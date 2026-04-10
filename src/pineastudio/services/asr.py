"""ASR service — server-side speech recognition via faster-whisper."""
from __future__ import annotations

import re
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path


class ASRUnavailableError(RuntimeError):
    pass


@dataclass
class ASRResult:
    text: str
    language: str = ""
    backend: str = ""
    reason: str = ""


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _looks_repetitive(text: str) -> bool:
    normalized = " ".join(text.split()).lower()
    if not normalized:
        return False
    tokens = normalized.split(" ")
    if len(tokens) >= 4 and len(set(tokens)) <= max(1, len(tokens) // 4):
        return True
    return bool(re.search(r"(.{2,}?)\1{2,}", normalized))


def _score_transcript_quality(text: str, preferred_language: str) -> str:
    normalized = " ".join(text.split()).strip()
    if len(normalized) < 2:
        return "empty"
    if _looks_repetitive(normalized):
        return "repetitive"

    has_arabic = any(
        ("\u0600" <= ch <= "\u06ff") or ("\u0750" <= ch <= "\u077f") or ("\u08a0" <= ch <= "\u08ff")
        for ch in normalized
    )
    if has_arabic and preferred_language not in {"ar", "auto"}:
        return "unexpected_arabic"

    letter_count = sum(ch.isalpha() for ch in normalized)
    weird_count = 0
    for ch in normalized:
        if ch.isspace() or ch.isdigit():
            continue
        cat = unicodedata.category(ch)
        if cat.startswith("P"):
            continue
        if "\u4e00" <= ch <= "\u9fff":
            continue
        if "LATIN" in unicodedata.name(ch, ""):
            continue
        weird_count += 1
    if letter_count and weird_count / max(len(normalized), 1) > 0.35:
        return "unexpected_script"

    if preferred_language == "zh" and not _contains_cjk(normalized):
        ascii_letters = sum(("a" <= ch.lower() <= "z") for ch in normalized)
        if ascii_letters < max(4, len(normalized) // 3):
            return "missing_cjk"
    return ""


class BaseASR:
    def transcribe_wav_bytes(self, wav_bytes: bytes) -> ASRResult:
        raise NotImplementedError

    @property
    def status(self) -> dict:
        return {"available": True, "backend": "unknown"}


class FasterWhisperASR(BaseASR):
    def __init__(self, model_name: str = "base", compute_type: str = "int8", language: str = "zh"):
        try:
            from faster_whisper import WhisperModel
        except Exception as exc:
            raise ASRUnavailableError(f"pip install faster-whisper ({exc})") from exc
        self.model_name = model_name
        self.compute_type = compute_type
        self.language = language
        self._whisper_cls = WhisperModel
        self._model = None

    def _ensure_model(self):
        if self._model is None:
            self._model = self._whisper_cls(self.model_name, compute_type=self.compute_type)
        return self._model

    def transcribe_wav_bytes(self, wav_bytes: bytes) -> ASRResult:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            temp_path = Path(f.name)
        try:
            model = self._ensure_model()
            language = None if self.language in {"", "auto"} else self.language
            initial_prompt = "以下是普通话的句子，使用简体中文。" if self.language == "zh" else None
            segments, info = model.transcribe(
                str(temp_path),
                beam_size=1,
                vad_filter=True,
                language=language,
                condition_on_previous_text=False,
                temperature=0.0,
                initial_prompt=initial_prompt,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
            detected = getattr(info, "language", "") or (language or "")
            reason = _score_transcript_quality(text, self.language or "auto")
            if reason:
                return ASRResult(text="", language=detected, backend="faster-whisper", reason=reason)
            return ASRResult(text=text, language=detected, backend="faster-whisper")
        finally:
            temp_path.unlink(missing_ok=True)

    @property
    def status(self) -> dict:
        return {"available": True, "backend": "faster-whisper", "model": self.model_name, "language": self.language}


class UnavailableASR(BaseASR):
    def __init__(self, reason: str):
        self.reason = reason

    def transcribe_wav_bytes(self, wav_bytes: bytes) -> ASRResult:
        raise ASRUnavailableError(self.reason)

    @property
    def status(self) -> dict:
        return {"available": False, "backend": "unavailable", "reason": self.reason}


_asr_instance: BaseASR | None = None


def get_asr(model: str = "base", compute_type: str = "int8", language: str = "zh") -> BaseASR:
    global _asr_instance
    if _asr_instance is None:
        try:
            _asr_instance = FasterWhisperASR(model, compute_type, language)
        except ASRUnavailableError as exc:
            _asr_instance = UnavailableASR(str(exc))
    return _asr_instance
