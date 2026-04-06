"""Per-thread collaboration state API (``collab_state.json`` under thread dir)."""

import logging
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from deerflow.collab.models import CollabPhase, ThreadCollabState
from deerflow.collab.task_progress_snapshot import build_task_progress_snapshot
from deerflow.collab.thread_collab import (
    load_thread_collab_state,
    merge_thread_collab_state,
    save_thread_collab_state,
)
from deerflow.config.paths import get_paths

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collab", tags=["collab"])


class ThreadCollabStatePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    collab_phase: CollabPhase | None = None
    bound_task_id: str | None = None
    bound_project_id: str | None = None


class ThreadCollabStateResponse(BaseModel):
    collab_phase: CollabPhase
    bound_task_id: str | None
    bound_project_id: str | None
    sidebar_supervisor_steps: list[dict[str, Any]] = Field(default_factory=list)
    updated_at: str


@router.get("/threads/{thread_id}/task-progress")
async def get_thread_task_progress(thread_id: str) -> dict[str, Any]:
    """Restore DeerPanel task sidebar after refresh: main task + subtasks bound to this chat thread."""
    paths = get_paths()
    try:
        return build_task_progress_snapshot(paths, thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        logger.exception("task-progress failed for thread_id=%s", thread_id)
        raise HTTPException(status_code=500, detail="Failed to load task progress for thread.") from None


@router.get("/threads/{thread_id}", response_model=ThreadCollabStateResponse)
async def get_thread_collab_state(thread_id: str) -> ThreadCollabState:
    paths = get_paths()
    try:
        return load_thread_collab_state(paths, thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        logger.exception("Failed to load collab state for %s", thread_id)
        raise HTTPException(status_code=500, detail="Failed to load collaboration state.") from None


@router.put("/threads/{thread_id}", response_model=ThreadCollabStateResponse)
async def put_thread_collab_state(thread_id: str, body: dict[str, Any] = Body(default_factory=dict)) -> ThreadCollabState:
    paths = get_paths()
    try:
        patch_model = ThreadCollabStatePatch.model_validate(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    patch = patch_model.model_dump(exclude_unset=True, mode="json")
    try:
        current = load_thread_collab_state(paths, thread_id)
        if not patch:
            return current
        merged = merge_thread_collab_state(current, patch)
        return save_thread_collab_state(paths, thread_id, merged)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        logger.exception("Failed to save collab state for %s", thread_id)
        raise HTTPException(status_code=500, detail="Failed to save collaboration state.") from None
