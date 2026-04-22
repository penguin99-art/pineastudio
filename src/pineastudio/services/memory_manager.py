"""Memory system: Markdown files + prompt builder for the AI companion."""
from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)


class MemoryManager:
    """Manages memory files (SOUL.md / USER.md / MEMORY.md) and builds system prompts."""

    def __init__(self, base_dir: Path):
        self.memory_dir = base_dir / "memory"
        self.daily_dir = base_dir / "daily"

    def ensure_dirs(self) -> None:
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.daily_dir.mkdir(parents=True, exist_ok=True)

    def is_initialized(self) -> bool:
        return self.exists("SOUL.md")

    def exists(self, filename: str) -> bool:
        return (self.memory_dir / filename).exists()

    def read(self, filename: str) -> str:
        path = self.memory_dir / filename
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def write(self, filename: str, content: str) -> None:
        self.ensure_dirs()
        (self.memory_dir / filename).write_text(content, encoding="utf-8")
        logger.info("Wrote %s (%d chars)", filename, len(content))

    def file_info(self, filename: str) -> dict:
        path = self.memory_dir / filename
        if not path.exists():
            return {"exists": False, "size": 0, "modified": None}
        stat = path.stat()
        return {
            "exists": True,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        }

    def status(self) -> dict:
        return {
            "initialized": self.is_initialized(),
            "files": {
                name: self.file_info(name)
                for name in ("SOUL.md", "USER.md", "MEMORY.md")
            },
        }

    def build_system_prompt(self) -> str:
        """Read memory files + today's daily → frozen snapshot for system prompt injection."""
        parts: list[str] = []

        for name in ("SOUL.md", "USER.md", "MEMORY.md"):
            content = self.read(name)
            if content.strip():
                parts.append(content.strip())

        today_path = self.daily_dir / f"{date.today()}.md"
        if today_path.exists():
            daily = today_path.read_text(encoding="utf-8").strip()
            if daily:
                parts.append(daily)

        return "\n\n---\n\n".join(parts)

    def append_daily(self, text: str) -> None:
        """Append text to today's daily log."""
        self.ensure_dirs()
        today = self.daily_dir / f"{date.today()}.md"
        existing = today.read_text(encoding="utf-8") if today.exists() else ""
        if existing and not existing.endswith("\n"):
            existing += "\n"
        today.write_text(existing + text.strip() + "\n", encoding="utf-8")
        logger.info("Appended to daily/%s.md (%d chars)", date.today(), len(text))

    def read_daily(self, date_str: str) -> str:
        path = self.daily_dir / f"{date_str}.md"
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def backup_and_reset(self) -> None:
        """Backup current memory files and delete SOUL.md to trigger re-initialization."""
        import shutil
        from datetime import datetime

        backup_dir = self.memory_dir / "backups" / datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir.mkdir(parents=True, exist_ok=True)

        for name in ("SOUL.md", "USER.md", "MEMORY.md"):
            src = self.memory_dir / name
            if src.exists():
                shutil.copy2(src, backup_dir / name)
                src.unlink()
                logger.info("Backed up and removed %s", name)
