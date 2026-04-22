"""Realtime voice router: ASR → LLM (Ollama) → TTS pipeline over WebSocket."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field

import httpx
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from pineastudio.services.asr import ASRUnavailableError, get_asr
from pineastudio.services.memory_manager import MemoryManager
from pineastudio.services.memory_tool import MemoryTool, TOOL_SCHEMA
from pineastudio.services.tts_service import TTSUnavailableError, get_tts

logger = logging.getLogger(__name__)

router = APIRouter(tags=["realtime"])

SENTENCE_RE = re.compile(r"(.+?[.!?。！？\n]+)(?=\s|$)", re.S)

OLLAMA_HOST = "http://localhost:11434"
DEFAULT_MODEL = "gemma4:e2b"
FALLBACK_MODELS = ["gemma4:e4b", "gemma4:26b"]
DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful local realtime voice assistant. "
    "Always reply in the same language the user speaks. "
    "If the user speaks Chinese, reply in Simplified Chinese (简体中文), never Traditional Chinese. "
    "Keep spoken responses concise (1-3 sentences)."
)
MAX_HISTORY = 20
SENTENCE_FLUSH_CHARS = 220

_memory: MemoryManager | None = None
_tool: MemoryTool | None = None
_prefs: "Preferences | None" = None

MAX_TOOL_ROUNDS = 2


def init_realtime_memory(mm: MemoryManager) -> None:
    global _memory, _tool
    _memory = mm
    _tool = MemoryTool(mm)


def init_realtime_prefs(prefs: "Preferences") -> None:
    global _prefs
    _prefs = prefs


def _strip_backend_prefix(model_id: str) -> str:
    """Remove 'ollama/' or similar backend prefix from model ID."""
    if "/" in model_id:
        return model_id.split("/", 1)[1]
    return model_id


def _rt_model() -> str:
    if _prefs:
        m = _prefs.get("realtime_model") or DEFAULT_MODEL
        return _strip_backend_prefix(m)
    return DEFAULT_MODEL


def _rt_fallbacks() -> list[str]:
    if _prefs:
        raw = _prefs.get("realtime_fallback_models") or FALLBACK_MODELS
        return [_strip_backend_prefix(m) for m in raw]
    return FALLBACK_MODELS


def _rt_ollama_host() -> str:
    if _prefs:
        return _prefs.get("ollama_host") or OLLAMA_HOST
    return OLLAMA_HOST


def _get_system_prompt(mode: str = "chat") -> str:
    if mode == "setup":
        from pineastudio.routers.setup import SETUP_SYSTEM_PROMPT
        return SETUP_SYSTEM_PROMPT

    if _memory and _memory.is_initialized():
        prompt = _memory.build_system_prompt()
        if prompt:
            return prompt

    return DEFAULT_SYSTEM_PROMPT


def extract_sentences(buf: str, flush_chars: int = SENTENCE_FLUSH_CHARS) -> tuple[str, list[str]]:
    sentences: list[str] = []
    cursor = 0
    for m in SENTENCE_RE.finditer(buf):
        sentences.append(m.group(1).strip())
        cursor = m.end()
    rest = buf[cursor:].lstrip()
    if not sentences and len(buf) >= flush_chars:
        cut = buf.rfind(" ", 0, flush_chars)
        if cut <= 0:
            cut = flush_chars
        sentences.append(buf[:cut].strip())
        rest = buf[cut:].lstrip()
    return rest, [s for s in sentences if s]


@dataclass
class SessionState:
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    conversation: list[dict] = field(default_factory=list)
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    active_task: asyncio.Task | None = None
    mode: str = "chat"

    def cancel_current(self) -> bool:
        if self.active_task and not self.active_task.done():
            self.cancel.set()
            return True
        return False


async def _send(ws: WebSocket, payload: dict) -> bool:
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_text(json.dumps(payload))
            return True
    except Exception:
        pass
    return False


async def _ollama_stream(text: str, image_b64: str, history: list[dict],
                         cancel: asyncio.Event) -> tuple[str, float]:
    """Stream LLM response from Ollama, yielding tokens. Returns (full_text, elapsed)."""
    msgs: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs.extend(history[-MAX_HISTORY * 2:])
    user_msg: dict = {"role": "user", "content": text}
    if image_b64:
        user_msg["images"] = [image_b64]
    msgs.append(user_msg)

    raise NotImplementedError  # placeholder, real implementation below


async def _summarize_realtime(conversation: list[dict]) -> None:
    """Summarize a realtime voice conversation and write to daily log."""
    try:
        from pineastudio.services.summarizer import summarize_conversation
        await summarize_conversation(
            conversation, _memory,
            ollama_host=_rt_ollama_host(),
            model=_rt_model(),
        )
    except Exception as e:
        logger.warning("Realtime summarization failed: %s", e)


async def _run_tool_pass(msgs: list[dict], state: SessionState) -> list[dict]:
    """Non-streaming tool-call loop. Returns updated messages list."""
    assert _tool is not None
    model = _rt_model()
    host = _rt_ollama_host()

    MEMORY_HINT = (
        "\n\nYou have a `memory` tool to persist important information. "
        "Use it silently when the user shares preferences, facts, or plans. "
        "Do NOT mention the tool to the user."
    )
    tool_msgs = list(msgs)
    if tool_msgs and tool_msgs[0].get("role") == "system":
        tool_msgs[0] = {**tool_msgs[0], "content": tool_msgs[0]["content"] + MEMORY_HINT}

    tools_payload = [{
        "type": "function",
        "function": TOOL_SCHEMA["function"],
    }]

    for round_i in range(MAX_TOOL_ROUNDS):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{host}/api/chat",
                    json={"model": model, "messages": tool_msgs, "stream": False,
                          "tools": tools_payload, "options": {"num_predict": 256}},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            logger.warning("Tool pass call failed: %s", e)
            break

        msg = data.get("message", {})
        tool_calls = msg.get("tool_calls")

        if not tool_calls:
            break

        logger.info("Realtime tool call round %d: %d call(s)", round_i + 1, len(tool_calls))
        tool_msgs.append(msg)

        for tc in tool_calls:
            func = tc.get("function", {})
            name = func.get("name", "")
            if name != "memory":
                tool_msgs.append({"role": "tool", "content": f"Error: unknown tool '{name}'"})
                continue
            try:
                args = func.get("arguments", {})
                if isinstance(args, str):
                    args = json.loads(args)
            except (json.JSONDecodeError, TypeError):
                args = {}
            result = _tool.execute(
                action=args.get("action", ""),
                file=args.get("file", ""),
                content=args.get("content", ""),
                old_content=args.get("old_content", ""),
            )
            logger.info("Realtime tool result: %s", result[:100])
            tool_msgs.append({"role": "tool", "content": result})

    return msgs


async def run_turn(ws: WebSocket, state: SessionState, *,
                   audio_b64: str | None = None, image_b64: str | None = None,
                   text_input: str | None = None):
    """Execute one conversation turn: ASR → LLM → TTS."""
    turn_id = uuid.uuid4().hex[:12]
    state.cancel = asyncio.Event()
    assistant_text = ""
    sentence_buf = ""
    audio_started = False
    tts_idx = 0

    try:
        # 1. Resolve user text
        if text_input is not None:
            user_text = text_input.strip()
        else:
            await _send(ws, {"type": "status", "phase": "transcribing"})
            wav_bytes = base64.b64decode(audio_b64 or "")
            asr = get_asr()
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, asr.transcribe_wav_bytes, wav_bytes)
            user_text = result.text.strip()
            logger.info("ASR [%s]: %r lang=%s reason=%s", turn_id, user_text[:80], result.language, result.reason)

        if not user_text:
            await _send(ws, {"type": "error", "message": "No speech detected."})
            return

        await _send(ws, {"type": "text", "transcription": user_text})

        # 2. LLM via Ollama (with optional tool-call pre-pass)
        await _send(ws, {"type": "status", "phase": "thinking"})

        system_prompt = _get_system_prompt(state.mode)
        msgs: list[dict] = [{"role": "system", "content": system_prompt}]
        msgs.extend(state.conversation[-MAX_HISTORY * 2:])
        user_msg: dict = {"role": "user", "content": user_text}
        if image_b64:
            user_msg["images"] = [image_b64]
        msgs.append(user_msg)

        # Tool-call pre-pass (non-streaming) — only in chat mode with memory
        if state.mode == "chat" and _tool and _memory and _memory.is_initialized():
            msgs = await _run_tool_pass(msgs, state)

        t0 = time.time()
        tts_t0: float | None = None

        model = _rt_model()
        fallbacks = _rt_fallbacks()
        candidates = [model] + [m for m in fallbacks if m != model]
        last_err: Exception | None = None

        for model in candidates:
            try:
                async with httpx.AsyncClient(timeout=180) as client:
                    async with client.stream(
                        "POST", f"{_rt_ollama_host()}/api/chat",
                        json={"model": model, "messages": msgs, "stream": True, "options": {"num_predict": 512}},
                    ) as resp:
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if state.cancel.is_set():
                                break
                            if not line:
                                continue
                            data = json.loads(line)
                            if "error" in data:
                                raise RuntimeError(data["error"])
                            chunk = data.get("message", {}).get("content", "")
                            if chunk:
                                assistant_text += chunk
                                sentence_buf += chunk
                                await _send(ws, {"type": "assistant_token", "text": chunk})

                                sentence_buf, sentences = extract_sentences(sentence_buf)
                                if sentences:
                                    logger.info("Extracted %d sentence(s) from buf, remaining=%d chars", len(sentences), len(sentence_buf))
                                for sentence in sentences:
                                    if state.cancel.is_set():
                                        break
                                    if tts_t0 is None:
                                        tts_t0 = time.time()
                                    audio_started = await _tts_sentence(
                                        ws, state, sentence, audio_started, tts_idx,
                                    )
                                    tts_idx += 1
                            if data.get("done"):
                                break
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                logger.warning("Model %s failed: %s, trying next...", model, exc)
                continue

        if last_err:
            raise last_err

        llm_time = time.time() - t0

        # Flush remaining text
        logger.info("Flush check [%s]: sentence_buf=%r cancel=%s", turn_id, sentence_buf.strip()[:60], state.cancel.is_set())
        if sentence_buf.strip() and not state.cancel.is_set():
            if tts_t0 is None:
                tts_t0 = time.time()
            audio_started = await _tts_sentence(ws, state, sentence_buf.strip(), audio_started, tts_idx)
            tts_idx += 1

        if audio_started and not state.cancel.is_set():
            tts_time = round(time.time() - (tts_t0 or t0), 2)
            await _send(ws, {"type": "audio_end", "tts_time": tts_time})

        logger.info("LLM done [%s]: %d chars in %.2fs", turn_id, len(assistant_text), llm_time)
        await _send(ws, {"type": "text", "text": assistant_text, "llm_time": round(llm_time, 2)})

        state.conversation.append({"role": "user", "content": user_text})
        state.conversation.append({"role": "assistant", "content": assistant_text})

    except asyncio.CancelledError:
        logger.info("Turn cancelled [%s]", turn_id)
        if audio_started:
            await _send(ws, {"type": "audio_end"})
    except ASRUnavailableError as exc:
        logger.warning("ASR unavailable [%s]: %s", turn_id, exc)
        await _send(ws, {"type": "error", "message": str(exc)})
    except Exception as exc:
        logger.error("Turn error [%s]: %s", turn_id, exc, exc_info=True)
        await _send(ws, {"type": "error", "message": str(exc)})
    finally:
        state.active_task = None


async def _tts_sentence(ws: WebSocket, state: SessionState,
                        text: str, audio_started: bool, idx: int) -> bool:
    if state.cancel.is_set():
        return audio_started
    logger.info("TTS synthesizing [%d]: %r", idx, text[:60])
    try:
        tts = get_tts()
        loop = asyncio.get_event_loop()
        pcm, sr = await loop.run_in_executor(None, tts.generate_pcm, text)
        logger.info("TTS done [%d]: %d samples at %dHz", idx, len(pcm), sr)
    except TTSUnavailableError as exc:
        logger.warning("TTS unavailable [%d]: %s", idx, exc)
        return audio_started
    except Exception as exc:
        logger.error("TTS error [%d]: %s", idx, exc, exc_info=True)
        return audio_started

    if not audio_started:
        if not await _send(ws, {"type": "audio_start", "sample_rate": sr}):
            return audio_started

    pcm_i16 = (np.clip(pcm, -1.0, 1.0) * 32767).astype(np.int16)
    await _send(ws, {
        "type": "audio_chunk",
        "audio": base64.b64encode(pcm_i16.tobytes()).decode("ascii"),
        "index": idx,
    })
    return True


@router.get("/api/realtime/status")
async def realtime_status():
    asr = get_asr()
    tts = get_tts()
    return {
        "asr": asr.status,
        "tts": tts.status,
        "model": _rt_model(),
        "ollama_host": _rt_ollama_host(),
    }


@router.websocket("/ws/realtime")
async def realtime_ws(ws: WebSocket):
    await ws.accept()
    state = SessionState()
    logger.info("Realtime WS connected [%s]", state.session_id)

    await _send(ws, {
        "type": "ready",
        "config": {
            "model_name": _rt_model(),
            "sample_rate": 16000,
        },
        "asr": get_asr().status,
        "tts": get_tts().status,
    })

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            # Parlor-style: {audio, image} without type field
            if "audio" in data and "type" not in data:
                if state.active_task and not state.active_task.done():
                    state.cancel_current()
                    await asyncio.sleep(0.1)
                state.active_task = asyncio.create_task(
                    run_turn(ws, state, audio_b64=data["audio"], image_b64=data.get("image"))
                )

            elif msg_type == "interrupt":
                if state.cancel_current():
                    logger.info("Barge-in [%s]", state.session_id)
                    await _send(ws, {"type": "audio_end"})

            elif msg_type == "text_input":
                if state.active_task and not state.active_task.done():
                    state.cancel_current()
                    await asyncio.sleep(0.1)
                state.active_task = asyncio.create_task(
                    run_turn(ws, state, text_input=data.get("text", ""), image_b64=data.get("image"))
                )

            elif msg_type == "setup_start":
                state.mode = "setup"
                state.conversation = []
                logger.info("Switched to setup mode [%s]", state.session_id)
                await _send(ws, {"type": "mode", "mode": "setup"})

            elif msg_type == "ping":
                await _send(ws, {"type": "pong"})

    except WebSocketDisconnect:
        logger.info("Realtime WS disconnected [%s]", state.session_id)
    except Exception as e:
        logger.warning("Realtime WS error [%s]: %s", state.session_id, e)
    finally:
        state.cancel_current()
        if state.active_task and not state.active_task.done():
            state.active_task.cancel()
        if state.conversation and _memory and _memory.is_initialized() and state.mode == "chat":
            asyncio.create_task(_summarize_realtime(state.conversation))
