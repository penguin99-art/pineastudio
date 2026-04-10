from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import AsyncIterator

import httpx

from pineastudio.schemas import BackendKind, BackendType, ModelInfo

logger = logging.getLogger(__name__)


class Backend(ABC):
    """Base class for all inference backends."""

    id: str
    backend_type: BackendType
    kind: BackendKind
    base_url: str

    def __init__(self, id: str, base_url: str):
        self.id = id
        self.base_url = base_url.rstrip("/")

    @abstractmethod
    async def health_check(self) -> bool: ...

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]: ...

    async def proxy_request(self, method: str, path: str, body: dict | None = None) -> httpx.Response:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=None) as client:
            return await client.request(method, path, json=body)

    async def proxy_stream(self, method: str, path: str, body: dict | None = None) -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=None) as client:
            async with client.stream(method, path, json=body) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk


class ManagedBackend(Backend, ABC):
    """Backend whose lifecycle PineaStudio manages (start/stop)."""

    kind = BackendKind.MANAGED
    _process: asyncio.subprocess.Process | None = None

    @abstractmethod
    async def start(self, **config: object) -> None: ...

    async def stop(self) -> None:
        if self._process and self._process.returncode is None:
            logger.info("Stopping %s (pid=%s)", self.id, self._process.pid)
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=10)
            except asyncio.TimeoutError:
                logger.warning("Force killing %s", self.id)
                self._process.kill()
            self._process = None

    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def restart(self, **config: object) -> None:
        await self.stop()
        await self.start(**config)


class ExternalBackend(Backend, ABC):
    """Backend already running externally; PineaStudio only connects."""

    kind = BackendKind.EXTERNAL
