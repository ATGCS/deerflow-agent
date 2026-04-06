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

/** 工具已有可展示的 JSON 结果（流式返回完成） */
function toolOutputLooksComplete(output) {
  const o = parseToolOutputObject(output)
  if (!o || typeof o !== 'object') return false
  if ('success' in o && o.success === false) return false
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
    const done = toolOutputLooksComplete(t.output)

    supervisorSteps.push({
      id: toolId,
      action,
      label: stepLabel(action),
      done,
    })

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
        subtasksMap.set(sid, {
          ...prev,
          subtaskId: sid,
          ...(parentTaskId ? { parentTaskId } : {}),
          ...(typeof o.name === 'string' ? { name: o.name } : {}),
          ...(typeof o.description === 'string' ? { description: o.description } : {}),
          ...(typeof o.status === 'string' ? { status: o.status } : {}),
          ...(typeof o.progress === 'number' ? { progress: o.progress } : {}),
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
