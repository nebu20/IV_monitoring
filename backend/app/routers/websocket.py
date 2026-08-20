"""
WebSocket Router
================
WS /ws/telemetry  – real-time bidirectional channel for React Native clients.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket_manager import manager
from app.routers.telemetry import get_latest_state_cache

logger = logging.getLogger(__name__)
router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    """
    Accept a WebSocket connection. On connect, push the full latest state
    snapshot so the client doesn't wait for the next sensor tick.
    Then keep the connection open and relay any broadcast messages.
    """
    await manager.connect(websocket)
    try:
        # Send current state snapshot immediately on connect
        cache = get_latest_state_cache()
        if cache:
            await websocket.send_text(
                json.dumps({
                    "type": "INITIAL_STATE",
                    "data": list(cache.values()),
                })
            )

        # Keep alive — we only receive pings/pongs or client messages
        while True:
            data = await websocket.receive_text()
            # Handle client-initiated messages (e.g., ping)
            try:
                msg = json.loads(data)
                if msg.get("type") == "PING":
                    await websocket.send_text(json.dumps({"type": "PONG"}))
            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected normally.")
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        await manager.disconnect(websocket)
