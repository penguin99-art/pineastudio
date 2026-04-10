from __future__ import annotations

from fastapi import APIRouter

from pineastudio.schemas import ModelListResponse
from pineastudio.services.backend_manager import BackendManager

router = APIRouter(prefix="/api/models", tags=["models"])
_manager: BackendManager | None = None


def init_models_router(manager: BackendManager) -> None:
    global _manager
    _manager = manager


def _mgr() -> BackendManager:
    assert _manager is not None
    return _manager


@router.get("", response_model=ModelListResponse)
async def list_all_models():
    models = await _mgr().list_all_models()
    return ModelListResponse(models=models)
