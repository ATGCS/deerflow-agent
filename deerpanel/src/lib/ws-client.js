/**
 * DeerFlow 聊天客户端（HTTP/SSE 版本）
 * 兼容原 wsClient 的调用接口，彻底移除旧 ws-rpc 聊天链路。
 */

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const SESSION_MAP_KEY = 'deerflow-chat-session-map-v1'
const MAIN_SESSION_KEY = 'agent:main:main'

function nowTs() {
  return Date.now()
}

function safeParseJSON(raw, fallback) {
  try { return JSON.parse(raw) } catch { return fallback }
}

function loadSessionMap() {
  return safeParseJSON(localStorage.getItem(SESSION_MAP_KEY) || '{}', {})
}

function saveSessionMap(map) {
  localStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map || {}))
}

const DEFAULT_SESSION_CONTEXT = {
  thinking_enabled: true,
  is_plan_mode: false,
  subagent_enabled: false,
  reasoning_effort: undefined,
}

function threadTs(u) {
  if (typeof u === 'number' && !Number.isNaN(u)) return u
  if (typeof u === 'string') {
    const p = Date.parse(u)
    if (!Number.isNaN(p)) return p
  }
  return 0
}

function threadSearchUpdatedTs(t) {
  if (!t || typeof t !== 'object') return 0
  return threadTs(t.updated_at ?? t.updatedAt)
}

function threadSearchCreatedTs(t) {
  if (!t || typeof t !== 'object') return 0
  return threadTs(t.created_at ?? t.createdAt)
}

/** 与 Web 端 useThreads 一致：metadata.session_key；无主键时用 thread:${id} 占位 */
function sessionKeyFromSearchThread(t) {
  if (!t || typeof t !== 'object') return ''
  const meta = t.metadata && typeof t.metadata === 'object' ? t.metadata : {}
  const sk = meta.session_key ?? meta.sessionKey
  if (typeof sk === 'string' && sk.trim()) return sk.trim()
  const id = t.thread_id || t.threadId
  if (id) return `thread:${id}`
  return ''
}

function normalizeThreadsSearchResponse(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.threads)) return data.threads
  if (data && Array.isArray(data.items)) return data.items
  return []
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options)
  const text = await resp.text().catch(() => '')
  const data = text ? safeParseJSON(text, null) : null
  if (!resp.ok) {
    const msg = data?.detail || data?.error || data?.message || `HTTP ${resp.status}`
    throw new Error(msg)
  }
  return data
}

function extractAssistantText(message) {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter(x => x && x.type === 'text' && typeof x.text === 'string')
      .map(x => x.text)
      .join('\n')
  }
  if (typeof message.text === 'string') return message.text
  return ''
}

/** LangGraph 可能发累计全文或 token 小块：合并为单调增长的展示文本 */
function accumulateStreamAssistantText(prev, incoming) {
  if (incoming == null || incoming === '') return prev || ''
  const inc = typeof incoming === 'string' ? incoming : ''
  if (!inc) return prev || ''
  if (!prev) return inc
  if (inc.length >= prev.length && inc.startsWith(prev)) return inc
  return prev + inc
}

/** LangGraph 流式：AIMessageChunk / ai / assistant */
function isLangGraphStreamAiPart(m) {
  if (!m || typeof m !== 'object') return false
  const t = m.type
  return t === 'ai' || t === 'AIMessageChunk' || t === 'AIMessage' || m.role === 'assistant'
}

/**
 * 从单条流式消息取增量文本（content 可为 string 或 block 数组；数组里也可能混 string 块）
 */
function textFromLangGraphStreamPart(obj) {
  if (!obj || typeof obj !== 'object') return ''
  if (typeof obj.content === 'string') return obj.content
  if (!Array.isArray(obj.content)) return extractAssistantText(obj)
  return obj.content.map(part => {
    if (typeof part === 'string') return part
    if (part && part.type === 'text' && typeof part.text === 'string') return part.text
    return ''
  }).join('')
}

