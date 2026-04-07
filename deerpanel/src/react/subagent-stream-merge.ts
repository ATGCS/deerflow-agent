import type { SubagentStreamTask } from './chat-types.js'

const LIVE_CAP = 65536
const HINT_LEN = 600

function textFromLangGraphMessage(msg: unknown, maxLen: number): string {
  if (msg == null) return ''
  if (typeof msg === 'string') return msg.slice(0, maxLen)
  if (typeof msg !== 'object') return String(msg).slice(0, maxLen)
  const m = msg as Record<string, unknown>
  const c = m.content
  if (typeof c === 'string') return c.slice(0, maxLen)
  if (Array.isArray(c)) {
    let s = ''
    for (const b of c) {
      if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text') {
        const t = (b as Record<string, unknown>).text
        if (typeof t === 'string') s += t
      }
    }
    return s.slice(0, maxLen)
  }
  return ''
}

const ARGS_PREVIEW = 6000

function stringifyArgs(args: unknown): string {
  if (args == null) return ''
  if (typeof args === 'string') return args.slice(0, ARGS_PREVIEW)
  try {
    return JSON.stringify(args, null, 2).slice(0, ARGS_PREVIEW)
  } catch {
    return String(args).slice(0, ARGS_PREVIEW)
  }
}

function upsertToolItem(tools: unknown[], next: Record<string, unknown>) {
  const id = String(next.id || next.tool_call_id || '')
  if (!id) {
    tools.push(next)
    return
  }
  const idx = tools.findIndex((t) => {
    const o = t as Record<string, unknown>
    return String(o.id || o.tool_call_id || '') === id
  })
  if (idx < 0) tools.push(next)
  else tools[idx] = { ...(tools[idx] as Record<string, unknown>), ...next }
}

function mergeToolsFromLangGraphMessage(cur: unknown[] | undefined, msg: unknown): unknown[] | undefined {
  if (typeof msg !== 'object' || msg == null) return cur
  const m = msg as Record<string, unknown>
  let tools = cur ? [...cur] : []

  // AIMessage.tool_calls
  const rawCalls = m.tool_calls
  if (Array.isArray(rawCalls)) {
    for (const item of rawCalls) {
      if (!item || typeof item !== 'object') continue
      const tc = item as Record<string, unknown>
      const id = typeof tc.id === 'string' ? tc.id : ''
      const name = typeof tc.name === 'string' ? tc.name : 'tool'
      upsertToolItem(tools, {
        id,
        tool_call_id: id,
        name,
        input: tc.args ?? null,
        status: 'running',
      })
    }
  }

  // ToolMessage（工具返回）
  if (m.type === 'tool') {
    const id = typeof m.tool_call_id === 'string' ? m.tool_call_id : ''
    const name = typeof m.name === 'string' ? m.name : 'tool'
    const raw = m.content
    const output = typeof raw === 'string' ? raw.slice(0, 12000) : stringifyArgs(raw).slice(0, 12000)
    upsertToolItem(tools, {
      id,
      tool_call_id: id,
      name,
      output,
      status: 'completed',
    })
  }
  return tools.length ? tools : cur
}

/** 单条消息：仅提取 AI 文本（工具调用与工具结果改走 ToolCallList） */
function liveChunkFromLangGraphMessage(msg: unknown, maxTextLen: number): string {
  if (typeof msg !== 'object' || msg === null) {
    return textFromLangGraphMessage(msg, maxTextLen).trim()
  }
  const m = msg as Record<string, unknown>
  if (m.type === 'tool') return ''
  return textFromLangGraphMessage(msg, maxTextLen).trim()
}

function appendLive(cur: string | undefined, chunk: string): string {
  if (!chunk) return cur || ''
  const sep = cur ? '\n\n───\n\n' : ''
  let next = (cur || '') + sep + chunk
  if (next.length > LIVE_CAP) next = next.slice(-LIVE_CAP)
  return next
}

function stringifyResult(res: unknown, maxLen: number): string {
  if (res == null) return ''
  if (typeof res === 'string') return res.slice(0, maxLen)
  try {
    return JSON.stringify(res).slice(0, maxLen)
  } catch {
    return String(res).slice(0, maxLen)
  }
}

