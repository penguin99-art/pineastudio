from __future__ import annotations

import json
from pathlib import Path

import aiosqlite

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS backends (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    base_url   TEXT NOT NULL,
    config     TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS downloads (
    task_id    TEXT PRIMARY KEY,
    repo_id    TEXT NOT NULL,
    filename   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    progress   REAL NOT NULL DEFAULT 0.0,
    error      TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    model      TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    reasoning       TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
"""


class Database:
    def __init__(self, db_path: Path):
        self._path = db_path
        self._db: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self._db = await aiosqlite.connect(self._path)
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_SCHEMA)
        await self._migrate()
        await self._db.commit()

    async def _migrate(self) -> None:
        """Add columns that may be missing from earlier schema versions."""
        assert self._db
        try:
            await self._db.execute("SELECT model FROM messages LIMIT 0")
        except Exception:
            await self._db.execute(
                "ALTER TABLE messages ADD COLUMN model TEXT NOT NULL DEFAULT ''"
            )
            await self._db.commit()

    async def close(self) -> None:
        if self._db:
            await self._db.close()

    @property
    def db(self) -> aiosqlite.Connection:
        assert self._db is not None, "Database not connected"
        return self._db

    # ── Backends ─────────────────────────────────────────────────────────

    async def list_backends(self) -> list[dict]:
        async with self.db.execute("SELECT * FROM backends") as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

    async def get_backend(self, backend_id: str) -> dict | None:
        async with self.db.execute(
            "SELECT * FROM backends WHERE id = ?", (backend_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def upsert_backend(
        self, id: str, type: str, kind: str, base_url: str, config: dict | None = None
    ) -> None:
        await self.db.execute(
            "INSERT OR REPLACE INTO backends (id, type, kind, base_url, config) "
            "VALUES (?, ?, ?, ?, ?)",
            (id, type, kind, base_url, json.dumps(config or {})),
        )
        await self.db.commit()

    async def delete_backend(self, backend_id: str) -> None:
        await self.db.execute("DELETE FROM backends WHERE id = ?", (backend_id,))
        await self.db.commit()

    # ── Downloads ────────────────────────────────────────────────────────

    async def create_download(self, task_id: str, repo_id: str, filename: str) -> None:
        await self.db.execute(
            "INSERT INTO downloads (task_id, repo_id, filename) VALUES (?, ?, ?)",
            (task_id, repo_id, filename),
        )
        await self.db.commit()

    async def update_download(self, task_id: str, **fields: object) -> None:
        sets = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [task_id]
        await self.db.execute(
            f"UPDATE downloads SET {sets} WHERE task_id = ?", vals
        )
        await self.db.commit()

    async def list_downloads(self) -> list[dict]:
        async with self.db.execute(
            "SELECT * FROM downloads ORDER BY created_at DESC"
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

    async def delete_download(self, task_id: str) -> None:
        await self.db.execute("DELETE FROM downloads WHERE task_id = ?", (task_id,))
        await self.db.commit()

    # ── Conversations ─────────────────────────────────────────────────

    async def list_conversations(self, limit: int = 50) -> list[dict]:
        async with self.db.execute(
            "SELECT id, title, model, created_at, updated_at FROM conversations "
            "ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def get_conversation(self, conv_id: str) -> dict | None:
        async with self.db.execute(
            "SELECT * FROM conversations WHERE id = ?", (conv_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None

    async def create_conversation(self, conv_id: str, title: str, model: str) -> None:
        await self.db.execute(
            "INSERT INTO conversations (id, title, model) VALUES (?, ?, ?)",
            (conv_id, title, model),
        )
        await self.db.commit()

    async def update_conversation(self, conv_id: str, **fields: object) -> None:
        sets = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [conv_id]
        await self.db.execute(
            f"UPDATE conversations SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            vals,
        )
        await self.db.commit()

    async def delete_conversation(self, conv_id: str) -> None:
        await self.db.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        await self.db.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        await self.db.commit()

    # ── Messages ──────────────────────────────────────────────────────

    async def list_messages(self, conv_id: str) -> list[dict]:
        async with self.db.execute(
            "SELECT id, role, content, reasoning, model, created_at FROM messages "
            "WHERE conversation_id = ? ORDER BY id ASC",
            (conv_id,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def add_message(
        self, conv_id: str, role: str, content: str,
        reasoning: str = "", model: str = "",
    ) -> int:
        cur = await self.db.execute(
            "INSERT INTO messages (conversation_id, role, content, reasoning, model) "
            "VALUES (?, ?, ?, ?, ?)",
            (conv_id, role, content, reasoning, model),
        )
        await self.db.execute(
            "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (conv_id,),
        )
        await self.db.commit()
        return cur.lastrowid or 0
