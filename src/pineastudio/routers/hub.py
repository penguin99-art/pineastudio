from __future__ import annotations

import asyncio
from functools import partial

from fastapi import APIRouter, HTTPException, Query

from pineastudio.config import Settings
from pineastudio.db import Database
from pineastudio.schemas import DownloadTask, HubDownloadRequest, HubSearchResult
from pineastudio.services import downloader

router = APIRouter(prefix="/api/hub", tags=["hub"])
_db: Database | None = None
_settings: Settings | None = None


def init_hub_router(db: Database, settings: Settings) -> None:
    global _db, _settings
    _db = db
    _settings = settings


@router.get("/search", response_model=list[HubSearchResult])
async def search_models(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=50),
):
    from huggingface_hub import list_models

    results = await asyncio.to_thread(
        partial(
            list_models,
            search=q,
            library="gguf",
            sort="downloads",
            limit=limit,
        )
    )

    return [
        HubSearchResult(
            repo_id=m.id,
            author=m.author or "",
            downloads=m.downloads or 0,
            likes=m.likes or 0,
            tags=list(m.tags or []),
        )
        for m in results
    ]


@router.get("/model/{repo_id:path}")
async def model_detail(repo_id: str):
    from huggingface_hub import list_repo_tree

    files = await asyncio.to_thread(
        partial(list_repo_tree, repo_id, repo_type="model")
    )

    gguf_files = []
    for f in files:
        name = getattr(f, "rfilename", None) or getattr(f, "path", "")
        if name.endswith(".gguf"):
            gguf_files.append({
                "filename": name,
                "size_bytes": getattr(f, "size", None),
            })

    return {"repo_id": repo_id, "gguf_files": gguf_files}


@router.post("/download", response_model=DownloadTask)
async def start_download(req: HubDownloadRequest):
    assert _db is not None and _settings is not None
    task_id = await downloader.start_download(
        _db, req.repo_id, req.filename, _settings.models_dir, _settings.hf_token,
    )
    return DownloadTask(
        task_id=task_id, repo_id=req.repo_id, filename=req.filename, status="pending",
    )


@router.get("/downloads", response_model=list[DownloadTask])
async def list_downloads():
    assert _db is not None
    rows = await _db.list_downloads()
    return [
        DownloadTask(
            task_id=r["task_id"],
            repo_id=r["repo_id"],
            filename=r["filename"],
            status=r["status"],
            progress=downloader.get_progress(r["task_id"]),
            error=r.get("error"),
        )
        for r in rows
    ]
