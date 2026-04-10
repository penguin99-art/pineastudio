from __future__ import annotations

import logging

import httpx

from pineastudio.schemas import BackendKind, BackendType, ModelInfo
from .base import ExternalBackend

logger = logging.getLogger(__name__)


class OllamaBackend(ExternalBackend):
    backend_type = BackendType.OLLAMA
    kind = BackendKind.EXTERNAL

    def __init__(self, id: str = "ollama", base_url: str = "http://localhost:11434"):
        super().__init__(id, base_url)

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=5) as c:
                resp = await c.get("/api/tags")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=10) as c:
                resp = await c.get("/api/tags")
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            logger.warning("Failed to list Ollama models: %s", e)
            return []

        models: list[ModelInfo] = []
        for m in data.get("models", []):
            name = m.get("name", "")
            details = m.get("details", {})
            models.append(ModelInfo(
                id=f"{self.id}/{name}",
                name=name,
                backend_id=self.id,
                backend_type=self.backend_type,
                size_bytes=m.get("size"),
                status="ready",
                details={
                    "parameter_size": details.get("parameter_size", ""),
                    "quantization": details.get("quantization_level", ""),
                    "family": details.get("family", ""),
                    "format": details.get("format", ""),
                },
            ))
        return models
