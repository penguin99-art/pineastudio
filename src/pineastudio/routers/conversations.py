from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from pineastudio.db import Database
from pineastudio.services.memory_manager import MemoryManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

_db: Database | None = None
_memory: MemoryManager | None = None
_ollama_host: str = "http://localhost:11434"
_summarize_model: str = "gemma4:e2b"


def init_conversations_router(
    db: Database,
    memory: MemoryManager | None = None,
    ollama_host: str = "http://localhost:11434",
    summarize_model: str = "gemma4:e2b",
) -> None:
    global _db, _memory, _ollama_host, _summarize_model
    _db = db
    _memory = memory
    _ollama_host = ollama_host
    _summarize_model = summarize_model


class ConversationCreate(BaseModel):
    title: str = ""
    model: str = ""


class ConversationUpdate(BaseModel):
    title: str | None = None
    model: str | None = None


class MessageCreate(BaseModel):
    role: str
    content: str
    reasoning: str = ""
    model: str = ""


@router.get("")
async def list_conversations():
    assert _db
    return await _db.list_conversations()


@router.post("")
async def create_conversation(body: ConversationCreate):
    assert _db
    conv_id = uuid.uuid4().hex[:12]
    await _db.create_conversation(conv_id, body.title or "New Chat", body.model)
    return {"id": conv_id, "title": body.title or "New Chat", "model": body.model}


@router.get("/{conv_id}")
async def get_conversation(conv_id: str):
    assert _db
    conv = await _db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    messages = await _db.list_messages(conv_id)
    return {**conv, "messages": messages}


@router.put("/{conv_id}")
async def update_conversation(conv_id: str, body: ConversationUpdate):
    assert _db
    fields: dict = {}
    if body.title is not None:
        fields["title"] = body.title
    if body.model is not None:
        fields["model"] = body.model
    if fields:
        await _db.update_conversation(conv_id, **fields)
    return {"ok": True}


@router.delete("/{conv_id}")
async def delete_conversation(conv_id: str):
    assert _db
    await _db.delete_conversation(conv_id)
    return {"ok": True}


@router.post("/{conv_id}/messages")
async def add_message(conv_id: str, body: MessageCreate):
    assert _db
    conv = await _db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    msg_id = await _db.add_message(conv_id, body.role, body.content, body.reasoning, body.model)
    return {"id": msg_id}


@router.post("/{conv_id}/summarize")
async def summarize(conv_id: str, bg: BackgroundTasks):
    """Trigger async summarization of a conversation into the daily log."""
    assert _db
    if not _memory or not _memory.is_initialized():
        return {"ok": False, "reason": "memory not initialized"}

    conv = await _db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    messages = await _db.list_messages(conv_id)

    async def _do_summarize():
        from pineastudio.services.summarizer import summarize_conversation
        msg_dicts = [{"role": m["role"], "content": m["content"]} for m in messages]
        try:
            result = await summarize_conversation(
                msg_dicts, _memory, _ollama_host, _summarize_model,
            )
            if result:
                logger.info("Summarized conversation %s: %d chars", conv_id, len(result))
        except Exception as e:
            logger.warning("Failed to summarize conversation %s: %s", conv_id, e)

    bg.add_task(_do_summarize)
    return {"ok": True, "status": "queued"}
