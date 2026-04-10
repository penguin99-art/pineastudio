from __future__ import annotations

from fastapi import APIRouter

from pineastudio.schemas import SystemInfo
from pineastudio.services.hardware import get_system_info

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/info", response_model=SystemInfo)
async def system_info():
    return get_system_info()
