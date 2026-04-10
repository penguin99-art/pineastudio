from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path

from pineastudio.db import Database

logger = logging.getLogger(__name__)

_active_tasks: dict[str, asyncio.Task] = {}
_progress: dict[str, float] = {}


def get_progress(task_id: str) -> float:
    return _progress.get(task_id, 0.0)


async def start_download(
    db: Database,
    repo_id: str,
    filename: str,
    models_dir: Path,
    hf_token: str = "",
) -> str:
    task_id = uuid.uuid4().hex[:12]
    await db.create_download(task_id, repo_id, filename)

    task = asyncio.create_task(
        _download_worker(db, task_id, repo_id, filename, models_dir, hf_token)
    )
    _active_tasks[task_id] = task
    return task_id


async def _download_worker(
    db: Database,
    task_id: str,
    repo_id: str,
    filename: str,
    models_dir: Path,
    hf_token: str,
) -> None:
    try:
        await db.update_download(task_id, status="downloading")
        _progress[task_id] = 0.0

        local_path = await asyncio.to_thread(
            _hf_download, repo_id, filename, hf_token
        )

        symlink_path = models_dir / filename
        if not symlink_path.exists():
            os.symlink(local_path, symlink_path)
            logger.info("Created symlink: %s -> %s", symlink_path, local_path)

        _progress[task_id] = 1.0
        await db.update_download(task_id, status="done", progress=1.0)
        logger.info("Download complete: %s/%s", repo_id, filename)

    except Exception as e:
        logger.error("Download failed: %s/%s: %s", repo_id, filename, e)
        await db.update_download(task_id, status="error", error=str(e))
    finally:
        _active_tasks.pop(task_id, None)


def _hf_download(repo_id: str, filename: str, hf_token: str) -> str:
    from huggingface_hub import hf_hub_download

    token = hf_token or None
    path = hf_hub_download(repo_id=repo_id, filename=filename, token=token)
    return path
