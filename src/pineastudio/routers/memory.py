"""Memory API: read/write memory files, memory tool, reinitialize."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pineastudio.services.memory_manager import MemoryManager
from pineastudio.services.memory_tool import MemoryTool

router = APIRouter(prefix="/api/memory", tags=["memory"])

_mm: MemoryManager | None = None
_tool: MemoryTool | None = None


def init_memory_router(mm: MemoryManager) -> None:
    global _mm, _tool
    _mm = mm
    _tool = MemoryTool(mm)


def _get_mm() -> MemoryManager:
    assert _mm is not None
    return _mm


def _get_tool() -> MemoryTool:
    assert _tool is not None
    return _tool


@router.get("/status")
async def memory_status():
    return _get_mm().status()


@router.get("/stats")
async def memory_stats():
    mm = _get_mm()
    from pineastudio.services.memory_tool import CHAR_LIMITS
    stats = {}
    for name in ("SOUL.md", "USER.md", "MEMORY.md"):
        content = mm.read(name)
        limit = CHAR_LIMITS.get(name)
        stats[name] = {
            "chars": len(content),
            "limit": limit,
            "usage_pct": round(len(content) / limit * 100, 1) if limit else None,
            "lines": content.count("\n") + 1 if content else 0,
        }

    daily_count = 0
    if mm.daily_dir.exists():
        daily_count = len(list(mm.daily_dir.glob("*.md")))
    stats["daily_count"] = daily_count
    return stats


@router.get("/daily/list")
async def list_daily():
    mm = _get_mm()
    daily_dir = mm.daily_dir
    if not daily_dir.exists():
        return {"files": []}
    files = sorted(daily_dir.glob("*.md"), reverse=True)
    result = []
    for f in files[:30]:
        result.append({
            "date": f.stem,
            "size": f.stat().st_size,
        })
    return {"files": result}


@router.get("/daily/{date_str}")
async def read_daily(date_str: str):
    mm = _get_mm()
    path = mm.daily_dir / f"{date_str}.md"
    if not path.exists():
        return {"date": date_str, "content": "", "exists": False}
    return {"date": date_str, "content": path.read_text(encoding="utf-8"), "exists": True}


class MemoryToolBody(BaseModel):
    action: str
    file: str
    content: str = ""
    old_content: str = ""


@router.post("/tool")
async def memory_tool_call(body: MemoryToolBody):
    result = _get_tool().execute(body.action, body.file, body.content, body.old_content)
    ok = result.startswith("OK")
    if not ok:
        raise HTTPException(400, result)
    return {"ok": True, "message": result}


@router.post("/reinitialize")
async def reinitialize():
    mm = _get_mm()
    mm.backup_and_reset()
    return {"ok": True, "message": "Memory reset. SOUL.md removed — next visit will trigger setup."}


@router.get("/file/{filename}")
async def read_memory(filename: str):
    if filename not in ("SOUL.md", "USER.md", "MEMORY.md"):
        raise HTTPException(400, f"Invalid filename: {filename}")
    mm = _get_mm()
    return {"filename": filename, "content": mm.read(filename), **mm.file_info(filename)}


class MemoryWriteBody(BaseModel):
    content: str


@router.put("/file/{filename}")
async def write_memory(filename: str, body: MemoryWriteBody):
    if filename not in ("SOUL.md", "USER.md", "MEMORY.md"):
        raise HTTPException(400, f"Invalid filename: {filename}")
    _get_mm().write(filename, body.content)
    return {"ok": True, "size": len(body.content)}
