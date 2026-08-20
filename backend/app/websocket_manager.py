"""
WebSocket Connection Manager
============================
Maintains the set of active WebSocket clients and broadcasts
JSON-serialisable payloads to all connected clients.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        logger.info("WS client connected. Total: %d", len(self._connections))

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)
        logger.info("WS client disconnected. Total: %d", len(self._connections))

    async def broadcast(self, payload: dict) -> None:
        """Send payload to all active clients; silently drop dead connections."""
        message = json.dumps(payload)
        dead: Set[WebSocket] = set()
        async with self._lock:
            targets = set(self._connections)   # snapshot to avoid mutation during iteration

        for ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)

        if dead:
            async with self._lock:
                self._connections -= dead
            logger.debug("Removed %d dead WS connections.", len(dead))

    @property
    def connection_count(self) -> int:
        return len(self._connections)


# Singleton shared across the application
manager = ConnectionManager()
