"""OpenAI-compatible proxy: /v1/* routes requests to the appropriate backend.

Memory injection: /v1/chat/completions automatically prepends the memory
system prompt (SOUL + USER + MEMORY + daily) when inject_memory=true (default).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse, StreamingResponse

from pineastudio.services.backend_manager import BackendManager
from pineastudio.services.memory_manager import MemoryManager

logger = logging.getLogger(__name__)

router = APIRouter()
_manager: BackendManager | None = None
_memory: MemoryManager | None = None


def init_proxy(manager: BackendManager, memory: MemoryManager | None = None) -> None:
    global _manager, _memory
    _manager = manager
    _memory = memory


def _get_manager() -> BackendManager:
    assert _manager is not None
    return _manager


def _inject_memory(body: dict) -> dict:
    """Prepend memory system prompt to messages if available."""
    if _memory is None or not _memory.is_initialized():
        return body
    if body.get("_skip_memory"):
        body.pop("_skip_memory", None)
        return body

    memory_prompt = _memory.build_system_prompt()
    if not memory_prompt:
        return body

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


@router.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)
    mgr = _get_manager()

    body = _inject_memory(body)

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
