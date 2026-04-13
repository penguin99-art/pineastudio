"""Settings API: read/write user preferences."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from pineastudio.services.preferences import Preferences

router = APIRouter(prefix="/api/settings", tags=["settings"])

_prefs: Preferences | None = None


def init_settings_router(prefs: Preferences) -> None:
    global _prefs
    _prefs = prefs


def _get_prefs() -> Preferences:
    assert _prefs is not None
    return _prefs


@router.get("")
async def get_settings():
    return _get_prefs().get_all()


class UpdateBody(BaseModel):
    changes: dict


@router.put("")
async def update_settings(body: UpdateBody):
    return _get_prefs().update(body.changes)