function textFromStreamAiPayload(obj) {
  return textFromLangGraphStreamPart(obj)
}

/**
 * LangGraph /messages/stream 常见形态：
 * - 数组元组（旧）
 * - 单条 { type: 'ai'|'tool', content, ... }（与 embedded client / 新版 SDK 一致）
 * - ['namespace', { type: 'ai', ... }]
 */
function unwrapMessagesTupleRoot(data) {
  if (Array.isArray(data) && data.length === 2 && typeof data[0] === 'string' && typeof data[1] === 'object' && data[1] !== null && !Array.isArray(data[1])) {
    const inner = data[1]
    if (inner.type || inner.role) return inner
  }
  return data
}

function isAssistantMessage(m) {
  if (!m || typeof m !== 'object') return false
  return m.role === 'assistant' || m.type === 'ai'
}

function isHumanMessage(m) {
  if (!m || typeof m !== 'object') return false
  return m.type === 'human' || m.role === 'user'
}

function isToolMessage(m) {
  if (!m || typeof m !== 'object') return false
  return m.role === 'tool' || m.type === 'tool'
}

function extractReasoningPreview(msg) {
  if (!msg) return null
  if (!isAssistantMessage(msg)) return null
  const ak = msg.additional_kwargs
  if (ak && typeof ak.reasoning_content === 'string' && ak.reasoning_content.trim()) {
    return ak.reasoning_content.trim().slice(0, 800)
  }
  if (Array.isArray(msg.content)) {
    const think = msg.content.find(p => p && p.type === 'thinking' && typeof p.thinking === 'string')
    if (think?.thinking?.trim()) return think.thinking.trim().slice(0, 800)
  }
  return null
}

function findAskClarification(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!isToolMessage(m)) continue
    const name = m.name || m.tool_name
    if (name !== 'ask_clarification') continue
    let preview = ''
    if (typeof m.content === 'string') preview = m.content
    else if (m.content != null) {
      try { preview = JSON.stringify(m.content) } catch { preview = String(m.content) }
    }
    return { toolCallId: m.tool_call_id, preview: preview.slice(0, 2000) }
  }
  return null
}

function deriveActivityFromMessages(messages) {
  const base = {
    kind: 'idle',
    detail: '',
    toolNames: [],
    reasoningPreview: null,
    clarification: null,
  }
  if (!Array.isArray(messages) || messages.length === 0) return base

  const clarification = findAskClarification(messages)
  if (clarification) {
    return {
      ...base,
      kind: 'clarification',
      detail: '模型正在等待你的选择或回复',
      clarification,
    }
  }

  let reasoningPreview = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!isAssistantMessage(m)) continue
    const tc = m.tool_calls
    if (Array.isArray(tc) && tc.length > 0) {
      const toolNames = tc.map(x => x?.name || x?.function?.name || 'tool').filter(Boolean)
      return {
        ...base,
        kind: 'tools',
        detail: toolNames.length ? `调用：${toolNames.join(' · ')}` : '调用工具…',
        toolNames,
      }
    }
    if (!reasoningPreview) {
      const r = extractReasoningPreview(m)
      if (r) reasoningPreview = r
    }
  }

  if (reasoningPreview) {
    return {
      ...base,
      kind: 'thinking',
      detail: '推理中',
      reasoningPreview,
    }
  }
  return base
}

/** 与 Web 版 values 事件对齐：扁平或 { values: {...} } */
function normalizeStreamValues(data) {
  if (!data || typeof data !== 'object') return { messages: [], todos: [], title: null }
  const raw = data.values && typeof data.values === 'object' ? data.values : data
  const messages = Array.isArray(raw.messages) ? raw.messages : []
  const todos = Array.isArray(raw.todos) ? raw.todos : []
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null
  return { messages, todos, title }
}

