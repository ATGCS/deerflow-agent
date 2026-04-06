"""Load/save per-thread collaboration state (``collab_state.json``)."""

import json
import logging
from pathlib import Path
from typing import Any

from deerflow.collab.models import CollabPhase, ThreadCollabState, _utc_iso_z
from deerflow.config.paths import Paths

COLLAB_STATE_FILENAME = "collab_state.json"


def collab_state_path(paths: Paths, thread_id: str) -> Path:
    """Return ``{base}/threads/{thread_id}/collab_state.json`` (validates ``thread_id``)."""
    return paths.thread_dir(thread_id) / COLLAB_STATE_FILENAME


def default_thread_collab_state() -> ThreadCollabState:
    return ThreadCollabState()


def load_thread_collab_state(paths: Paths, thread_id: str) -> ThreadCollabState:
    """Read state from disk, or return defaults if missing / invalid."""
    path = collab_state_path(paths, thread_id)
    if not path.is_file():
        return default_thread_collab_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default_thread_collab_state()
    if not isinstance(raw, dict):
        return default_thread_collab_state()
    try:
        return ThreadCollabState.model_validate(raw)
    except Exception:
        return default_thread_collab_state()


def append_sidebar_supervisor_step(
    paths: Paths, thread_id: str, step: dict[str, Any], *, max_steps: int = 80
) -> None:
    """Append one supervisor timeline step and persist (trim to last ``max_steps``)."""
    tid = (thread_id or "").strip()
    if not tid:
        raise ValueError("thread_id is required")
    paths.thread_dir(tid)
    current = load_thread_collab_state(paths, tid)
    steps = list(current.sidebar_supervisor_steps)
    steps.append(step)
    if len(steps) > max_steps:
        steps = steps[-max_steps:]
    save_thread_collab_state(paths, tid, current.model_copy(update={"sidebar_supervisor_steps": steps}))


def save_thread_collab_state(paths: Paths, thread_id: str, state: ThreadCollabState) -> ThreadCollabState:
    """Write state; creates ``thread_dir`` if needed."""
    td = paths.thread_dir(thread_id)
    td.mkdir(parents=True, exist_ok=True)
    out = state.model_copy(update={"updated_at": _utc_iso_z()})
    path = td / COLLAB_STATE_FILENAME
    path.write_text(json.dumps(out.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def merge_thread_collab_state(current: ThreadCollabState, patch: dict[str, Any]) -> ThreadCollabState:
    """Apply partial update (only keys present in ``patch``)."""
    data = current.model_dump(mode="json")
    for key, value in patch.items():
        if key == "updated_at" or key not in ThreadCollabState.model_fields:
            continue
        data[key] = value
    return ThreadCollabState.model_validate(data)


logger = logging.getLogger(__name__)


def _norm_thread_id_for_dedup(value: str | None) -> str:
    """Match thread ids across clients (UUID casing, braces)."""
    if value is None:
        return ""
    return str(value).strip().lower().replace("{", "").replace("}", "")


def advance_collab_phase_to_executing_for_task(
    paths: Paths, task_id: str, *, runtime_thread_id: str | None = None
) -> bool:
    """After ``supervisor(start_execution)`` / authorize, move thread collab phase to ``executing``.

    Writes ``collab_state.json`` under the task's ``thread_id`` **and** (when different) under
    ``runtime_thread_id``. Middleware and ``task_tool`` read state by **current LangGraph thread**;
    if those differ from the task record, only updating the task folder leaves the chat stuck in
    ``awaiting_exec``.
    """
    from deerflow.collab.storage import find_main_task, get_project_storage

    storage = get_project_storage()
    found = find_main_task(storage, task_id)
    if not found:
        logger.warning("advance_collab_phase_to_executing: main task %r not found", task_id)
        return False
    project, task = found
    task_tid = (task.get("thread_id") or "").strip()
    run_tid = (runtime_thread_id or "").strip()
    nt, nr = _norm_thread_id_for_dedup(task_tid), _norm_thread_id_for_dedup(run_tid)

    targets: list[str] = []
    if task_tid:
        targets.append(task_tid)
    if run_tid and nr != nt:
        targets.append(run_tid)

    if not targets:
        logger.warning(
            "advance_collab_phase_to_executing: task %r has no thread_id and no runtime_thread_id; skip collab_state update",
            task_id,
        )
        return False

    pid = (project.get("id") or "").strip() or None
    # Merge from first target's existing file so we keep e.g. sidebar_supervisor_steps
    primary = targets[0]
    current = load_thread_collab_state(paths, primary)
    merged = merge_thread_collab_state(
        current,
        {
            "collab_phase": CollabPhase.EXECUTING.value,
            "bound_task_id": task_id,
            "bound_project_id": pid,
        },
    )
    for tid in targets:
        save_thread_collab_state(paths, tid, merged)
    logger.info(
        "advance_collab_phase_to_executing: thread_ids=%s task_id=%s project_id=%s",
        targets,
        task_id,
        pid,
    )
    return True
