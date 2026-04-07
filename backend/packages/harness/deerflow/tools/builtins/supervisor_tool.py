"""Supervisor tool for multi-agent task planning and coordination."""

import asyncio
import json
import logging
import os
import uuid
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import ValidationError

from deerflow.collab.models import WorkerProfile
from deerflow.collab.authorize_execution import authorize_main_task_execution
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
from deerflow.collab.thread_collab import advance_collab_phase_to_executing_for_task
from deerflow.config.agents_config import load_agent_config, list_all_agents
from deerflow.config.paths import get_paths
from deerflow.subagents import get_available_subagent_names

logger = logging.getLogger(__name__)

_TERMINAL_SUBTASK = frozenset({"completed", "failed", "cancelled"})


def _subtask_ids_to_run_after_start(
    storage: Any, main_task_id: str, explicit: list[str] | None
) -> list[str]:
    """Resolve which subtasks to delegate: explicit list, else all assigned non-terminal subtasks."""
    if explicit:
        return list(explicit)
    row = find_main_task(storage, main_task_id)
    if not row:
        return []
    _proj, task = row
    out: list[str] = []
    for st in task.get("subtasks") or []:
        sid = st.get("id")
        if not sid:
            continue
        status = (st.get("status") or "pending").strip().lower()
        if status in _TERMINAL_SUBTASK:
            continue
        if not (str(st.get("assigned_to") or "")).strip():
            continue
        out.append(str(sid))
    return out


async def delegate_collab_subtasks_for_start_execution(
    runtime: ToolRuntime[ContextT, dict] | None,
    storage: Any,
    main_task_id: str,
    subtask_ids: list[str],
) -> list[dict[str, Any]]:
    """Invoke ``task`` for each subtask (parallel). Used by ``start_execution`` so workers actually run."""
    if not subtask_ids:
        return []
    if runtime is None:
        logger.warning("start_execution: skip subagent delegation (no tool runtime)")
        return [
            {
                "subtaskId": sid,
                "ok": False,
                "error": "No runtime: cannot delegate to task tool",
            }
            for sid in subtask_ids
        ]

    from deerflow.tools.builtins.task_tool import task_tool as tt
    coro = getattr(tt, "coroutine", None)
    if coro is None:
        logger.error("task_tool has no coroutine; cannot delegate from start_execution")
        return [{"subtaskId": sid, "ok": False, "error": "task_tool unavailable"} for sid in subtask_ids]

    async def _one(sid: str) -> dict[str, Any]:
        st = find_subtask_by_ids(storage, main_task_id, sid)
        if not st:
            return {"subtaskId": sid, "ok": False, "error": "subtask not found"}
        name = (st.get("name") or "subtask").strip() or "subtask"
        desc = (st.get("description") or "").strip()
        prompt = desc if desc else (
            f"完成子任务「{name}」。协作主任务 id: {main_task_id}；子任务 id: {sid}。"
        )
        subagent_type = _resolved_subagent_type_for_subtask(st)
        tcid = f"supervisor-start-exec-{main_task_id}-{sid}-{uuid.uuid4().hex[:12]}"
        try:
            out = await coro(
                runtime=runtime,
                description=name[:120],
                prompt=prompt,
                subagent_type=subagent_type,
                tool_call_id=tcid,
                max_turns=None,
                collab_task_id=main_task_id,
                collab_subtask_id=sid,
            )
            text = out if isinstance(out, str) else str(out)
            ok = text.startswith("Task Succeeded.")
            err = None if ok else text[:4000]
            return {"subtaskId": sid, "ok": ok, "result": text if ok else None, "error": err}
        except Exception as e:
            logger.exception("delegate subtask %s via task_tool failed", sid)
            return {"subtaskId": sid, "ok": False, "error": str(e)}

    return list(await asyncio.gather(*[_one(sid) for sid in subtask_ids]))


def _resolved_subagent_type_for_subtask(st: dict) -> str:
    """Prefer explicit assign_subtask (assigned_to); else worker_profile.base_subagent; else default."""
    a = (st.get("assigned_to") or "").strip()
    if a:
        return a
    wp = st.get("worker_profile")
    if isinstance(wp, dict):
        b = str(wp.get("base_subagent") or "").strip()
        if b:
            return b
    return "general-purpose"


