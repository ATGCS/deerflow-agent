"""Supervisor tool for multi-agent task planning and coordination.

Thin routing layer: ``@tool("supervisor")`` + action dispatch.
All heavy logic is delegated to the :pymod:`supervisor` sub-package:
- :pymod:`~supervisor.dependency` — DAG depends_on resolution
- :pymod:`~supervisor.execution` — Delegation (task_tool), auto-followup wave
- :pymod:`~supervisor.monitor`  — Background task monitor, recommendation engine
- :pymod:`~supervisor.memory`  — Memory aggregation, SSE broadcast
- :pymod:`~supervisor.utils`    — Runtime helpers, debug, clamping
- :pymod:`~supervisor.display`  — Subtask row formatting, worker_profile rendering
"""

import asyncio
import json
import logging
import os
import time
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import ValidationError

from deerflow.collab.models import CollabPhase, WorkerProfile
from deerflow.collab.authorize_execution import authorize_main_task_execution
from deerflow.collab.id_format import make_subtask_id
from deerflow.collab.storage import (
    find_main_task,
    find_open_main_task_id_by_name,
    find_subtask_by_ids,
    get_project_storage,
    get_task_memory_storage,
    load_task_memory_for_task_id,
    new_project_bundle_root_task,
    rollup_root_task_progress_from_subtasks,
)
from deerflow.collab.thread_collab import (
    advance_collab_phase_to_executing_for_task,
    append_sidebar_supervisor_step,
    load_thread_collab_state,
    merge_thread_collab_state,
    save_thread_collab_state,
)
from deerflow.config.agents_config import load_agent_config, list_all_agents
from deerflow.config.paths import get_paths
from deerflow.subagents import get_available_subagent_names
from deerflow.subagents.builtins import BUILTIN_SUBAGENTS

# ── Sub-module imports (extracted from monolithic layout) ──────────────
from deerflow.tools.builtins.supervisor.dependency import (       # noqa: F401
    _TERMINAL_SUBTASK,
    _IN_FLIGHT_SUBTASK,
    _subtask_dep_ids,
    _build_subtask_name_index,
    _resolve_dep_ref_to_id,
    _auto_finalize_unrunnable_pending_subtasks,
    _resolve_subtasks_for_start_execution,
)
from deerflow.tools.builtins.supervisor.execution import (         # noqa: F401
    delegate_collab_subtasks_for_start_execution,
    auto_delegate_collab_followup_wave,
    _resolved_subagent_type_for_subtask,
)
from deerflow.tools.builtins.supervisor.monitor import (           # noqa: F401
    _ensure_background_task_monitor,
    _compute_monitor_recommendation,
    _monitor_main_task_until_terminal,
)
from deerflow.tools.builtins.supervisor.memory import (            # noqa: F401
    _persist_main_task_memory_snapshot,
    _broadcast_task_event,
    _record_supervisor_ui_step,
)
from deerflow.tools.builtins.supervisor.utils import (             # noqa: F401
    _runtime_thread_id,
    _dbg_enabled,
    _repr_with_invisibles,
    _clamp_progress,
)
from deerflow.tools.builtins.supervisor.display import (           # noqa: F401
    _subtask_worker_profile_suffix,
    _subtask_row_dict,
    _build_monitor_subtask_rows,
)

logger = logging.getLogger(__name__)

# ── Module-level state (shared across action handler + monitors) ─────
_MONITOR_TERMINAL_MAIN = frozenset({"completed", "failed", "cancelled"})
_bg_task_monitors: dict[str, asyncio.Task[Any]] = {}
_task_watch_state: dict[str, dict[str, Any]] = {}


# ════════════════════════════════════════════════════════════════════
#  Thin routing layer — @tool decorator + action dispatch
# ════════════════════════════════════════════════════════════════════


