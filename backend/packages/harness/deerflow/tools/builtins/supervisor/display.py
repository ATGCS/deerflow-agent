"""Display and formatting helpers for supervisor subtask output.

Provides:
- _subtask_worker_profile_suffix — compact worker_profile line for list_subtasks/get_status
- _subtask_row_dict — structured subtask row for JSON tool results
- _build_monitor_subtask_rows — rich subtask rows with memory snapshots for monitoring
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _subtask_worker_profile_suffix(st: dict) -> str:
    """Compact worker_profile line for list_subtasks / get_status (template + constraints)."""
    wp = st.get("worker_profile")
    if not isinstance(wp, dict) or not wp:
        return ""
    parts: list[str] = []
    b = wp.get("base_subagent")
    if b:
        parts.append(f"base={b}")
    tools = wp.get("tools") or []
    if tools:
        t = ",".join(str(x) for x in tools[:12])
        if len(tools) > 12:
            t += ",..."
        parts.append(f"tools={t}")
    skills = wp.get("skills") or []
    if skills:
        s = ",".join(str(x) for x in skills[:12])
        if len(skills) > 12:
            s += ",..."
        parts.append(f"skills={s}")
    dep = wp.get("depends_on") or []
    if dep:
        parts.append(f"deps={','.join(str(x) for x in dep)}")
    ins = (wp.get("instruction") or "").strip()
    if ins:
        _trunc = (ins[:80] + "...") if len(ins) > 80 else ins[:80]
        parts.append(f"instr={_trunc}")
    if not parts:
        return ""
    return " | profile: " + "; ".join(parts)


def _subtask_row_dict(st: dict) -> dict[str, Any]:
    """Structured subtask row for JSON tool results (get_status / list_subtasks)."""
    status = st.get("status", "unknown")
    icon = {"pending": "open", "executing": "running", "completed": "done", "failed": "failed"}.get(status, "open")
    wp = st.get("worker_profile")
    summary = _subtask_worker_profile_suffix(st)
    if summary.startswith(" | profile: "):
        summary = summary[len(" | profile: ") :]
    else:
        summary = ""
    return {
        "id": st.get("id"),
        "name": st.get("name", "unnamed"),
        "status": status,
        "statusIcon": icon,
        "assignedTo": st.get("assigned_to") or "unassigned",
        "progress": st.get("progress", 0),
        "workerProfile": wp if isinstance(wp, dict) else None,
        "workerProfileSummary": summary,
    }


def _build_monitor_subtask_rows(
    storage: Any,
    subtasks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build rich subtask rows for monitor_execution(_step) to support lead-agent reasoning."""
    from deerflow.collab.storage import get_task_memory_storage, load_task_memory_for_task_id

    sub_rows: list[dict[str, Any]] = []
    failed_subtasks: list[dict[str, Any]] = []
    mem_store = get_task_memory_storage()

    for st in subtasks:
        sid = str(st.get("id") or "")
        s_status = str(st.get("status") or "pending").strip().lower()
        s_prog = st.get("progress", 0) or 0
        s_err = st.get("error") or st.get("failed_at") or None

        wp = st.get("worker_profile")
        wp_dict = wp if isinstance(wp, dict) else None
        observed = st.get("observed_tools") or []
        if not isinstance(observed, list):
            observed = []
        observed_calls = st.get("observed_tool_calls") or []
        if not isinstance(observed_calls, list):
            observed_calls = []

        item: dict[str, Any] = {
            "subtaskId": sid,
            "status": s_status,
            "progress": s_prog,
            "assignedTo": st.get("assigned_to") or "unassigned",
            "workerProfile": wp_dict,
            "workerProfileSummary": _subtask_worker_profile_suffix(st).replace(" | profile: ", ""),
            "observedTools": [str(x) for x in observed if str(x).strip()],
            "observedToolCalls": observed_calls[-40:],
        }

        # If observed tools are not yet available, fall back to worker_profile.tools (planned tools).
        if not item["observedTools"] and isinstance(wp_dict, dict):
            raw_tools = wp_dict.get("tools") or []
            if isinstance(raw_tools, list):
                item["observedTools"] = [str(x) for x in raw_tools if str(x).strip()]

        # Attach subtask memory snapshot (best-effort).
        try:
            if sid:
                mrow = load_task_memory_for_task_id(storage, mem_store, sid)
                if mrow is not None:
                    mem, _project_id, _agent_id, _parent_task_id = mrow
                    facts = mem.get("facts") or []
                    if not isinstance(facts, list):
                        facts = []
                    item["memory"] = {
                        "status": mem.get("status", ""),
                        "progress": mem.get("progress", 0),
                        "current_step": mem.get("current_step", ""),
                        "output_summary": mem.get("output_summary", ""),
                        "factsCount": len(facts),
                    }
        except Exception:
            logger.debug("monitor subtask memory snapshot failed sid=%s", sid, exc_info=True)

        if s_err and s_status in {"failed"}:
            item["error"] = s_err
            failed_subtasks.append(item)

        sub_rows.append(item)

    return sub_rows, failed_subtasks


__all__ = [
    "_subtask_worker_profile_suffix",
    "_subtask_row_dict",
    "_build_monitor_subtask_rows",
]
