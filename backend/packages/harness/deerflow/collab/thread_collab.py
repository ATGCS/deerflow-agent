"""Load/save per-thread collaboration state (``collab_state.json``)."""

import json
from pathlib import Path
from typing import Any

from deerflow.collab.models import ThreadCollabState, _utc_iso_z
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