@tool("supervisor", parse_docstring=True)
async def supervisor_tool(
    runtime: ToolRuntime[ContextT, dict],
    action: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    task_name: str | None = None,
    task_description: str | None = None,
    subtask_name: str | None = None,
    subtask_description: str | None = None,
    task_id: str | None = None,
    subtask_id: str | None = None,
    assigned_agent: str | None = None,
    subtasks: list[dict[str, Any]] | None = None,
    subtask_ids: list[str] | None = None,
    progress: int | None = None,
    status: str | None = None,
    authorized_by: str | None = None,
    worker_profile_json: str | None = None,
    wait_for_completion: bool = False,
    monitor_poll_seconds: int = 5,
    monitor_timeout_seconds: int | None = None,
    monitor_step_seconds: int = 10,
) -> str:
    """Supervisor tool for creating and managing complex multi-agent tasks with subtasks.

    Use this tool when:
    - User requests a complex task that requires multiple steps
    - You need to coordinate multiple agents working in parallel
    - You want to track progress across multiple subtasks
    - A task requires diverse skills (research, writing, coding, etc.)

    **Workflow:**
    1. Create a main task with `action=create_task`
    2. Before adding subtasks: call `action=list_subtasks` (or `get_status`) on this `task_id` to see
       existing rows, `assigned_to`, and `worker_profile`. Only `create_subtask` when no suitable row exists.
    3. Add subtasks with `action=create_subtask` or `action=create_subtasks` (optional `worker_profile_json`).
       - Prefer create+assign in one call by passing `assigned_agent` (single) or `subtasks` (batch).
    4. Update progress with `action=update_progress`
    5. Mark completed with `action=complete_subtask`

    Args:
        action: One of create_task, create_subtask, create_subtasks, update_progress,
            complete_subtask, start_execution, monitor_execution, get_status, get_task_memory, list_subtasks, set_task_planned (see workflow above).
        task_name: Name for a new task (required for create_task).
        task_description: Description for a new task (optional for create_task).
        subtask_name: Name for a new subtask (required for create_subtask).
        subtask_description: Description for a new subtask (optional for create_subtask).
        task_id: Main task id (required for create_subtask, get_status, get_task_memory, list_subtasks, set_task_planned).
        subtask_id: ID of an existing subtask (required for complete_subtask; optional for update_progress when updating main task).
        assigned_agent: Agent ID for create_subtask (optional); must be a configured subagent name。
            When used with `action="create_subtask"`, the new subtask will be created already assigned (create+assign).
        subtasks: For create_subtasks: list of subtask objects (batch create+assign).
            Each item may include fields such as name (required), description, assigned_agent, worker_profile_json (JSON string).
        subtask_ids: For start_execution: optional; if set, only these ids are *considered*
            (must exist on the task). Each subtask actually delegated must still be assigned,
            non-terminal, and have every `worker_profile.depends_on` upstream in `completed`.
            Ready ids in the allowed set run in parallel in one call; others appear in
            `blockedSubtasks` in the JSON result. If omitted/empty after normalize, the tool
            auto-picks every assigned non-terminal subtask whose dependencies are satisfied
            (same parallel batch); still-waiting subtasks are listed in `blockedSubtasks`.
        progress: Progress 0-100 (required for update_progress).
        status: Optional status for update_progress (e.g. `failed`, `cancelled`, `completed`). When provided, it will be persisted to subtask/main task and rolled up into main task status.
        authorized_by: Recorded on authorize/start_execution (default lead for start_execution).
        worker_profile_json: Optional JSON object string for create_subtask (worker constraints, tools, etc.).
        wait_for_completion: For start_execution only. If False (default), kick off subagents in the
            background and return immediately so the lead model is not blocked; completion is persisted
            by the task tool's async polling. If True, block until each subagent run finishes (legacy).
        monitor_poll_seconds: For monitor_execution/monitor_execution_step only. Poll interval in seconds.
        monitor_timeout_seconds: For monitor_execution only. If provided, stop polling after this many seconds.
        monitor_step_seconds: For monitor_execution_step only. How long (max) to wait before returning a snapshot.
    """
    # NOTE: `assigned_agent` for create_subtask(s) refers to *subagent template name* (subagent_type),
    # not a "custom agent" config entry from agents/ directory. These are different namespaces.
    available_agents = get_available_subagent_names()
    storage = get_project_storage()

    # Normalize ids to avoid mismatches caused by model/tool serialization adding
    # accidental whitespace (e.g. "ccd29719 " or "ccd29719\n").
    def _norm_id(v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() if isinstance(v, str) else str(v).strip()

    task_id = _norm_id(task_id)
    subtask_id = _norm_id(subtask_id)
    assigned_agent = _norm_id(assigned_agent)
    if subtasks is not None and not isinstance(subtasks, list):
        subtasks = None
    if subtask_ids is not None:
        _sid_clean: list[str] = []
        for _s in subtask_ids:
            _n = _norm_id(_s) if _s is not None else None
            if _n:
                _sid_clean.append(_n)
        subtask_ids = _sid_clean or None

    if _dbg_enabled(runtime):
        try:
            storage_dir = getattr(storage, "_storage_dir", None)
        except Exception:
            storage_dir = "<error>"
        logger.warning(
            "supervisor_tool(debug): action=%s tool_call_id=%s runtime_thread_id=%s "
            "task_id=%s(%s) subtask_id=%s(%s) assigned_agent=%s(%s) storage_dir=%r available_agents=%r",
            action,
            tool_call_id,
            _runtime_thread_id(runtime),
            task_id,
            _repr_with_invisibles(task_id),
            subtask_id,
            _repr_with_invisibles(subtask_id),
            assigned_agent,
            _repr_with_invisibles(assigned_agent),
            str(storage_dir),
            list(available_agents),
        )

    # ── Action: create_task ───────────────────────────────────────────
    if action == "create_task":
        if not task_name:
            return json.dumps({
                "success": False,
                "action": "create_task",
                "error": "task_name is required for create_task action"
            }, ensure_ascii=False)

        task_id_new = find_open_main_task_id_by_name(storage, task_name)
        if task_id_new:
            return json.dumps({
                "success": False,
                "action": "create_task",
                "error": f"Task '{task_name}' already exists with ID: {task_id_new}",
                "existingTaskId": task_id_new
            }, ensure_ascii=False)

        bound_thread = _runtime_thread_id(runtime)
        project_data, task_data = new_project_bundle_root_task(
            task_name,
            task_description or "",
            thread_id=bound_thread,
        )

        if storage.save_project(project_data):
            logger.info(f"Created task '{task_name}' with ID: {task_data['id']}")
            
            # 返回结构化的 JSON 格式，方便前端解析
            result = {
                "success": True,
                "taskId": task_data['id'],
                "id": task_data['id'],  # 兼容性字段
                "task_id": task_data['id'],  # 兼容性字段
                "name": task_name,
                "description": task_description or "",
                "projectId": project_data.get('id'),
                "project_id": project_data.get('id'),  # 兼容性字段
                "parent_project_id": project_data.get('id'),  # 兼容性字段
                "projectName": project_data.get('name', ''),
                "threadId": bound_thread,
                "status": "pending",
                "progress": 0
            }
            _record_supervisor_ui_step(
                runtime, tool_call_id, "create_task", f"创建主任务：{task_name}"
            )
            return json.dumps(result, ensure_ascii=False)
        return json.dumps({
            "success": False,
            "action": "create_task",
            "error": "Failed to create task"
        }, ensure_ascii=False)

    # ── Action: create_subtasks (batch) ───────────────────────────────
    elif action == "create_subtasks":
        if not task_id:
            return json.dumps(
                {
                    "success": False,
                    "action": "create_subtasks",
                    "error": "task_id is required for create_subtasks action",
                },
                ensure_ascii=False,
            )
        if not subtasks or not isinstance(subtasks, list):
            return json.dumps(
                {
                    "success": False,
                    "action": "create_subtasks",
                    "error": "subtasks (array) is required for create_subtasks action",
                },
                ensure_ascii=False,
            )

        created: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []

        def _normalize_depends_on_in_worker_profile(
            wp: dict[str, Any] | None,
            existing_subtasks: list[dict[str, Any]],
        ) -> tuple[dict[str, Any] | None, list[str]]:
            """Normalize worker_profile.depends_on from names/ids -> ids."""
            if not isinstance(wp, dict):
                return wp, []
            raw_dep = wp.get("depends_on")
            if not isinstance(raw_dep, list) or not raw_dep:
                return wp, []

            by_id: dict[str, dict[str, Any]] = {}
            by_name: dict[str, list[str]] = {}
            for st in existing_subtasks:
                if not isinstance(st, dict):
                    continue
                sid = str(st.get("id") or "").strip()
                if not sid:
                    continue
                by_id[sid] = st
                nm = str(st.get("name") or "").strip()
                if nm:
                    by_name.setdefault(nm, []).append(sid)

            normalized: list[str] = []
            unresolved: list[str] = []
            for dep in raw_dep:
                ref = str(dep or "").strip()
                if not ref:
                    continue
                if ref in by_id:
                    normalized.append(ref)
                    continue
                cands = by_name.get(ref) or []
                if len(cands) == 1:
                    normalized.append(cands[0])
                    continue
                unresolved.append(ref)
                normalized.append(ref)

            if normalized == raw_dep:
                return wp, unresolved
            merged = dict(wp)
            merged["depends_on"] = normalized
            return merged, unresolved

        def _parse_wp_json(raw: str | None) -> dict | None:
            if raw is None:
                return None
            if not str(raw).strip():
                return None
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                raise ValueError("worker_profile_json must be valid JSON")
            if not isinstance(parsed, dict):
                raise ValueError("worker_profile_json must be a JSON object")
            wp = WorkerProfile.model_validate(parsed)
            return wp.to_storage_dict() or None

        projects = storage.list_projects()
        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if not project:
                continue
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") != task_id:
                    continue

                from datetime import datetime

                now = datetime.utcnow().isoformat() + "Z"
                for idx, spec in enumerate(subtasks):
                    if not isinstance(spec, dict):
                        errors.append({"index": idx, "error": "subtasks[i] must be an object"})
                        continue
                    nm = str(spec.get("name") or spec.get("subtask_name") or "").strip()
                    if not nm:
                        errors.append({"index": idx, "error": "subtasks[i].name is required"})
                        continue
                    desc = str(spec.get("description") or spec.get("subtask_description") or "").strip()
                    agent = str(spec.get("assigned_agent") or spec.get("assignedTo") or "").strip() or None
                    # UX: Do not fail the row on unknown assigned_agent.
                    # Create the subtask unassigned and return a warning so the lead agent
                    # can proceed without getting stuck in "Unknown agent" loops.
                    row_warnings: list[dict[str, Any]] = []
                    if agent and agent not in available_agents:
                        row_warnings.append(
                            {
                                "index": idx,
                                "name": nm,
                                "warning": f"Unknown subagent template '{agent}' (subtask created unassigned)",
                                "availableSubagents": list(available_agents),
                            }
                        )
                        agent = None
                    wp_raw = spec.get("worker_profile_json")
                    try:
                        worker_profile = _parse_wp_json(str(wp_raw) if wp_raw is not None else None)
                    except (ValidationError, ValueError) as e:
                        errors.append({"index": idx, "name": nm, "error": str(e)})
                        continue

                    # Friendly spec fields (so lead model doesn't need upstream ids beforehand):
                    # subtasks[i].depends_on / dependsOn can be names or ids.
                    # Also allow direct worker-profile knobs without forcing worker_profile_json.
                    direct_dep = spec.get("depends_on")
                    if direct_dep is None:
                        direct_dep = spec.get("dependsOn")
                    direct_instr = spec.get("instruction")
                    direct_tools = spec.get("tools")
                    direct_skills = spec.get("skills")
                    direct_model = spec.get("model")
                    has_direct_profile = any(
                        x is not None for x in [direct_dep, direct_instr, direct_tools, direct_skills, direct_model]
                    )
                    if has_direct_profile:
                        wp_obj: dict[str, Any] = dict(worker_profile or {})
                        if direct_dep is not None:
                            if isinstance(direct_dep, list):
                                wp_obj["depends_on"] = [str(x).strip() for x in direct_dep if str(x).strip()]
                            else:
                                row_warnings.append(
                                    {
                                        "index": idx,
                                        "name": nm,
                                        "warning": "subtasks[i].depends_on must be an array; ignored",
                                    }
                                )
                        if isinstance(direct_instr, str) and direct_instr.strip():
                            wp_obj["instruction"] = direct_instr.strip()
                        if isinstance(direct_tools, list):
                            wp_obj["tools"] = [str(x).strip() for x in direct_tools if str(x).strip()]
                        if isinstance(direct_skills, list):
                            wp_obj["skills"] = [str(x).strip() for x in direct_skills if str(x).strip()]
                        if isinstance(direct_model, str) and direct_model.strip():
                            wp_obj["model"] = direct_model.strip()
                        # Default base_subagent from assignment when absent.
                        if not str(wp_obj.get("base_subagent") or "").strip() and agent:
                            wp_obj["base_subagent"] = agent
                        try:
                            wp_valid = WorkerProfile.model_validate(wp_obj)
                            worker_profile = wp_valid.to_storage_dict() or None
                        except ValidationError as e:
                            errors.append({"index": idx, "name": nm, "error": f"direct worker profile: {e}"})
                            continue

                    subtask_data: dict[str, Any] = {
                        "id": make_subtask_id(),
                        "name": nm,
                        "description": desc,
                        "status": "pending",
                        "dependencies": [],
                        "assigned_to": agent,
                        "result": None,
                        "error": None,
                        "created_at": now,
                        "started_at": None,
                        "completed_at": None,
                        "progress": 0,
                    }
                    if worker_profile is not None:
                        worker_profile, unresolved_dep = _normalize_depends_on_in_worker_profile(
                            worker_profile,
                            [x for x in (task.get("subtasks") or []) if isinstance(x, dict)],
                        )
                        subtask_data["worker_profile"] = worker_profile
                        if unresolved_dep:
                            row_warnings.append(
                                {
                                    "index": idx,
                                    "name": nm,
                                    "warning": "depends_on contains unresolved references (kept as-is)",
                                    "unresolvedDependsOn": unresolved_dep,
                                }
                            )
                        # 若未显式 assigned_agent，且 profile 提供 base_subagent，则默认按 profile 分配
                        if not subtask_data.get("assigned_to"):
                            bs = str(worker_profile.get("base_subagent") or "").strip()
                            if bs:
                                subtask_data["assigned_to"] = bs

                    task.setdefault("subtasks", []).append(subtask_data)
                    created.append(
                        {
                            "subtaskId": subtask_data["id"],
                            "id": subtask_data["id"],
                            "subtask_id": subtask_data["id"],
                            "name": nm,
                            "description": desc,
                            "parentTaskId": task_id,
                            "task_id": task_id,
                            "status": "pending",
                            "progress": 0,
                            **(
                                {"assignedTo": subtask_data["assigned_to"]}
                                if subtask_data.get("assigned_to")
                                else {}
                            ),
                            **({"warnings": row_warnings} if row_warnings else {}),
                        }
                    )

                project["tasks"][i] = task
                storage.save_project(project)
                _record_supervisor_ui_step(
                    runtime,
                    tool_call_id,
                    "create_subtasks",
                    f"批量创建子任务：{len(created)} 个",
                )
                return json.dumps(
                    {
                        "success": len(created) > 0,
                        "action": "create_subtasks",
                        "taskId": task_id,
                        "created": created,
                        "errors": errors,
                    },
                    ensure_ascii=False,
                )

        return json.dumps(
            {"success": False, "action": "create_subtasks", "error": f"Task '{task_id}' not found"},
            ensure_ascii=False,
        )

    # ── Action: create_subtask (single) ──────────────────────────────
    elif action == "create_subtask":
        if not task_id or not subtask_name:
            return json.dumps({
                "success": False,
                "action": "create_subtask",
                "error": "task_id and subtask_name are required for create_subtask action"
            }, ensure_ascii=False)
        warnings: list[dict[str, Any]] = []
        if assigned_agent and assigned_agent not in available_agents:
            warnings.append(
                {
                    "warning": f"Unknown subagent template '{assigned_agent}' (subtask created unassigned)",
                    "availableSubagents": list(available_agents),
                }
            )
            assigned_agent = None

        worker_profile: dict | None = None
        if worker_profile_json and str(worker_profile_json).strip():
            try:
                parsed = json.loads(worker_profile_json)
            except json.JSONDecodeError:
                return json.dumps({
                    "success": False,
                    "action": "create_subtask",
                    "error": "worker_profile_json must be valid JSON"
                }, ensure_ascii=False)
            if not isinstance(parsed, dict):
                return json.dumps({
                    "success": False,
                    "action": "create_subtask",
                    "error": "worker_profile_json must be a JSON object"
                }, ensure_ascii=False)
            try:
                wp = WorkerProfile.model_validate(parsed)
            except ValidationError as e:
                return json.dumps({
                    "success": False,
                    "action": "create_subtask",
                    "error": f"worker_profile_json: {e}"
                }, ensure_ascii=False)
            worker_profile = wp.to_storage_dict() or None

        def _normalize_depends_on_in_worker_profile_single(
            wp: dict[str, Any] | None,
            existing_subtasks: list[dict[str, Any]],
        ) -> tuple[dict[str, Any] | None, list[str]]:
            if not isinstance(wp, dict):
                return wp, []
            raw_dep = wp.get("depends_on")
            if not isinstance(raw_dep, list) or not raw_dep:
                return wp, []
            by_id: dict[str, dict[str, Any]] = {}
            by_name: dict[str, list[str]] = {}
            for st in existing_subtasks:
                if not isinstance(st, dict):
                    continue
                sid = str(st.get("id") or "").strip()
                if not sid:
                    continue
                by_id[sid] = st
                nm = str(st.get("name") or "").strip()
                if nm:
                    by_name.setdefault(nm, []).append(sid)
            normalized: list[str] = []
            unresolved: list[str] = []
            for dep in raw_dep:
                ref = str(dep or "").strip()
                if not ref:
                    continue
                if ref in by_id:
                    normalized.append(ref)
                    continue
                cands = by_name.get(ref) or []
                if len(cands) == 1:
                    normalized.append(cands[0])
                    continue
                unresolved.append(ref)
                normalized.append(ref)
            if normalized == raw_dep:
                return wp, unresolved
            merged = dict(wp)
            merged["depends_on"] = normalized
            return merged, unresolved

        projects = storage.list_projects()
        task_found = False

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        from datetime import datetime

                        now = datetime.utcnow().isoformat() + "Z"
                        subtask_data = {
                            "id": make_subtask_id(),
                            "name": subtask_name,
                            "description": subtask_description or "",
                            "status": "pending",
                            "dependencies": [],
                            "assigned_to": assigned_agent or None,
                            "result": None,
                            "error": None,
                            "created_at": now,
                            "started_at": None,
                            "completed_at": None,
                            "progress": 0,
                        }
                        if worker_profile is not None:
                            worker_profile, unresolved_dep = _normalize_depends_on_in_worker_profile_single(
                                worker_profile,
                                [x for x in (task.get("subtasks") or []) if isinstance(x, dict)],
                            )
                            subtask_data["worker_profile"] = worker_profile
                            if unresolved_dep:
                                warnings.append(
                                    {
                                        "warning": "depends_on contains unresolved references (kept as-is)",
                                        "unresolvedDependsOn": unresolved_dep,
                                    }
                                )
                            bs = str(worker_profile.get("base_subagent") or "").strip()
                            if bs:
                                # 若未显式指定 assigned_agent，则默认用 profile.base_subagent
                                if not subtask_data.get("assigned_to"):
                                    subtask_data["assigned_to"] = bs

                        task.setdefault("subtasks", []).append(subtask_data)
                        project["tasks"][i] = task
                        storage.save_project(project)
                        task_found = True
                        logger.info(f"Created subtask '{subtask_name}' in task {task_id}")
                        
                        # 返回结构化的 JSON 格式
                        result = {
                            "success": True,
                            "action": "create_subtask",
                            "subtaskId": subtask_data['id'],
                            "id": subtask_data['id'],
                            "subtask_id": subtask_data['id'],
                            "name": subtask_name,
                            "description": subtask_description or "",
                            "parentTaskId": task_id,
                            "task_id": task_id,
                            "status": "pending",
                            "progress": 0,
                            **(
                                {"assignedTo": subtask_data["assigned_to"]}
                                if subtask_data.get("assigned_to")
                                else {}
                            ),
                        }
                        if warnings:
                            result["warnings"] = warnings
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "create_subtask",
                            f"创建子任务：{subtask_name}" + (f" → {subtask_data.get('assigned_to')}" if subtask_data.get("assigned_to") else ""),
                        )
                        return json.dumps(result, ensure_ascii=False)

        if not task_found:
            return json.dumps({
                "success": False,
                "action": "create_subtask",
                "error": f"Task '{task_id}' not found"
            }, ensure_ascii=False)

    # ── Action: update_progress ─────────────────────────────────────
    elif action == "update_progress":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "update_progress",
                "error": "task_id is required for update_progress action"
            }, ensure_ascii=False)
        if progress is None:
            return json.dumps({
                "success": False,
                "action": "update_progress",
                "error": "progress is required for update_progress action (0-100)"
            }, ensure_ascii=False)

        progress_value = _clamp_progress(progress)
        status_norm: str | None = None
        now: str | None = None
        if status is not None:
            status_norm = str(status).strip().lower()
            if status_norm in {"done"}:
                status_norm = "completed"
            if status_norm in {"error"}:
                status_norm = "failed"
            if status_norm in {"canceled"}:
                status_norm = "cancelled"
            if status_norm in {"executing", "running", "in_progress"}:
                status_norm = "in_progress"
            if status_norm in {"pending", "planning", "planned"}:
                status_norm = "in_progress"
            if status_norm in {"completed", "failed", "cancelled"}:
                from datetime import datetime as _dt
                now = _dt.utcnow().isoformat() + "Z"

        effective_progress = 100 if status_norm == "completed" else progress_value

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        if subtask_id:
                            for j, subtask in enumerate(task.get("subtasks", [])):
                                if subtask.get("id") == subtask_id:
                                    if status_norm == "completed":
                                        subtask["status"] = "completed"
                                        subtask["progress"] = effective_progress
                                        if "completed_at" in subtask:
                                            subtask["completed_at"] = subtask.get("completed_at") or now
                                    elif status_norm == "failed":
                                        subtask["status"] = "failed"
                                        subtask["progress"] = effective_progress
                                        subtask["failed_at"] = subtask.get("failed_at") or now
                                    elif status_norm == "cancelled":
                                        subtask["status"] = "cancelled"
                                        subtask["progress"] = effective_progress
                                    elif status_norm:
                                        subtask["status"] = status_norm
                                        subtask["progress"] = effective_progress
                                    else:
                                        subtask["progress"] = progress_value
                                    task["subtasks"][j] = subtask
                                    project["tasks"][i] = task
                                    storage.save_project(project)
                                    # Root status convergence depends on all subtasks' terminal states.
                                    rollup_root_task_progress_from_subtasks(storage, task_id)
                                    await _broadcast_task_event(
                                        project.get("id"),
                                        "task:progress",
                                        {
                                            "task_id": subtask_id,
                                            "progress": effective_progress,
                                            "current_step": "",
                                        },
                                    )
                                    
                                    # 返回结构化的 JSON 格式
                                    result = {
                                        "success": True,
                                        "action": "update_progress",
                                        "subtaskId": subtask_id,
                                        "taskId": task_id,
                                        "progress": effective_progress,
                                        "message": f"Updated progress of subtask {subtask_id} to {progress_value}%"
                                    }
                                    return json.dumps(result, ensure_ascii=False)
                            return json.dumps({
                                "success": False,
                                "action": "update_progress",
                                "error": f"Subtask '{subtask_id}' not found"
                            }, ensure_ascii=False)
                        task["progress"] = progress_value
                        if status_norm:
                            if status_norm == "completed":
                                task["status"] = "completed"
                                task["progress"] = effective_progress
                                if "completed_at" in task:
                                    task["completed_at"] = task.get("completed_at") or now
                            elif status_norm == "failed":
                                task["status"] = "failed"
                                if "failed_at" in task:
                                    task["failed_at"] = task.get("failed_at") or now
                            elif status_norm == "cancelled":
                                task["status"] = "cancelled"
                            else:
                                task["status"] = status_norm
                        project["tasks"][i] = task
                        storage.save_project(project)
                        _persist_main_task_memory_snapshot(project, task)
                        rollup_root_task_progress_from_subtasks(storage, task_id)
                        await _broadcast_task_event(
                            project.get("id"),
                            "task:progress",
                            {
                                "task_id": task_id,
                                "progress": effective_progress,
                                "current_step": "",
                            },
                        )
                        
                        # 返回结构化的 JSON 格式
                        result = {
                            "success": True,
                            "action": "update_progress",
                            "taskId": task_id,
                            "progress": effective_progress,
                            "message": f"Updated progress of main task {task_id} to {effective_progress}%"
                        }
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "update_progress",
                            f"主任务进度 {effective_progress}%",
                        )
                        return json.dumps(result, ensure_ascii=False)

        return json.dumps({
            "success": False,
            "action": "update_progress",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    # ── Action: complete_subtask ─────────────────────────────────────
    elif action == "complete_subtask":
        if not task_id or not subtask_id:
            return json.dumps({
                "success": False,
                "action": "complete_subtask",
                "error": "task_id and subtask_id are required for complete_subtask action"
            }, ensure_ascii=False)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        for j, subtask in enumerate(task.get("subtasks", [])):
                            if subtask.get("id") == subtask_id:
                                from datetime import datetime

                                now = datetime.utcnow().isoformat() + "Z"
                                subtask["status"] = "completed"
                                subtask["progress"] = 100
                                subtask["completed_at"] = now
                                task["subtasks"][j] = subtask
                                # If all subtasks are completed, mark the parent task completed too.
                                if task.get("subtasks") and all(
                                    (s.get("status") == "completed") for s in task.get("subtasks", [])
                                ):
                                    task["status"] = "completed"
                                    task["progress"] = 100
                                    if not task.get("completed_at"):
                                        task["completed_at"] = now
                                project["tasks"][i] = task
                                storage.save_project(project)
                                await _broadcast_task_event(
                                    project.get("id"),
                                    "task:completed",
                                    {"task_id": subtask_id, "result": subtask.get("result")},
                                )
                                facts_count = _persist_main_task_memory_snapshot(project, task)
                                await _broadcast_task_event(
                                    project.get("id"),
                                    "task_memory:updated",
                                    {"task_id": task_id, "facts_count": facts_count},
                                )
                                if task.get("status") == "completed":
                                    await _broadcast_task_event(
                                        project.get("id"),
                                        "task:completed",
                                        {"task_id": task_id, "result": task.get("result")},
                                    )
                                logger.info(f"Completed subtask {subtask_id}")
                                
                                # 返回结构化的 JSON 格式
                                result = {
                                    "success": True,
                                    "action": "complete_subtask",
                                    "subtaskId": subtask_id,
                                    "taskId": task_id,
                                    "status": "completed",
                                    "message": f"Subtask {subtask_id} marked as completed"
                                }
                                return json.dumps(result, ensure_ascii=False)
                        return json.dumps({
                            "success": False,
                            "action": "complete_subtask",
                            "error": f"Subtask '{subtask_id}' not found in task '{task_id}'"
                        }, ensure_ascii=False)
        return json.dumps({
            "success": False,
            "action": "complete_subtask",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    # ── Action: start_execution ──────────────────────────────────────
    elif action == "start_execution":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "start_execution",
                "error": "task_id is required for start_execution action"
            }, ensure_ascii=False)
        actor = authorized_by or "lead"

        if subtask_ids:
            row = find_main_task(storage, task_id)
            if not row:
                return json.dumps({
                    "success": False,
                    "action": "start_execution",
                    "taskId": task_id,
                    "error": f"Task '{task_id}' not found",
                }, ensure_ascii=False)
            _project, _task = row
            _existing = {st.get("id") for st in (_task.get("subtasks") or [])}
            _missing = [x for x in subtask_ids if x not in _existing]
            if _missing:
                return json.dumps({
                    "success": False,
                    "action": "start_execution",
                    "taskId": task_id,
                    "error": f"Subtask id(s) not under this task: {_missing}",
                }, ensure_ascii=False)

        ok, msg = authorize_main_task_execution(storage, task_id, actor)
        if not ok:
            return json.dumps({
                "success": False,
                "action": "start_execution",
                "taskId": task_id,
                "error": msg
            }, ensure_ascii=False)

        to_run, blocked_subtasks = _resolve_subtasks_for_start_execution(
            storage, task_id, subtask_ids
        )
        if to_run:
            from datetime import datetime as _dt

            _now = _dt.utcnow().isoformat() + "Z"
            row_mark = find_main_task(storage, task_id)
            if row_mark:
                proj_mark, t_mark = row_mark
                to_set = set(to_run)
                for st in t_mark.get("subtasks") or []:
                    if st.get("id") in to_set:
                        st["started_at"] = st.get("started_at") or _now
                storage.save_project(proj_mark)

        # 与 HTTP authorize-execution 对齐：必须把该聊天线程的 collab_phase 推进到 executing，
        # 否则 CollabPhaseMiddleware 仍提示「等待执行」。随后对本批子任务并行调用 task 工具，子智能体开始实际执行。
        phase_ok = False
        try:
            phase_ok = advance_collab_phase_to_executing_for_task(
                get_paths(), task_id, runtime_thread_id=_runtime_thread_id(runtime)
            )
        except Exception:
            logger.exception("start_execution: advance_collab_phase_to_executing_for_task failed for task_id=%s", task_id)

        delegated: list[dict[str, Any]] = []
        if to_run:
            try:
                delegated = await delegate_collab_subtasks_for_start_execution(
                    runtime,
                    storage,
                    task_id,
                    to_run,
                    wait_for_completion=wait_for_completion,
                )
            except Exception as exc:
                logger.exception("start_execution: delegate_collab_subtasks_for_start_execution failed task_id=%s", task_id)
                _err_msg = f"delegation failed: {type(exc).__name__}: {exc}"
                delegated = [
                    {"subtaskId": sid, "ok": False, "error": _err_msg}
                    for sid in to_run
                ]

        all_ok = all(d.get("ok") for d in delegated) if delegated else True

        # Server-side convergence: persist delegated subtask/main-task status immediately,
        # so UI does not depend on model remembering extra supervisor calls.
        row_done = find_main_task(storage, task_id)
        if row_done and delegated:
            from datetime import datetime as _dt

            proj_done, task_done = row_done
            now_done = _dt.utcnow().isoformat() + "Z"
            delegated_map: dict[str, dict[str, Any]] = {
                str(d.get("subtaskId")): d for d in delegated if d.get("subtaskId")
            }
            for st in task_done.get("subtasks") or []:
                sid = str(st.get("id") or "")
                rec = delegated_map.get(sid)
                if not rec:
                    continue
                if rec.get("detached"):
                    continue
                st["updated_at"] = now_done
                if rec.get("ok"):
                    st["status"] = "completed"
                    st["progress"] = 100
                    st["completed_at"] = st.get("completed_at") or now_done
                else:
                    if (st.get("status") or "").strip().lower() != "completed":
                        st["status"] = "failed"
                    st["failed_at"] = st.get("failed_at") or now_done
            subtasks_all = task_done.get("subtasks") or []
            total = len(subtasks_all)
            completed_cnt = sum(1 for s in subtasks_all if (s.get("status") or "").strip().lower() == "completed")
            failed_cnt = sum(1 for s in subtasks_all if (s.get("status") or "").strip().lower() == "failed")
            terminal_cnt = sum(
                1
                for s in subtasks_all
                if (s.get("status") or "").strip().lower() in {"completed", "failed", "cancelled"}
            )
            if total > 0 and completed_cnt == total:
                task_done["status"] = "completed"
                task_done["progress"] = 100
                task_done["completed_at"] = task_done.get("completed_at") or now_done
            elif total > 0 and terminal_cnt == total and failed_cnt > 0:
                # All subtasks terminated and at least one failed -> mark main task failed.
                task_done["status"] = "failed"
                task_done["failed_at"] = task_done.get("failed_at") or now_done
                task_done["progress"] = int((completed_cnt / total) * 100)
            elif total > 0:
                task_done["status"] = "in_progress"
                task_done["progress"] = int((completed_cnt / total) * 100)
            task_done["updated_at"] = now_done
            if storage.save_project(proj_done):
                facts_count = _persist_main_task_memory_snapshot(proj_done, task_done)
                await _broadcast_task_event(
                    proj_done.get("id"),
                    "task_memory:updated",
                    {"task_id": task_id, "facts_count": facts_count},
                )
                await _broadcast_task_event(
                    proj_done.get("id"),
                    "task:progress",
                    {
                        "task_id": task_id,
                        "progress": int(task_done.get("progress") or 0),
                        "current_step": "",
                    },
                )
                if (task_done.get("status") or "").strip().lower() == "completed":
                    await _broadcast_task_event(
                        proj_done.get("id"),
                        "task:completed",
                        {"task_id": task_id, "result": task_done.get("result")},
                    )

        # 返回结构化的 JSON 格式
        _msg = f"Execution authorized for task {task_id}. ({msg})"
        auto_follow = False
        follow_payload: dict[str, Any] | None = None
        if not wait_for_completion and to_run:
            _msg += " Subagents are running in the background; the lead thread is not blocked."
            if any(bool(d.get("detached")) for d in delegated):
                auto_follow = True
                try:
                    _ensure_background_task_monitor(
                        storage,
                        task_id,
                        _runtime_thread_id(runtime),
                        poll_seconds=max(1.0, float(monitor_poll_seconds or 2)),
                    )
                except Exception:
                    logger.debug("start_execution: ensure background monitor failed", exc_info=True)
                # Backend-controlled follow loop: keep the main tool turn alive and poll repeatedly
                # so the lead agent can continue reasoning with fresh snapshots.
                try:
                    follow_payload = await _monitor_main_task_until_terminal(
                        storage,
                        task_id,
                        poll_seconds=max(1.0, float(monitor_poll_seconds or 2)),
                        timeout_seconds=monitor_timeout_seconds,
                        timeline_step_seconds=max(2, int(monitor_step_seconds or 5)),
                        # Keep the lead model responsive: return incremental snapshot quickly.
                        slice_seconds=2,
                    )
                except Exception:
                    logger.debug("start_execution: auto-follow monitor failed", exc_info=True)
                    follow_payload = {
                        "success": False,
                        "error": "auto-follow monitor failed",
                    }
        if blocked_subtasks:
            _msg += f" {len(blocked_subtasks)} subtask(s) skipped (not ready — see blockedSubtasks)."
        result = {
            "success": True,
            "action": "start_execution",
            "taskId": task_id,
            "authorizedBy": actor,
            "message": _msg,
            "collabPhaseAdvanced": phase_ok,
            "waitForCompletion": wait_for_completion,
            "subtaskIds": to_run,
            "blockedSubtasks": blocked_subtasks,
            "delegatedSubtasks": delegated,
            "delegationAllSucceeded": all_ok,
            "autoFollowed": auto_follow,
            "mustContinueMonitoring": bool(auto_follow),
            "nextMonitorInSeconds": 2 if auto_follow else 0,
        }
        if follow_payload is not None:
            result["follow"] = follow_payload
        return json.dumps(result, ensure_ascii=False)

    # ── Action: set_task_planned ─────────────────────────────────────
    elif action == "set_task_planned":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "set_task_planned",
                "error": "task_id is required for set_task_planned action"
            }, ensure_ascii=False)
        
        # 查找并更新任务状态（须遍历全部 project：任务可能在非列表首项的工程中）
        projects = storage.list_projects()
        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if not project:
                continue
            for i, task in enumerate(project.get("tasks", [])):
                if task.get("id") == task_id:
                    from datetime import datetime

                    now = datetime.utcnow().isoformat() + "Z"
                    task["status"] = "planned"
                    task["updated_at"] = now
                    project["tasks"][i] = task
                    
                    if storage.save_project(project):
                        result = {
                            "success": True,
                            "action": "set_task_planned",
                            "taskId": task_id,
                            "status": "planned",
                            "message": f"Task {task_id} status set to planned"
                        }
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "set_task_planned",
                            f"任务已规划：{task_id}",
                        )
                        return json.dumps(result, ensure_ascii=False)
                    else:
                        return json.dumps({
                            "success": False,
                            "action": "set_task_planned",
                            "taskId": task_id,
                            "error": "Failed to save project"
                        }, ensure_ascii=False)

        return json.dumps({
            "success": False,
            "action": "set_task_planned",
            "taskId": task_id,
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    # ── Action: get_status ───────────────────────────────────────────
    elif action == "get_status":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "get_status",
                "error": "task_id is required for get_status action"
            }, ensure_ascii=False)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    if task.get("id") == task_id:
                        subtasks = task.get("subtasks", [])
                        auth = task.get("execution_authorized", False)
                        tid = task.get("thread_id")
                        result = {
                            "success": True,
                            "action": "get_status",
                            "taskId": task_id,
                            "name": task.get("name"),
                            "status": task.get("status", "unknown"),
                            "progress": task.get("progress", 0),
                            "executionAuthorized": bool(auth),
                            "threadId": tid,
                            "subtaskCount": len(subtasks),
                            "subtasks": [_subtask_row_dict(st) for st in subtasks],
                        }
                        return json.dumps(result, ensure_ascii=False, default=str)

        return json.dumps({
            "success": False,
            "action": "get_status",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    # ── Action: get_task_memory ──────────────────────────────────────
    elif action == "get_task_memory":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "get_task_memory",
                "error": "task_id is required for get_task_memory action"
            }, ensure_ascii=False)
        mem_store = get_task_memory_storage()
        row = load_task_memory_for_task_id(storage, mem_store, task_id)
        if row is None:
            return json.dumps({
                "success": False,
                "action": "get_task_memory",
                "error": f"Task '{task_id}' not found"
            }, ensure_ascii=False)
        mem, project_id, agent_id, parent_task_id = row
        facts = mem.get("facts") or []
        if not isinstance(facts, list):
            facts = []
        result = {
            "success": True,
            "action": "get_task_memory",
            "taskId": task_id,
            "projectId": project_id,
            "memoryKeyAgentId": agent_id,
            "parentTaskId": parent_task_id,
            "isSubtaskMemory": parent_task_id is not None,
            "memory": {
                "status": mem.get("status", ""),
                "progress": mem.get("progress", 0),
                "current_step": mem.get("current_step", ""),
                "output_summary": mem.get("output_summary", ""),
                "facts": facts,
                "factsCount": len(facts),
            },
        }
        return json.dumps(result, ensure_ascii=False, default=str)

    # ── Action: monitor_execution (blocking until terminal) ──────────
    elif action == "monitor_execution":
        """Block until a collaborative task reaches a terminal state and return status+memory snapshot."""
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "monitor_execution",
                "error": "task_id is required for monitor_execution action",
            }, ensure_ascii=False)

        # Safety: avoid too-fast polling storms
        try:
            poll_seconds = max(1, int(monitor_poll_seconds))
        except Exception:
            poll_seconds = 5
        timeout_seconds = monitor_timeout_seconds
        start_ts = asyncio.get_event_loop().time()

        terminal_main = {"completed", "failed", "cancelled"}

        while True:
            try:
                _auto_finalize_unrunnable_pending_subtasks(storage, task_id)
            except Exception:
                logger.debug("monitor_execution: auto finalize pending failed task_id=%s", task_id, exc_info=True)
            row = find_main_task(storage, task_id)
            if not row:
                return json.dumps({
                    "success": False,
                    "action": "monitor_execution",
                    "taskId": task_id,
                    "error": f"Task '{task_id}' not found",
                }, ensure_ascii=False)

            _proj, task = row
            t_status = str(task.get("status") or "pending").strip().lower()
            t_progress = task.get("progress", 0) or 0
            subtasks = task.get("subtasks") or []

            sub_rows, failed_subtasks = _build_monitor_subtask_rows(storage, subtasks)

            main_terminal = t_status in terminal_main
            all_sub_terminal = True
            for st in subtasks:
                s_status = str(st.get("status") or "pending").strip().lower()
                if s_status not in _TERMINAL_SUBTASK:
                    all_sub_terminal = False
                    break

            if main_terminal or (subtasks and all_sub_terminal):
                # Attach task memory snapshot (best-effort).
                mem_store = get_task_memory_storage()
                mem_row = load_task_memory_for_task_id(storage, mem_store, task_id)
                memory_payload: dict[str, Any] | None = None
                if mem_row is not None:
                    mem, project_id, agent_id, parent_task_id = mem_row
                    facts = mem.get("facts") or []
                    if not isinstance(facts, list):
                        facts = []
                    memory_payload = {
                        "status": mem.get("status", ""),
                        "progress": mem.get("progress", 0),
                        "current_step": mem.get("current_step", ""),
                        "output_summary": mem.get("output_summary", ""),
                        "factsCount": len(facts),
                        # Keep first few facts to limit response size.
                        "facts": facts[:10],
                    }

                return json.dumps({
                    "success": True,
                    "action": "monitor_execution",
                    "taskId": task_id,
                    "status": t_status,
                    "progress": t_progress,
                    "subtasks": sub_rows,
                    "failedSubtasks": failed_subtasks,
                    "memory": memory_payload,
                }, ensure_ascii=False, default=str)

            # Timeout guard
            if timeout_seconds is not None:
                elapsed = asyncio.get_event_loop().time() - start_ts
                if elapsed > float(timeout_seconds):
                    return json.dumps({
                        "success": False,
                        "action": "monitor_execution",
                        "taskId": task_id,
                        "status": t_status,
                        "progress": t_progress,
                        "error": f"monitor_execution timeout after {timeout_seconds}s",
                        "subtasks": sub_rows,
                    }, ensure_ascii=False, default=str)

            await asyncio.sleep(poll_seconds)

    # ── Action: monitor_execution_step (incremental snapshot) ────────
    elif action == "monitor_execution_step":
        """Poll for at most `monitor_step_seconds` and return an incremental snapshot.

        This is used when the lead agent should report progress every N seconds
        without requiring a full terminal wait.
        """
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "monitor_execution_step",
                "error": "task_id is required for monitor_execution_step action",
            }, ensure_ascii=False)

        try:
            poll_seconds = max(1, int(monitor_poll_seconds))
        except Exception:
            poll_seconds = 5

        try:
            step_seconds = max(1, int(monitor_step_seconds))
        except Exception:
            step_seconds = 10

        start_ts = asyncio.get_event_loop().time()
        terminal_main = {"completed", "failed", "cancelled"}
        # Prefer returning on meaningful state change to avoid repetitive monitor spam.
        baseline_sig = ""
        try:
            prev = _task_watch_state.get(task_id) or {}
            baseline_sig = str(prev.get("last_monitor_return_sig") or "")
        except Exception:
            baseline_sig = ""

        while True:
            try:
                _auto_finalize_unrunnable_pending_subtasks(storage, task_id)
            except Exception:
                logger.debug("monitor_execution_step: auto finalize pending failed task_id=%s", task_id, exc_info=True)
            row = find_main_task(storage, task_id)
            if not row:
                return json.dumps({
                    "success": False,
                    "action": "monitor_execution_step",
                    "taskId": task_id,
                    "error": f"Task '{task_id}' not found",
                }, ensure_ascii=False)

            _proj, task = row
            t_status = str(task.get("status") or "pending").strip().lower()
            t_progress = task.get("progress", 0) or 0
            subtasks = task.get("subtasks") or []

            sub_rows, failed_subtasks = _build_monitor_subtask_rows(storage, subtasks)

            # Determine whether we can treat this snapshot as terminal.
            main_terminal = t_status in terminal_main
            all_sub_terminal = True
            for st in subtasks:
                s_status = str(st.get("status") or "pending").strip().lower()
                if s_status not in _TERMINAL_SUBTASK:
                    all_sub_terminal = False
                    break
            sub_terminal = bool(subtasks) and all_sub_terminal

            # Attach task memory snapshot (best-effort, keep small)
            memory_payload: dict[str, Any] | None = None
            try:
                mem_store = get_task_memory_storage()
                mem_row = load_task_memory_for_task_id(storage, mem_store, task_id)
                if mem_row is not None:
                    mem, project_id, agent_id, parent_task_id = mem_row
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
                # Monitoring should never fail because memory is unavailable.
                logger.debug("monitor_execution_step: memory snapshot failed", exc_info=True)

            elapsed = asyncio.get_event_loop().time() - start_ts
            cur_sig = json.dumps(
                {
                    "status": t_status,
                    "progress": int(t_progress or 0),
                    "sub": [(str(x.get("subtaskId") or ""), str(x.get("status") or ""), int(x.get("progress") or 0)) for x in sub_rows],
                    "step": str((memory_payload or {}).get("current_step") or ""),
                },
                ensure_ascii=False,
                default=str,
            )

            # Terminal: return immediately with terminal=true
            if main_terminal or sub_terminal:
                rec = _compute_monitor_recommendation(
                    task_id=task_id,
                    status=t_status,
                    progress=int(t_progress or 0),
                    sub_rows=sub_rows,
                    memory_payload=memory_payload,
                )
                return json.dumps({
                    "success": True,
                    "action": "monitor_execution_step",
                    "taskId": task_id,
                    "terminal": True,
                    "status": t_status,
                    "progress": t_progress,
                    "subtasks": sub_rows,
                    "failedSubtasks": failed_subtasks,
                    "memory": memory_payload,
                    "recommendation": rec,
                    "noChange": False,
                }, ensure_ascii=False, default=str)

            # Return early when state changed (preferred path).
            if cur_sig and cur_sig != baseline_sig:
                rec = _compute_monitor_recommendation(
                    task_id=task_id,
                    status=t_status,
                    progress=int(t_progress or 0),
                    sub_rows=sub_rows,
                    memory_payload=memory_payload,
                )
                try:
                    ws = _task_watch_state.get(task_id) or {}
                    ws["last_monitor_return_sig"] = cur_sig
                    _task_watch_state[task_id] = ws
                except Exception:
                    pass
                return json.dumps({
                    "success": True,
                    "action": "monitor_execution_step",
                    "taskId": task_id,
                    "terminal": False,
                    "status": t_status,
                    "progress": t_progress,
                    "subtasks": sub_rows,
                    "failedSubtasks": failed_subtasks,
                    "memory": memory_payload,
                    "recommendation": rec,
                    "noChange": False,
                    "elapsedSeconds": int(elapsed),
                }, ensure_ascii=False, default=str)

            # Non-terminal + unchanged: still return immediately with a full snapshot.
            # 目标：每次 monitor_execution_step 都有结构化结果，避免前端显示"无结果"。
            rec = _compute_monitor_recommendation(
                task_id=task_id,
                status=t_status,
                progress=int(t_progress or 0),
                sub_rows=sub_rows,
                memory_payload=memory_payload,
            )
            return json.dumps({
                "success": True,
                "action": "monitor_execution_step",
                "taskId": task_id,
                "terminal": False,
                "status": t_status,
                "progress": t_progress,
                "subtasks": sub_rows,
                "failedSubtasks": failed_subtasks,
                "memory": memory_payload,
                "recommendation": rec,
                "noChange": True,
                "elapsedSeconds": int(elapsed),
            }, ensure_ascii=False, default=str)

    # ── Action: list_subtasks ────────────────────────────────────────
    elif action == "list_subtasks":
        if not task_id:
            return json.dumps({
                "success": False,
                "action": "list_subtasks",
                "error": "task_id is required for list_subtasks action"
            }, ensure_ascii=False)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    if task.get("id") == task_id:
                        subtasks = task.get("subtasks", [])
                        payload = {
                            "success": True,
                            "action": "list_subtasks",
                            "taskId": task_id,
                            "subtasks": [_subtask_row_dict(st) for st in subtasks],
                        }
                        if not subtasks:
                            payload["message"] = f"No subtasks found for task '{task_id}'"
                        return json.dumps(payload, ensure_ascii=False, default=str)

        return json.dumps({
            "success": False,
            "action": "list_subtasks",
            "error": f"Task '{task_id}' not found"
        }, ensure_ascii=False)

    # ── Fallback: unknown action ────────────────────────────────────
    return json.dumps({
        "success": False,
        "action": action,
        "error": f"Unknown action '{action}'",
        "availableActions": [
            "create_task",
            "create_subtask",
            "create_subtasks",
            "update_progress",
            "complete_subtask",
            "start_execution",
            "monitor_execution",
            "monitor_execution_step",
            "set_task_planned",
            "get_status",
            "get_task_memory",
            "list_subtasks",
        ],
    }, ensure_ascii=False)
