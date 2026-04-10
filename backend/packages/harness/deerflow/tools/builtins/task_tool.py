"""Task tool for delegating work to subagents."""

import asyncio
import json
import logging
from dataclasses import replace
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langgraph.config import get_stream_writer
from langgraph.typing import ContextT
from pydantic import ValidationError

from deerflow.agents.lead_agent.prompt import get_skills_prompt_section
from deerflow.agents.thread_state import ThreadState
from deerflow.config.agents_config import load_agent_config
from deerflow.sandbox.security import LOCAL_BASH_SUBAGENT_DISABLED_MESSAGE, is_host_bash_allowed
from deerflow.collab.models import CollabPhase, WorkerProfile
from deerflow.collab.storage import (
    collab_execution_gate_error,
    find_main_task,
    find_subtask_by_ids,
    get_project_storage,
    get_task_memory_storage,
    patch_collab_subtask_in_project_storage,
    persist_task_memory_after_subagent_run,
    rollup_root_task_progress_from_subtasks,
)
from deerflow.collab.thread_collab import load_thread_collab_state
from deerflow.collab.id_format import make_trace_id
from deerflow.config.paths import get_paths
from deerflow.subagents import SubagentExecutor, get_available_subagent_names, get_subagent_config
from deerflow.subagents.executor import SubagentResult, SubagentStatus, cleanup_background_task, get_background_task_result

logger = logging.getLogger(__name__)


def _collect_tool_names_from_stream_message(message: object) -> list[str]:
    """Best-effort extraction of tool names from stream message payload."""
    out: list[str] = []
    seen: set[str] = set()

    def _push(v: object) -> None:
        name = str(v or "").strip()
        if not name or name in seen:
            return
        seen.add(name)
        out.append(name)

    try:
        if isinstance(message, dict):
            # Common schema: {"tool_calls":[{"name":"web_search", ...}]}
            tcs = message.get("tool_calls")
            if isinstance(tcs, list):
                for tc in tcs:
                    if isinstance(tc, dict):
                        _push(tc.get("name") or tc.get("tool_name"))

            # LangChain content blocks may also include tool metadata
            content = message.get("content")
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if str(block.get("type") or "").lower() in {"tool_call", "tool_use"}:
                        _push(block.get("name") or block.get("tool_name"))
        # Non-dict messages are ignored.
    except Exception:
        return out
    return out


