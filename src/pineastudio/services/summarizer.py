"""Post-conversation summarizer: extracts key facts and writes daily logs."""
from __future__ import annotations

import json
import logging
from datetime import datetime

import httpx

from pineastudio.services.memory_manager import MemoryManager

logger = logging.getLogger(__name__)

SUMMARIZE_PROMPT = (
    "Below is a conversation between a user and an AI assistant. "
    "Summarize the KEY information in 2-4 bullet points (use - prefix). "
    "Focus on: user facts, preferences, plans, decisions, important requests. "
    "Skip: greetings, chitchat, technical implementation details. "
    "If nothing meaningful was discussed, reply with exactly: SKIP\n"
    "Reply in the same language the conversation used."
)

MIN_MESSAGES_TO_SUMMARIZE = 4


async def summarize_conversation(
    messages: list[dict],
    memory: MemoryManager,
    ollama_host: str = "http://localhost:11434",
    model: str = "gemma4:e2b",
) -> str | None:
    """Summarize a conversation and append to today's daily log.

    Returns the summary text, or None if skipped.
    """
    user_assistant = [
        m for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content", "").strip()
    ]
    if len(user_assistant) < MIN_MESSAGES_TO_SUMMARIZE:
        logger.info("Skipping summarization: only %d messages", len(user_assistant))
        return None

    transcript = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
        for m in user_assistant[-20:]
    )

    llm_messages = [
        {"role": "system", "content": SUMMARIZE_PROMPT},
        {"role": "user", "content": transcript},
    ]

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{ollama_host}/api/chat",
                json={"model": model, "messages": llm_messages, "stream": False,
                      "options": {"num_predict": 256}},
            )
            resp.raise_for_status()
            data = resp.json()
            summary = data.get("message", {}).get("content", "").strip()
    except Exception as e:
        logger.warning("Summarization LLM call failed: %s", e)
        return None

    if not summary or summary.upper() == "SKIP":
        logger.info("Summarization returned SKIP")
        return None

    now = datetime.now().strftime("%H:%M")
    entry = f"\n### {now}\n{summary}\n"
    memory.append_daily(entry)
    logger.info("Wrote conversation summary to daily log: %d chars", len(summary))
    return summary
