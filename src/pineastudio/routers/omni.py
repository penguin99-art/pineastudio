"""Omni router: WebSocket for real-time voice + REST for server control."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
from starlette.websockets import WebSocketState

from pineastudio.services.backend_manager import BackendManager
from pineastudio.services.backends.llama_omni import LlamaOmniBackend
from pineastudio.services.omni_session import OmniSession

logger = logging.getLogger(__name__)

router = APIRouter(tags=["omni"])

_manager: BackendManager | None = None
_active_session: OmniSession | None = None

DEFAULT_MODEL_DIR = "/home/pineapi/gy/cases/edge-agent/models/MiniCPM-o-4_5-gguf"
DEFAULT_BINARY = "/home/pineapi/gy/llama.cpp-omni/build/bin/llama-server"


def init_omni_router(manager: BackendManager) -> None:
    global _manager
    _manager = manager


def _get_omni_backend() -> LlamaOmniBackend:
    assert _manager is not None
    for b in _manager.all_backends():
        if isinstance(b, LlamaOmniBackend):
            return b
    raise HTTPException(404, "No omni backend registered. Add one via Settings or /api/omni/setup.")


class OmniSetupRequest(BaseModel):
    model_dir: str = DEFAULT_MODEL_DIR
    binary_path: str = DEFAULT_BINARY
    port: int = 9060


@router.post("/api/omni/setup")
async def setup_omni(body: OmniSetupRequest):
    """Register and optionally start the omni backend."""
    assert _manager is not None
    existing = _manager.get("omni")
    if existing:
        _manager.unregister("omni")

    backend = LlamaOmniBackend(
        id="omni",
        base_url=f"http://localhost:{body.port}",
        binary_path=body.binary_path,
        model_dir=body.model_dir,
    )
    _manager.register(backend)
    return {"ok": True, "id": "omni", "base_url": backend.base_url}


@router.post("/api/omni/start")
async def start_omni():
    backend = _get_omni_backend()
    if backend.is_running():
        return {"ok": True, "status": "already_running"}
    await backend.start()
    return {"ok": True, "status": "starting"}


@router.post("/api/omni/stop")
async def stop_omni():
    backend = _get_omni_backend()
    await backend.stop()
    return {"ok": True, "status": "stopped"}


@router.get("/api/omni/status")
async def omni_status():
    assert _manager is not None
    try:
        backend = _get_omni_backend()
    except HTTPException:
        return {
            "registered": False,
            "running": False,
            "healthy": False,
            "omni_initialized": False,
        }
    return {
        "registered": True,
        "running": backend.is_running(),
        "healthy": await backend.health_check(),
        "omni_initialized": backend.omni_initialized,
    }


@router.websocket("/ws/omni")
async def omni_ws(ws: WebSocket):
    global _active_session
    await ws.accept()
    logger.info("Omni WebSocket connected")

    session: OmniSession | None = None
    ws_alive = True

    async def send_msg(msg: dict) -> None:
        if not ws_alive:
            return
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_text(json.dumps(msg))
        except Exception:
            pass

    async def ping_loop():
        """Send periodic pings to keep the WebSocket alive."""
        while ws_alive:
            try:
                await asyncio.sleep(15)
                if ws.client_state == WebSocketState.CONNECTED:
                    await ws.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break

    ping_task = asyncio.create_task(ping_loop())

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")

            if msg_type == "pong":
                continue

            if msg_type == "start":
                logger.info("Received 'start' command")
                if session:
                    await session.stop()
                    session = None

                try:
                    backend = _get_omni_backend()
                    logger.info("Found existing omni backend")
                except HTTPException:
                    assert _manager is not None
                    logger.info("No omni backend found, creating new one")
                    backend = LlamaOmniBackend(
                        id="omni",
                        base_url="http://localhost:9060",
                        binary_path=DEFAULT_BINARY,
                        model_dir=DEFAULT_MODEL_DIR,
                    )
                    _manager.register(backend)

                config = msg.get("config", {})
                session = OmniSession(backend, send_msg)
                _active_session = session
                try:
                    await session.start(
                        media_type=config.get("media_type", 2),
                        use_tts=config.get("use_tts", True),
                        duplex_mode=config.get("duplex_mode", False),
                        voice_audio=config.get("voice_audio"),
                    )
                except Exception as e:
                    logger.error("session.start() failed: %s", e, exc_info=True)
                    await send_msg({"type": "error", "message": f"Failed to start session: {e}"})

            elif msg_type == "audio" and session:
                await session.feed_audio(msg.get("data", ""))

            elif msg_type == "image" and session:
                session.feed_image(msg.get("data", ""))

            elif msg_type == "mute" and session:
                session.set_muted(msg.get("muted", True))

            elif msg_type == "stop" and session:
                await session.stop()
                session = None
                _active_session = None

    except WebSocketDisconnect:
        logger.info("Omni WebSocket disconnected")
    except Exception as e:
        logger.warning("Omni WS error: %s", e)
    finally:
        ws_alive = False
        ping_task.cancel()
        if session:
            await session.stop()
            session = None
            _active_session = None
