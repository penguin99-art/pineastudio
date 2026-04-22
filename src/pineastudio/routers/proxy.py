"""OpenAI-compatible proxy: /v1/* routes requests to the appropriate backend.

Memory injection: /v1/chat/completions automatically prepends the memory
system prompt (SOUL + USER + MEMORY + daily) when inject_memory=true (default).

Tool call loop: when memory is initialized, the proxy injects a `memory` tool
schema.  If the LLM responds with tool_calls, the proxy executes them via
MemoryTool, appends results, and re-calls the LLM (up to MAX_TOOL_ROUNDS).
The final text response is then streamed to the client.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse, StreamingResponse

from pineastudio.services.backend_manager import BackendManager
from pineastudio.services.memory_manager import MemoryManager
from pineastudio.services.memory_tool import MemoryTool, TOOL_SCHEMA

logger = logging.getLogger(__name__)

router = APIRouter()
_manager: BackendManager | None = None
_memory: MemoryManager | None = None
_tool: MemoryTool | None = None

MAX_TOOL_ROUNDS = 3

MEMORY_INSTRUCTION = (
    "\n\n---\n\n"
    "[IMPORTANT — Memory Tool]\n"
    "You have a `memory` tool. When the user shares personal info (name, preferences, "
    "plans, facts, interests), you MUST call the memory tool with action='add' to save it. "
    "Do NOT just say 'I will remember' — actually call the tool. "
    "Do NOT mention the tool to the user. "
    "Do NOT save trivial greetings or chitchat."
)


def init_proxy(manager: BackendManager, memory: MemoryManager | None = None) -> None:
    global _manager, _memory, _tool
    _manager = manager
    _memory = memory
    if memory:
        _tool = MemoryTool(memory)


def _get_manager() -> BackendManager:
    assert _manager is not None
    return _manager


def _inject_memory(body: dict) -> dict:
    """Prepend memory system prompt + tool instruction to messages."""
    if _memory is None or not _memory.is_initialized():
        return body
    if body.get("_skip_memory"):
        body.pop("_skip_memory", None)
        return body

    memory_prompt = _memory.build_system_prompt()
    if not memory_prompt:
        return body

    memory_prompt += MEMORY_INSTRUCTION

    messages = list(body.get("messages", []))
    if messages and messages[0].get("role") == "system":
        messages[0] = {
            "role": "system",
            "content": memory_prompt + "\n\n---\n\n" + messages[0]["content"],
        }
    else:
        messages.insert(0, {"role": "system", "content": memory_prompt})

    body = {**body, "messages": messages}
    return body


def _should_use_tools(body: dict) -> bool:
    """Decide whether to inject memory tools into this request."""
    if _tool is None or _memory is None or not _memory.is_initialized():
        return False
    if body.get("_skip_memory"):
        return False
    if body.get("tools"):
        return False
    return True


def _exec_tool_call(tc: dict) -> str:
    """Execute a single tool call and return the result string."""
    assert _tool is not None
    func = tc.get("function", {})
    name = func.get("name", "")
    if name != "memory":
        return f"Error: unknown tool '{name}'"
    try:
        args = json.loads(func.get("arguments", "{}"))
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON arguments: {e}"
    return _tool.execute(
        action=args.get("action", ""),
        file=args.get("file", ""),
        content=args.get("content", ""),
        old_content=args.get("old_content", ""),
    )


async def _chat_with_tools(model: str, body: dict) -> dict:
    """Run the tool-call loop (non-streaming).

    Always returns a complete response dict. If no tool calls happen,
    returns the first response directly (avoiding a redundant second call).
    """
    mgr = _get_manager()
    messages = list(body.get("messages", []))
    tool_body = {**body, "stream": False, "tools": [TOOL_SCHEMA], "messages": messages}

    for round_i in range(MAX_TOOL_ROUNDS):
        logger.info("Tool pass round %d: model=%s, messages=%d, tools=%d, body_keys=%s",
                     round_i, model, len(messages), len(tool_body.get("tools", [])),
                     list(tool_body.keys()))
        resp = await mgr.proxy_to_backend(model, "POST", "/v1/chat/completions", tool_body)
        if resp.status_code != 200:
            logger.warning("Tool pass got status %d", resp.status_code)
            raise RuntimeError(f"Backend returned {resp.status_code}")

        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {})
        tool_calls = msg.get("tool_calls")
        finish = choice.get("finish_reason", "")

        logger.info("Tool pass result: finish=%s, tool_calls=%s, content_len=%d",
                     finish, bool(tool_calls), len(msg.get("content", "")))

        if not tool_calls:
            return data

        logger.info("Tool call round %d: %d call(s)", round_i + 1, len(tool_calls))
        messages.append(msg)

        for tc in tool_calls:
            result = _exec_tool_call(tc)
            logger.info("Tool result: %s", result[:120])
            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "content": result,
            })

        tool_body = {**tool_body, "messages": messages}

    resp = await mgr.proxy_to_backend(
        model, "POST", "/v1/chat/completions",
        {**body, "stream": False, "messages": messages},
    )
    return resp.json()


def _response_to_sse(data: dict) -> bytes:
    """Convert a non-streaming response dict to SSE format for the client."""
    import uuid
    choice = (data.get("choices") or [{}])[0]
    content = choice.get("message", {}).get("content", "")
    chunk = {
        "id": data.get("id", f"chatcmpl-{uuid.uuid4().hex[:8]}"),
        "object": "chat.completion.chunk",
        "model": data.get("model", ""),
        "choices": [{
            "index": 0,
            "delta": {"role": "assistant", "content": content},
            "finish_reason": None,
        }],
    }
    done_chunk = {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}

    lines = f"data: {json.dumps(chunk)}\n\ndata: {json.dumps(done_chunk)}\n\ndata: [DONE]\n\n"
    return lines.encode()


async def _sse_from_tool_result(data: dict):
    """Yield SSE bytes from a completed tool-call result."""
    yield _response_to_sse(data)


@router.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)
    mgr = _get_manager()

    body = _inject_memory(body)

    use_tools = _should_use_tools(body)

    if use_tools:
        try:
            result = await _chat_with_tools(model, body)
            if stream:
                return StreamingResponse(
                    _sse_from_tool_result(result),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )
            return JSONResponse(content=result)
        except Exception as e:
            logger.warning("Tool call pass failed, falling back to normal path: %s", e)

    if stream:
        return StreamingResponse(
            mgr.proxy_stream_to_backend(model, "POST", "/v1/chat/completions", body),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    resp = await mgr.proxy_to_backend(model, "POST", "/v1/chat/completions", body)
    return JSONResponse(content=resp.json(), status_code=resp.status_code)


@router.post("/v1/completions")
async def completions(request: Request):
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)
    mgr = _get_manager()

    if stream:
        return StreamingResponse(
            mgr.proxy_stream_to_backend(model, "POST", "/v1/completions", body),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    resp = await mgr.proxy_to_backend(model, "POST", "/v1/completions", body)
    return JSONResponse(content=resp.json(), status_code=resp.status_code)


@router.post("/v1/embeddings")
async def embeddings(request: Request):
    body = await request.json()
    model = body.get("model", "")
    mgr = _get_manager()
    resp = await mgr.proxy_to_backend(model, "POST", "/v1/embeddings", body)
    return JSONResponse(content=resp.json(), status_code=resp.status_code)


@router.get("/v1/models")
async def list_models():
    mgr = _get_manager()
    models = await mgr.list_all_models()
    return {
        "object": "list",
        "data": [
            {"id": m.id, "object": "model", "owned_by": m.backend_id}
            for m in models
        ],
    }
