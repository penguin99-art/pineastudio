from __future__ import annotations

from fastapi import APIRouter, HTTPException

from pineastudio.schemas import BackendCreate, BackendInfo
from pineastudio.services.backend_manager import BackendManager
from pineastudio.services.backends.base import ManagedBackend

router = APIRouter(prefix="/api/backends", tags=["backends"])
_manager: BackendManager | None = None


def init_backends_router(manager: BackendManager) -> None:
    global _manager
    _manager = manager


def _mgr() -> BackendManager:
    assert _manager is not None
    return _manager


@router.get("", response_model=list[BackendInfo])
async def list_backends():
    return await _mgr().list_backend_info()


@router.post("", response_model=BackendInfo)
async def add_backend(req: BackendCreate):
    mgr = _mgr()
    if mgr.get(req.id):
        raise HTTPException(400, f"Backend '{req.id}' already exists")
    backend = await mgr.add_backend(req.id, req.type.value, req.base_url)
    healthy = await backend.health_check()
    models = await backend.list_models() if healthy else []
    return BackendInfo(
        id=backend.id,
        type=backend.backend_type,
        kind=backend.kind,
        base_url=backend.base_url,
        healthy=healthy,
        model_count=len(models),
    )


@router.delete("/{backend_id}")
async def remove_backend(backend_id: str):
    mgr = _mgr()
    if not mgr.get(backend_id):
        raise HTTPException(404, f"Backend '{backend_id}' not found")
    await mgr.remove_backend(backend_id)
    return {"ok": True}


@router.get("/{backend_id}/health")
async def health_check(backend_id: str):
    backend = _mgr().get(backend_id)
    if not backend:
        raise HTTPException(404, f"Backend '{backend_id}' not found")
    healthy = await backend.health_check()
    return {"id": backend_id, "healthy": healthy}


@router.post("/{backend_id}/start")
async def start_backend(backend_id: str):
    backend = _mgr().get(backend_id)
    if not backend:
        raise HTTPException(404, f"Backend '{backend_id}' not found")
    if not isinstance(backend, ManagedBackend):
        raise HTTPException(400, "Only managed backends can be started")
    await backend.start()
    return {"ok": True}


@router.post("/{backend_id}/stop")
async def stop_backend(backend_id: str):
    backend = _mgr().get(backend_id)
    if not backend:
        raise HTTPException(404, f"Backend '{backend_id}' not found")
    if not isinstance(backend, ManagedBackend):
        raise HTTPException(400, "Only managed backends can be stopped")
    await backend.stop()
    return {"ok": True}
