from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pineastudio.db import Database

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

_db: Database | None = None


def init_conversations_router(db: Database) -> None:
    global _db
    _db = db


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
