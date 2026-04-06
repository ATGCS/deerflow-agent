import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from deerflow.collab.task_progress_snapshot import build_task_progress_snapshot
from deerflow.config.paths import Paths, get_paths

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/threads", tags=["threads"])


class ThreadDeleteResponse(BaseModel):
    """Response model for thread cleanup."""

    success: bool
    message: str


def _delete_thread_data(thread_id: str, paths: Paths | None = None) -> ThreadDeleteResponse:
    """Delete local persisted filesystem data for a thread."""
    path_manager = paths or get_paths()
    try:
        path_manager.delete_thread_dir(thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to delete thread data for %s", thread_id)
        raise HTTPException(status_code=500, detail="Failed to delete local thread data.") from exc

    logger.info("Deleted local thread data for %s", thread_id)
    return ThreadDeleteResponse(success=True, message=f"Deleted local thread data for {thread_id}")


@router.get("/{thread_id}/task-progress")
async def get_thread_task_progress_alias(thread_id: str) -> dict[str, Any]:
    """Same payload as ``GET /api/collab/threads/{thread_id}/task-progress`` (alias for proxies / older clients)."""
    paths = get_paths()
    try:
        return build_task_progress_snapshot(paths, thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        logger.exception("task-progress (threads alias) failed for thread_id=%s", thread_id)
        raise HTTPException(status_code=500, detail="Failed to load task progress for thread.") from None


@router.delete("/{thread_id}", response_model=ThreadDeleteResponse)
async def delete_thread_data(thread_id: str) -> ThreadDeleteResponse:
    """Delete local persisted filesystem data for a thread.

    This endpoint only cleans DeerFlow-managed thread directories. LangGraph
    thread state deletion remains handled by the LangGraph API.
    """
    return _delete_thread_data(thread_id)
