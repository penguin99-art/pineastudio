"""Video generation REST endpoints."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from pineastudio.services import video_gen

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["video"])


class GenerateRequest(BaseModel):
    model_id: str
    prompt: str
    negative_prompt: str = ""
    width: int = Field(832, ge=128, le=2048)
    height: int = Field(480, ge=128, le=2048)
    num_frames: int = Field(25, ge=1, le=257)
    num_inference_steps: int = Field(25, ge=1, le=200)
    guidance_scale: float = 5.0
    fps: int = Field(16, ge=1, le=60)
    seed: int = -1


@router.get("/models")
def list_models():
    svc = video_gen.get_service()
    return {"models": svc.list_local_models(), "loaded": svc.loaded_pipelines()}


@router.post("/generate")
async def generate(body: GenerateRequest):
    svc = video_gen.get_service()
    try:
        job = await svc.submit_job(**body.model_dump())
    except ValueError as e:
        raise HTTPException(404, str(e))
    return job.to_dict()


@router.get("/jobs")
def list_jobs():
    svc = video_gen.get_service()
    return {"jobs": svc.list_jobs()}


@router.get("/jobs/{job_id}")
def get_job(job_id: str):
    svc = video_gen.get_service()
    job = svc.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job.to_dict()


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    svc = video_gen.get_service()
    if not svc.delete_job(job_id):
        raise HTTPException(404, "Job not found")
    return {"ok": True}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    svc = video_gen.get_service()
    ok = svc.cancel_job(job_id)
    return {"ok": ok}


@router.get("/jobs/{job_id}/file")
def get_job_file(job_id: str):
    svc = video_gen.get_service()
    job = svc.get_job(job_id)
    if not job or not job.output_path:
        raise HTTPException(404, "Output not found")
    p = Path(job.output_path)
    if not p.is_file():
        raise HTTPException(404, "File missing")
    return FileResponse(
        p, media_type="video/mp4", filename=f"pineastudio-{job_id}.mp4"
    )


@router.post("/unload/{model_id}")
async def unload(model_id: str):
    svc = video_gen.get_service()
    ok = await svc.unload(model_id)
    return {"ok": ok}
