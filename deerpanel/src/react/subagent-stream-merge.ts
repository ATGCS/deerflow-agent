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
      if (typeof b === 'string') {
        s += b
        continue
      }
      if (b && typeof b === 'object') {
        const bb = b as Record<string, unknown>
        const ty = String(bb.type || '').toLowerCase()
        if (ty === 'text') {
          const t = bb.text
          if (typeof t === 'string') s += t
        }
      }
    }
    return s.slice(0, maxLen)
  }
  return ''
}

/** LangChain JSON / httpx 序列化常见：顶层带 kwargs */
function flattenLangChainMessage(msg: unknown): unknown {
  if (typeof msg !== 'object' || msg == null) return msg
  const m = msg as Record<string, unknown>
  const kw = m.kwargs
  if (kw && typeof kw === 'object' && !Array.isArray(kw)) {
    const k = kw as Record<string, unknown>
    return {
      ...m,
      type: m.type ?? k.type,
      content: m.content ?? k.content,
      role: m.role ?? k.role,
      name: m.name ?? k.name,
      tool_call_id: m.tool_call_id ?? k.tool_call_id,
      tool_calls: m.tool_calls ?? k.tool_calls,
    }
  }
  return msg
}

const TOOL_LIVE_PREVIEW = 420

/** 工具结果也写入 liveOutput，避免侧栏一直卡在「工具过程」而看不到检索主题/后续模型段 */
function toolMessageLivePreview(m: Record<string, unknown>, maxLen: number): string {
  const raw = m.content
  const s =
    typeof raw === 'string'
      ? raw
      : raw != null
        ? (() => {
            try {
              return JSON.stringify(raw)
            } catch {
              return String(raw)
            }
          })()
        : ''
  const oneLine = s.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  try {
    const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw))
    if (parsed && typeof parsed === 'object') {
      const q = (parsed as Record<string, unknown>).query
      if (typeof q === 'string' && q.trim()) {
        const t = q.trim().slice(0, 220)
        return t.length < q.trim().length ? `搜索：${t}…` : `搜索：${t}`
      }
      const err = (parsed as Record<string, unknown>).error
      if (typeof err === 'string' && err.trim()) {
        const t = err.trim().slice(0, 200)
        return t.length < err.trim().length ? `工具：${t}…` : `工具：${t}`
      }
    }
  } catch {
    // 非 JSON，走截断全文
  }
  return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine
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
  const flat = flattenLangChainMessage(msg)
  if (typeof flat !== 'object' || flat == null) return cur
  const m = flat as Record<string, unknown>
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

/** task_running 单条消息 → 写入 liveOutput 的片段（含工具返回摘要 + 模型正文） */
function liveChunkFromStreamMessage(msg: unknown, maxTextLen: number): string {
  const flat = flattenLangChainMessage(msg)
  if (typeof flat !== 'object' || flat === null) {
    return textFromLangGraphMessage(flat, maxTextLen).trim()
  }
  const m = flat as Record<string, unknown>
  const kind = String(m.type || m.role || '').toLowerCase()
  if (kind === 'tool') {
    return toolMessageLivePreview(m, Math.min(TOOL_LIVE_PREVIEW, maxTextLen))
  }
  return textFromLangGraphMessage(m, maxTextLen).trim()
}

const LIVE_SEGMENT_SEP = '\n\n───\n\n'

/** 与上一段内容相同则不再追加（custom 通道 + project SSE 双源、或轮询重复投递会导致成对重复） */
function appendLive(cur: string | undefined, chunk: string): string {
  const c = chunk.trim()
  if (!c) return cur || ''
  const base = cur || ''
  const lastSeg = base.includes(LIVE_SEGMENT_SEP)
    ? (base.split(LIVE_SEGMENT_SEP).pop() || '').trim()
    : base.trim()
  if (lastSeg === c) return base
  const sep = base ? LIVE_SEGMENT_SEP : ''
  let next = base + sep + chunk
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

  const collabSubtaskId =
    typeof ev.collab_subtask_id === 'string' && ev.collab_subtask_id.trim()
      ? ev.collab_subtask_id.trim()
      : typeof ev.collabSubtaskId === 'string' && ev.collabSubtaskId.trim()
        ? ev.collabSubtaskId.trim()
        : undefined

  const subagentFromEv =
    typeof ev.subagent_type === 'string' && ev.subagent_type.trim()
      ? ev.subagent_type.trim()
      : undefined

  if (type === 'task_started') {
    const description = typeof ev.description === 'string' ? ev.description : undefined
    map[taskId] = {
      ...cur,
      taskId,
      collabSubtaskId: collabSubtaskId ?? cur.collabSubtaskId,
      description: description ?? cur.description,
      subagentType: subagentFromEv ?? cur.subagentType,
      phase: 'running',
      startedAt: cur.startedAt ?? Date.now(),
    }
    return
  }

  if (type === 'task_running') {
    const chunk = liveChunkFromStreamMessage(ev.message, 32000)
    const tools = mergeToolsFromLangGraphMessage(cur.tools, ev.message)
    const mi = typeof ev.message_index === 'number' ? ev.message_index : undefined
    const tm = typeof ev.total_messages === 'number' ? ev.total_messages : undefined
    const prevLive = cur.liveOutput || ''
    const liveOutput = appendLive(prevLive, chunk)
    const hintTail =
      liveOutput === prevLive && chunk.trim()
        ? cur.progressHint
        : chunk.slice(-HINT_LEN) || cur.progressHint
    map[taskId] = {
      ...cur,
      taskId,
      collabSubtaskId: collabSubtaskId ?? cur.collabSubtaskId,
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
      collabSubtaskId: collabSubtaskId ?? cur.collabSubtaskId,
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
      collabSubtaskId: collabSubtaskId ?? cur.collabSubtaskId,
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
      collabSubtaskId: collabSubtaskId ?? cur.collabSubtaskId,
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
