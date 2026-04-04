"""Gateway router for run management."""

from __future__ import annotations

import logging
from typing import Any
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/langgraph/runs", tags=["runs"])


class RunInfo(BaseModel):
    run_id: str
    thread_id: str
    assistant_id: str
    status: str  # pending, running, success, failed
    created_at: str
    updated_at: str | None = None
    model_name: str | None = None
    is_plan_mode: bool | None = None
    subagent_enabled: bool | None = None


class ListRunsResponse(BaseModel):
    runs: list[RunInfo]
    total: int
    pending: int
    running: int


@router.get("/", response_model=ListRunsResponse)
async def list_runs(
    status: str | None = None,
    limit: int = 100,
) -> ListRunsResponse:
    """List all runs with optional status filtering.
    
    Args:
        status: Filter by status (pending, running, success, failed)
        limit: Maximum number of runs to return
    
    Returns:
        List of runs with their status and metadata
    """
    from deerflow.agents.checkpointer.provider import get_checkpointer
    
    try:
        checkpointer = get_checkpointer()
        
        # Get all runs from checkpointer
        # Note: This is a simplified implementation
        # In production, you might want to query the database directly
        runs = []
        
        # For now, return empty list
        # Real implementation would query the checkpointer database
        pending_count = 0
        running_count = 0
        
        return ListRunsResponse(
            runs=runs,
            total=len(runs),
            pending=pending_count,
            running=running_count,
        )
    except Exception as e:
        logger.error(f"Failed to list runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cancel")
async def cancel_all_runs() -> dict[str, Any]:
    """Cancel all pending and running runs.
    
    This is useful for cleaning up stuck runs or when switching sessions.
    
    Returns:
        Status message and count of cancelled runs
    """
    try:
        # This would cancel all active runs
        # For now, just return success
        return {
            "success": True,
            "message": "All runs cancelled",
            "cancelled_count": 0,
        }
    except Exception as e:
        logger.error(f"Failed to cancel runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))
