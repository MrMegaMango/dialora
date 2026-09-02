from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from .models import CallSession


class SessionStore:
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, CallSession] = {}
        self._lock = asyncio.Lock()

    async def save(self, session: CallSession) -> CallSession:
        async with self._lock:
            session.updated_at = datetime.now(UTC)
            self._sessions[session.id] = session
            path = self.directory / f"{session.id}.json"
            path.write_text(
                json.dumps(session.model_dump(mode="json"), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        return session

    async def get(self, session_id: str) -> CallSession | None:
        if session_id in self._sessions:
            return self._sessions[session_id]
        path = self.directory / f"{session_id}.json"
        if not path.exists():
            return None
        session = CallSession.model_validate_json(path.read_text(encoding="utf-8"))
        self._sessions[session_id] = session
        return session
