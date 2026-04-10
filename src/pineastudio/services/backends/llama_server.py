from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import httpx

from pineastudio.schemas import BackendKind, BackendType, ModelInfo
from .base import ManagedBackend

logger = logging.getLogger(__name__)


class LlamaServerBackend(ManagedBackend):
    backend_type = BackendType.LLAMA_SERVER
    kind = BackendKind.MANAGED

    def __init__(
        self,
        id: str = "llama",
        base_url: str = "http://localhost:8080",
        binary_path: str | Path | None = None,
        models_dir: str | Path | None = None,
    ):
        super().__init__(id, base_url)
        self.binary_path = Path(binary_path) if binary_path else None
        self.models_dir = Path(models_dir) if models_dir else None

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=5) as c:
                resp = await c.get("/health")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=10) as c:
                resp = await c.get("/v1/models")
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            logger.warning("Failed to list llama-server models: %s", e)
            return []

        models: list[ModelInfo] = []
        for m in data.get("data", []):
            model_id = m.get("id", "")
            meta = m.get("meta", {})
            models.append(ModelInfo(
                id=f"{self.id}/{model_id}",
                name=model_id,
                backend_id=self.id,
                backend_type=self.backend_type,
                size_bytes=meta.get("n_params"),
                status="loaded" if meta else "ready",
                details=meta,
            ))
        return models

    async def start(self, **config: object) -> None:
        if self.is_running():
            logger.info("llama-server already running")
            return

        binary = self.binary_path or self._find_binary()
        if binary is None:
            raise RuntimeError(
                "llama-server binary not found. Install llama.cpp or set binary path."
            )

        port = self.base_url.rsplit(":", 1)[-1].split("/")[0]
        cmd: list[str] = [
            str(binary),
            "--host", "127.0.0.1",
            "--port", str(port),
        ]

        if self.models_dir and self.models_dir.exists():
            cmd.extend(["--models-dir", str(self.models_dir)])

        gpu_layers = config.get("gpu_layers", 99)
        cmd.extend(["-ngl", str(gpu_layers)])

        ctx_size = config.get("ctx_size")
        if ctx_size:
            cmd.extend(["-c", str(ctx_size)])

        log_path = config.get("log_path")
        log_file = open(log_path, "a") if log_path else asyncio.subprocess.DEVNULL

        logger.info("Starting llama-server: %s", " ".join(cmd))
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=log_file,
            stderr=asyncio.subprocess.STDOUT,
        )
        logger.info("llama-server started (pid=%s)", self._process.pid)

    def _find_binary(self) -> Path | None:
        import shutil
        path = shutil.which("llama-server")
        if path:
            return Path(path)
        home_bin = Path.home() / ".pineastudio" / "bin" / "llama-server"
        if home_bin.exists():
            return home_bin
        return None