/** 完整状态（与 Web 版 values 快照一致） */
function emitThreadStateFull(self, key, runId, data) {
  const { messages, todos, title } = normalizeStreamValues(data)
  const act = deriveActivityFromMessages(messages)
  self._emitEvent('thread_state', {
    sessionKey: key,
    runId,
    partial: false,
    title,
    todos,
    activityKind: act.kind,
    activityDetail: act.detail,
    toolNames: act.toolNames || [],
    reasoningPreview: act.reasoningPreview,
    clarification: act.clarification,
  })
}

/** 流式中途仅有的 ask_clarification tool 片段（下一帧 values 会补全） */
function emitThreadStateClarify(self, key, runId, clarification) {
  if (!clarification) return
  self._emitEvent('thread_state', {
    sessionKey: key,
    runId,
    partial: true,
    activityKind: 'clarification',
    activityDetail: '模型正在等待你的选择或回复',
    clarification,
  })
}

export class WsClient {
  constructor() {
    this._eventListeners = []
    this._statusListeners = []
    this._readyCallbacks = []
    this._connected = false
    this._gatewayReady = false
    this._connecting = false
    this._sessionKey = MAIN_SESSION_KEY
    this._hello = {
      serverVersion: 'deerflow-http-sse',
      snapshot: { sessionDefaults: { mainSessionKey: MAIN_SESSION_KEY, defaultAgentId: 'main' } },
    }
    this._snapshot = this._hello.snapshot
    this._serverVersion = this._hello.serverVersion
    this._abortByRunId = new Map()
    this._latestRunBySession = new Map()
  }

  get connected() { return this._connected }
  get connecting() { return this._connecting }
  get gatewayReady() { return this._gatewayReady }
  get snapshot() { return this._snapshot }
  get hello() { return this._hello }
  get sessionKey() { return this._sessionKey }
  get serverVersion() { return this._serverVersion }

  onStatusChange(fn) {
    this._statusListeners.push(fn)
    return () => { this._statusListeners = this._statusListeners.filter(cb => cb !== fn) }
  }

  onReady(fn) {
    this._readyCallbacks.push(fn)
    return () => { this._readyCallbacks = this._readyCallbacks.filter(cb => cb !== fn) }
  }

  connect() {
    if (this._connected || this._connecting) return
    this._connecting = true
    this._setConnected(true, 'connected')
    this._gatewayReady = true
    this._connecting = false
    this._setConnected(true, 'ready')
    this._readyCallbacks.forEach(fn => {
      try { fn(this._hello, this._sessionKey) } catch {}
    })
  }

  disconnect() {
    for (const controller of this._abortByRunId.values()) {
      try { controller.abort() } catch {}
    }
    this._abortByRunId.clear()
    this._latestRunBySession.clear()
    this._gatewayReady = false
    this._setConnected(false)
  }

  reconnect() {
    this.disconnect()
    this.connect()
  }

  _setConnected(val, status, errorMsg) {
    this._connected = val
    const s = status || (val ? 'connected' : 'disconnected')
    this._statusListeners.forEach(fn => {
      try { fn(s, errorMsg) } catch (e) { console.error('[ws] status listener error:', e) }
    })
  }

  _emitEvent(event, payload) {
    const msg = { type: 'event', event, payload }
    this._eventListeners.forEach(fn => {
      try { fn(msg) } catch {}
    })
  }

