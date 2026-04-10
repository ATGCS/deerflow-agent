/**
 * 从流式/最终消息中的工具列表解析协作任务侧栏状态（supervisor 多步调用）。
 * 与 ChatApp 流式 tool / delta 同步，create_task 有结果后即可展示主任务。
 */

import { SUPERVISOR_ACTION_ZH } from './tool-display.js'

function parseToolInputObject(input) {
  if (input == null) return null
  if (typeof input === 'object') return input
  if (typeof input === 'string') {
    const t = input.trim()
    if (!t || t === '{}' || t === '[]') return null
    try {
      const p = JSON.parse(t)
      return typeof p === 'object' && p !== null ? p : null
    } catch {
      return null
    }
  }
  return null
}

function parseToolOutputObject(output) {
  if (output == null) return null
  if (typeof output === 'object') return output
  if (typeof output === 'string') {
    const t = output.trim()
    if (!t) return null
    try {
      const p = JSON.parse(t)
      return typeof p === 'object' && p !== null ? p : null
    } catch {
      return null
    }
  }
  return null
}

function isSupervisorLikeTool(name) {
  const n = String(name || '').trim().toLowerCase()
  return n === 'supervisor' || n === 'task_tool' || n === 'task'
}

/**
 * 工具是否已有「可合并进侧栏」的完整 JSON。
 * start_execution：若 success 为 true 但尚未带回 delegatedSubtasks，视为仍在执行中（便于先根据入参显示转圈）。
 */
function toolOutputLooksComplete(output, input) {
  const o = parseToolOutputObject(output)
  if (!o || typeof o !== 'object') return false
  if ('success' in o && o.success === false) return false
  const ia = input && typeof input === 'object' && typeof input.action === 'string' ? input.action.trim() : ''
  const oa = typeof o.action === 'string' ? o.action.trim() : ''
  const act = ia || oa
  if (act === 'start_execution' && o.success === true) {
    if (!Array.isArray(o.delegatedSubtasks)) return false
  }
  return true
}

function stepLabel(action) {
  const zh = action && SUPERVISOR_ACTION_ZH[action]
  return zh ? `任务调度 · ${zh}` : `任务调度 · ${action || '调度'}`
}

/**
 * @param {unknown[]} tools
 * @returns {{ main: object | null, subtasks: object[], supervisorSteps: object[] }}
 */
