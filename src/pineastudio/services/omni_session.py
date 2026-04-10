"""OmniSession: orchestrates the prefill/decode loop and TTS watcher for one active omni session."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import struct
import tempfile
import time
from pathlib import Path
from typing import Callable, Awaitable

from pineastudio.services.backends.llama_omni import LlamaOmniBackend

logger = logging.getLogger(__name__)


def _make_silence_wav(path: Path, duration_s: float = 1.0, sample_rate: int = 16000) -> None:
    """Write a silent 16-bit mono WAV file."""
    n_samples = int(sample_rate * duration_s)
    data_size = n_samples * 2
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(b"\x00" * data_size)


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
    """Wrap raw 16-bit PCM in a WAV header."""
    data_size = len(pcm_bytes)
    header = bytearray()
    header += b"RIFF"
    header += struct.pack("<I", 36 + data_size)
    header += b"WAVE"
    header += b"fmt "
    header += struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
    header += b"data"
    header += struct.pack("<I", data_size)
    return bytes(header) + pcm_bytes


class OmniSession:
    """Manages one active omni conversation session."""

    def __init__(self, backend: LlamaOmniBackend, send_fn: Callable[[dict], Awaitable[None]]):
        self.backend = backend
        self._send = send_fn
        self._cnt = 0
        self._running = False
        self._muted = False
        self._tmp_dir = Path(tempfile.mkdtemp(prefix="pinea_omni_"))
        self._output_dir = self._tmp_dir / "output"
        self._output_dir.mkdir(exist_ok=True)
        self._audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=30)
        self._tasks: list[asyncio.Task] = []
        self._seen_wavs: set[str] = set()

        _make_silence_wav(self._tmp_dir / "silence.wav")

    async def start(
        self,
        media_type: int = 2,
        use_tts: bool = True,
        duplex_mode: bool = False,
        voice_audio: str | None = None,
    ) -> None:
        await self._send({"type": "status", "state": "initializing"})

        if not await self.backend.health_check():
            await self._send({"type": "status", "state": "starting_server"})
            await self.backend.start()
            for _ in range(120):
                await asyncio.sleep(1)
                if await self.backend.health_check():
                    break
            else:
                await self._send({"type": "error", "message": "llama-server failed to start"})
                return

        await self._send({"type": "status", "state": "loading_omni"})
        try:
            await self.backend.omni_init(
                media_type=media_type,
                use_tts=use_tts,
                duplex_mode=duplex_mode,
                output_dir=str(self._output_dir),
                voice_audio=voice_audio,
            )
        except Exception as e:
            await self._send({"type": "error", "message": f"omni_init failed: {e}"})
            return

        self._running = True
        self._cnt = 1
        await self._send({"type": "status", "state": "ready"})

        self._tasks.append(asyncio.create_task(self._loop()))
        if use_tts:
            self._tasks.append(asyncio.create_task(self._tts_watcher()))

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        self._tasks.clear()
        try:
            await self.backend.omni_break()
        except Exception:
            pass
        try:
            await self.backend.omni_reset()
        except Exception:
            pass
        try:
            await self._send({"type": "status", "state": "idle"})
        except Exception:
            pass

    async def feed_audio(self, audio_b64: str) -> None:
        try:
            raw = base64.b64decode(audio_b64)
            await self._audio_queue.put(raw)
        except Exception as e:
            logger.warning("Failed to decode audio: %s", e)

    def set_muted(self, muted: bool) -> None:
        self._muted = muted

    async def _loop(self) -> None:
        logger.info("Omni prefill/decode loop started (cnt=%d)", self._cnt)

        while self._running:
            t0 = time.monotonic()

            audio_path = str(self._tmp_dir / f"chunk_{self._cnt}.wav")

            is_silence = True
            if self._muted or self._audio_queue.empty():
                audio_path = str(self._tmp_dir / "silence.wav")
            else:
                try:
                    pcm = await asyncio.wait_for(self._audio_queue.get(), timeout=0.5)
                    wav_bytes = _pcm_to_wav(pcm)
                    Path(audio_path).write_bytes(wav_bytes)
                    is_silence = False
                except asyncio.TimeoutError:
                    audio_path = str(self._tmp_dir / "silence.wav")

            if self._cnt % 10 == 0 or not is_silence:
                qsize = self._audio_queue.qsize()
                logger.info("prefill(cnt=%d): %s qsize=%d", self._cnt, "USER_AUDIO" if not is_silence else "SILENCE", qsize)

            try:
                await self.backend.omni_prefill(self._cnt, audio_path)
            except Exception as e:
                logger.warning("prefill error (cnt=%d): %s", self._cnt, e)
                await asyncio.sleep(0.5)
                continue

            has_speech = False
            try:
                async for data_str in self.backend.omni_decode_stream(str(self._output_dir)):
                    try:
                        data = json.loads(data_str)
                        content = data.get("content", "")
                        is_listen = data.get("is_listen", False)
                        if content or is_listen:
                            logger.info("decode(cnt=%d): content=%r is_listen=%s", self._cnt, content[:60] if content else "", is_listen)
                        if content:
                            if not has_speech:
                                has_speech = True
                                await self._send({"type": "status", "state": "speaking"})
                            await self._send({"type": "text", "content": content, "is_listen": False})
                        if is_listen:
                            await self._send({"type": "text", "content": "", "is_listen": True})
                            await self._send({"type": "status", "state": "listening"})
                    except json.JSONDecodeError:
                        logger.warning("decode JSON parse error: %r", data_str[:100])
            except Exception as e:
                logger.warning("decode error (cnt=%d): %s", self._cnt, e)

            self._cnt += 1

            elapsed = time.monotonic() - t0
            if elapsed < 1.0:
                await asyncio.sleep(1.0 - elapsed)

    async def _tts_watcher(self) -> None:
        logger.info("TTS watcher started, watching: %s", self._output_dir)
        while self._running:
            await asyncio.sleep(0.3)
            try:
                if not self._output_dir.exists():
                    continue
                # Duplex: tts_wav directly under output_dir
                await self._scan_tts_dir(self._output_dir / "tts_wav")
                # Simplex: tts_wav under round_XXX subdirectories
                for sub in sorted(self._output_dir.iterdir()):
                    if sub.is_dir() and sub.name.startswith("round_"):
                        await self._scan_tts_dir(sub / "tts_wav")
            except Exception as e:
                logger.warning("TTS watcher error: %s", e)

    async def _scan_tts_dir(self, tts_dir: Path) -> None:
        if not tts_dir.is_dir():
            return
        for wav_file in sorted(tts_dir.iterdir()):
            key = str(wav_file)
            if key in self._seen_wavs:
                continue
            if wav_file.suffix != ".wav":
                continue
            if wav_file.stat().st_size < 100:
                continue
            self._seen_wavs.add(key)
            wav_data = wav_file.read_bytes()
            b64 = base64.b64encode(wav_data).decode()
            logger.info("Sending TTS audio: %s (%d bytes)", wav_file.name, len(wav_data))
            await self._send({"type": "audio", "data": b64})