/** 将后端 task_tool writer 单条事件合并进按 task_id 聚合的映射（就地修改） */
export function mergeSubagentStreamEvent(
  map: Record<string, SubagentStreamTask>,
  ev: Record<string, unknown>,
): void {
  const type = ev.type
  if (
    type !== 'task_started' &&
    type !== 'task_running' &&
    type !== 'task_completed' &&
    type !== 'task_failed' &&
    type !== 'task_timed_out'
  ) {
    return
  }
  const taskId = typeof ev.task_id === 'string' ? ev.task_id.trim() : ''
  if (!taskId) return

  const cur = map[taskId] || {
    taskId,
    phase: 'running' as const,
    startedAt: Date.now(),
  }

  const subagentFromEv =
    typeof ev.subagent_type === 'string' && ev.subagent_type.trim()
      ? ev.subagent_type.trim()
      : undefined

  if (type === 'task_started') {
    const description = typeof ev.description === 'string' ? ev.description : undefined
    map[taskId] = {
      ...cur,
      taskId,
      description: description ?? cur.description,
      subagentType: subagentFromEv ?? cur.subagentType,
      phase: 'running',
      startedAt: cur.startedAt ?? Date.now(),
    }
    return
  }

  if (type === 'task_running') {
    const chunk = liveChunkFromLangGraphMessage(ev.message, 32000)
    const tools = mergeToolsFromLangGraphMessage(cur.tools, ev.message)
    const mi = typeof ev.message_index === 'number' ? ev.message_index : undefined
    const tm = typeof ev.total_messages === 'number' ? ev.total_messages : undefined
    const liveOutput = appendLive(cur.liveOutput, chunk)
    const hintTail = chunk.slice(-HINT_LEN) || cur.progressHint
    map[taskId] = {
      ...cur,
      taskId,
      phase: 'running',
      subagentType: subagentFromEv ?? cur.subagentType,
      tools,
      progressHint: hintTail || cur.progressHint,
      messageIndex: mi ?? cur.messageIndex,
      totalMessages: tm ?? cur.totalMessages,
      liveOutput,
      startedAt: cur.startedAt ?? Date.now(),
    }
    return
  }

  if (type === 'task_completed') {
    const tail = stringifyResult(ev.result, 12000).trim()
    const prev = (cur.liveOutput || '').trim()
    // 避免最终 result 与最后一条模型输出重复再拼一整段
    let liveOutput = cur.liveOutput
    if (tail) {
      const redundant =
        prev.length > 0 &&
        (prev.includes(tail) ||
          (tail.length > 80 && prev.slice(-Math.min(tail.length, prev.length)) === tail))
      if (!redundant) {
        liveOutput = appendLive(cur.liveOutput, `【完成】\n${tail}`)
      } else if (!prev.includes('【完成】')) {
        liveOutput = appendLive(cur.liveOutput, '【完成】')
      }
    }
    map[taskId] = {
      ...cur,
      taskId,
      phase: 'completed',
      subagentType: subagentFromEv ?? cur.subagentType,
      tools: (cur.tools || []).map((t) => {
        const o = t as Record<string, unknown>
        if (o.status === 'running' || o.status == null) return { ...o, status: 'completed' }
        return o
      }),
      liveOutput,
      startedAt: cur.startedAt ?? Date.now(),
    }
    return
  }

  if (type === 'task_failed') {
    const err = typeof ev.error === 'string' ? ev.error : 'failed'
    map[taskId] = {
      ...cur,
      taskId,
      phase: 'failed',
      subagentType: subagentFromEv ?? cur.subagentType,
      tools: (cur.tools || []).map((t) => {
        const o = t as Record<string, unknown>
        if (o.status === 'running' || o.status == null) return { ...o, status: 'error' }
        return o
      }),
      error: err,
      startedAt: cur.startedAt ?? Date.now(),
    }
    return
  }

  if (type === 'task_timed_out') {
    const err = typeof ev.error === 'string' ? ev.error : 'timed out'
    map[taskId] = {
      ...cur,
      taskId,
      phase: 'timed_out',
      subagentType: subagentFromEv ?? cur.subagentType,
      tools: (cur.tools || []).map((t) => {
        const o = t as Record<string, unknown>
        if (o.status === 'running' || o.status == null) return { ...o, status: 'error' }
        return o
      }),
      error: err,
      startedAt: cur.startedAt ?? Date.now(),
    }
  }
}