def _normalize_tool_output_content(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    try:
        return json.dumps(v, ensure_ascii=False)
    except Exception:
        return str(v)


def _extract_tool_events_from_stream_message(message: object) -> list[dict[str, Any]]:
    """Extract realtime tool call/result events with input/output."""
    out: list[dict[str, Any]] = []
    if not isinstance(message, dict):
        return out
    try:
        tcs = message.get("tool_calls")
        if isinstance(tcs, list):
            for tc in tcs:
                if not isinstance(tc, dict):
                    continue
                name = str(tc.get("name") or tc.get("tool_name") or "").strip()
                if not name:
                    continue
                tool_call_id = str(tc.get("id") or tc.get("tool_call_id") or "").strip()
                args = tc.get("args")
                if args is None:
                    fn = tc.get("function")
                    if isinstance(fn, dict):
                        raw = fn.get("arguments")
                        if isinstance(raw, str):
                            try:
                                args = json.loads(raw)
                            except Exception:
                                args = {"raw": raw}
                        elif isinstance(raw, dict):
                            args = raw
                if not isinstance(args, dict):
                    args = {}
                out.append(
                    {
                        "phase": "call",
                        "name": name,
                        "toolCallId": tool_call_id,
                        "input": args,
                    }
                )

        m_type = str(message.get("type") or message.get("role") or "").strip().lower()
        if m_type == "tool":
            name = str(message.get("name") or message.get("tool_name") or "").strip()
            if name:
                out.append(
                    {
                        "phase": "result",
                        "name": name,
                        "toolCallId": str(message.get("tool_call_id") or message.get("id") or "").strip(),
                        "output": _normalize_tool_output_content(message.get("content")),
                    }
                )
    except Exception:
        return out
    return out


@tool("task", parse_docstring=True)
async def task_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    description: str,
    prompt: str,
    subagent_type: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    max_turns: int | None = None,
    collab_task_id: str | None = None,
    collab_subtask_id: str | None = None,
    detach: bool = False,
) -> str:
    """Delegate a task to a specialized subagent that runs in its own context.

    Subagents help you:
    - Preserve context by keeping exploration and implementation separate
    - Handle complex multi-step tasks autonomously
    - Execute commands or operations in isolated contexts

    Available subagent types depend on the active sandbox configuration:
    - **general-purpose**: A capable agent for complex, multi-step tasks that require
      both exploration and action. Use when the task requires complex reasoning,
      multiple dependent steps, or would benefit from isolated context.
    - **bash**: Command execution specialist for running bash commands. This is only
      available when host bash is explicitly allowed or when using an isolated shell
      sandbox such as `AioSandboxProvider`.

    When to use this tool:
    - Complex tasks requiring multiple steps or tools
    - Tasks that produce verbose output
    - When you want to isolate context from the main conversation
    - Parallel research or exploration tasks

    When NOT to use this tool:
    - Simple, single-step operations (use tools directly)
    - Tasks requiring user interaction or clarification

    Args:
        description: A short (3-5 word) description of the task for logging/display. ALWAYS PROVIDE THIS PARAMETER FIRST.
        prompt: The task description for the subagent. Be specific and clear about what needs to be done. ALWAYS PROVIDE THIS PARAMETER SECOND.
        subagent_type: The type of subagent to use. ALWAYS PROVIDE THIS PARAMETER THIRD.
        max_turns: Optional maximum number of agent turns. Defaults to subagent's configured max.
        collab_task_id: When set (or context key collab_task_id), require the main task to exist
            in project storage (no execution_authorized / thread_id gate).
        collab_subtask_id: With collab_task_id, load ``worker_profile`` from storage (§5.2 → §5.4):
            ``base_subagent``, ``tools`` (whitelist ∩ global tools), ``skills``, ``instruction``.
        detach: When True with both collab ids set, start the background subagent and return
            immediately; completion is persisted via the same polling path asynchronously.
            Used by supervisor ``start_execution``; leave False for normal ``task`` calls.
    """
    available_subagent_names = get_available_subagent_names()

    thread_id = None
    if runtime is not None:
        thread_id = runtime.context.get("thread_id") if runtime.context else None
        if thread_id is None:
            thread_id = runtime.config.get("configurable", {}).get("thread_id")

    resolved_collab = (collab_task_id or "").strip() or None
    if not resolved_collab and runtime is not None and runtime.context:
        ctx_ct = runtime.context.get("collab_task_id")
        if ctx_ct:
            resolved_collab = str(ctx_ct).strip() or None

    # Same-run stale context: authorize/start_execution writes bound_task_id to collab_state.json only.
    if not resolved_collab and thread_id:
        try:
            disk = load_thread_collab_state(get_paths(), str(thread_id))
            if disk.collab_phase == CollabPhase.EXECUTING:
                bt = str(disk.bound_task_id or "").strip()
                if bt:
                    resolved_collab = bt
        except Exception:
            pass

    resolved_subtask = (collab_subtask_id or "").strip() or None
    if not resolved_subtask and runtime is not None and runtime.context:
        ctx_st = runtime.context.get("collab_subtask_id")
        if ctx_st:
            resolved_subtask = str(ctx_st).strip() or None

    if resolved_subtask and not resolved_collab:
        return (
            "Error: collab_subtask_id requires collab_task_id "
            "(or runtime context collab_task_id)."
        )

    if resolved_collab:
        gate = collab_execution_gate_error(resolved_collab, thread_id)
        if gate:
            return gate

    collab_project_id: str | None = None
    collab_agent_for_memory = ""
    collab_memory_task_id: str | None = None
    profile_model: WorkerProfile | None = None
    if resolved_collab:
        collab_storage = get_project_storage()
        cm = find_main_task(collab_storage, resolved_collab)
        if cm:
            proj, main_task = cm
            collab_project_id = proj["id"]
            if resolved_subtask:
                sub_row = find_subtask_by_ids(collab_storage, resolved_collab, resolved_subtask)
                if not sub_row:
                    return (
                        f"Error: subtask {resolved_subtask!r} not found under collaborative task {resolved_collab!r}."
                    )
                collab_memory_task_id = resolved_subtask
                collab_agent_for_memory = (sub_row.get("assigned_to") or main_task.get("assigned_to") or "") or ""
                wp = sub_row.get("worker_profile")
                if wp:
                    try:
                        if isinstance(wp, dict) and "base_subagent" not in wp:
                            wp = {**wp, "base_subagent": subagent_type}
                        profile_model = WorkerProfile.model_validate(wp)
                    except ValidationError as e:
                        return f"Error: invalid worker_profile in storage for subtask {resolved_subtask!r}: {e}"
            else:
                collab_memory_task_id = resolved_collab
                collab_agent_for_memory = (main_task.get("assigned_to") or "") or ""

    _collab_stream_scope: dict[str, str] = {}
    if resolved_collab and resolved_subtask:
        _collab_stream_scope = {
            "collab_task_id": resolved_collab,
            "collab_subtask_id": resolved_subtask,
        }

    def _ws(ev: dict) -> dict:
        return {**ev, **_collab_stream_scope} if _collab_stream_scope else ev

    async def _persist_collab_task_memory(outcome: str, r: SubagentResult) -> None:
        if collab_project_id is None or not collab_memory_task_id:
            return
        from deerflow.collab.sse_notify import broadcast_project_event

        mem_store = get_task_memory_storage()
        if outcome == "completed":
            ok, facts_count = persist_task_memory_after_subagent_run(
                mem_store,
                collab_project_id,
                collab_agent_for_memory,
                collab_memory_task_id,
                outcome="completed",
                output_summary=(r.result or ""),
                current_step="Subagent completed",
                progress=100,
                source_ref=tool_call_id,
            )
            prog, step = 100, "Subagent completed"
        elif outcome == "failed":
            ok, facts_count = persist_task_memory_after_subagent_run(
                mem_store,
                collab_project_id,
                collab_agent_for_memory,
                collab_memory_task_id,
                outcome="failed",
                output_summary=(r.error or ""),
                current_step="Subagent failed",
                progress=0,
                source_ref=tool_call_id,
            )
            prog, step = 0, "Subagent failed"
        else:
            ok, facts_count = persist_task_memory_after_subagent_run(
                mem_store,
                collab_project_id,
                collab_agent_for_memory,
                collab_memory_task_id,
                outcome="timed_out",
                output_summary=(r.error or ""),
                current_step="Subagent timed out",
                progress=0,
                source_ref=tool_call_id,
            )
            prog, step = 0, "Subagent timed out"

        # 同步项目 JSON 中的子任务行（任务侧栏 / GET /api/tasks 读的是这里，不仅 task_memory）
        if resolved_subtask and resolved_collab:
            try:
                pst = get_project_storage()
                if outcome == "completed":
                    patch_collab_subtask_in_project_storage(
                        pst,
                        resolved_collab,
                        resolved_subtask,
                        {"status": "completed", "progress": 100, "result": (r.result or "")[:8000]},
                    )
                elif outcome == "failed":
                    patch_collab_subtask_in_project_storage(
                        pst,
                        resolved_collab,
                        resolved_subtask,
                        {"status": "failed", "progress": 0, "error": (r.error or "")[:2000]},
                    )
                else:
                    patch_collab_subtask_in_project_storage(
                        pst,
                        resolved_collab,
                        resolved_subtask,
                        {"status": "failed", "progress": 0, "error": (r.error or "")[:2000]},
                    )
                rollup_root_task_progress_from_subtasks(pst, resolved_collab)
                # 后端即时收敛：若主任务下所有子任务已终态，立即把 collab_phase 置 done（不等后续轮询）。
                row_main = find_main_task(pst, resolved_collab)
                if row_main is not None:
                    _proj2, main2 = row_main
                    subs2 = [x for x in (main2.get("subtasks") or []) if isinstance(x, dict)]
                    if subs2 and all(
                        str(x.get("status") or "").strip().lower() in {"completed", "failed", "cancelled", "timed_out"}
                        for x in subs2
                    ):
                        try:
                            from deerflow.collab.models import CollabPhase
                            from deerflow.collab.thread_collab import merge_thread_collab_state, save_thread_collab_state

                            tid2 = str(main2.get("thread_id") or thread_id or "").strip()
                            if tid2:
                                cur2 = load_thread_collab_state(get_paths(), tid2)
                                merged2 = merge_thread_collab_state(cur2, {"collab_phase": CollabPhase.DONE.value})
                                save_thread_collab_state(get_paths(), tid2, merged2)
                        except Exception:
                            logger.debug("task_tool: immediate collab done convergence failed", exc_info=True)
                # depends_on 链：上游子任务已落库终态后，由后端自动启动下一波可运行子任务（无需主智能体再次 start_execution）
                if runtime is not None:

                    async def _auto_followup() -> None:
                        try:
                            from deerflow.tools.builtins.collab_bridge import emit_followup_wave_needed

                            await emit_followup_wave_needed(runtime, resolved_collab)
                        except Exception:
                            logger.exception(
                                "collab auto follow-up delegation failed main=%s sub=%s",
                                resolved_collab,
                                resolved_subtask,
                            )

                    asyncio.create_task(
                        _auto_followup(),
                        name=f"collab-followup-{str(resolved_collab)[:12]}",
                    )
            except Exception:
                logger.exception(
                    "sync collab subtask row after subagent outcome=%s main=%s sub=%s",
                    outcome,
                    resolved_collab,
                    resolved_subtask,
                )

        if not ok:
            return
        pid, tid = collab_project_id, collab_memory_task_id
        await broadcast_project_event(pid, "task:progress", {"task_id": tid, "progress": prog, "current_step": step})
        await broadcast_project_event(pid, "task_memory:updated", {"task_id": tid, "facts_count": facts_count})
        if outcome == "completed":
            await broadcast_project_event(pid, "task:completed", {"task_id": tid, "result": (r.result or "")[:4000]})
        else:
            await broadcast_project_event(pid, "task:failed", {"task_id": tid, "error": (r.error or "")[:4000]})

    effective_subagent_type = subagent_type
    if profile_model and profile_model.base_subagent:
        effective_subagent_type = str(profile_model.base_subagent).strip()

    config = get_subagent_config(effective_subagent_type)
    if config is None:
        available = ", ".join(available_subagent_names)
        return f"Error: Unknown subagent type '{effective_subagent_type}'. Available: {available}"
    if effective_subagent_type == "bash" and not is_host_bash_allowed():
        return f"Error: {LOCAL_BASH_SUBAGENT_DISABLED_MESSAGE}"

    # Extract parent context from runtime
    sandbox_state = None
    thread_data = None
    parent_model = None
    trace_id = None

    if runtime is not None:
        sandbox_state = runtime.state.get("sandbox")
        thread_data = runtime.state.get("thread_data")
        if thread_id is None:
            thread_id = runtime.context.get("thread_id") if runtime.context else None
            if thread_id is None:
                thread_id = runtime.config.get("configurable", {}).get("thread_id")

        metadata = runtime.config.get("metadata", {})
        parent_model = metadata.get("model_name")
        trace_id = metadata.get("trace_id") or make_trace_id()

    from deerflow.tools import get_available_tools

    tools = get_available_tools(model_name=parent_model, subagent_enabled=False)
    allowed_tool_names: set[str] = set()
    for t in tools:
        if isinstance(t, str):
            allowed_tool_names.add(t)
        else:
            n = getattr(t, "name", None)
            if n is not None:
                allowed_tool_names.add(str(n))

    overrides: dict = {}

    if profile_model is not None and profile_model.tools is not None:
        req = list(profile_model.tools)
        inter = [n for n in req if n in allowed_tool_names]
        unknown = [n for n in req if n not in allowed_tool_names]
        if unknown:
            logger.warning(
                "worker_profile.tools names not in global tool catalog (dropped): %s",
                unknown,
            )
        if not inter:
            return (
                "Error: worker_profile.tools has no valid tool names after validation. "
                f"Requested: {req!r}; available: {sorted(allowed_tool_names)!r}"
            )
        overrides["tools"] = inter

    skills_kw: set[str] | None = None
    if profile_model is not None and profile_model.skills is not None:
        skills_kw = set(profile_model.skills)

    skills_section = get_skills_prompt_section(skills_kw)
    system_prompt = config.system_prompt
    if skills_section:
        system_prompt = system_prompt + "\n\n" + skills_section
    if profile_model and profile_model.instruction:
        system_prompt = system_prompt + "\n\n" + profile_model.instruction
    overrides["system_prompt"] = system_prompt

    if max_turns is not None:
        overrides["max_turns"] = max_turns

    if overrides:
        config = replace(config, **overrides)

    # Load tools/skills from AgentConfig if not overridden in WorkerProfile
    final_tools = overrides.get("tools")
    final_skills = skills_kw
    
    if profile_model is not None:
        # Load from AgentConfig if WorkerProfile doesn't override
        if final_tools is None:
            agent_cfg = load_agent_config(effective_subagent_type)
            if agent_cfg and agent_cfg.tools is not None:
                # Filter by available tools
                final_tools = [t for t in agent_cfg.tools if t in allowed_tool_names]
                logger.info(f"Loaded {len(final_tools)} tools from AgentConfig for {effective_subagent_type}")
        
        if final_skills is None:
            agent_cfg = load_agent_config(effective_subagent_type)
            if agent_cfg and agent_cfg.skills is not None:
                final_skills = set(agent_cfg.skills)
                logger.info(f"Loaded {len(final_skills)} skills from AgentConfig for {effective_subagent_type}")
        
        # Override model if specified in WorkerProfile
        if profile_model.model is not None:
            parent_model = profile_model.model
            logger.info(f"Overriding model to {profile_model.model} from WorkerProfile")
    
    # Update overrides with final values
    if final_tools is not None:
        overrides["tools"] = final_tools
    if final_skills is not None:
        skills_section = get_skills_prompt_section(final_skills)
        system_prompt = config.system_prompt
        if skills_section:
            system_prompt = system_prompt + "\n\n" + skills_section
        if profile_model and profile_model.instruction:
            system_prompt = system_prompt + "\n\n" + profile_model.instruction
        overrides["system_prompt"] = system_prompt

    # Create executor
    executor = SubagentExecutor(
        config=config,
        tools=tools,
        parent_model=parent_model,
        sandbox_state=sandbox_state,
        thread_data=thread_data,
        thread_id=thread_id,
        trace_id=trace_id,
    )

    # Start background execution (always async to prevent blocking)
    # Use tool_call_id as task_id for better traceability
    task_id = executor.execute_async(prompt, task_id=tool_call_id)

    # Poll for task completion in backend (removes need for LLM to poll)
    poll_count = 0
    last_status = None
    last_message_count = 0  # Track how many AI messages we've already sent
    # Polling timeout: execution timeout + 60s buffer, checked every 5s
    max_poll_count = (config.timeout_seconds + 60) // 5

    logger.info(
        f"[trace={trace_id}] Started background task {task_id} "
        f"(subagent={effective_subagent_type}, timeout={config.timeout_seconds}s, polling_limit={max_poll_count} polls)"
    )

    writer = get_stream_writer()
    # Send Task Started message'
    writer(
        _ws(
            {
                "type": "task_started",
                "task_id": task_id,
                "description": description,
                "subagent_type": effective_subagent_type,
            }
        )
    )
    if collab_project_id and collab_memory_task_id:
        from deerflow.collab.sse_notify import broadcast_project_event

        await broadcast_project_event(
            collab_project_id,
            "task:started",
            {"task_id": collab_memory_task_id, "agent_id": collab_agent_for_memory},
        )

    if resolved_collab and resolved_subtask:
        try:
            pst = get_project_storage()
            st0 = find_subtask_by_ids(pst, resolved_collab, resolved_subtask)
            prev_p = 0
            if isinstance(st0, dict):
                try:
                    prev_p = max(0, min(100, int(st0.get("progress") or 0)))
                except (TypeError, ValueError):
                    prev_p = 0
            patch_collab_subtask_in_project_storage(
                pst,
                resolved_collab,
                resolved_subtask,
                {"status": "executing", "progress": max(5, prev_p)},
            )
            rollup_root_task_progress_from_subtasks(pst, resolved_collab)
        except Exception:
            logger.exception(
                "mark collab subtask executing failed main=%s sub=%s",
                resolved_collab,
                resolved_subtask,
            )

    detach_effective = bool(detach) and bool(resolved_collab) and bool(resolved_subtask)
    if detach and not detach_effective:
        logger.warning(
            "task_tool: detach=True ignored (requires collab_task_id and collab_subtask_id)"
        )

    async def _poll_subagent_to_completion() -> str:
        nonlocal poll_count, last_status, last_message_count
        try:
            while True:
                result = get_background_task_result(task_id)

                if result is None:
                    logger.error(f"[trace={trace_id}] Task {task_id} not found in background tasks")
                    writer(_ws({"type": "task_failed", "task_id": task_id, "error": "Task disappeared from background tasks"}))
                    cleanup_background_task(task_id)
                    return f"Error: Task {task_id} disappeared from background tasks"

                # Log status changes for debugging
                if result.status != last_status:
                    logger.info(f"[trace={trace_id}] Task {task_id} status: {result.status.value}")
                    last_status = result.status

                # 新消息：优先 stream_messages（含 AIMessage + ToolMessage），否则仅 ai_messages
                stream_list = getattr(result, "stream_messages", None) or []
                legacy_list = getattr(result, "ai_messages", None) or []
                use_stream = len(stream_list) > 0
                current_message_count = len(stream_list) if use_stream else len(legacy_list)
                if current_message_count > last_message_count:
                    # Send task_running event for each new message
                    observed_tools: set[str] = set()
                    observed_events: list[dict[str, Any]] = []
                    for i in range(last_message_count, current_message_count):
                        message = stream_list[i] if use_stream else legacy_list[i]
                        for tn in _collect_tool_names_from_stream_message(message):
                            observed_tools.add(tn)
                        for ev in _extract_tool_events_from_stream_message(message):
                            ev2 = dict(ev)
                            ev2["messageIndex"] = i + 1
                            observed_events.append(ev2)
                        writer(
                            _ws(
                                {
                                    "type": "task_running",
                                    "task_id": task_id,
                                    "message": message,
                                    "message_index": i + 1,  # 1-based index for display
                                    "total_messages": current_message_count,
                                    "subagent_type": effective_subagent_type,
                                }
                            )
                        )
                        # detached 模式下前端主流可能已结束；同时向 project SSE 广播原始 task_running，
                        # 让 TODO 侧栏仍能实时看到工具调用/模型输出/工具结果。
                        if collab_project_id and collab_memory_task_id:
                            from deerflow.collab.sse_notify import broadcast_project_event
                            msg_preview = _normalize_tool_output_content(message)
                            msg_preview = (msg_preview or "").replace("\n", " ").strip()
                            if len(msg_preview) > 220:
                                msg_preview = msg_preview[:220] + "…"
                            logger.info(
                                "[trace=%s] task:running sse main=%s sub=%s exec=%s idx=%s/%s text=%s",
                                trace_id,
                                collab_memory_task_id,
                                (resolved_subtask or collab_memory_task_id),
                                task_id,
                                i + 1,
                                current_message_count,
                                msg_preview,
                            )

                            await broadcast_project_event(
                                collab_project_id,
                                "task:running",
                                {
                                    "task_id": collab_memory_task_id,
                                    "task_exec_id": task_id,
                                    "collab_subtask_id": resolved_subtask or collab_memory_task_id,
                                    "message": message,
                                    "message_index": i + 1,
                                    "total_messages": current_message_count,
                                    "subagent_type": effective_subagent_type,
                                },
                            )
                        logger.info(f"[trace={trace_id}] Task {task_id} sent message #{i + 1}/{current_message_count}")
                    last_message_count = current_message_count
                    if (observed_tools or observed_events) and resolved_subtask and resolved_collab:
                        try:
                            pst = get_project_storage()
                            current_st = find_subtask_by_ids(pst, resolved_collab, resolved_subtask) or {}
                            existed = current_st.get("observed_tools") or []
                            if not isinstance(existed, list):
                                existed = []
                            merged: list[str] = []
                            seen_tool: set[str] = set()
                            for x in [*existed, *sorted(observed_tools)]:
                                n = str(x or "").strip()
                                if not n or n in seen_tool:
                                    continue
                                seen_tool.add(n)
                                merged.append(n)
                            patch_collab_subtask_in_project_storage(
                                pst,
                                resolved_collab,
                                resolved_subtask,
                                {
                                    "observed_tools": merged,
                                    "observed_tool_calls": (
                                        (
                                            (current_st.get("observed_tool_calls") or [])
                                            if isinstance(current_st.get("observed_tool_calls"), list)
                                            else []
                                        )
                                        + observed_events
                                    )[-80:],
                                },
                            )
                        except Exception:
                            logger.debug("task_tool: persist observed_tools failed", exc_info=True)

                # Check if task completed, failed, or timed out
                if result.status == SubagentStatus.COMPLETED:
                    writer(_ws({"type": "task_completed", "task_id": task_id, "result": result.result}))
                    logger.info(f"[trace={trace_id}] Task {task_id} completed after {poll_count} polls")
                    await _persist_collab_task_memory("completed", result)
                    cleanup_background_task(task_id)
                    return f"Task Succeeded. Result: {result.result}"
                elif result.status == SubagentStatus.FAILED:
                    writer(_ws({"type": "task_failed", "task_id": task_id, "error": result.error}))
                    logger.error(f"[trace={trace_id}] Task {task_id} failed: {result.error}")
                    await _persist_collab_task_memory("failed", result)
                    cleanup_background_task(task_id)
                    return f"Task failed. Error: {result.error}"
                elif result.status == SubagentStatus.TIMED_OUT:
                    writer(_ws({"type": "task_timed_out", "task_id": task_id, "error": result.error}))
                    logger.warning(f"[trace={trace_id}] Task {task_id} timed out: {result.error}")
                    await _persist_collab_task_memory("timed_out", result)
                    cleanup_background_task(task_id)
                    return f"Task timed out. Error: {result.error}"

                # Still running, wait before next poll
                await asyncio.sleep(1)
                poll_count += 1

                # Polling timeout as a safety net (in case thread pool timeout doesn't work)
                # Set to execution timeout + 60s buffer, in 5s poll intervals
                # This catches edge cases where the background task gets stuck
                # Note: We don't call cleanup_background_task here because the task may
                # still be running in the background. The cleanup will happen when the
                # executor completes and sets a terminal status.
                if poll_count > max_poll_count:
                    timeout_minutes = config.timeout_seconds // 60
                    logger.error(f"[trace={trace_id}] Task {task_id} polling timed out after {poll_count} polls (should have been caught by thread pool timeout)")
                    writer(_ws({"type": "task_timed_out", "task_id": task_id}))
                    return f"Task polling timed out after {timeout_minutes} minutes. This may indicate the background task is stuck. Status: {result.status.value}"
        except asyncio.CancelledError:

            async def cleanup_when_done() -> None:
                max_cleanup_polls = max_poll_count
                cleanup_poll_count = 0

                while True:
                    result = get_background_task_result(task_id)
                    if result is None:
                        return

                    if result.status in {SubagentStatus.COMPLETED, SubagentStatus.FAILED, SubagentStatus.TIMED_OUT} or getattr(result, "completed_at", None) is not None:
                        cleanup_background_task(task_id)
                        return

                    if cleanup_poll_count > max_cleanup_polls:
                        logger.warning(f"[trace={trace_id}] Deferred cleanup for task {task_id} timed out after {cleanup_poll_count} polls")
                        return

                    await asyncio.sleep(5)
                    cleanup_poll_count += 1

            def log_cleanup_failure(cleanup_task: asyncio.Task[None]) -> None:
                if cleanup_task.cancelled():
                    return

                exc = cleanup_task.exception()
                if exc is not None:
                    logger.error(f"[trace={trace_id}] Deferred cleanup failed for task {task_id}: {exc}")

            logger.debug(f"[trace={trace_id}] Scheduling deferred cleanup for cancelled task {task_id}")
            asyncio.create_task(cleanup_when_done()).add_done_callback(log_cleanup_failure)
            raise

    if detach_effective:

        async def _detached_poll_runner() -> None:
            try:
                await _poll_subagent_to_completion()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "detached task_tool poll failed task_id=%s collab=%s sub=%s",
                    task_id,
                    resolved_collab,
                    resolved_subtask,
                )

        asyncio.create_task(
            _detached_poll_runner(),
            name=f"task_tool-detached-{str(task_id)[:24]}",
        )
        return "Task Detached. Background execution started for collab subtask."

    return await _poll_subagent_to_completion()


# ── Register task_tool delegate on collab_bridge at import time ─────────
# This allows supervisor/execution.py to delegate subtasks via this tool
# without directly importing task_tool (breaks circular dependency).
try:
    from deerflow.tools.builtins.collab_bridge import register_task_tool_delegate

    _coro_ref = getattr(task_tool, "coroutine", None)
    if _coro_ref is not None:
        register_task_tool_delegate(_coro_ref)
except Exception:
    logger.debug("collab_bridge: failed to register task_tool delegate", exc_info=True)
