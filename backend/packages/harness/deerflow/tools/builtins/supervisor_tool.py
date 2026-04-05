"""Supervisor tool for multi-agent task planning and coordination."""

import os
import json
import logging
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.typing import ContextT
from pydantic import ValidationError

from deerflow.collab.models import WorkerProfile
from deerflow.collab.storage import (
    authorize_main_task_execution,
    find_open_main_task_id_by_name,
    get_project_storage,
    get_task_memory_storage,
    load_task_memory_for_task_id,
    new_project_bundle_root_task,
)
from deerflow.config.agents_config import load_agent_config, list_all_agents
from deerflow.config.paths import get_paths
from deerflow.subagents import get_available_subagent_names

logger = logging.getLogger(__name__)


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
            complete_subtask, start_execution, get_status, get_task_memory, list_subtasks (see workflow above).
        task_name: Name for a new task (required for create_task).
        task_description: Description for a new task (optional for create_task).
        subtask_name: Name for a new subtask (required for create_subtask).
        subtask_description: Description for a new subtask (optional for create_subtask).
        task_id: Main task id (required for create_subtask, assign_subtask, get_status, get_task_memory, list_subtasks).
        subtask_id: ID of an existing subtask (required for assign_subtask, complete_subtask; optional for update_progress when updating main task).
        assigned_agent: Agent ID for assign_subtask (optional); must be a configured subagent name.
        subtask_ids: List of subtask IDs (optional, for batch operations).
        progress: Progress 0-100 (required for update_progress).
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
            return "Error: task_name is required for create_task action"

        task_id_new = find_open_main_task_id_by_name(storage, task_name)
        if task_id_new:
            return f"Task '{task_name}' already exists with ID: {task_id_new}"

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
            return json.dumps(result, ensure_ascii=False)
        return "Error: Failed to create task"

    elif action == "create_subtask":
        if not task_id or not subtask_name:
            return "Error: task_id and subtask_name are required for create_subtask action"

        worker_profile: dict | None = None
        if worker_profile_json and str(worker_profile_json).strip():
            try:
                parsed = json.loads(worker_profile_json)
            except json.JSONDecodeError:
                return "Error: worker_profile_json must be valid JSON"
            if not isinstance(parsed, dict):
                return "Error: worker_profile_json must be a JSON object"
            try:
                wp = WorkerProfile.model_validate(parsed)
            except ValidationError as e:
                return f"Error: worker_profile_json: {e}"
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
                            "progress": 0
                        }
                        return json.dumps(result, ensure_ascii=False)

        if not task_found:
            return f"Error: Task '{task_id}' not found"

    elif action == "assign_subtask":
        if not task_id or not subtask_id:
            return "Error: task_id and subtask_id are required for assign_subtask action"
        if assigned_agent and assigned_agent not in available_agents:
            return f"Error: Unknown agent '{assigned_agent}'. Available: {', '.join(available_agents)}"

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
                                return json.dumps(result, ensure_ascii=False)
                        return f"Error: Subtask '{subtask_id}' not found in task '{task_id}'"

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
            return "Error: task_id is required for update_progress action"
        if progress is None:
            return "Error: progress is required for update_progress action (0-100)"

        progress_value = _clamp_progress(progress)

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for i, task in enumerate(project.get("tasks", [])):
                    if task.get("id") == task_id:
                        if subtask_id:
                            for j, subtask in enumerate(task.get("subtasks", [])):
                                if subtask.get("id") == subtask_id:
                                    subtask["progress"] = progress_value
                                    task["subtasks"][j] = subtask
                                    project["tasks"][i] = task
                                    storage.save_project(project)
                                    await _broadcast_task_event(
                                        project.get("id"),
                                        "task:progress",
                                        {
                                            "task_id": subtask_id,
                                            "progress": progress_value,
                                            "current_step": "",
                                        },
                                    )
                                    
                                    # 返回结构化的 JSON 格式
                                    result = {
                                        "success": True,
                                        "action": "update_progress",
                                        "subtaskId": subtask_id,
                                        "taskId": task_id,
                                        "progress": progress_value,
                                        "message": f"Updated progress of subtask {subtask_id} to {progress_value}%"
                                    }
                                    return json.dumps(result, ensure_ascii=False)
                            return f"Error: Subtask '{subtask_id}' not found"
                        task["progress"] = progress_value
                        project["tasks"][i] = task
                        storage.save_project(project)
                        _persist_main_task_memory_snapshot(project, task)
                        await _broadcast_task_event(
                            project.get("id"),
                            "task:progress",
                            {
                                "task_id": task_id,
                                "progress": progress_value,
                                "current_step": "",
                            },
                        )
                        
                        # 返回结构化的 JSON 格式
                        result = {
                            "success": True,
                            "action": "update_progress",
                            "taskId": task_id,
                            "progress": progress_value,
                            "message": f"Updated progress of main task {task_id} to {progress_value}%"
                        }
                        return json.dumps(result, ensure_ascii=False)

        return f"Error: Task '{task_id}' not found"

    elif action == "complete_subtask":
        if not task_id or not subtask_id:
            return "Error: task_id and subtask_id are required for complete_subtask action"

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
                        return f"Error: Subtask '{subtask_id}' not found in task '{task_id}'"
        return f"Error: Task '{task_id}' not found"

    elif action == "start_execution":
        if not task_id:
            return "Error: task_id is required for start_execution action"
        actor = authorized_by or "lead"
        ok, msg = authorize_main_task_execution(storage, task_id, actor)
        if not ok:
            return json.dumps({
                "success": False,
                "action": "start_execution",
                "taskId": task_id,
                "error": msg
            }, ensure_ascii=False)
        
        # 返回结构化的 JSON 格式
        result = {
            "success": True,
            "action": "start_execution",
            "taskId": task_id,
            "authorizedBy": actor,
            "message": f"Execution authorized for task {task_id}. ({msg})"
        }
        return json.dumps(result, ensure_ascii=False)

    elif action == "get_status":
        if not task_id:
            return "Error: task_id is required for get_status action"

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    if task.get("id") == task_id:
                        subtasks = task.get("subtasks", [])
                        subtask_info = []
                        for st in subtasks:
                            status_icon = {"pending": "⚪", "executing": "🔴", "completed": "✅", "failed": "❌"}.get(st.get("status", ""), "⚪")
                            ag = st.get("assigned_to") or "unassigned"
                            wp_s = _subtask_worker_profile_suffix(st)
                            subtask_info.append(
                                f"  {status_icon} {st.get('name', 'unnamed')} [{st.get('status', 'unknown')}] "
                                f"| Agent: {ag}{wp_s} (ID: {st.get('id')})"
                            )

                        auth = task.get("execution_authorized", False)
                        tid = task.get("thread_id") or "(none)"
                        result = f"""Task Status:
ID: {task_id}
Name: {task.get('name')}
Status: {task.get('status', 'unknown')}
Progress: {task.get('progress', 0)}%
Execution authorized: {auth}
Thread ID: {tid}
Subtasks ({len(subtasks)}):
{chr(10).join(subtask_info) if subtask_info else '  (none)'}"""
                        return result

        return f"Error: Task '{task_id}' not found"

    elif action == "get_task_memory":
        if not task_id:
            return "Error: task_id is required for get_task_memory action"
        mem_store = get_task_memory_storage()
        row = load_task_memory_for_task_id(storage, mem_store, task_id)
        if row is None:
            return f"Error: Task '{task_id}' not found"
        mem, project_id, agent_id, parent_task_id = row
        facts = mem.get("facts") or []
        max_show = 30
        fact_lines = [
            f"  - [{f.get('category', 'finding')}] {f.get('content', '')}"
            for f in facts[:max_show]
        ]
        more = f"\n  ... and {len(facts) - max_show} more fact(s)" if len(facts) > max_show else ""
        scope = f"subtask of {parent_task_id!r}" if parent_task_id else "main task"
        return "\n".join(
            [
                f"TaskMemory for {scope} {task_id!r} (project_id={project_id}, memory_key_agent_id={agent_id!r}):",
                f"status: {mem.get('status', '')}",
                f"progress: {mem.get('progress', 0)}",
                f"current_step: {mem.get('current_step', '')}",
                f"output_summary: {mem.get('output_summary', '')}",
                f"facts ({len(facts)}):",
                *fact_lines,
            ]
        ) + more

    elif action == "list_subtasks":
        if not task_id:
            return "Error: task_id is required for list_subtasks action"

        projects = storage.list_projects()

        for project_summary in projects:
            project = storage.load_project(project_summary["id"])
            if project:
                for task in project.get("tasks", []):
                    if task.get("id") == task_id:
                        subtasks = task.get("subtasks", [])
                        if not subtasks:
                            return f"No subtasks found for task '{task_id}'"

                        subtask_info = []
                        for st in subtasks:
                            status_icon = {"pending": "⚪", "executing": "🔴", "completed": "✅", "failed": "❌"}.get(st.get("status", ""), "⚪")
                            agent = st.get("assigned_to", "unassigned")
                            wp_s = _subtask_worker_profile_suffix(st)
                            subtask_info.append(
                                f"{status_icon} {st.get('name', 'unnamed')} | Status: {st.get('status', 'unknown')} "
                                f"| Agent: {agent} | Progress: {st.get('progress', 0)}%{wp_s} | ID: {st.get('id')}"
                            )

                        return f"Subtasks for task '{task_id}':\n" + "\n".join(subtask_info)

        return f"Error: Task '{task_id}' not found"

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

    return f"Error: Unknown action '{action}'. Available actions: create_task, create_subtask, assign_subtask, update_progress, complete_subtask, start_execution, get_status, get_task_memory, list_subtasks, create_agent, update_agent, list_agents"