def _record_supervisor_ui_step(
    runtime: ToolRuntime[ContextT, dict] | None,
    tool_call_id: str,
    action: str,
    label: str,
) -> None:
    """Persist a compact supervisor step for DeerPanel task sidebar (best-effort)."""
    tid = _runtime_thread_id(runtime)
    if not tid:
        return
    try:
        import uuid as _uuid

        from deerflow.collab.thread_collab import append_sidebar_supervisor_step

        sid = (tool_call_id or "").strip()
        step_id = sid if sid else str(_uuid.uuid4())
        append_sidebar_supervisor_step(
            get_paths(),
            tid,
            {"id": step_id, "action": action, "label": label, "done": True},
        )
    except Exception:
        logger.debug("append sidebar supervisor step failed", exc_info=True)


def _runtime_thread_id(runtime: ToolRuntime[ContextT, dict] | None) -> str | None:
    if runtime is None:
        return None
    ctx = getattr(runtime, "context", None)
    if isinstance(ctx, dict):
        tid = ctx.get("thread_id")
        if tid:
            return str(tid)
    cfg = getattr(runtime, "config", None) or {}
    conf = cfg.get("configurable") or {}
    tid = conf.get("thread_id")
    return str(tid) if tid else None


def _dbg_enabled(runtime: ToolRuntime[ContextT, dict] | None) -> bool:
    # Opt-in noisy logs via runtime context (preferred) or env var (fallback).
    try:
        ctx = getattr(runtime, "context", None)
        if isinstance(ctx, dict) and "DEERFLOW_SUPERVISOR_DEBUG" in ctx:
            v = ctx.get("DEERFLOW_SUPERVISOR_DEBUG")
            if isinstance(v, bool):
                return v
            return str(v).strip().lower() in {"1", "true", "yes", "on"}
    except Exception:
        pass
    return str(os.getenv("DEERFLOW_SUPERVISOR_DEBUG", "")).strip().lower() in {"1", "true", "yes", "on"}


def _repr_with_invisibles(v: object) -> str:
    # Make whitespace/newlines visible in logs.
    s = "" if v is None else str(v)
    return (
        s.replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace("\t", "\\t")
        .replace(" ", "·")
    )


def _clamp_progress(value: int | None) -> int:
    if value is None:
        return 0
    return max(0, min(100, int(value)))


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
        parts.append(f"instr={ins[:80]}{'…' if len(ins) > 80 else ''}")
    if not parts:
        return ""
    return " | profile: " + "; ".join(parts)


def _subtask_row_dict(st: dict) -> dict[str, Any]:
    """Structured subtask row for JSON tool results (get_status / list_subtasks)."""
    status = st.get("status", "unknown")
    icon = {"pending": "⚪", "executing": "🔴", "completed": "✅", "failed": "❌"}.get(status, "⚪")
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


async def _broadcast_task_event(project_id: str, event_type: str, data: dict) -> None:
    """Best-effort SSE broadcast from supervisor paths."""
    try:
        from deerflow.collab.sse_notify import broadcast_project_event

        await broadcast_project_event(project_id, event_type, data)
    except Exception:
        logger.debug("Failed to broadcast task event", exc_info=True)


