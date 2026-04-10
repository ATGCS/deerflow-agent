"""Per-thread collaboration state API (``collab_state.json`` under thread dir)."""

import asyncio
import json
import logging
import time
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from deerflow.collab.models import CollabPhase, ThreadCollabState
from deerflow.collab.storage import (
    find_main_task,
    get_project_storage,
    get_task_memory_storage,
    load_task_memory_for_task_id,
)
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


@router.get("/threads/{thread_id}/task-stream", summary="SSE: stream task progress snapshots for a thread")
async def stream_thread_task_progress(
    thread_id: str,
    poll_interval_ms: int = 200,
    max_wait_seconds: int = 600,
) -> StreamingResponse:
    """Stream task/subtask progress for a thread, independent of chat run lifetime.

    This endpoint exists to solve: lead-agent run ends early but subtasks still run in background,
    so the UI must keep receiving progress/memory/error updates.
    """

    paths = get_paths()
    poll_seconds = max(0.2, min(5.0, float(poll_interval_ms) / 1000.0))
    timeout_seconds = max(1, int(max_wait_seconds))

    terminal_main = {"completed", "failed", "cancelled"}
    terminal_sub = {"completed", "failed", "cancelled"}

    async def _gen() -> AsyncGenerator[str, None]:
        started = time.monotonic()

        try:
            while True:
                if time.monotonic() - started > timeout_seconds:
                    return

                # Read collab state first.
                try:
                    collab = load_thread_collab_state(paths, thread_id)
                    phase_val = (
                        collab.collab_phase.value
                        if hasattr(collab.collab_phase, "value")
                        else str(collab.collab_phase)
                    )
                    phase_str = str(phase_val or "idle").strip().lower()
                except Exception:
                    phase_str = "idle"
                    collab = None  # type: ignore

                snap: dict[str, Any] = {}
                try:
                    snap = build_task_progress_snapshot(paths, thread_id)
                except Exception:
                    snap = {"thread_id": thread_id, "main_task": None, "subtasks": []}

                # Attach task memory snapshot (best-effort)
                memory_payload: dict[str, Any] | None = None
                try:
                    main_task_id = (snap.get("main_task") or {}).get("taskId")
                    if main_task_id:
                        storage = get_project_storage()
                        mem_store = get_task_memory_storage()
                        row = load_task_memory_for_task_id(storage, mem_store, str(main_task_id))
                        if row is not None:
                            mem, _project_id, _agent_id, _parent = row
                            facts = mem.get("facts") or []
                            if not isinstance(facts, list):
                                facts = []
                            memory_payload = {
                                "status": mem.get("status", ""),
                                "progress": mem.get("progress", 0),
                                "current_step": mem.get("current_step", ""),
                                "output_summary": mem.get("output_summary", ""),
                                "factsCount": len(facts),
                                "facts": facts[:5],
                            }
                except Exception:
                    memory_payload = None

                # Determine terminal condition and auto-close collab phase.
                terminal = False
                has_running_task = False
                try:
                    main_task = snap.get("main_task") or {}
                    t_status = str(main_task.get("status") or "").strip().lower()
                    subs = snap.get("subtasks") or []
                    has_running_task = t_status not in {"", "pending", *terminal_main}
                    if not has_running_task:
                        has_running_task = any(
                            str(st.get("status") or "").strip().lower() not in {"", "pending", *terminal_sub}
                            for st in subs
                            if isinstance(st, dict)
                        )
                    subs_terminal = bool(subs) and all(
                        str(st.get("status") or "").strip().lower() in terminal_sub for st in subs if isinstance(st, dict)
                    )
                    terminal = t_status in terminal_main or subs_terminal
                except Exception:
                    terminal = False
                    has_running_task = False

                # Backend-strong terminal fallback:
                # Re-check task storage directly by main task id (or bound task id) to avoid
                # stale snapshot/status mismatch that may leave UI "processing" forever.
                if not terminal:
                    try:
                        main_task_id = str(main_task.get("taskId") or snap.get("bound_task_id") or "").strip()
                        if main_task_id:
                            storage2 = get_project_storage()
                            row2 = find_main_task(storage2, main_task_id)
                            if row2 is not None:
                                _p2, t2 = row2
                                raw_subs = [x for x in (t2.get("subtasks") or []) if isinstance(x, dict)]
                                if raw_subs:
                                    active_subs = [
                                        x
                                        for x in raw_subs
                                        if str(x.get("status") or "").strip().lower()
                                        not in {"completed", "failed", "cancelled", "timed_out"}
                                    ]
                                    if not active_subs:
                                        terminal = True
                                        has_running_task = False
                    except Exception:
                        logger.debug("task-stream: storage terminal fallback failed", exc_info=True)

                # If collab phase is stale idle/done but task is still running, self-heal to executing and continue streaming.
                if phase_str in {"idle", "done"} and has_running_task:
                    try:
                        cur = load_thread_collab_state(paths, thread_id)
                        merged = merge_thread_collab_state(cur, {"collab_phase": CollabPhase.EXECUTING.value})
                        save_thread_collab_state(paths, thread_id, merged)
                        phase_str = CollabPhase.EXECUTING.value
                    except Exception:
                        logger.debug("task-stream: failed to self-heal collab_phase to executing", exc_info=True)

                # Only stop early when phase is idle/done and there is no running task to watch.
                if phase_str in {"idle", "done"} and not has_running_task:
                    return

                payload = {
                    "thread_id": thread_id,
                    "terminal": terminal,
                    "collab_phase": phase_str,
                    "snapshot": snap,
                    "memory": memory_payload,
                }
                yield f"event: task_progress\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"

                if terminal:
                    # Best-effort: mark collab phase as done to prevent stale executing state.
                    try:
                        cur = load_thread_collab_state(paths, thread_id)
                        merged = merge_thread_collab_state(cur, {"collab_phase": CollabPhase.DONE.value})
                        save_thread_collab_state(paths, thread_id, merged)
                    except Exception:
                        logger.debug("task-stream: failed to set collab_phase=done", exc_info=True)
                    return

                await asyncio.sleep(poll_seconds)
        except Exception:
            logger.exception("task-stream failed thread_id=%s", thread_id)
            err_payload = {"thread_id": thread_id, "terminal": True, "error": "task_stream_internal_error"}
            yield f"event: task_progress\ndata: {json.dumps(err_payload, ensure_ascii=False)}\n\n"
            return

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(_gen(), headers=headers, media_type="text/event-stream")
