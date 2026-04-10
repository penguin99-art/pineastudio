from __future__ import annotations

import logging
from typing import AsyncIterator

import httpx

from pineastudio.db import Database
from pineastudio.schemas import BackendInfo, BackendKind, BackendType, ModelInfo
from .backends.base import Backend, ManagedBackend
from .backends.ollama import OllamaBackend
from .backends.llama_server import LlamaServerBackend
from .backends.openai_compat import OpenAICompatBackend

logger = logging.getLogger(__name__)


class BackendManager:
    """Registry and router for all inference backends."""

    def __init__(self, db: Database):
        self._db = db
        self._backends: dict[str, Backend] = {}

    # ── Registry ─────────────────────────────────────────────────────────

    def register(self, backend: Backend) -> None:
        self._backends[backend.id] = backend
        logger.info("Registered backend: %s (%s)", backend.id, backend.backend_type.value)

    def unregister(self, backend_id: str) -> Backend | None:
        return self._backends.pop(backend_id, None)

    def get(self, backend_id: str) -> Backend | None:
        return self._backends.get(backend_id)

    def all_backends(self) -> list[Backend]:
        return list(self._backends.values())

    # ── Lifecycle ────────────────────────────────────────────────────────

    async def auto_discover(self, models_dir: str | None = None) -> None:
        """Auto-detect available backends on startup."""
        saved = await self._db.list_backends()
        for row in saved:
            if row["id"] in self._backends:
                continue
            backend = self._create_from_db(row)
            if backend:
                self.register(backend)

        if "ollama" not in self._backends:
            ollama = OllamaBackend()
            if await ollama.health_check():
                self.register(ollama)
                await self._db.upsert_backend(
                    ollama.id, ollama.backend_type.value,
                    ollama.kind.value, ollama.base_url,
                )
                logger.info("Auto-discovered Ollama at %s", ollama.base_url)

    async def add_backend(
        self, id: str, type: str, base_url: str, **extra: object,
    ) -> Backend:
        backend = self._create(id, type, base_url, **extra)
        self.register(backend)
        await self._db.upsert_backend(
            id, type, backend.kind.value, base_url, config=dict(extra),
        )
        return backend

    async def remove_backend(self, backend_id: str) -> None:
        backend = self.unregister(backend_id)
        if backend and isinstance(backend, ManagedBackend):
            await backend.stop()
        await self._db.delete_backend(backend_id)

    async def shutdown(self) -> None:
        for b in self._backends.values():
            if isinstance(b, ManagedBackend):
                await b.stop()

    # ── Queries ──────────────────────────────────────────────────────────

    async def list_backend_info(self) -> list[BackendInfo]:
        results: list[BackendInfo] = []
        for b in self._backends.values():
            healthy = await b.health_check()
            models = await b.list_models() if healthy else []
            results.append(BackendInfo(
                id=b.id,
                type=b.backend_type,
                kind=b.kind,
                base_url=b.base_url,
                healthy=healthy,
                model_count=len(models),
            ))
        return results

    async def list_all_models(self) -> list[ModelInfo]:
        all_models: list[ModelInfo] = []
        for b in self._backends.values():
            try:
                models = await b.list_models()
                all_models.extend(models)
            except Exception as e:
                logger.warning("Failed to list models from %s: %s", b.id, e)
        return all_models

    # ── Routing ──────────────────────────────────────────────────────────

    def resolve_backend(self, model_id: str) -> tuple[Backend, str] | None:
        """Given 'backend_id/model_name', return (backend, raw_model_name)."""
        if "/" in model_id:
            parts = model_id.split("/", 1)
            backend = self._backends.get(parts[0])
            if backend:
                return backend, parts[1]

        # Fallback: try all backends with the raw name
        for b in self._backends.values():
            return b, model_id

        return None

    async def proxy_to_backend(
        self, model_id: str, method: str, path: str, body: dict,
    ) -> httpx.Response:
        result = self.resolve_backend(model_id)
        if result is None:
            raise ValueError(f"No backend found for model: {model_id}")
        backend, raw_name = result
        body = {**body, "model": raw_name}
        return await backend.proxy_request(method, path, body)

    async def proxy_stream_to_backend(
        self, model_id: str, method: str, path: str, body: dict,
    ) -> AsyncIterator[bytes]:
        result = self.resolve_backend(model_id)
        if result is None:
            raise ValueError(f"No backend found for model: {model_id}")
        backend, raw_name = result
        body = {**body, "model": raw_name}
        async for chunk in backend.proxy_stream(method, path, body):
            yield chunk

    # ── Internal ─────────────────────────────────────────────────────────

    def _create(self, id: str, type: str, base_url: str, **extra: object) -> Backend:
        if type == BackendType.OLLAMA.value:
            return OllamaBackend(id=id, base_url=base_url)
        elif type == BackendType.LLAMA_SERVER.value:
            return LlamaServerBackend(id=id, base_url=base_url, **extra)
        elif type == BackendType.OPENAI_COMPAT.value:
            return OpenAICompatBackend(id=id, base_url=base_url, **extra)
        else:
            return OpenAICompatBackend(id=id, base_url=base_url)

    def _create_from_db(self, row: dict) -> Backend | None:
        import json
        config = json.loads(row.get("config", "{}"))
        return self._create(row["id"], row["type"], row["base_url"], **config)