export function buildCollabSidebarFromTools(tools) {
  /** @type {Record<string, unknown> | null} */
  let main = null
  /** @type {Map<string, Record<string, unknown>>} */
  const subtasksMap = new Map()
  /** @type {Array<{ id: string, action: string, label: string, done: boolean }>} */
  const supervisorSteps = []

  if (!Array.isArray(tools)) {
    return { main: null, subtasks: [], supervisorSteps: [] }
  }

  for (const tool of tools) {
    const t = tool && typeof tool === 'object' ? tool : {}
    const name = String(t.name || '')
    if (!isSupervisorLikeTool(name)) continue

    const input = parseToolInputObject(t.input)
    const output = parseToolOutputObject(t.output)
    const action = input && typeof input.action === 'string' ? input.action.trim() : ''
    const toolId = String(t.id || t.tool_call_id || `step-${supervisorSteps.length}`)
    const done = toolOutputLooksComplete(t.output, input)

    supervisorSteps.push({
      id: toolId,
      action,
      label: stepLabel(action),
      done,
    })

    // start_execution：工具尚未返回 delegatedSubtasks 时，根据入参先把对应子任务标为执行中（转圈）
    if (!done && input && typeof input === 'object') {
      const earlyAction = typeof input.action === 'string' ? input.action.trim() : ''
      if (earlyAction === 'start_execution') {
        const tid = String(input.task_id || input.taskId || '').trim()
        const rawIds = input.subtask_ids ?? input.subtaskIds
        const ids = Array.isArray(rawIds) ? rawIds : []
        for (const raw of ids) {
          const sid = String(raw || '').trim()
          if (!sid) continue
          const prev = subtasksMap.get(sid) || {}
          subtasksMap.set(sid, {
            ...prev,
            subtaskId: sid,
            ...(tid ? { parentTaskId: tid } : {}),
            status: 'in_progress',
          })
        }
        if (tid) {
          if (main && String(main.taskId || '').trim() === tid) {
            main = { ...main, status: 'running' }
          } else if (!main || !String(main.taskId || '').trim()) {
            main = { ...(main || {}), taskId: tid, status: 'running' }
          }
        }
      }
    }

    if (!done || !output || typeof output !== 'object') continue

    const o = output

    if (action === 'create_task') {
      const taskId = String(o.taskId || o.id || o.task_id || '')
      if (taskId) {
        const projectId = String(o.projectId || o.project_id || o.parent_project_id || '').trim()
        main = {
          taskId,
          ...(projectId ? { projectId } : {}),
          ...(typeof o.name === 'string' ? { name: o.name } : {}),
          ...(typeof o.status === 'string' ? { status: o.status } : {}),
          ...(typeof o.progress === 'number' ? { progress: o.progress } : {}),
        }
      }
    }

    if (action === 'create_subtask') {
      const sid = String(o.subtaskId || o.subtask_id || o.id || '')
      const parentTaskId = String(o.parentTaskId || o.task_id || (input && input.task_id) || '')
      if (sid) {
        const prev = subtasksMap.get(sid) || {}
        const assignedFromOut =
          typeof o.assignedTo === 'string'
            ? o.assignedTo.trim()
            : typeof o.assigned_to === 'string'
              ? o.assigned_to.trim()
              : ''
        subtasksMap.set(sid, {
          ...prev,
          subtaskId: sid,
          ...(parentTaskId ? { parentTaskId } : {}),
          ...(typeof o.name === 'string' ? { name: o.name } : {}),
          ...(typeof o.description === 'string' ? { description: o.description } : {}),
          ...(typeof o.status === 'string' ? { status: o.status } : {}),
          ...(typeof o.progress === 'number' ? { progress: o.progress } : {}),
          ...(assignedFromOut ? { assignedAgent: assignedFromOut } : {}),
        })
      }
    }

    if (action === 'create_subtasks') {
      const created = Array.isArray(o.created) ? o.created : []
      for (const row of created) {
        if (!row || typeof row !== 'object') continue
        const r = row
        const sid = String(r.subtaskId || r.subtask_id || r.id || '')
        const parentTaskId = String(r.parentTaskId || r.task_id || (input && input.task_id) || '')
        if (!sid) continue
        const prev = subtasksMap.get(sid) || {}
        const assignedFromOut =
          typeof r.assignedTo === 'string'
            ? r.assignedTo.trim()
            : typeof r.assigned_to === 'string'
              ? r.assigned_to.trim()
              : ''
        subtasksMap.set(sid, {
          ...prev,
          subtaskId: sid,
          ...(parentTaskId ? { parentTaskId } : {}),
          ...(typeof r.name === 'string' ? { name: r.name } : {}),
          ...(typeof r.description === 'string' ? { description: r.description } : {}),
          ...(typeof r.status === 'string' ? { status: r.status } : {}),
          ...(typeof r.progress === 'number' ? { progress: r.progress } : {}),
          ...(assignedFromOut ? { assignedAgent: assignedFromOut } : {}),
        })
      }
    }

    if (action === 'assign_subtask') {
      const sid = String(o.subtaskId || o.subtask_id || (input && input.subtask_id) || '')
      const assigned = String(o.assignedTo || (input && input.assigned_agent) || '')
      if (sid) {
        const prev = subtasksMap.get(sid) || { subtaskId: sid }
        subtasksMap.set(sid, {
          ...prev,
          subtaskId: sid,
          ...(assigned ? { assignedAgent: assigned } : {}),
        })
      }
    }

    if (action === 'complete_subtask') {
      const sid = String(o.subtaskId || o.subtask_id || (input && input.subtask_id) || '')
      if (sid) {
        const prev = subtasksMap.get(sid) || { subtaskId: sid }
        subtasksMap.set(sid, {
          ...prev,
          subtaskId: sid,
          status: 'completed',
          progress: 100,
        })
      }
    }

    if (action === 'start_execution') {
      const tid = String(o.taskId || o.task_id || (input && input.task_id) || '')
      if (tid) {
        if (main && main.taskId === tid) {
          main = { ...main, status: o.status && typeof o.status === 'string' ? o.status : 'running' }
        } else {
          main = {
            ...(main || {}),
            taskId: tid,
            status: typeof o.status === 'string' ? o.status : 'running',
          }
        }
      }

      // start_execution 可能直接带回 delegatedSubtasks（每个子任务的执行结果）
      const delegated = Array.isArray(o.delegatedSubtasks) ? o.delegatedSubtasks : []
      for (const row of delegated) {
        if (!row || typeof row !== 'object') continue
        const r = row
        const sid = String(r.subtaskId || r.subtask_id || '')
        if (!sid) continue
        const detached = r.detached === true
        const ok = r.ok === true
        const prev = subtasksMap.get(sid) || { subtaskId: sid, parentTaskId: tid || undefined }
        subtasksMap.set(sid, {
          ...prev,
          subtaskId: sid,
          ...(tid ? { parentTaskId: tid } : {}),
          // 异步（detached=true）代表仍在后台跑：绝不能在 UI 里标为 completed/failed
          status: detached ? 'executing' : ok ? 'completed' : 'failed',
          progress: ok ? 100 : typeof prev.progress === 'number' ? prev.progress : 0,
        })
      }

      // 若明确全部成功，主任务直接标记为完成
      // 注意：异步模式下 delegatedSubtasks 可能都是 detached，此时不能提前 completed
      if (o.delegationAllSucceeded === true && main && main.taskId === tid && delegated.every((x) => x && typeof x === 'object' && x.detached !== true)) {
        main = { ...main, status: 'completed', progress: 100 }
      }
    }

    if (action === 'update_progress') {
      const tid = String(o.taskId || o.task_id || (input && input.task_id) || '')
      const sid = String(o.subtaskId || o.subtask_id || (input && input.subtask_id) || '')
      const prog = typeof o.progress === 'number' ? o.progress : undefined
      const st = typeof o.status === 'string' ? o.status : undefined
      if (sid && subtasksMap.has(sid)) {
        const prev = subtasksMap.get(sid)
        subtasksMap.set(sid, {
          ...prev,
          ...(prog !== undefined ? { progress: prog } : {}),
          ...(st ? { status: st } : {}),
        })
      } else if (tid && main && main.taskId === tid) {
        main = {
          ...main,
          ...(prog !== undefined ? { progress: prog } : {}),
          ...(st ? { status: st } : {}),
        }
      }
    }
  }

  return {
    main,
    subtasks: Array.from(subtasksMap.values()),
    supervisorSteps,
  }
}
