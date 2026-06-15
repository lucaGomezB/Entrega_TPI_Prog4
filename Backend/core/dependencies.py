"""
Core dependency injection module.

Provides singleton-style dependencies for the FastAPI application.
"""

import asyncio
import logging
from core.websocket_manager import WSManager

logger = logging.getLogger(__name__)

# ── Singleton WSManager instance ──
_ws_manager: WSManager | None = None


def get_ws_manager() -> WSManager:
    """Return the singleton WSManager instance, creating it on first call.

    Suitable for use as a FastAPI dependency:
        ws_manager: WSManager = Depends(get_ws_manager)
    """
    global _ws_manager
    if _ws_manager is None:
        _ws_manager = WSManager()
        logger.info("WSManager singleton initialized")
    return _ws_manager


def fire_broadcast(ws_manager: WSManager | None, room: str | int, payload: dict) -> None:
    """Fire-and-forget broadcast to a specific room from a sync context.

    Uses asyncio.run() to execute the async broadcast. Safe to call from
    thread-pool threads (sync FastAPI route handlers) because those threads
    do not have a running event loop.

    Args:
        ws_manager: The WSManager instance (or None to skip).
        room: Target room key.
        payload: JSON-serializable dict.
    """
    if ws_manager is None:
        return
    try:
        asyncio.run(ws_manager.broadcast(room, payload))
    except Exception as exc:
        logger.warning("WS broadcast to room %s failed: %s", room, exc)


def fire_broadcast_admin(ws_manager: WSManager | None, payload: dict) -> None:
    """Fire-and-forget broadcast to the admin room from a sync context.

    Args:
        ws_manager: The WSManager instance (or None to skip).
        payload: JSON-serializable dict.
    """
    if ws_manager is None:
        return
    try:
        asyncio.run(ws_manager.broadcast_admin(payload))
    except Exception as exc:
        logger.warning("WS admin broadcast failed: %s", exc)
