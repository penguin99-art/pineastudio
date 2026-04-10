from __future__ import annotations

import logging

import httpx

from pineastudio.schemas import BackendKind, BackendType, ModelInfo
from .base import ExternalBackend

logger = logging.getLogger(__name__)


class OpenAICompatBackend(ExternalBackend):
    """Generic backend for any OpenAI-compatible API endpoint."""

    backend_type = BackendType.OPENAI_COMPAT
    kind = BackendKind.EXTERNAL

    def __init__(self, id: str, base_url: str, api_key: str = ""):
        super().__init__(id, base_url)
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, headers=self._headers(), timeout=5
            ) as c:
                resp = await c.get("/v1/models")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[ModelInfo]:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url, headers=self._headers(), timeout=10
            ) as c:
                resp = await c.get("/v1/models")
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as e:
            logger.warning("Failed to list models from %s: %s", self.id, e)
            return []

        models: list[ModelInfo] = []
        for m in data.get("data", []):
            model_id = m.get("id", "")
            models.append(ModelInfo(
                id=f"{self.id}/{model_id}",
                name=model_id,
                backend_id=self.id,
                backend_type=self.backend_type,
                status="ready",
                details={k: v for k, v in m.items() if k != "id"},
            ))
        return models

    async def proxy_request(self, method: str, path: str, body: dict | None = None) -> httpx.Response:
        async with httpx.AsyncClient(
            base_url=self.base_url, headers=self._headers(), timeout=None
        ) as client:
            return await client.request(method, path, json=body)

    async def proxy_stream(self, method: str, path: str, body: dict | None = None):
        async with httpx.AsyncClient(
            base_url=self.base_url, headers=self._headers(), timeout=None
        ) as client:
            async with client.stream(method, path, json=body) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk
