from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import httpx

from pineastudio.schemas import BackendKind, BackendType, ModelInfo
from .base import ManagedBackend

logger = logging.getLogger(__name__)

OMNI_DEFAULT_PORT = 9060

_REF_AUDIO_CANDIDATES = [
    Path(__file__).resolve().parent.parent.parent / "assets" / "ref_audio_default.wav",
    Path.home() / ".pineastudio" / "ref_audio.wav",
]


def _find_default_ref_audio(output_dir: str) -> str:
    """Find or create a reference audio for voice cloning."""
    for p in _REF_AUDIO_CANDIDATES:
        if p.exists() and p.stat().st_size > 1000:
            logger.info("Using reference audio: %s", p)
            return str(p)
    from pineastudio.services.omni_session import _make_silence_wav
    fallback = Path(output_dir) / "init_silence.wav"
    fallback.parent.mkdir(parents=True, exist_ok=True)
    _make_silence_wav(fallback, duration_s=1.0)
    logger.warning("No reference audio found, using silence fallback")
    return str(fallback)


class LlamaOmniBackend(ManagedBackend):
    """Managed backend for llama.cpp-omni (MiniCPM-o multimodal)."""

    backend_type = BackendType.OMNI
    kind = BackendKind.MANAGED

    def __init__(
        self,
        id: str = "omni",
        base_url: str = f"http://localhost:{OMNI_DEFAULT_PORT}",
        binary_path: str | Path | None = None,
        model_dir: str | Path | None = None,
    ):
        super().__init__(id, base_url)
        self.binary_path = Path(binary_path) if binary_path else self._find_binary()
        self.model_dir = Path(model_dir) if model_dir else None
        self._omni_initialized = False

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
        except httpx.HTTPError:
            if self.model_dir:
                return [ModelInfo(
                    id=f"{self.id}/minicpm-o-4.5",
                    name="MiniCPM-o-4.5",
                    backend_id=self.id,
                    backend_type=self.backend_type,
                    size_bytes=None,
                    status="stopped",
                    details={"model_dir": str(self.model_dir)},
                )]
            return []

        models: list[ModelInfo] = []
        for m in data.get("data", []):
            model_id = m.get("id", "minicpm-o-4.5")
            models.append(ModelInfo(
                id=f"{self.id}/{model_id}",
                name="MiniCPM-o-4.5",
                backend_id=self.id,
                backend_type=self.backend_type,
                size_bytes=None,
                status="loaded",
                details={"omni_initialized": self._omni_initialized},
            ))
        return models

    async def start(self, **config: object) -> None:
        if self.is_running():
            logger.info("llama-omni-server already running")
            return

        binary = self.binary_path
        if binary is None or not binary.exists():
            raise RuntimeError(
                f"llama-omni binary not found at {binary}. "
                "Build llama.cpp-omni or set the binary path."
            )

        if not self.model_dir or not self.model_dir.exists():
            raise RuntimeError(f"Model directory not found: {self.model_dir}")

        llm_gguf = self.model_dir / "MiniCPM-o-4_5-Q4_K_M.gguf"
        if not llm_gguf.exists():
            raise RuntimeError(f"LLM GGUF not found: {llm_gguf}")

        port = self.base_url.rsplit(":", 1)[-1].split("/")[0]
        gpu_layers = config.get("gpu_layers", 99)
        ctx_size = config.get("ctx_size", 8192)

        cmd = [
            str(binary),
            "--host", "127.0.0.1",
            "--port", str(port),
            "--model", str(llm_gguf),
            "-ngl", str(gpu_layers),
            "-c", str(ctx_size),
            "--repeat-penalty", "1.05",
            "--temp", "0.7",
        ]

        lib_dir = binary.parent
        env_patch = {"LD_LIBRARY_PATH": str(lib_dir)}

        import os
        env = {**os.environ, **env_patch}

        logger.info("Starting llama-omni: %s", " ".join(cmd))
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=env,
        )
        logger.info("llama-omni started (pid=%s)", self._process.pid)

    # ── Omni-specific methods ─────────────────────────────────────────

    async def omni_init(
        self,
        media_type: int = 2,
        use_tts: bool = True,
        duplex_mode: bool = False,
        output_dir: str = "/tmp/pineastudio_omni_output",
        voice_audio: str | None = None,
    ) -> dict:
        if not self.model_dir:
            raise RuntimeError("model_dir not set")

        # voice_audio triggers index=0 prefill which loads the system prompt
        # into KV cache and sets TTS voice cloning reference.
        if not voice_audio:
            voice_audio = _find_default_ref_audio(output_dir)

        model_dir_str = str(self.model_dir)
        body: dict = {
            "media_type": media_type,
            "use_tts": use_tts,
            "duplex_mode": duplex_mode,
            "model_dir": model_dir_str,
            "tts_bin_dir": model_dir_str + "/tts",
            "tts_gpu_layers": 99,
            "token2wav_device": "gpu:0",
            "output_dir": output_dir,
            "voice_audio": voice_audio,
        }

        async with httpx.AsyncClient(base_url=self.base_url, timeout=120) as c:
            resp = await c.post("/v1/stream/omni_init", json=body)
            resp.raise_for_status()
            self._omni_initialized = True
            return resp.json()

    async def omni_prefill(self, cnt: int, audio_path: str, img_path: str = "") -> dict:
        body: dict = {"cnt": cnt, "audio_path_prefix": audio_path}
        if img_path:
            body["img_path_prefix"] = img_path

        async with httpx.AsyncClient(base_url=self.base_url, timeout=30) as c:
            resp = await c.post("/v1/stream/prefill", json=body)
            resp.raise_for_status()
            return resp.json()

    async def omni_decode(self, output_dir: str) -> httpx.Response:
        body = {"debug_dir": output_dir, "stream": True}
        async with httpx.AsyncClient(base_url=self.base_url, timeout=None) as c:
            resp = await c.post("/v1/stream/decode", json=body)
            resp.raise_for_status()
            return resp

    async def omni_decode_stream(self, output_dir: str):
        body = {"debug_dir": output_dir, "stream": True}
        async with httpx.AsyncClient(base_url=self.base_url, timeout=None) as c:
            async with c.stream("POST", "/v1/stream/decode", json=body) as resp:
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        return
                    yield data

    async def omni_break(self) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=10) as c:
            resp = await c.post("/v1/stream/break")
            resp.raise_for_status()
            return resp.json()

    async def omni_reset(self) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=30) as c:
            resp = await c.post("/v1/stream/reset")
            resp.raise_for_status()
            self._omni_initialized = False
            return resp.json()

    @property
    def omni_initialized(self) -> bool:
        return self._omni_initialized

    def _find_binary(self) -> Path | None:
        candidates = [
            Path("/home/pineapi/gy/llama.cpp-omni/build/bin/llama-server"),
            Path.home() / ".pineastudio" / "bin" / "llama-omni-server",
        ]
        for p in candidates:
            if p.exists():
                return p
        import shutil
        path = shutil.which("llama-omni-server")
        return Path(path) if path else None
