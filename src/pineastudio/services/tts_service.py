"""TTS service — text-to-speech with fallback chain: Edge TTS → ffmpeg-flite."""
from __future__ import annotations

import io
import shutil
import subprocess
import wave

import numpy as np


class TTSUnavailableError(RuntimeError):
    pass


class BaseTTSBackend:
    sample_rate: int = 24000

    def generate_pcm(self, text: str) -> tuple[np.ndarray, int]:
        raise NotImplementedError

    @property
    def status(self) -> dict:
        return {"available": True, "backend": "unknown"}


_voice_zh = "zh-CN-XiaoxiaoNeural"
_voice_en = "en-US-AriaNeural"


def configure_voices(zh: str = "", en: str = "") -> None:
    global _voice_zh, _voice_en
    if zh:
        _voice_zh = zh
    if en:
        _voice_en = en


class EdgeTTSBackend(BaseTTSBackend):
    """Microsoft Edge TTS — good Chinese + English, requires internet."""

    def __init__(self):
        try:
            import edge_tts as _  # noqa: F401
        except ImportError as exc:
            raise TTSUnavailableError("pip install edge-tts") from exc
        self.sample_rate = 24000

    def generate_pcm(self, text: str) -> tuple[np.ndarray, int]:
        import asyncio
        import edge_tts

        has_cjk = any("\u4e00" <= ch <= "\u9fff" for ch in text)
        voice = _voice_zh if has_cjk else _voice_en

        async def _synth():
            comm = edge_tts.Communicate(text, voice)
            audio_data = b""
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    audio_data += chunk["data"]
            return audio_data

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    mp3_bytes = pool.submit(lambda: asyncio.run(_synth())).result(timeout=15)
            else:
                mp3_bytes = loop.run_until_complete(_synth())
        except RuntimeError:
            mp3_bytes = asyncio.run(_synth())

        if not mp3_bytes:
            raise TTSUnavailableError("Edge TTS returned empty audio")

        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error",
             "-i", "pipe:0", "-f", "s16le", "-ar", "24000", "-ac", "1", "pipe:1"],
            input=mp3_bytes, capture_output=True,
        )
        if proc.returncode != 0:
            raise TTSUnavailableError(f"ffmpeg decode failed: {proc.stderr[:200]}")

        pcm_i16 = np.frombuffer(proc.stdout, dtype=np.int16)
        return pcm_i16.astype(np.float32) / 32768.0, 24000

    @property
    def status(self) -> dict:
        return {"available": True, "backend": "edge-tts"}


class FfmpegFliteBackend(BaseTTSBackend):
    """ffmpeg built-in flite — English only, lowest quality fallback."""

    def __init__(self):
        if not shutil.which("ffmpeg"):
            raise TTSUnavailableError("ffmpeg not found")
        self.sample_rate = 16000

    def generate_pcm(self, text: str) -> tuple[np.ndarray, int]:
        escaped = text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("\n", " ")
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error",
             "-f", "lavfi", "-i", f"flite=text='{escaped}':voice=slt",
             "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"],
            capture_output=True,
        )
        if proc.returncode != 0:
            raise TTSUnavailableError("flite synthesis failed")
        pcm_i16 = np.frombuffer(proc.stdout, dtype=np.int16)
        return pcm_i16.astype(np.float32) / 32768.0, 16000

    @property
    def status(self) -> dict:
        return {"available": True, "backend": "ffmpeg-flite"}


class UnavailableTTS(BaseTTSBackend):
    def __init__(self, reason: str):
        self.reason = reason

    def generate_pcm(self, text: str) -> tuple[np.ndarray, int]:
        raise TTSUnavailableError(self.reason)

    @property
    def status(self) -> dict:
        return {"available": False, "backend": "unavailable", "reason": self.reason}


_tts_instance: BaseTTSBackend | None = None


def get_tts(backend: str = "edge") -> BaseTTSBackend:
    global _tts_instance
    if _tts_instance is not None:
        return _tts_instance

    if backend == "edge":
        try:
            _tts_instance = EdgeTTSBackend()
            return _tts_instance
        except TTSUnavailableError:
            pass

    # Fallback chain
    for cls in [EdgeTTSBackend, FfmpegFliteBackend]:
        try:
            _tts_instance = cls()
            return _tts_instance
        except TTSUnavailableError:
            continue

    _tts_instance = UnavailableTTS("No TTS backend available (pip install edge-tts)")
    return _tts_instance