  async _ensureThread(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    if (map[key]?.threadId) return map[key].threadId
    const created = await fetchJson('/api/langgraph/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { session_key: key } }),
    })
    const threadId = created?.thread_id || created?.threadId
    if (!threadId) throw new Error('创建会话失败：未返回 thread_id')
    map[key] = {
      threadId,
      createdAt: nowTs(),
      updatedAt: nowTs(),
      messageCount: 0,
      context: { ...DEFAULT_SESSION_CONTEXT },
    }
    saveSessionMap(map)
    return threadId
  }

  async chatSend(sessionKey, message, attachments) {
    const key = sessionKey || MAIN_SESSION_KEY
    const threadId = await this._ensureThread(key)
    const runId = uuid()
    const controller = new AbortController()
    this._abortByRunId.set(runId, controller)
    this._latestRunBySession.set(key, runId)

    const blocks = [{ type: 'text', text: message || '' }]
    if (Array.isArray(attachments) && attachments.length) {
      for (const att of attachments) {
        if (!att?.content) continue
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: att.mimeType || 'image/png',
            data: att.content,
          },
        })
      }
    }

    const map = loadSessionMap()
    const sessionContext = map[key]?.context || {}
    const defaultContext = {
      thinking_enabled: true,
      is_plan_mode: false,
      subagent_enabled: false,
      reasoning_effort: undefined,
    }

    const body = {
      assistant_id: 'lead_agent',
      input: { messages: [{ role: 'user', content: blocks }] },
      stream_mode: ['values', 'messages-tuple'],
      streamSubgraphs: true,
      streamResumable: true,
      config: {
        recursion_limit: 1000,
      },
      context: {
        ...defaultContext,
        ...sessionContext,
        thread_id: threadId,
      },
    }
    const started = nowTs()
    let finalText = ''

    /** LangGraph / SSE 规范使用 CRLF；用 split('\\n\\n') 永远切不开「\\r\\n\\r\\n」分隔的事件 */
    const takeCompleteSseFrames = (raw) => {
      const normalized = raw.replace(/\r\n/g, '\n')
      const parts = normalized.split('\n\n')
      const rest = parts.pop() ?? ''
      return { frames: parts, rest }
    }

    try {
      const resp = await fetch(`/api/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(text || `HTTP ${resp.status}`)
      }
      if (!resp.body) throw new Error('响应流为空')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const dispatchSseFrame = (frameText) => {
          const lines = frameText.split('\n')
          let dataRaw = ''
          let eventName = ''
          for (const line of lines) {
            const l = line.replace(/\r$/, '')
            if (l.startsWith('event:')) eventName = l.slice(6).trim()
            if (l.startsWith('data:')) dataRaw += l.slice(5).trim()
          }
          if (!dataRaw) return

          const data = safeParseJSON(dataRaw, null)
          if (!data) return

          if (eventName === 'values') {
            if (!data || typeof data !== 'object') return
            const { messages } = normalizeStreamValues(data)
            // 快照末尾若是本轮新 user，尚无 assistant：不能再取 reverse 到的「上一条 ai」，否则会把上一轮回答灌进当前气泡
            const last = messages.length ? messages[messages.length - 1] : null
            const text =
              last && isAssistantMessage(last) ? extractAssistantText(last) : ''
            if (text) {
              const next = accumulateStreamAssistantText(finalText, text)
              if (next !== finalText) {
                finalText = next
                this._emitEvent('chat', {
                  sessionKey: key,
                  runId,
                  state: 'delta',
                  message: { role: 'assistant', content: [{ type: 'text', text: finalText }] },
                })
              }
            }
            emitThreadStateFull(this, key, runId, data)
          } else if (eventName === 'messages' || eventName === 'messages-tuple') {
            const root = unwrapMessagesTupleRoot(data)

            const emitToolFromObj = (t, tupleToolId) => {
              if (!t || typeof t !== 'object') return
              this._emitEvent('chat', {
                sessionKey: key,
                runId,
                state: 'tool',
                data: t,
                toolCallId: t.tool_call_id ?? tupleToolId,
                name: t.name || t.tool_name || 'tool',
              })
              const tn = t.name || t.tool_name
              if (tn === 'ask_clarification') {
                let preview = ''
                if (typeof t.content === 'string') preview = t.content
                else if (t.content != null) {
                  try { preview = JSON.stringify(t.content) } catch { preview = String(t.content) }
                }
                emitThreadStateClarify(this, key, runId, {
                  toolCallId: t.tool_call_id,
                  preview: preview.slice(0, 2000),
                })
              }
            }

            const emitAssistantChunkIfNew = (piece) => {
              if (piece == null || piece === '') return
              const next = accumulateStreamAssistantText(finalText, piece)
              if (next === finalText) return
              finalText = next
              this._emitEvent('chat', {
                sessionKey: key,
                runId,
                state: 'delta',
                message: { role: 'assistant', content: [{ type: 'text', text: finalText }] },
              })
            }

            if (root && typeof root === 'object' && !Array.isArray(root)) {
              if (root.type === 'tool' || root.role === 'tool') {
                emitToolFromObj(root, root.tool_call_id)
              } else if (isLangGraphStreamAiPart(root)) {
                emitAssistantChunkIfNew(textFromLangGraphStreamPart(root))
              }
            } else if (Array.isArray(root)) {
              // LangGraph 1.x：["event: messages"] 常为 [AIMessageChunk, run 元数据]
              if (
                root.length === 2 &&
                isLangGraphStreamAiPart(root[0]) &&
                root[1] &&
                typeof root[1] === 'object' &&
                !Array.isArray(root[1]) &&
                (root[1].run_id != null || root[1].langgraph_step != null || root[1].langgraph_node != null)
              ) {
                emitAssistantChunkIfNew(textFromLangGraphStreamPart(root[0]))
              } else {
              for (const msg of root) {
                if (msg && typeof msg === 'object' && !Array.isArray(msg) && (msg.type || msg.role)) {
                  if (msg.type === 'tool' || msg.role === 'tool') {
                    emitToolFromObj(msg, msg.tool_call_id)
                  } else if (isLangGraphStreamAiPart(msg)) {
                    emitAssistantChunkIfNew(textFromLangGraphStreamPart(msg))
                  }
                } else if (Array.isArray(msg)) {
                  if (typeof msg[0] === 'object' && msg[0] !== null && 'content' in msg[0]) {
                    if (isLangGraphStreamAiPart(msg[0])) {
                      emitAssistantChunkIfNew(textFromLangGraphStreamPart(msg[0]))
                    } else if (msg[0].type === 'tool' || msg[0].role === 'tool') {
                      emitToolFromObj(msg[0], msg[0].tool_call_id)
                    }
                  } else if (msg?.[0] === 'ai' && typeof msg?.[1] === 'string') {
                    emitAssistantChunkIfNew(msg[1])
                  } else if (msg?.[0] === 'tool' && typeof msg?.[2] === 'object') {
                    emitToolFromObj(msg[2], msg[1])
                  }
                }
              }
              }
            } else if (root?.role === 'assistant' && typeof root.content === 'string') {
              emitAssistantChunkIfNew(root.content)
            }
          }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = takeCompleteSseFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          if (!frame.trim()) continue
          dispatchSseFrame(frame)
        }
      }
      if (buffer.trim()) {
        dispatchSseFrame(buffer.replace(/\r\n/g, '\n'))
      }

      this._emitEvent('chat', {
        sessionKey: key,
        runId,
        state: 'final',
        durationMs: nowTs() - started,
        message: { role: 'assistant', content: [{ type: 'text', text: finalText }] },
      })

      if (map[key]) {
        map[key].updatedAt = nowTs()
        map[key].messageCount = (map[key].messageCount || 0) + 2
        saveSessionMap(map)
      }
      return { ok: true, runId }
    } catch (err) {
      if (controller.signal.aborted) {
        this._emitEvent('chat', { sessionKey: key, runId, state: 'aborted' })
        return { ok: true, aborted: true, runId }
      }
      this._emitEvent('chat', {
        sessionKey: key,
        runId,
        state: 'error',
        errorMessage: err?.message || '请求失败',
      })
      throw err
    } finally {
      this._abortByRunId.delete(runId)
    }
  }

  async chatHistory(sessionKey, limit = 200) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    const threadId = map[key]?.threadId
    if (!threadId) return { messages: [], valuesSnapshot: null }
    const state = await fetchJson(`/api/langgraph/threads/${encodeURIComponent(threadId)}/state`)
    const values = state?.values && typeof state.values === 'object' ? state.values : null
    const messages = Array.isArray(values?.messages) ? values.messages : []
    const result = messages.slice(-Math.max(1, limit))
    // 仅拉历史不要用「当前时间」刷 updatedAt，否则下次列表排序会把刚点过的会话顶来顶去
    map[key].messageCount = messages.length
    saveSessionMap(map)
    return { messages: result, valuesSnapshot: values }
  }

  chatAbort(sessionKey, runId) {
    const key = sessionKey || MAIN_SESSION_KEY
    const targetRunId = runId || this._latestRunBySession.get(key)
    if (!targetRunId) return Promise.resolve({ ok: true, aborted: false })
    const controller = this._abortByRunId.get(targetRunId)
    if (controller) {
      try { controller.abort() } catch {}
      this._abortByRunId.delete(targetRunId)
    }
    this._emitEvent('chat', { sessionKey: key, runId: targetRunId, state: 'aborted' })
    return Promise.resolve({ ok: true, aborted: true, runId: targetRunId })
  }

  async sessionsList(limit = 50) {
    try {
      const cap = Math.max(Number(limit) || 50, 80)
      await this._mergeRemoteThreadsIntoSessionMap(cap)
    } catch (e) {
      console.warn('[ws-client] threads/search 同步失败，使用本地会话映射', e?.message || e)
    }
    const map = loadSessionMap()
    const sessions = Object.entries(map).map(([key, meta]) => ({
      sessionKey: key,
      key,
      createdAt: meta.createdAt || 0,
      updatedAt: meta.updatedAt || meta.createdAt || 0,
      messageCount: meta.messageCount || 0,
    }))
    if (!sessions.find(s => s.sessionKey === MAIN_SESSION_KEY)) {
      sessions.push({
        sessionKey: MAIN_SESSION_KEY,
        key: MAIN_SESSION_KEY,
        createdAt: nowTs(),
        updatedAt: nowTs(),
        messageCount: 0,
      })
    }
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return { sessions: sessions.slice(0, Math.max(1, limit)) }
  }

  async sessionsDelete(key) {
    if (!key || key === MAIN_SESSION_KEY) throw new Error('主会话不能删除')
    const map = loadSessionMap()
    const threadId = map[key]?.threadId
    delete map[key]
    saveSessionMap(map)
    if (threadId) {
      await fetch(`/api/langgraph/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }).catch(() => {})
      await fetch(`/api/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }).catch(() => {})
    }
    return { ok: true }
  }

  async sessionsReset(key) {
    const sessionKey = key || MAIN_SESSION_KEY
    const map = loadSessionMap()
    const oldThread = map[sessionKey]?.threadId
    const oldContext = map[sessionKey]?.context
    if (oldThread) {
      await fetch(`/api/langgraph/threads/${encodeURIComponent(oldThread)}`, { method: 'DELETE' }).catch(() => {})
      await fetch(`/api/threads/${encodeURIComponent(oldThread)}`, { method: 'DELETE' }).catch(() => {})
    }
    const created = await fetchJson('/api/langgraph/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { session_key: sessionKey } }),
    })
    const threadId = created?.thread_id || created?.threadId
    if (!threadId) throw new Error('重置会话失败：未返回 thread_id')
    map[sessionKey] = {
      threadId,
      createdAt: map[sessionKey]?.createdAt || nowTs(),
      updatedAt: nowTs(),
      messageCount: 0,
      context: oldContext || { ...DEFAULT_SESSION_CONTEXT },
    }
    saveSessionMap(map)
    return { ok: true, threadId }
  }

  updateSessionContext(sessionKey, context) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    if (!map[key]) {
      map[key] = { context: { ...DEFAULT_SESSION_CONTEXT } }
    }
    map[key].context = {
      ...(map[key].context || {}),
      ...context,
    }
    saveSessionMap(map)
  }

  getSessionContext(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    return map[key]?.context || { ...DEFAULT_SESSION_CONTEXT }
  }

  /**
   * 与 Web RecentChatList / useThreads 对齐：POST threads/search，把服务端线程写回本地 session↔thread 映射。
   * 解决仅依赖 localStorage 时刷新丢映射、列表空、历史拉不到的问题。
   */
  async _mergeRemoteThreadsIntoSessionMap(maxResults = 80) {
    const pageSize = 50
    let offset = 0
    const collected = []
    while (collected.length < maxResults) {
      const batch = Math.min(pageSize, maxResults - collected.length)
      const bodies = [
        { limit: batch, offset, sortBy: 'updated_at', sortOrder: 'desc' },
        { limit: batch, offset, sort_by: 'updated_at', sort_order: 'desc' },
      ]
      let page = []
      let lastErr = null
      for (const body of bodies) {
        try {
          const raw = await fetchJson('/api/langgraph/threads/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          page = normalizeThreadsSearchResponse(raw)
          lastErr = null
          break
        } catch (e) {
          lastErr = e
        }
      }
      if (lastErr) throw lastErr
      if (!page.length) break
      collected.push(...page)
      offset += page.length
      if (page.length < batch) break
    }

    const map = loadSessionMap()
    /** @type {Map<string, { tid: string, updated: number, thread: object }>} */
    const best = new Map()
    for (const t of collected) {
      const sk = sessionKeyFromSearchThread(t)
      const tid = t.thread_id || t.threadId
      if (!sk || !tid) continue
      const updated = threadSearchUpdatedTs(t)
      const cur = best.get(sk)
      if (!cur || updated >= cur.updated) {
        best.set(sk, { tid, updated, thread: t })
      }
    }
    for (const { tid, updated, thread: t } of best.values()) {
      const sk = sessionKeyFromSearchThread(t)
      const values = t.values && typeof t.values === 'object' ? t.values : {}
      const msgs = Array.isArray(values.messages) ? values.messages : []
      const prev = map[sk] || {}
      map[sk] = {
        threadId: tid,
        createdAt: prev.createdAt || threadSearchCreatedTs(t) || nowTs(),
        updatedAt: Math.max(prev.updatedAt || 0, updated || 0),
        messageCount: msgs.length || prev.messageCount || 0,
        context: prev.context && typeof prev.context === 'object'
          ? { ...DEFAULT_SESSION_CONTEXT, ...prev.context }
          : { ...DEFAULT_SESSION_CONTEXT },
      }
    }
    saveSessionMap(map)
  }

  async request(method, params = {}) {
    if (method === 'sessions.usage') {
      const map = loadSessionMap()
      const rows = Object.entries(map).map(([key, meta]) => ({
        key,
        sessionKey: key,
        updatedAt: meta.updatedAt || 0,
        messageCount: meta.messageCount || 0,
      }))
      return { sessions: rows }
    }
    throw new Error(`旧 RPC 已移除: ${method}`)
  }

  onEvent(callback) {
    this._eventListeners.push(callback)
    return () => { this._eventListeners = this._eventListeners.filter(fn => fn !== callback) }
  }
}

/** 供历史加载/外部同步：从 LangGraph checkpoint values 生成左栏状态 */
export function threadStatePayloadFromValues(sessionKey, values) {
  if (!values || typeof values !== 'object') return null
  const { messages, todos, title } = normalizeStreamValues(values)
  const act = deriveActivityFromMessages(messages)
  return {
    sessionKey,
    runId: null,
    partial: false,
    title,
    todos,
    activityKind: act.kind,
    activityDetail: act.detail,
    toolNames: act.toolNames || [],
    reasoningPreview: act.reasoningPreview,
    clarification: act.clarification,
  }
}

const _g = typeof window !== 'undefined' ? window : globalThis
if (!_g.__clawpanelWsClient) _g.__clawpanelWsClient = new WsClient()
export const wsClient = _g.__clawpanelWsClient
