from __future__ import annotations

from enum import Enum
from pydantic import BaseModel


# ── Backend ──────────────────────────────────────────────────────────────────

class BackendKind(str, Enum):
    MANAGED = "managed"
    EXTERNAL = "external"


class BackendType(str, Enum):
    OLLAMA = "ollama"
    LLAMA_SERVER = "llama-server"
    OMNI = "omni"
    OPENAI_COMPAT = "openai-compat"


class BackendCreate(BaseModel):
    id: str
    type: BackendType
    base_url: str
    auto_connect: bool = True


class BackendInfo(BaseModel):
    id: str
    type: BackendType
    kind: BackendKind
    base_url: str
    healthy: bool = False
    model_count: int = 0


# ── Model ────────────────────────────────────────────────────────────────────

class ModelInfo(BaseModel):
    id: str                     # "{backend_id}/{model_name}"
    name: str                   # original model name in the backend
    backend_id: str
    backend_type: BackendType
    size_bytes: int | None = None
    status: str = "unknown"     # ready / loaded / unloaded / ...
    details: dict = {}


class ModelListResponse(BaseModel):
    models: list[ModelInfo]


# ── Hub (HuggingFace) ────────────────────────────────────────────────────────

class HubSearchResult(BaseModel):
    repo_id: str
    author: str = ""
    downloads: int = 0
    likes: int = 0
    tags: list[str] = []


class HubFileInfo(BaseModel):
    filename: str
    size_bytes: int | None = None


class HubDownloadRequest(BaseModel):
    repo_id: str
    filename: str


class DownloadTask(BaseModel):
    task_id: str
    repo_id: str
    filename: str
    status: str = "pending"     # pending / downloading / done / error
    progress: float = 0.0       # 0.0 ~ 1.0
    error: str | None = None


# ── System ───────────────────────────────────────────────────────────────────

class GpuInfo(BaseModel):
    index: int
    name: str
    memory_total_mb: int
    memory_used_mb: int
    memory_free_mb: int
    utilization_pct: int = 0


class SystemInfo(BaseModel):
    cpu_count: int
    memory_total_mb: int
    memory_used_mb: int
    disk_total_gb: float
    disk_free_gb: float
    gpus: list[GpuInfo] = []
