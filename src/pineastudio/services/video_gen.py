"""Video generation service.

Manages local diffusers video pipelines (Wan 2.x, LTX, etc.) with:
  * lazy loading (model loaded on first job)
  * single-worker queue (one GPU job at a time)
  * persistent job records on disk
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Known local model search paths (modelscope + HF hub style)
DEFAULT_MODEL_SEARCH_DIRS = [
    Path.home() / ".cache" / "modelscope" / "hub" / "models",
    Path.home() / ".cache" / "huggingface" / "hub",
]

# Map directory-name -> human readable info
KNOWN_MODELS: dict[str, dict[str, Any]] = {
    "Wan2___1-T2V-1___3B-Diffusers": {
        "id": "wan2.1-t2v-1.3b",
        "name": "Wan 2.1 T2V 1.3B",
        "pipeline": "WanPipeline",
        "params_b": 1.3,
        "vram_gb_min": 8,
        "default_steps": 25,
        "default_frames": 25,
        "default_size": (832, 480),
        "default_fps": 16,
        "default_guidance": 5.0,
    },
    "Wan2___1-T2V-14B-Diffusers": {
        "id": "wan2.1-t2v-14b",
        "name": "Wan 2.1 T2V 14B",
        "pipeline": "WanPipeline",
        "params_b": 14.0,
        "vram_gb_min": 24,
        "default_steps": 30,
        "default_frames": 81,
        "default_size": (1280, 720),
        "default_fps": 16,
        "default_guidance": 5.0,
    },
    "Wan2___2-T2V-A14B-Diffusers": {
        "id": "wan2.2-t2v-a14b",
        "name": "Wan 2.2 T2V A14B (MoE)",
        "pipeline": "WanPipeline",
        "params_b": 14.0,
        "vram_gb_min": 24,
        "default_steps": 30,
        "default_frames": 81,
        "default_size": (1280, 720),
        "default_fps": 16,
        "default_guidance": 5.0,
    },
}


@dataclass
class VideoJob:
    id: str
    model_id: str
    prompt: str
    negative_prompt: str
    width: int
    height: int
    num_frames: int
    num_inference_steps: int
    guidance_scale: float
    fps: int
    seed: int
    status: str = "queued"  # queued | loading | running | done | error
    progress: float = 0.0   # 0.0-1.0
    progress_step: int = 0
    progress_total: int = 0
    output_path: str | None = None
    output_size: int = 0
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    elapsed_load_s: float | None = None
    elapsed_gen_s: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class VideoService:
    def __init__(self, output_dir: Path) -> None:
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.jobs_dir = output_dir / "_jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

        self._jobs: dict[str, VideoJob] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

        # In-memory pipeline cache: model_id -> pipeline
        self._pipelines: dict[str, Any] = {}
        self._loaded_paths: dict[str, str] = {}

        self._load_jobs_from_disk()

    # ---------- model discovery ----------

    def list_local_models(self) -> list[dict[str, Any]]:
        """Scan known cache dirs for installed video models."""
        found: list[dict[str, Any]] = []
        for base in DEFAULT_MODEL_SEARCH_DIRS:
            if not base.exists():
                continue
            for sub in base.glob("**/*"):
                if not sub.is_dir():
                    continue
                meta = KNOWN_MODELS.get(sub.name)
                if not meta:
                    continue
                # Validate it has model_index.json
                if not (sub / "model_index.json").is_file():
                    continue
                size_gb = _dir_size_gb(sub)
                found.append({
                    **meta,
                    "path": str(sub),
                    "size_gb": round(size_gb, 2),
                    "loaded": meta["id"] in self._pipelines,
                })
        # Dedupe by id, prefer larger / first found
        seen: set[str] = set()
        out = []
        for m in found:
            if m["id"] in seen:
                continue
            seen.add(m["id"])
            out.append(m)
        out.sort(key=lambda x: x.get("params_b", 0))
        return out

    def get_model_info(self, model_id: str) -> dict[str, Any] | None:
        for m in self.list_local_models():
            if m["id"] == model_id:
                return m
        return None

    # ---------- jobs ----------

    def list_jobs(self) -> list[dict[str, Any]]:
        items = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
        return [j.to_dict() for j in items]

    def get_job(self, job_id: str) -> VideoJob | None:
        return self._jobs.get(job_id)

    async def submit_job(
        self,
        *,
        model_id: str,
        prompt: str,
        negative_prompt: str = "",
        width: int = 832,
        height: int = 480,
        num_frames: int = 25,
        num_inference_steps: int = 25,
        guidance_scale: float = 5.0,
        fps: int = 16,
        seed: int = -1,
    ) -> VideoJob:
        info = self.get_model_info(model_id)
        if not info:
            raise ValueError(f"Model not found locally: {model_id}")

        if seed < 0:
            seed = int.from_bytes(os.urandom(4), "big")

        job = VideoJob(
            id=uuid.uuid4().hex[:12],
            model_id=model_id,
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            fps=fps,
            seed=seed,
        )
        self._jobs[job.id] = job
        self._save_job(job)

        await self._queue.put(job.id)
        self._ensure_worker()
        return job

    def cancel_job(self, job_id: str) -> bool:
        """Mark a queued job as cancelled (running jobs cannot be interrupted)."""
        job = self._jobs.get(job_id)
        if not job:
            return False
        if job.status == "queued":
            job.status = "error"
            job.error = "cancelled"
            job.finished_at = time.time()
            self._save_job(job)
            return True
        return False

    def delete_job(self, job_id: str) -> bool:
        job = self._jobs.pop(job_id, None)
        if not job:
            return False
        if job.output_path:
            try:
                Path(job.output_path).unlink(missing_ok=True)
            except Exception:
                pass
        try:
            (self.jobs_dir / f"{job_id}.json").unlink(missing_ok=True)
        except Exception:
            pass
        return True

    # ---------- worker ----------

    def _ensure_worker(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker_loop())

    async def _worker_loop(self) -> None:
        logger.info("Video worker started")
        while True:
            try:
                job_id = await asyncio.wait_for(self._queue.get(), timeout=300)
            except asyncio.TimeoutError:
                logger.info("Video worker idle, exiting")
                return

            job = self._jobs.get(job_id)
            if not job or job.status != "queued":
                continue

            try:
                await asyncio.to_thread(self._run_job_sync, job)
            except Exception as e:
                logger.exception("Video job %s failed", job_id)
                job.status = "error"
                job.error = str(e)
                job.finished_at = time.time()
                self._save_job(job)

    def _run_job_sync(self, job: VideoJob) -> None:
        """Run a single generation job in a worker thread (blocking torch calls)."""
        info = self.get_model_info(job.model_id)
        if not info:
            raise RuntimeError(f"Model not found: {job.model_id}")

        # 1) Load pipeline (cached)
        pipe = self._pipelines.get(job.model_id)
        if pipe is None:
            job.status = "loading"
            self._save_job(job)
            t0 = time.time()
            pipe = self._load_pipeline(info)
            self._pipelines[job.model_id] = pipe
            self._loaded_paths[job.model_id] = info["path"]
            job.elapsed_load_s = time.time() - t0
            logger.info("Loaded %s in %.1fs", job.model_id, job.elapsed_load_s)
        else:
            job.elapsed_load_s = 0.0

        import torch
        from diffusers.utils import export_to_video

        # 2) Prepare callback for progress reporting
        total = job.num_inference_steps
        job.progress_total = total

        def _step_cb(pipeline, step_index, timestep, callback_kwargs):
            job.progress_step = step_index + 1
            job.progress = (step_index + 1) / total
            return callback_kwargs

        job.status = "running"
        job.started_at = time.time()
        self._save_job(job)
        gen_start = time.time()

        generator = torch.Generator(device="cuda").manual_seed(job.seed)
        out = pipe(
            prompt=job.prompt,
            negative_prompt=job.negative_prompt or None,
            height=job.height,
            width=job.width,
            num_frames=job.num_frames,
            num_inference_steps=job.num_inference_steps,
            guidance_scale=job.guidance_scale,
            generator=generator,
            callback_on_step_end=_step_cb,
        )
        frames = out.frames[0]
        job.elapsed_gen_s = time.time() - gen_start

        # 3) Save to disk
        out_path = self.output_dir / f"{job.id}.mp4"
        export_to_video(frames, str(out_path), fps=job.fps)
        job.output_path = str(out_path)
        job.output_size = out_path.stat().st_size
        job.status = "done"
        job.finished_at = time.time()
        job.progress = 1.0
        self._save_job(job)
        logger.info(
            "Job %s done: %s (%.1fs gen, %.2fMB)",
            job.id, out_path, job.elapsed_gen_s, job.output_size / 1e6,
        )

    def _load_pipeline(self, info: dict[str, Any]) -> Any:
        import torch
        from diffusers import WanPipeline  # noqa: F401

        pipeline_cls_name = info["pipeline"]
        import diffusers
        cls = getattr(diffusers, pipeline_cls_name)
        pipe = cls.from_pretrained(info["path"], torch_dtype=torch.bfloat16)
        pipe.to("cuda")
        return pipe

    # ---------- persistence ----------

    def _save_job(self, job: VideoJob) -> None:
        try:
            (self.jobs_dir / f"{job.id}.json").write_text(json.dumps(job.to_dict()))
        except Exception as e:
            logger.warning("Failed to persist job %s: %s", job.id, e)

    def _load_jobs_from_disk(self) -> None:
        for f in self.jobs_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text())
                # Reset stale 'loading' / 'running' jobs to error
                if data.get("status") in ("loading", "running", "queued"):
                    data["status"] = "error"
                    data["error"] = "interrupted by server restart"
                self._jobs[data["id"]] = VideoJob(**data)
            except Exception as e:
                logger.warning("Failed to load job file %s: %s", f, e)

    def loaded_pipelines(self) -> list[str]:
        return list(self._pipelines.keys())

    async def unload(self, model_id: str) -> bool:
        """Free GPU memory by dropping a loaded pipeline."""
        async with self._lock:
            pipe = self._pipelines.pop(model_id, None)
            if pipe is None:
                return False
            try:
                import torch
                del pipe
                torch.cuda.empty_cache()
            except Exception:
                pass
            return True


def _dir_size_gb(path: Path) -> float:
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total / 1e9


_service: Optional[VideoService] = None


def get_service() -> VideoService:
    if _service is None:
        raise RuntimeError("VideoService not initialized")
    return _service


def init_video_service(data_dir: Path) -> VideoService:
    global _service
    _service = VideoService(output_dir=data_dir / "videos")
    return _service
