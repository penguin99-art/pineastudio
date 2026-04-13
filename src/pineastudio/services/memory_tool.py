"""Memory tool: LLM-driven add/replace/remove operations on memory files."""
from __future__ import annotations

import logging

from pineastudio.services.memory_manager import MemoryManager

logger = logging.getLogger(__name__)

CHAR_LIMITS = {
    "MEMORY.md": 2200,
    "USER.md": 1375,
}

TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "memory",
        "description": "Manage persistent memory. Changes take effect in the next conversation.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["add", "replace", "remove"],
                    "description": "add=append, replace=swap old→new, remove=delete substring",
                },
                "file": {
                    "type": "string",
                    "enum": ["MEMORY.md", "USER.md"],
                    "description": "Which memory file to operate on",
                },
                "content": {
                    "type": "string",
                    "description": "Content to add or replace with (required for add/replace)",
                },
                "old_content": {
                    "type": "string",
                    "description": "Substring to match for replace/remove",
                },
            },
            "required": ["action", "file"],
        },
    },
}


class MemoryTool:
    def __init__(self, mm: MemoryManager):
        self.mm = mm

    @property
    def schema(self) -> dict:
        return TOOL_SCHEMA

    def execute(self, action: str, file: str,
                content: str = "", old_content: str = "") -> str:
        if file not in ("MEMORY.md", "USER.md"):
            return f"Error: can only operate on MEMORY.md or USER.md, got {file}"

        text = self.mm.read(file)

        if action == "add":
            if not content:
                return "Error: 'content' is required for add"
            text = (text + "\n" + content).strip()

        elif action == "replace":
            if not old_content:
                return "Error: 'old_content' is required for replace"
            if old_content not in text:
                return f"Error: substring not found in {file}"
            text = text.replace(old_content, content, 1)

        elif action == "remove":
            if not old_content:
                return "Error: 'old_content' is required for remove"
            if old_content not in text:
                return f"Error: substring not found in {file}"
            text = text.replace(old_content, "", 1)

        else:
            return f"Error: unknown action '{action}'"

        text = text.strip()
        limit = CHAR_LIMITS.get(file)
        if limit and len(text) > limit:
            return (
                f"Error: {file} would be {len(text)} chars, exceeding limit of {limit}. "
                "Remove old content first."
            )

        self.mm.write(file, text)
        logger.info("memory tool: %s on %s → %d chars", action, file, len(text))
        return f"OK: {action} on {file} ({len(text)} chars)"
