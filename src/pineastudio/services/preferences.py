"""User preferences: persistent JSON config for model, TTS, ASR choices."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULTS: dict[str, Any] = {
    "assistant_model": "",
    "realtime_model": "gemma4:e2b",
    "realtime_fallback_models": ["gemma4:e4b", "gemma4:26b"],
    "ollama_host": "http://localhost:11434",
    "tts_voice_zh": "zh-CN-XiaoxiaoNeural",
    "tts_voice_en": "en-US-AriaNeural",
    "tts_backend": "edge-tts",
    "asr_model": "base",
    "asr_language": "auto",
}


class Preferences:
    def __init__(self, data_dir: Path):
        self._path = data_dir / "preferences.json"
        self._data: dict[str, Any] = dict(DEFAULTS)
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                with open(self._path, encoding="utf-8") as f:
                    saved = json.load(f)
                self._data.update(saved)
            except Exception as exc:
                logger.warning("Failed to load preferences: %s", exc)

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def get_all(self) -> dict[str, Any]:
        return dict(self._data)

    def update(self, changes: dict[str, Any]) -> dict[str, Any]:
        for k, v in changes.items():
            if k in DEFAULTS:
                self._data[k] = v
        self._save()
        logger.info("Preferences updated: %s", list(changes.keys()))
        return self.get_all()
