"""OpenAI-compatible proxy: /v1/* routes requests to the appropriate backend."""
from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.responses import JSONResponse, StreamingResponse

from pineastudio.services.backend_manager import BackendManager

router = APIRouter()
_manager: BackendManager | None = None


def init_proxy(manager: BackendManager) -> None:
    global _manager
    _manager = manager


def _get_manager() -> BackendManager:
    assert _manager is not None
    return _manager


@router.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "")
    stream = body.get("stream", False)
    mgr = _get_manager()

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
