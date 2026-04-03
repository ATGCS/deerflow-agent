"""SSE (Server-Sent Events) router for real-time collaboration events."""

import asyncio
import json
import logging
import os
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from deerflow.collab.storage import get_project_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])

_observers: dict[str, list[asyncio.Queue]] = defaultdict(list)
_observer_lock = asyncio.Lock()


class EventBroadcaster:
    """Singleton event broadcaster for collaboration events."""

    _instance = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = EventBroadcaster()
        return cls._instance

    async def broadcast(self, project_id: str, event_type: str, data: dict[str, Any]) -> None:
        """Broadcast an event to all observers of a project."""
        event = {
            "type": event_type,
            "project_id": project_id,
            "data": data,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

        async with _observer_lock:
            queues = list(_observers.get(project_id, []))

        for queue in queues:
            try:
                await queue.put(json.dumps(event))
            except Exception as e:
                logger.warning("Failed to send event to observer: %s", e)

    def add_observer(self, project_id: str, queue: asyncio.Queue) -> None:
        """Add an observer for a project."""
        _observers[project_id].append(queue)

    def remove_observer(self, project_id: str, queue: asyncio.Queue) -> None:
        """Remove an observer from a project."""
        if project_id in _observers:
            try:
                _observers[project_id].remove(queue)
            except ValueError:
                pass


broadcaster = EventBroadcaster.get_instance()


async def event_generator(project_id: str):
    """Generate SSE events for a project."""
    queue: asyncio.Queue = asyncio.Queue()

    broadcaster.add_observer(project_id, queue)

    try:
        yield f"event: connected\ndata: {{}}\n\n"

        while True:
            try:
                event_data = await asyncio.wait_for(queue.get(), timeout=30)
                yield f"data: {event_data}\n\n"
            except asyncio.TimeoutError:
                yield f"event: ping\ndata: {{}}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        broadcaster.remove_observer(project_id, queue)


@router.get("/projects/{project_id}/stream", summary="Subscribe to Project Events", description="Subscribe to real-time events for a project.")
async def subscribe_project_events(project_id: str):
    """Subscribe to project events via SSE."""
    storage = get_project_storage()
    project = storage.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")

    return StreamingResponse(
        event_generator(project_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def emit_task_created(project_id: str, task: dict[str, Any]) -> None:
    """Emit a task created event."""
    await broadcaster.broadcast(project_id, "task:created", {"task": task})


async def emit_task_started(project_id: str, task_id: str, agent_id: str) -> None:
    """Emit a task started event."""
    await broadcaster.broadcast(project_id, "task:started", {"task_id": task_id, "agent_id": agent_id})


async def emit_task_progress(project_id: str, task_id: str, progress: int, current_step: str = "") -> None:
    """Emit a task progress event."""
    await broadcaster.broadcast(project_id, "task:progress", {"task_id": task_id, "progress": progress, "current_step": current_step})


async def emit_task_completed(project_id: str, task_id: str, result: Any = None) -> None:
    """Emit a task completed event."""
    await broadcaster.broadcast(project_id, "task:completed", {"task_id": task_id, "result": result})


async def emit_task_failed(project_id: str, task_id: str, error: str) -> None:
    """Emit a task failed event."""
    await broadcaster.broadcast(project_id, "task:failed", {"task_id": task_id, "error": error})


async def emit_task_heartbeat(project_id: str, task_id: str, agent_id: str, status: str, progress: int, current_step: str) -> None:
    """Emit a task heartbeat event."""
    await broadcaster.broadcast(project_id, "task:heartbeat", {
        "task_id": task_id,
        "agent_id": agent_id,
        "status": status,
        "progress": progress,
        "current_step": current_step,
    })


async def emit_task_memory_updated(project_id: str, task_id: str, facts_count: int) -> None:
    """Emit a task memory updated event."""
    await broadcaster.broadcast(project_id, "task_memory:updated", {"task_id": task_id, "facts_count": facts_count})


async def emit_project_updated(project_id: str, status: str) -> None:
    """Emit a project updated event."""
    await broadcaster.broadcast(project_id, "project:updated", {"project_id": project_id, "status": status})


class InternalBroadcastBody(BaseModel):
    """Body for LangGraph → gateway SSE fan-out (separate process)."""

    project_id: str
    event_type: str
    data: dict[str, Any] = Field(default_factory=dict)


@router.post("/internal/broadcast", summary="Internal broadcast", include_in_schema=False)
async def internal_broadcast(
    body: InternalBroadcastBody,
    x_internal_events_secret: str | None = Header(default=None, alias="X-Internal-Events-Secret"),
) -> dict[str, bool]:
    """Relay an event into the in-memory broadcaster (requires ``INTERNAL_EVENTS_SECRET``)."""
    expected = (os.getenv("INTERNAL_EVENTS_SECRET") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="Internal events disabled (set INTERNAL_EVENTS_SECRET).")
    if (x_internal_events_secret or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid internal events secret.")
    await broadcaster.broadcast(body.project_id, body.event_type, body.data)
    return {"ok": True}