def _persist_main_task_memory_snapshot(project: dict, task: dict) -> int:
    """Aggregate subtask memories into the main-task memory file."""
    mem_store = get_task_memory_storage()
    project_id = project.get("id")
    task_id = task.get("id")
    if not project_id or not task_id:
        return 0

    main_agent_id = task.get("assigned_to") or ""
    main_mem = mem_store.load_task_memory(project_id, main_agent_id, task_id)
    main_mem["task_id"] = task_id
    main_mem["project_id"] = project_id
    main_mem["agent_id"] = main_agent_id
    main_mem["status"] = task.get("status") or "pending"
    main_mem["progress"] = _clamp_progress(task.get("progress"))
    main_mem["current_step"] = (
        "All subtasks completed" if (task.get("status") == "completed") else "Task in progress"
    )

    aggregated_facts = []
    output_parts = []
    seen_fact_ids = set()
    for st in task.get("subtasks", []):
        st_id = st.get("id")
        if not st_id:
            continue
        st_agent_id = (st.get("assigned_to") or task.get("assigned_to") or "") or ""
        st_mem = mem_store.load_task_memory(project_id, st_agent_id, st_id)
        out = (st_mem.get("output_summary") or "").strip()
        if out:
            output_parts.append(f"[{st_id}] {out}")
        for fact in st_mem.get("facts", []) or []:
            fid = fact.get("id") or f"{st_id}:{fact.get('content', '')[:64]}"
            if fid in seen_fact_ids:
                continue
            seen_fact_ids.add(fid)
            aggregated_facts.append({**fact, "task_id": st_id})

    if output_parts:
        main_mem["output_summary"] = "\n".join(output_parts)[:8000]
    main_mem["facts"] = aggregated_facts
    if task.get("status") == "completed":
        from datetime import datetime

        now = datetime.utcnow().isoformat() + "Z"
        main_mem["completed_at"] = now

    mem_store.save_task_memory(main_mem)
    return len(aggregated_facts)


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
    subtask_ids: list[str] | None = None,
    progress: int | None = None,
    status: str | None = None,
    authorized_by: str | None = None,
    worker_profile_json: str | None = None,
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
    3. Add subtasks with `action=create_subtask` (optional `worker_profile_json`)
    4. Assign subtasks to agents with `action=assign_subtask`
    5. Update progress with `action=update_progress`
    6. Mark completed with `action=complete_subtask`

    Args:
        action: One of create_task, create_subtask, assign_subtask, update_progress,
            complete_subtask, start_execution, get_status, get_task_memory, list_subtasks, set_task_planned (see workflow above).
        task_name: Name for a new task (required for create_task).
        task_description: Description for a new task (optional for create_task).
        subtask_name: Name for a new subtask (required for create_subtask).
        subtask_description: Description for a new subtask (optional for create_subtask).
        task_id: Main task id (required for create_subtask, assign_subtask, get_status, get_task_memory, list_subtasks, set_task_planned).
        subtask_id: ID of an existing subtask (required for assign_subtask, complete_subtask; optional for update_progress when updating main task).
        assigned_agent: Agent ID for assign_subtask (optional); must be a configured subagent name.
        subtask_ids: For start_execution: optional; if set, only these subtasks are delegated via `task` (must exist).
            If omitted/empty after normalize, all assigned non-terminal subtasks on the main task are delegated in parallel.
        progress: Progress 0-100 (required for update_progress).
        status: Optional status for update_progress (e.g. `failed`, `cancelled`, `completed`). When provided, it will be persisted to subtask/main task and rolled up into main task status.
        authorized_by: Recorded on authorize/start_execution (default lead for start_execution).
        worker_profile_json: Optional JSON object string for create_subtask (worker constraints, tools, etc.).
    """
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

    elif action == "create_subtask":
        if not task_id or not subtask_name:
            return json.dumps({
                "success": False,
                "action": "create_subtask",
                "error": "task_id and subtask_name are required for create_subtask action"
            }, ensure_ascii=False)

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

        projects = storage.list_projects()
        task_found = False

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        import uuid
                        from datetime import datetime

                        now = datetime.utcnow().isoformat() + "Z"
                        subtask_data = {
                            "id": str(uuid.uuid4())[:8],
                            "name": subtask_name,
                            "description": subtask_description or "",
                            "status": "pending",
                            "dependencies": [],
                            "assigned_to": None,
                            "result": None,
                            "error": None,
                            "created_at": now,
                            "started_at": None,
                            "completed_at": None,
                            "progress": 0,
                        }
                        if worker_profile is not None:
                            subtask_data["worker_profile"] = worker_profile
                            bs = str(worker_profile.get("base_subagent") or "").strip()
                            if bs:
                                # 与 worker_profile 对齐，便于 list/get_status/侧栏展示；start_execution 委托仍可由 task_tool 读 profile 覆盖
                                subtask_data["assigned_to"] = bs

                        task.setdefault("subtasks", []).append(subtask_data)
                        project["tasks"][i] = task
                        storage.save_project(project)
                        task_found = True
                        logger.info(f"Created subtask '{subtask_name}' in task {task_id}")
                        
                        # 返回结构化的 JSON 格式
                        result = {
                            "success": True,
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
                        _record_supervisor_ui_step(
                            runtime,
                            tool_call_id,
                            "create_subtask",
                            f"创建子任务：{subtask_name}",
                        )
                        return json.dumps(result, ensure_ascii=False)

        if not task_found:
            return json.dumps({
                "success": False,
                "action": "create_subtask",
                "error": f"Task '{task_id}' not found"
            }, ensure_ascii=False)

    elif action == "assign_subtask":
        if not task_id or not subtask_id:
            return json.dumps({
                "success": False,
                "action": "assign_subtask",
                "error": "task_id and subtask_id are required for assign_subtask action"
            }, ensure_ascii=False)
        if assigned_agent and assigned_agent not in available_agents:
            return json.dumps({
                "success": False,
                "action": "assign_subtask",
                "error": f"Unknown agent '{assigned_agent}'",
                "availableAgents": list(available_agents)
            }, ensure_ascii=False)

        projects = storage.list_projects()
        # Fallback debug to stdout/stderr: some deployments filter python logging.
        print(
            "[supervisor.assign_subtask] tool_call_id=%s runtime_thread_id=%s task_id=%r subtask_id=%r assigned_agent=%r projects=%d"
            % (tool_call_id, _runtime_thread_id(runtime), task_id, subtask_id, assigned_agent, len(projects)),
            flush=True,
        )
        # Always log one high-signal line for this historically flaky action.
        logger.warning(
            "assign_subtask: tool_call_id=%s runtime_thread_id=%s task_id=%s(%s) subtask_id=%s(%s) "
            "assigned_agent=%s(%s) projects=%d project_ids=%r",
            tool_call_id,
            _runtime_thread_id(runtime),
            task_id,
            _repr_with_invisibles(task_id),
            subtask_id,
            _repr_with_invisibles(subtask_id),
            assigned_agent,
            _repr_with_invisibles(assigned_agent),
            len(projects),
            [p.get("id") for p in projects],
        )

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                if _dbg_enabled(runtime):
                    try:
                        task_ids = [t.get("id") for t in project.get("tasks", [])]
                    except Exception:
                        task_ids = ["<error_collecting_task_ids>"]
                    logger.warning(
                        "assign_subtask(debug): scanning project_id=%r task_ids=%r",
                        project.get("id"),
                        task_ids,
                    )
                for i, task in enumerate(project.get("tasks", [])):
                    # Keep matching consistent with get_status/list_subtasks which use direct id equality.
                    if task.get("id") == task_id:
                        if _dbg_enabled(runtime):
                            logger.warning(
                                "assign_subtask(debug): matched task_id=%r in project_id=%r; subtasks=%r",
                                task_id,
                                project.get("id"),
                                [st.get("id") for st in task.get("subtasks", [])],
                            )
                        for j, subtask in enumerate(task.get("subtasks", [])):
                            if subtask.get("id") == subtask_id:
                                subtask["assigned_to"] = assigned_agent or "general-purpose"
                                task["subtasks"][j] = subtask
                                project["tasks"][i] = task
                                storage.save_project(project)
                                agent_name = assigned_agent or "general-purpose"
                                logger.info(f"Assigned subtask {subtask_id} to {agent_name}")
                                
                                # 返回结构化的 JSON 格式
                                result = {
                                    "success": True,
                                    "action": "assign_subtask",
                                    "subtaskId": subtask_id,
                                    "taskId": task_id,
                                    "assignedTo": agent_name,
                                    "message": f"Subtask {subtask_id} assigned to agent: {agent_name}"
                                }
                                _record_supervisor_ui_step(
                                    runtime,
                                    tool_call_id,
                                    "assign_subtask",
                                    f"分配子任务 {subtask_id} → {agent_name}",
                                )
                                return json.dumps(result, ensure_ascii=False)
                        return json.dumps({
                            "success": False,
                            "action": "assign_subtask",
                            "error": f"Subtask '{subtask_id}' not found in task '{task_id}'"
                        }, ensure_ascii=False)

        # Always emit a failure summary so we can diagnose without special flags.
        try:
            scanned = []
            for p in projects:
                prj = storage.load_project(p["id"])
                if not prj:
                    continue
                scanned.append(
                    {
                        "project_id": prj.get("id"),
                        "tasks": [
                            {
                                "id": t.get("id"),
                                "subtasks": [st.get("id") for st in t.get("subtasks", [])],
                            }
                            for t in prj.get("tasks", [])
                        ],
                    }
                )
        except Exception as e:
            scanned = f"<error building scan summary: {e}>"
        logger.warning(
            "assign_subtask: NOT_FOUND task_id=%s(%s) subtask_id=%s(%s) assigned_agent=%s(%s) scanned=%r",
            task_id,
            _repr_with_invisibles(task_id),
            subtask_id,
            _repr_with_invisibles(subtask_id),
            assigned_agent,
            _repr_with_invisibles(assigned_agent),
            scanned,
        )
        # Always return a compact diagnostic payload for this historically flaky action.
        try:
            scanned_compact = json.dumps(scanned, ensure_ascii=False)
        except Exception:
            scanned_compact = str(scanned)
        return (
            f"Error: Task '{task_id}' not found"
            f" || DIAG runtime_thread_id={_runtime_thread_id(runtime)!r}"
            f" task_id={task_id!r} subtask_id={subtask_id!r} assigned_agent={assigned_agent!r}"
            f" scanned={scanned_compact}"
        )

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
                                import uuid
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

        to_run = _subtask_ids_to_run_after_start(storage, task_id, subtask_ids)
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
                    runtime, storage, task_id, to_run
                )
            except Exception:
                logger.exception("start_execution: delegate_collab_subtasks_for_start_execution failed task_id=%s", task_id)
                delegated = [
                    {"subtaskId": sid, "ok": False, "error": "delegation failed"}
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
        result = {
            "success": True,
            "action": "start_execution",
            "taskId": task_id,
            "authorizedBy": actor,
            "message": f"Execution authorized for task {task_id}. ({msg})",
            "collabPhaseAdvanced": phase_ok,
            "subtaskIds": to_run,
            "delegatedSubtasks": delegated,
            "delegationAllSucceeded": all_ok,
        }
        return json.dumps(result, ensure_ascii=False)

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

    elif action == "create_agent":
        """Create a new agent configuration.
        
        Args:
            agent_name: Unique identifier for the agent (required)
            agent_type: Type of agent - 'custom', 'subagent', or 'acp' (default: 'subagent')
            description: Agent description (optional)
            model: Model to use (optional)
            system_prompt: System prompt for subagents (required for subagent type)
            tools: List of tool names (optional)
            skills: List of skill names (optional)
            disallowed_tools: List of disallowed tool names (optional)
            max_turns: Maximum number of turns (default: 50)
            timeout_seconds: Timeout in seconds (default: 900)
        """
        agent_name = runtime.context.get("agent_name") if runtime.context else None
        if not agent_name:
            agent_name = runtime.config.get("configurable", {}).get("agent_name")
        
        if not agent_name:
            return "Error: agent_name is required for create_agent action (pass in context or configurable)"
        
        agent_type = runtime.context.get("agent_type", "subagent") if runtime.context else "subagent"
        if not agent_type:
            agent_type = runtime.config.get("configurable", {}).get("agent_type", "subagent")
        
        description = runtime.context.get("description", "") if runtime.context else ""
        if not description:
            description = runtime.config.get("configurable", {}).get("description", "")
        
        model = runtime.context.get("model") if runtime.context else None
        if not model:
            model = runtime.config.get("configurable", {}).get("model")
        
        system_prompt = runtime.context.get("system_prompt") if runtime.context else None
        if not system_prompt:
            system_prompt = runtime.config.get("configurable", {}).get("system_prompt")
        
        tools = runtime.context.get("tools") if runtime.context else None
        if not tools:
            tools = runtime.config.get("configurable", {}).get("tools")
        
        skills = runtime.context.get("skills") if runtime.context else None
        if not skills:
            skills = runtime.config.get("configurable", {}).get("skills")
        
        disallowed_tools = runtime.context.get("disallowed_tools") if runtime.context else None
        if not disallowed_tools:
            disallowed_tools = runtime.config.get("configurable", {}).get("disallowed_tools")
        
        max_turns = runtime.context.get("max_turns", 50) if runtime.context else 50
        if not max_turns:
            max_turns = runtime.config.get("configurable", {}).get("max_turns", 50)
        
        timeout_seconds = runtime.context.get("timeout_seconds", 900) if runtime.context else 900
        if not timeout_seconds:
            timeout_seconds = runtime.config.get("configurable", {}).get("timeout_seconds", 900)
        
        # Validate agent type
        if agent_type not in ["custom", "subagent", "acp"]:
            return f"Error: Invalid agent_type '{agent_type}'. Must be 'custom', 'subagent', or 'acp'"
        
        # Validate subagent requires system_prompt
        if agent_type == "subagent" and not system_prompt:
            return "Error: system_prompt is required for subagent type"
        
        # Check if agent already exists
        try:
            existing = load_agent_config(agent_name)
            if existing:
                return f"Error: Agent '{agent_name}' already exists"
        except FileNotFoundError:
            pass  # Expected - agent doesn't exist yet
        
        # Create agent directory and config file
        import yaml
        from pathlib import Path
        
        agents_dir = get_paths().agents_dir
        agent_dir = agents_dir / agent_name
        
        try:
            agent_dir.mkdir(parents=True, exist_ok=True)
            
            config_data = {
                "name": agent_name,
                "description": description,
                "agent_type": agent_type,
            }
            
            if model:
                config_data["model"] = model
            if system_prompt:
                config_data["system_prompt"] = system_prompt
            if tools:
                config_data["tools"] = tools
            if skills:
                config_data["skills"] = skills
            if disallowed_tools:
                config_data["disallowed_tools"] = disallowed_tools
            if max_turns != 50:
                config_data["max_turns"] = max_turns
            if timeout_seconds != 900:
                config_data["timeout_seconds"] = timeout_seconds
            
            config_file = agent_dir / "config.yaml"
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            
            logger.info(f"Created agent '{agent_name}' ({agent_type}) at {agent_dir}")
            return f"Agent '{agent_name}' created successfully at {agent_dir}"
        
        except Exception as e:
            logger.error(f"Failed to create agent '{agent_name}': {e}", exc_info=True)
            return f"Error: Failed to create agent '{agent_name}': {e}"

    elif action == "update_agent":
        """Update an existing agent configuration.
        
        Args:
            agent_name: Name of the agent to update (required)
            description: New description (optional)
            model: New model (optional)
            system_prompt: New system prompt (optional)
            tools: New tool list (optional)
            skills: New skill list (optional)
            disallowed_tools: New disallowed tools list (optional)
            max_turns: New max turns (optional)
            timeout_seconds: New timeout (optional)
        """
        agent_name = runtime.context.get("agent_name") if runtime.context else None
        if not agent_name:
            agent_name = runtime.config.get("configurable", {}).get("agent_name")
        
        if not agent_name:
            return "Error: agent_name is required for update_agent action"
        
        # Load existing agent config
        try:
            existing_cfg = load_agent_config(agent_name)
            if not existing_cfg:
                return f"Error: Agent '{agent_name}' not found"
        except FileNotFoundError:
            return f"Error: Agent '{agent_name}' not found"
        
        # Get update parameters
        updates = {}
        
        description = runtime.context.get("description") if runtime.context else None
        if description is not None:
            updates["description"] = description
        elif runtime.config.get("configurable", {}).get("description") is not None:
            updates["description"] = runtime.config.get("configurable", {}).get("description")
        
        model = runtime.context.get("model") if runtime.context else None
        if model is not None:
            updates["model"] = model
        elif runtime.config.get("configurable", {}).get("model") is not None:
            updates["model"] = runtime.config.get("configurable", {}).get("model")
        
        system_prompt = runtime.context.get("system_prompt") if runtime.context else None
        if system_prompt is not None:
            updates["system_prompt"] = system_prompt
        elif runtime.config.get("configurable", {}).get("system_prompt") is not None:
            updates["system_prompt"] = runtime.config.get("configurable", {}).get("system_prompt")
        
        tools = runtime.context.get("tools") if runtime.context else None
        if tools is not None:
            updates["tools"] = tools
        elif runtime.config.get("configurable", {}).get("tools") is not None:
            updates["tools"] = runtime.config.get("configurable", {}).get("tools")
        
        skills = runtime.context.get("skills") if runtime.context else None
        if skills is not None:
            updates["skills"] = skills
        elif runtime.config.get("configurable", {}).get("skills") is not None:
            updates["skills"] = runtime.config.get("configurable", {}).get("skills")
        
        disallowed_tools = runtime.context.get("disallowed_tools") if runtime.context else None
        if disallowed_tools is not None:
            updates["disallowed_tools"] = disallowed_tools
        elif runtime.config.get("configurable", {}).get("disallowed_tools") is not None:
            updates["disallowed_tools"] = runtime.config.get("configurable", {}).get("disallowed_tools")
        
        max_turns = runtime.context.get("max_turns") if runtime.context else None
        if max_turns is not None:
            updates["max_turns"] = max_turns
        elif runtime.config.get("configurable", {}).get("max_turns") is not None:
            updates["max_turns"] = runtime.config.get("configurable", {}).get("max_turns")
        
        timeout_seconds = runtime.context.get("timeout_seconds") if runtime.context else None
        if timeout_seconds is not None:
            updates["timeout_seconds"] = timeout_seconds
        elif runtime.config.get("configurable", {}).get("timeout_seconds") is not None:
            updates["timeout_seconds"] = runtime.config.get("configurable", {}).get("timeout_seconds")
        
        if not updates:
            return "Error: No update parameters provided"
        
        # Update config file
        import yaml
        from pathlib import Path
        
        agents_dir = get_paths().agents_dir
        agent_dir = agents_dir / agent_name
        config_file = agent_dir / "config.yaml"
        
        try:
            # Read existing config
            with open(config_file, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f) or {}
            
            # Apply updates
            config_data.update(updates)
            
            # Write back
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)
            
            logger.info(f"Updated agent '{agent_name}' with: {list(updates.keys())}")
            return f"Agent '{agent_name}' updated successfully. Updated fields: {', '.join(updates.keys())}"
        
        except Exception as e:
            logger.error(f"Failed to update agent '{agent_name}': {e}", exc_info=True)
            return f"Error: Failed to update agent '{agent_name}': {e}"

    elif action == "list_agents":
        """List all available agents.
        
        Returns:
            List of agents with their types and descriptions
        """
        try:
            agents = list_all_agents()
            if not agents:
                return "No agents found"
            
            agent_lines = []
            for agent in agents:
                agent_type = agent.agent_type
                model = agent.model or "default"
                desc = agent.description or "No description"
                agent_lines.append(f"  - {agent.name} ({agent_type}) | Model: {model} | {desc}")
            
            return f"Available agents ({len(agents)}):\n" + "\n".join(agent_lines)
        
        except Exception as e:
            logger.error(f"Failed to list agents: {e}", exc_info=True)
            return f"Error: Failed to list agents: {e}"

    return json.dumps({
        "success": False,
        "action": action,
        "error": f"Unknown action '{action}'",
        "availableActions": ["create_task", "create_subtask", "assign_subtask", "update_progress", "complete_subtask", "start_execution", "set_task_planned", "get_status", "get_task_memory", "list_subtasks", "create_agent", "update_agent", "list_agents"]
    }, ensure_ascii=False)
