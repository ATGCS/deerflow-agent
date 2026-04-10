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

function makeFormattedId(prefix) {
  const d = new Date()
  const ts = [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
    String(d.getUTCHours()).padStart(2, '0'),
    String(d.getUTCMinutes()).padStart(2, '0'),
    String(d.getUTCSeconds()).padStart(2, '0'),
  ].join('')
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
  const p = String(prefix || 'ID').trim() || 'ID'
  return `${p}_${ts}_${rand}`
}

const SESSION_MAP_KEY = 'deerflow-chat-session-map-v1'
const MAIN_SESSION_KEY = 'agent:main:main'
const VIRTUAL_PATH_MODE_KEY = 'deerpanel_use_virtual_paths'
const LEGACY_LOCAL_WORKSPACE_ROOT_KEY = 'deerpanel_local_workspace_root'
const LEGACY_LOCAL_WORKSPACE_HISTORY_KEY = 'deerpanel_local_workspace_history'
const WORKSPACE_HISTORY_BY_SESSION_KEY = 'deerpanel_workspace_history_by_session_v1'
let _legacyWorkspaceMigrated = false

function nowTs() {
  return Date.now()
}

function safeParseJSON(raw, fallback) {
  try { return JSON.parse(raw) } catch { return fallback }
}

/** 打包后的 Tauri WebView 无 Vite `/api` 代理，须走 Rust `gateway_proxy` / `gateway_proxy_stream`。 */
function isDeerflowTauri() {
  if (typeof window === 'undefined') return false
  return !!(
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__ ||
    window.isTauri
  )
}

function buildGatewayProxyRequest(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const [pathPart, search] = url.split('?')
  let query = null
  if (search) {
    query = {}
    new URLSearchParams(search).forEach((v, k) => {
      query[k] = v
    })
  }
  let body = null
  if (options.body != null && options.body !== '') {
    if (typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body)
      } catch {
        body = options.body
      }
    } else {
      body = options.body
    }
  }
  return { method, path: pathPart, body, query }
}

async function deerflowInvokeGatewayJson(url, options = {}) {
  const { invoke } = await import('@tauri-apps/api/core')
  const request = buildGatewayProxyRequest(url, options)
  const res = await invoke('gateway_proxy', { request })
  if (!res?.ok) {
    let msg = res?.error
    if (!msg && res?.body != null && typeof res.body === 'object') {
      msg = res.body.detail || res.body.error || res.body.message
    }
    if (!msg) msg = `HTTP ${res?.status ?? '?'}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  const b = res.body
  if (b === undefined) return null
  return b
}

/** Tauri 下模拟 `fetch`：仅提供本文件用到的 `ok` / `status` / `text()`。 */
async function deerflowFetch(url, options = {}) {
  if (!isDeerflowTauri() || !url.startsWith('/')) {
    return fetch(url, options)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  const request = buildGatewayProxyRequest(url, options)
  const res = await invoke('gateway_proxy', { request })
  const status = res?.status ?? 0
  const ok = !!res?.ok
  let text = ''
  if (res.body == null || res.body === '') {
    text = ''
  } else if (typeof res.body === 'string') {
    text = res.body
  } else {
    try {
      text = JSON.stringify(res.body)
    } catch {
      text = String(res.body)
    }
  }
  return {
    ok,
    status,
    async text() {
      return text
    },
  }
}

const DEERFLOW_STREAM_EOF = '__DF_EOF__'

/** LangGraph `runs/stream` 等 SSE：Rust 读上游字节后经 Channel 推 base64，再拼成 `ReadableStream`。 */
async function deerflowFetchStream(url, options = {}) {
  if (!isDeerflowTauri() || !url.startsWith('/')) {
    return fetch(url, options)
  }
  const { invoke, Channel } = await import('@tauri-apps/api/core')
  const request = buildGatewayProxyRequest(url, options)
  const chunks = []
  const waiters = []
  let streamError = null
  let streamFinished = false

  const notify = () => {
    waiters.splice(0).forEach((w) => w())
  }

  const onChunk = new Channel((b64) => {
    if (b64 === DEERFLOW_STREAM_EOF) {
      streamFinished = true
      notify()
      return
    }
    try {
      const bin = Uint8Array.from(globalThis.atob(b64), (c) => c.charCodeAt(0))
      chunks.push(bin)
    } catch (e) {
      streamError = e
    }
    notify()
  })

  invoke('gateway_proxy_stream', { request, onChunk }).catch((e) => {
    streamError = streamError || e
    streamFinished = true
    notify()
  })

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        if (chunks.length > 0) {
          controller.enqueue(chunks.shift())
          return
        }
        if (streamError) {
          controller.error(streamError)
          return
        }
        if (streamFinished) {
          controller.close()
          return
        }
        await new Promise((r) => waiters.push(r))
      }
    },
  })

  return new Response(stream, {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * LangGraph stream_mode=custom 的 data 形态因版本而异：可能是 writer 原对象、或 [namespace, chunk]、或 { chunk }。
 * 仅解析含 type: task_* 的 payload，供子智能体进度条使用。
 */
function normalizeCustomTaskPayload(data) {
  if (!data) return null
  if (Array.isArray(data) && data.length >= 2 && data[1] != null && typeof data[1] === 'object' && !Array.isArray(data[1])) {
    return data[1]
  }
  if (typeof data === 'object' && !Array.isArray(data) && data.chunk != null && typeof data.chunk === 'object' && !Array.isArray(data.chunk)) {
    return data.chunk
  }
  if (typeof data === 'object' && !Array.isArray(data) && typeof data.type === 'string') {
    return data
  }
  return null
}

function clampProgress01(v) {
  const n = Number.parseInt(v, 10)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/**
 * 旧版 Gateway 无 GET .../task-progress 时，用已有 collab + /api/tasks 拼出与后端快照同构的数据，避免对不存在路由发请求导致控制台 404。
 */
async function buildTaskProgressSnapshotFromLegacyApis(threadId) {
  const enc = encodeURIComponent(threadId)
  let collab = null
  try {
    const resp = await deerflowFetch(`/api/collab/threads/${enc}`)
    const text = await resp.text().catch(() => '')
    collab = text ? safeParseJSON(text, null) : null
    if (!resp.ok) collab = null
  } catch {
    collab = null
  }
  // collab 接口失败时仍可用 /api/tasks 按 thread_id 恢复（避免「任务列表有数据但整段返回 null」）
  if (!collab || typeof collab !== 'object') {
    collab = {
      collab_phase: 'idle',
      bound_task_id: null,
      bound_project_id: null,
    }
  }

  const phaseStr =
    collab.collab_phase != null && collab.collab_phase !== ''
      ? String(collab.collab_phase)
      : 'idle'
  const boundTid = (collab.bound_task_id || '').toString().trim()

  let task = null
  if (boundTid) {
    try {
      task = await fetchJson(`/api/tasks/${encodeURIComponent(boundTid)}`)
    } catch {
      task = null
    }
  }
  if (!task) {
    let list = []
    try {
      list = await fetchJson('/api/tasks')
    } catch {
      return null
    }
    if (!Array.isArray(list)) return null
    const want = (threadId || '').toString().trim().toLowerCase()
    const matches = list.filter((t) => {
      const tid = (t.thread_id || t.threadId || '').toString().trim().toLowerCase()
      return tid && tid === want
    })
    if (!matches.length) return null
    matches.sort((a, b) => {
      const auth = (x) => (x.execution_authorized ? 1 : 0)
      const d = auth(b) - auth(a)
      if (d) return d
      const ua = String(a.updated_at || a.created_at || '')
      const ub = String(b.updated_at || b.created_at || '')
      return ub.localeCompare(ua)
    })
    task = matches[0]
  }

  if (!task || !task.id) return null

  const pid = (task.parent_project_id || task.project_id || '').toString().trim() || null
  const subs = Array.isArray(task.subtasks) ? task.subtasks : []
  const subtasks = subs
    .filter((st) => st && st.id)
    .map((st) => ({
      subtaskId: String(st.id),
      parentTaskId: String(task.id),
      name: st.name,
      description: st.description,
      status: st.status,
      progress: clampProgress01(st.progress),
      assignedAgent: st.assigned_to,
    }))

  const rawSupervisorSteps =
    (Array.isArray(collab?.sidebar_supervisor_steps) &&
    collab.sidebar_supervisor_steps.length > 0
      ? collab.sidebar_supervisor_steps
      : null) ??
    (Array.isArray(collab?.supervisor_steps) &&
    collab.supervisor_steps.length > 0
      ? collab.supervisor_steps
      : null)
  const supervisor_steps =
    rawSupervisorSteps != null
      ? rawSupervisorSteps
          .map((x) =>
            x && typeof x === 'object' ? { ...x } : x
          )
          .filter((x) => x != null)
      : []

  return {
    thread_id: threadId,
    collab_phase: phaseStr,
    bound_task_id: collab.bound_task_id ?? null,
    bound_project_id: collab.bound_project_id ?? null,
    main_task: {
      taskId: String(task.id),
      projectId: pid,
      name: task.name,
      status: task.status,
      progress: clampProgress01(task.progress),
    },
    subtasks,
    supervisor_steps,
  }
}

function loadSessionMap() {
  return safeParseJSON(localStorage.getItem(SESSION_MAP_KEY) || '{}', {})
}

function saveSessionMap(map) {
  localStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map || {}))
}

function getUseVirtualPaths() {
  const raw = localStorage.getItem(VIRTUAL_PATH_MODE_KEY)
  if (raw == null) return false
  return raw !== 'false'
}

function loadWorkspaceHistoryMap() {
  return safeParseJSON(localStorage.getItem(WORKSPACE_HISTORY_BY_SESSION_KEY) || '{}', {})
}

function saveWorkspaceHistoryMap(obj) {
  try {
    localStorage.setItem(WORKSPACE_HISTORY_BY_SESSION_KEY, JSON.stringify(obj || {}))
  } catch {
    /* ignore */
  }
}

/** 将旧版全局工作空间迁移到主会话（仅一次） */
function migrateLegacyGlobalWorkspaceOnce() {
  if (_legacyWorkspaceMigrated) return
  _legacyWorkspaceMigrated = true
  if (typeof localStorage === 'undefined') return
  try {
    const legacy = (localStorage.getItem(LEGACY_LOCAL_WORKSPACE_ROOT_KEY) || '').trim()
    const legacyHistRaw = localStorage.getItem(LEGACY_LOCAL_WORKSPACE_HISTORY_KEY)
    const map = loadSessionMap()
    const mainKey = MAIN_SESSION_KEY
    if (legacy && map[mainKey]) {
      const ctx = map[mainKey].context && typeof map[mainKey].context === 'object' ? map[mainKey].context : {}
      if (!(ctx.local_workspace_root || '').toString().trim()) {
        map[mainKey].context = { ...ctx, local_workspace_root: legacy }
        saveSessionMap(map)
      }
    }
    if (legacyHistRaw && map[mainKey]) {
      try {
        const arr = JSON.parse(legacyHistRaw)
        const whMap = loadWorkspaceHistoryMap()
        if (Array.isArray(arr) && arr.length && (!whMap[mainKey] || !whMap[mainKey].length)) {
          whMap[mainKey] = arr.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30)
          saveWorkspaceHistoryMap(whMap)
        }
      } catch {
        /* ignore */
      }
    }
    if (legacy) localStorage.removeItem(LEGACY_LOCAL_WORKSPACE_ROOT_KEY)
    if (legacyHistRaw) localStorage.removeItem(LEGACY_LOCAL_WORKSPACE_HISTORY_KEY)
  } catch {
    /* ignore */
  }
}

function buildDefaultSessionContext() {
  return {
    thinking_enabled: true,
    is_plan_mode: false,
    subagent_enabled: false,
    include_search: true,
    use_virtual_paths: getUseVirtualPaths(),
    reasoning_effort: undefined,
  }
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

/**
 * 兼容不同网关/代理返回结构，尽量提取线程 ID。
 * 常见形态：
 * - { thread_id: "..." } / { threadId: "..." } / { id: "..." }
 * - { thread: { thread_id: "..." } } / { data: { thread_id: "..." } }
 * - 直接返回字符串 id
 */
function extractThreadId(payload) {
  if (!payload) return ''
  if (typeof payload === 'string') {
    const s = payload.trim()
    if (!s) return ''
    // 兼容 "{"thread_id":"..."}" 这类字符串化 JSON 返回
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s)
        const nested = extractThreadId(parsed)
        if (nested) return nested
      } catch {
        // keep raw string fallback
      }
    }
    return s
  }
  if (typeof payload === 'number') return String(payload)
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const id = extractThreadId(item)
      if (id) return id
    }
    return ''
  }
  if (typeof payload !== 'object') return ''
  const direct =
    payload.thread_id ||
    payload.threadId ||
    payload.id
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number') return String(direct)
  // 某些返回把 id 放在字符串字段里
  for (const k of ['thread', 'thread_id', 'threadId', 'id']) {
    const v = payload[k]
    if (typeof v === 'string') {
      const nested = extractThreadId(v)
      if (nested) return nested
    }
  }
  const nested = payload.thread || payload.data || payload.result
  if (nested && typeof nested === 'object') {
    const nid = nested.thread_id || nested.threadId || nested.id
    if (typeof nid === 'string' && nid.trim()) return nid.trim()
    if (typeof nid === 'number') return String(nid)
  }
  return ''
}

function debugPayloadSnippet(payload, maxLen = 300) {
  try {
    if (payload == null) return 'null'
    if (typeof payload === 'string') return payload.slice(0, maxLen)
    return JSON.stringify(payload).slice(0, maxLen)
  } catch {
    return String(payload).slice(0, maxLen)
  }
}

async function createThreadViaApi(sessionKey) {
  const desiredThreadId = makeFormattedId('Thread')
  try {
    return await fetchJson('/api/langgraph/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: desiredThreadId, metadata: { session_key: sessionKey } }),
    })
  } catch {
    // backward compatibility: some servers reject explicit thread_id
    return fetchJson('/api/langgraph/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { session_key: sessionKey } }),
    })
  }
}

async function createThreadViaTauriProxy(sessionKey) {
  if (!isDeerflowTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const desiredThreadId = makeFormattedId('Thread')
  let res = await invoke('gateway_proxy', {
    request: {
      method: 'POST',
      path: '/api/langgraph/threads',
      body: { thread_id: desiredThreadId, metadata: { session_key: sessionKey } },
      query: null,
    },
  })
  if (!res?.ok) {
    // backward compatibility: some servers reject explicit thread_id
    res = await invoke('gateway_proxy', {
      request: {
        method: 'POST',
        path: '/api/langgraph/threads',
        body: { metadata: { session_key: sessionKey } },
        query: null,
      },
    })
  }
  if (!res?.ok) {
    throw new Error(res?.error || `创建会话失败（gateway_proxy ${res?.status || 'unknown'}）`)
  }
  return res?.body ?? null
}

async function createThreadRobust(sessionKey) {
  const tryProxy = async () => {
    const viaProxy = await createThreadViaTauriProxy(sessionKey)
    return viaProxy
  }
  try {
    const viaApi = await createThreadViaApi(sessionKey)
    // 有些桌面环境会返回 200 但 body 不是线程对象（例如网关错误页/代理壳响应），
    // 这类情况之前不会进入 catch，导致后续报“未返回 thread_id”。
    if (extractThreadId(viaApi)) return viaApi
    const viaProxy = await tryProxy()
    if (viaProxy && extractThreadId(viaProxy)) return viaProxy
    return viaApi
  } catch (primaryErr) {
    // 桌面端 fetch 可能受本地代理/端口配置影响，退回 Tauri gateway_proxy 再试一次。
    try {
      const viaProxy = await tryProxy()
      if (viaProxy != null) return viaProxy
    } catch {
      // ignore and throw primary error below
    }
    throw primaryErr
  }
}

async function fetchJson(url, options = {}) {
  if (isDeerflowTauri() && url.startsWith('/')) {
    return deerflowInvokeGatewayJson(url, options)
  }
  const resp = await fetch(url, options)
  const text = await resp.text().catch(() => '')
  const data = text ? safeParseJSON(text, null) : null
  if (!resp.ok) {
    const msg = data?.detail || data?.error || data?.message || `HTTP ${resp.status}`
    const err = new Error(msg)
    // Attach useful diagnostics for callers (e.g. clear stale threadId on 404).
    err.status = resp.status
    err.url = url
    err.body = data
    throw err
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
  if (inc.length < prev.length && prev.startsWith(inc)) return prev
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

/** 从后往前最后一条 AI 消息（用于展示当前轮正文） */
function findLastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAssistantMessage(messages[i])) return messages[i]
  }
  return null
}

/** 从后往前最后一条「真实用户」消息（排除 collab_phase_hint），用于界定当前轮 */
function findLastNonCollabHumanIndex(messages) {
  if (!Array.isArray(messages)) return -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!isHumanMessage(m)) continue
    if (m.name === 'collab_phase_hint') continue
    return i
  }
  return -1
}

/**
 * 聚合当前轮内所有 assistant 上的 tool_calls（按 id 去重，顺序为首次出现）。
 * 解决「多段 AI、每段一个 tool_call」时只取到最后一条 AI 的 tool_calls 的问题。
 */
function collectToolCallsForTurnAfterLastUser(messages) {
  const start = findLastNonCollabHumanIndex(messages)
  if (start < 0) return null
  const byId = new Map()
  const order = []
  for (let i = start + 1; i < messages.length; i++) {
    const m = messages[i]
    if (!isAssistantMessage(m)) continue
    const tc = m.tool_calls || m.toolCalls
    if (!Array.isArray(tc) || !tc.length) continue
    tc.forEach((c, j) => {
      if (!c || typeof c !== 'object') return
      const cid = c.id || c.tool_call_id
      const key = cid != null && cid !== '' ? String(cid) : `__anon__:${i}:${j}`
      if (!byId.has(key)) order.push(key)
      byId.set(key, c)
    })
  }
  if (!order.length) return null
  return order.map((k) => byId.get(k))
}

/** OpenAI/LC 流式 tool_call：args 或 function.arguments（可能为未闭合 JSON 字符串） */
function normalizeStreamToolCallArgs(tc) {
  if (!tc || typeof tc !== 'object') return {}
  const direct = tc.args
  if (direct != null && typeof direct === 'object' && !Array.isArray(direct)) return direct
  const fn = tc.function
  if (fn && typeof fn.arguments === 'string' && fn.arguments.trim()) {
    try {
      const p = JSON.parse(fn.arguments)
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
    } catch {
      return {}
    }
  }
  if (fn && fn.arguments != null && typeof fn.arguments === 'object' && !Array.isArray(fn.arguments)) {
    return fn.arguments
  }
  return {}
}

/**
 * messages-tuple 流式首帧常见仅有 id+name，args 尚为 {}；此时不要向前端发 tool 事件，避免「supervisor + 空参」闪烁与误导。
 * supervisor 至少应有非空 args（含 action）后再展示。
 */
function streamToolCallReadyForUi(tc) {
  if (!tc || typeof tc !== 'object') return false
  const name = (tc.name || (tc.function && tc.function.name) || '').trim()
  const args = normalizeStreamToolCallArgs(tc)
  if (name === 'supervisor' && Object.keys(args).length === 0) return false
  return true
}

function isHumanMessage(m) {
  if (!m || typeof m !== 'object') return false
  return m.type === 'human' || m.role === 'user'
}

function normalizeLooseText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

function messageTextForMatch(m) {
  return normalizeLooseText(extractAssistantText(m))
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

/** 摘要后 ``messages`` 仅含模型上下文；``ui_messages`` 为摘要前完整副本（供界面） */
function pickDisplayMessages(values) {
  if (!values || typeof values !== 'object') return []
  const ui = Array.isArray(values.ui_messages) ? values.ui_messages : []
  if (ui.length) return ui
  return Array.isArray(values.messages) ? values.messages : []
}

/** 与 Web 版 values 事件对齐：扁平或 { values: {...} } */
function normalizeStreamValues(data) {
  if (!data || typeof data !== 'object') return { messages: [], todos: [], title: null }
  const raw = data.values && typeof data.values === 'object' ? data.values : data
  const messages = pickDisplayMessages(raw)
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

  /** 仅读本地映射中的 thread id，不创建线程 */
  getSessionThreadId(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const tid = loadSessionMap()[key]?.threadId
    return typeof tid === 'string' && tid.trim() ? tid.trim() : null
  }

  /** 确保 LangGraph 线程存在并写回 session map（任务协作开关等需先落盘 collab 时用） */
  async ensureChatThread(sessionKey) {
    return this._ensureThread(sessionKey)
  }

  async getThreadCollabState(threadId) {
    if (!threadId) return null
    try {
      return await fetchJson(`/api/collab/threads/${encodeURIComponent(threadId)}`)
    } catch {
      return null
    }
  }

  async getTaskStreamLog(taskId, limit = 100) {
    const tid = String(taskId || '').trim()
    if (!tid) return []
    const n = Math.max(1, Math.min(Number(limit) || 100, 1000))
    try {
      const data = await fetchJson(
        `/api/collab/tasks/${encodeURIComponent(tid)}/stream-log?limit=${encodeURIComponent(String(n))}`,
      )
      return Array.isArray(data?.events) ? data.events : []
    } catch {
      return []
    }
  }

  // NOTE: 已移除 getTaskProgressSnapshot（task-progress 快照恢复/拉取功能下线）

  async putThreadCollabState(threadId, body) {
    if (!threadId || !body || typeof body !== 'object') return
    await fetchJson(`/api/collab/threads/${encodeURIComponent(threadId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async _ensureThread(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    if (map[key]?.threadId) return map[key].threadId
    const created = await createThreadRobust(key)
    const threadId = extractThreadId(created)
    if (!threadId) {
      const snippet = debugPayloadSnippet(created)
      throw new Error(`创建会话失败：未返回 thread_id（返回=${snippet}）`)
    }
    map[key] = {
      threadId,
      createdAt: nowTs(),
      updatedAt: nowTs(),
      messageCount: 0,
      context: { ...buildDefaultSessionContext() },
    }
    saveSessionMap(map)
    return threadId
  }

  async _listThreadRuns(threadId) {
    if (!threadId) return []
    try {
      const data = await fetchJson(
        `/api/langgraph/threads/${encodeURIComponent(threadId)}/runs?limit=50`,
      )
      if (Array.isArray(data)) return data
      if (data && Array.isArray(data.items)) return data.items
      if (data && Array.isArray(data.runs)) return data.runs
      return []
    } catch {
      return []
    }
  }

  _pickLatestRun(runs) {
    if (!Array.isArray(runs) || !runs.length) return null
    const normTs = (v) => {
      if (!v) return 0
      const t = Date.parse(String(v))
      return Number.isNaN(t) ? 0 : t
    }
    const list = [...runs].sort((a, b) => {
      const ta = normTs(a?.created_at ?? a?.updated_at)
      const tb = normTs(b?.created_at ?? b?.updated_at)
      return tb - ta
    })
    return list[0] || null
  }

  /** 优先返回仍 pending/running 的 run（避免「最新一条已是 success 但仍有一条在跑」时误判为空闲） */
  _pickBusyOrLatestRun(runs) {
    if (!Array.isArray(runs) || !runs.length) return null
    const norm = (r) => String(r?.status || '').toLowerCase()
    const busy = runs.filter((r) => {
      const s = norm(r)
      return s === 'pending' || s === 'running'
    })
    const pool = busy.length ? busy : runs
    const normTs = (v) => {
      if (!v) return 0
      const t = Date.parse(String(v))
      return Number.isNaN(t) ? 0 : t
    }
    const list = [...pool].sort((a, b) => {
      const ta = normTs(a?.created_at ?? a?.updated_at)
      const tb = normTs(b?.created_at ?? b?.updated_at)
      return tb - ta
    })
    return list[0] || null
  }

  async _cancelThreadRunsByStatus(threadId, statuses = ['pending', 'running']) {
    if (!threadId) return { cancelled: [] }
    const target = new Set((statuses || []).map(x => String(x || '').toLowerCase()))
    const runs = await this._listThreadRuns(threadId)
    const cancelled = []
    for (const r of runs) {
      const runId = r?.run_id || r?.runId
      const st = String(r?.status || '').toLowerCase()
      if (!runId || !target.has(st)) continue
      try {
        await deerflowFetch(`/api/langgraph/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel`, {
          method: 'POST',
        })
        cancelled.push(runId)
      } catch {
        // Best-effort cancellation only.
      }
    }
    return { cancelled }
  }

  async getSessionRunStatus(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const threadId = this.getSessionThreadId(key)
    if (!threadId) return { threadId: null, run: null, status: 'idle' }
    const latest = this._pickBusyOrLatestRun(await this._listThreadRuns(threadId))
    if (!latest) return { threadId, run: null, status: 'idle' }
    return {
      threadId,
      run: latest,
      runId: latest?.run_id || latest?.runId || null,
      status: String(latest?.status || 'idle').toLowerCase(),
    }
  }

  async cancelSessionActiveRuns(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const threadId = this.getSessionThreadId(key)
    if (!threadId) return { cancelled: [] }
    return this._cancelThreadRunsByStatus(threadId, ['pending', 'running'])
  }

  /**
   * LangGraph 使用全局 worker 池（N_JOBS_PER_WORKER）。仅取消「当前 thread」上的 run 无法释放
   * 其它会话里卡住的 running/pending，会导致新会话的 /runs/stream 一直排队无首包。
   * 官方 POST /runs/cancel + { status: "all" } 会取消所有线程上的 pending+running。
   * 本地调试可在 localStorage 设 deerflow-disable-global-run-cancel=1 关闭该行为。
   */
  async cancelAllGlobalRunsBestEffort() {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('deerflow-disable-global-run-cancel') === '1') {
        return { skipped: true }
      }
    }
    try {
      const resp = await deerflowFetch('/api/langgraph/runs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'all' }),
      })
      if (resp.status === 404) return { ok: true, cancelled: false }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(text || `HTTP ${resp.status}`)
      }
      return { ok: true, cancelled: true }
    } catch (e) {
      console.warn('[ws-client] cancelAllGlobalRunsBestEffort:', e)
      return { ok: false, error: String(e?.message || e) }
    }
  }

  async chatSend(sessionKey, message, attachments) {
    const key = sessionKey || MAIN_SESSION_KEY
    const threadId = await this._ensureThread(key)
    // New user input should not be blocked by stale queued/running runs from a previous tab/session.
    await this._cancelThreadRunsByStatus(threadId, ['pending', 'running'])
    await this.cancelAllGlobalRunsBestEffort()
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
    // Extract agent name from sessionKey (format: "agent:{agentName}:{id}")
    const parsedAgent = (key && key.startsWith('agent:')) ? key.split(':')[1] : 'main'
    const defaultContext = {
      thinking_enabled: true,
      is_plan_mode: false,
      subagent_enabled: false,
      use_virtual_paths: getUseVirtualPaths(),
      reasoning_effort: undefined,
      agent_name: parsedAgent,   // Pass agent name so backend loads correct config
    }

    let serverCollab = null
    try {
      serverCollab = await fetchJson(`/api/collab/threads/${encodeURIComponent(threadId)}`)
    } catch {
      serverCollab = null
    }

    const runContext = {
      ...defaultContext,
      ...sessionContext,
      thread_id: threadId,
    }
    // Always honor the latest global path-mode toggle, overriding stale per-session cache.
    runContext.use_virtual_paths = getUseVirtualPaths()
    // local_workspace_root 仅来自该会话 context（按会话绑定），不在此处用全局覆盖

    const clientTaskId = (sessionContext.collab_task_id ?? '').toString().trim()

    if (serverCollab && typeof serverCollab === 'object') {
      const phase = serverCollab.collab_phase
      if (phase != null && phase !== '') runContext.collab_phase = phase
      // Collab phase 不是 idle 时，强制启用 plan + subagent（避免前端写入 context 发生 race）
      const phaseStr = (phase ?? '').toString().trim()
      const collabActive = !!phaseStr && phaseStr !== 'idle'
      if (collabActive) {
        runContext.is_plan_mode = true
        runContext.subagent_enabled = true
      }
      const bproj = (serverCollab.bound_project_id ?? '').toString().trim()
      if (bproj) runContext.bound_project_id = bproj
      else delete runContext.bound_project_id
      const boundTid = (serverCollab.bound_task_id ?? '').toString().trim()
      if (clientTaskId) {
        runContext.collab_task_id = clientTaskId
      } else if (boundTid) {
        runContext.collab_task_id = boundTid
      } else {
        delete runContext.collab_task_id
      }
    } else {
      if (clientTaskId) runContext.collab_task_id = clientTaskId
      else delete runContext.collab_task_id
    }

    const body = {
      assistant_id: 'lead_agent',
      input: { messages: [{ role: 'user', content: blocks }] },
      stream_mode: ['values', 'messages-tuple', 'custom'],
      streamSubgraphs: true,
      streamResumable: true,
      config: {
        recursion_limit: 1000,
      },
      context: runContext,
    }
    const started = nowTs()
    let finalText = ''
    const expectedUserText = normalizeLooseText(message || '')
    let valuesSeenCurrentUser = false
    /** messages-tuple 已输出正文后，不再用 values 快照合并正文（双通道会重复/版本不一致） */
    let streamTextFromMessages = false
    /** 避免 values 快照每帧重复 emit 相同 tool_calls */
    let lastValuesToolCallsSig = ''

    /** LangGraph / SSE 规范使用 CRLF；用 split('\\n\\n') 永远切不开「\\r\\n\\r\\n」分隔的事件 */
    const takeCompleteSseFrames = (raw) => {
      const normalized = raw.replace(/\r\n/g, '\n')
      const parts = normalized.split('\n\n')
      const rest = parts.pop() ?? ''
      return { frames: parts, rest }
    }

    try {
      const resp = await deerflowFetchStream(`/api/langgraph/threads/${encodeURIComponent(threadId)}/runs/stream`, {
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
      /** messages 通道里同一 tool_call 会在多帧重复携带，避免重复 emit 导致列表闪动/重复合并 */
      const lastTupleToolCallEmitSig = new Map()

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
            const lastMsg = messages.length ? messages[messages.length - 1] : null
            // values 可能先到“上一轮尾部 ai 快照”。只有确认本轮用户消息已入队后，才允许 values 产出正文。
            if (!valuesSeenCurrentUser) {
              const humanIdx = findLastNonCollabHumanIndex(messages)
              if (humanIdx >= 0) {
                const humanText = messageTextForMatch(messages[humanIdx])
                if (!expectedUserText || (humanText && humanText.includes(expectedUserText))) {
                  valuesSeenCurrentUser = true
                }
              }
            }
            /* 只在“末尾就是 assistant”时才抽正文；
               末尾若是 system/tool（中间件注入/工具结果）不能回退取更早 assistant，
               否则会把上一轮大段回答灌进当前气泡。 */
            let lastAi = null
            if (valuesSeenCurrentUser && lastMsg && isAssistantMessage(lastMsg)) {
              lastAi = findLastAssistantMessage(messages)
            }
            const text = lastAi ? extractAssistantText(lastAi) : ''
            console.log('[ws-debug][values]', {
              sessionKey: key,
              runId,
              streamTextFromMessages,
              valuesSeenCurrentUser,
              messagesCount: Array.isArray(messages) ? messages.length : 0,
              lastMsgType: lastMsg?.type || lastMsg?.role || null,
              pickedAssistant: !!lastAi,
              textLen: String(text || '').length,
              textHead: String(text || '').slice(0, 120),
            })
            const prevFinal = finalText
            // 只要 messages-tuple 开始产出正文，就不要再用 values 快照去“拼正文”
            // 否则两路 delta 会交错，导致前端 accumulate 发生重复追加。
            if (text && !streamTextFromMessages) {
              const next = accumulateStreamAssistantText(finalText, text)
              if (next !== finalText) finalText = next
            }
            const textChanged = finalText !== prevFinal
            const callsRaw =
              valuesSeenCurrentUser && lastMsg && isAssistantMessage(lastMsg)
                ? collectToolCallsForTurnAfterLastUser(messages)
                : null
            const calls = Array.isArray(callsRaw) ? callsRaw.filter(streamToolCallReadyForUi) : null
            const hasToolCalls = Array.isArray(calls) && calls.length > 0
            const sig = hasToolCalls ? JSON.stringify(calls) : ''
            const toolCallsChanged = sig !== lastValuesToolCallsSig
            if (toolCallsChanged) lastValuesToolCallsSig = sig
            if (toolCallsChanged) {
              console.log('[ws-debug][values-tool-calls]', {
                sessionKey: key,
                runId,
                toolCallsCount: Array.isArray(calls) ? calls.length : 0,
              })
            }
            /* values 快照常带完整 tool_calls+args（LangGraph 用 args 而非 function.arguments） */
            if ((textChanged && !streamTextFromMessages) || toolCallsChanged) {
              this._emitEvent('chat', {
                sessionKey: key,
                runId,
                state: toolCallsChanged ? 'tool' : 'delta',
                ...(toolCallsChanged
                  ? { data: { tool_calls: calls || [] } }
                  : {
                      message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: finalText }],
                        ...(hasToolCalls ? { tool_calls: calls } : {}),
                      },
                    }),
              })
            }
            emitThreadStateFull(this, key, runId, data)
          } else if (eventName === 'messages' || eventName === 'messages-tuple') {
            const root = unwrapMessagesTupleRoot(data)

            /** AI 片段里带 tool_calls 时尽早展示「正在调用 xxx」（否则只有 tool 节点到达时才有 UI） */
            const emitAiToolCallsIfAny = (aiPart) => {
              if (!aiPart || typeof aiPart !== 'object') return
              const calls = aiPart.tool_calls || aiPart.toolCalls
              if (!Array.isArray(calls) || !calls.length) return
              for (const tc of calls) {
                if (!streamToolCallReadyForUi(tc)) continue
                const id = tc.id || tc.tool_call_id
                if (!id && !tc.name && !(tc.function && tc.function.name)) continue
                const idKey = id != null && id !== '' ? String(id) : `anon:${tc.name || ''}`
                let sig = ''
                try {
                  sig = JSON.stringify(tc)
                } catch {
                  sig = String(idKey)
                }
                if (lastTupleToolCallEmitSig.get(idKey) === sig) continue
                lastTupleToolCallEmitSig.set(idKey, sig)
                this._emitEvent('chat', {
                  sessionKey: key,
                  runId,
                  state: 'tool',
                  data: { tool_calls: [tc] },
                  toolCallId: id,
                  name: tc.name || (tc.function && tc.function.name) || '工具',
                })
              }
            }

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
              streamTextFromMessages = true
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
                /* 先推正文再推 tool_calls，避免前端先封存 tools 段时 S.text 仍为空 → 工具块跑到正文上方、整块像「空白」 */
                emitAssistantChunkIfNew(textFromLangGraphStreamPart(root))
                emitAiToolCallsIfAny(root)
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
                emitAiToolCallsIfAny(root[0])
              } else {
              for (const msg of root) {
                if (msg && typeof msg === 'object' && !Array.isArray(msg) && (msg.type || msg.role)) {
                  if (msg.type === 'tool' || msg.role === 'tool') {
                    emitToolFromObj(msg, msg.tool_call_id)
                  } else if (isLangGraphStreamAiPart(msg)) {
                    emitAssistantChunkIfNew(textFromLangGraphStreamPart(msg))
                    emitAiToolCallsIfAny(msg)
                  }
                } else if (Array.isArray(msg)) {
                  if (typeof msg[0] === 'object' && msg[0] !== null && 'content' in msg[0]) {
                    if (isLangGraphStreamAiPart(msg[0])) {
                      emitAssistantChunkIfNew(textFromLangGraphStreamPart(msg[0]))
                      emitAiToolCallsIfAny(msg[0])
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
          } else if (eventName === 'custom') {
            const chunk = normalizeCustomTaskPayload(data)
            if (!chunk || typeof chunk !== 'object') return
            const t = chunk.type
            if (
              t === 'task_started' ||
              t === 'task_running' ||
              t === 'task_completed' ||
              t === 'task_failed' ||
              t === 'task_timed_out'
            ) {
              this._emitEvent('chat', {
                sessionKey: key,
                runId,
                state: 'subtask',
                subtaskEvent: chunk,
              })
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

  /**
   * Resume-like SSE stream for an in-progress run.
   * It attaches to /api/langgraph/threads/{threadId}/runs/{runId}/resume-stream.
   *
   * This does not restart the model; it streams `event: values` frames derived
   * from the current thread state until the run becomes terminal.
   */
  async chatResume(sessionKey, threadId, runId) {
    const key = sessionKey || MAIN_SESSION_KEY
    if (!threadId || !runId) return { ok: false }

    const controller = new AbortController()
    // Use runId as the internal run identifier so chatAbort can cancel it.
    this._abortByRunId.set(String(runId), controller)
    this._latestRunBySession.set(key, String(runId))

    const started = nowTs()
    let finalText = ''
    let streamTextFromMessages = false // resume endpoint emits values only
    let lastValuesToolCallsSig = ''

    const takeCompleteSseFrames = (raw) => {
      const normalized = raw.replace(/\r\n/g, '\n')
      const parts = normalized.split('\n\n')
      const rest = parts.pop() ?? ''
      return { frames: parts, rest }
    }

    try {
      const resp = await deerflowFetchStream(
        `/api/langgraph/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/resume-stream`,
        {
          method: 'GET',
          signal: controller.signal,
        },
      )
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
          const lastMsg = messages.length ? messages[messages.length - 1] : null
          // 只在末尾就是 assistant 时抽正文，避免把历史 assistant 误当本轮续写。
          let lastAi = null
          if (lastMsg && isAssistantMessage(lastMsg)) {
            lastAi = findLastAssistantMessage(messages)
          }

          const text = lastAi ? extractAssistantText(lastAi) : ''
          console.log('[ws-debug][resume-values]', {
            sessionKey: key,
            runId: String(runId),
            messagesCount: Array.isArray(messages) ? messages.length : 0,
            lastMsgType: lastMsg?.type || lastMsg?.role || null,
            pickedAssistant: !!lastAi,
            textLen: String(text || '').length,
            textHead: String(text || '').slice(0, 120),
          })
          const prevFinal = finalText

          if (text && !streamTextFromMessages) {
            const next = accumulateStreamAssistantText(finalText, text)
            if (next !== finalText) finalText = next
          }

          const textChanged = finalText !== prevFinal

          const callsRaw =
            lastMsg && isAssistantMessage(lastMsg) ? collectToolCallsForTurnAfterLastUser(messages) : null
          const calls = Array.isArray(callsRaw) ? callsRaw.filter(streamToolCallReadyForUi) : null
          const hasToolCalls = Array.isArray(calls) && calls.length > 0
          const sig = hasToolCalls ? JSON.stringify(calls) : ''
          const toolCallsChanged = sig !== lastValuesToolCallsSig
          if (toolCallsChanged) lastValuesToolCallsSig = sig

          if ((textChanged && !streamTextFromMessages) || toolCallsChanged) {
            this._emitEvent('chat', {
              sessionKey: key,
              runId: String(runId),
              state: toolCallsChanged ? 'tool' : 'delta',
              ...(toolCallsChanged
                ? { data: { tool_calls: calls || [] } }
                : {
                    message: {
                      role: 'assistant',
                      content: [{ type: 'text', text: finalText }],
                      ...(hasToolCalls ? { tool_calls: calls } : {}),
                    },
                  }),
            })
          }
          emitThreadStateFull(this, key, String(runId), data)
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
        runId: String(runId),
        state: 'final',
        durationMs: nowTs() - started,
        message: { role: 'assistant', content: [{ type: 'text', text: finalText }] },
      })

      const map = loadSessionMap()
      if (map[key]) {
        map[key].updatedAt = nowTs()
        map[key].messageCount = (map[key].messageCount || 0) + 2
        saveSessionMap(map)
      }

      return { ok: true, runId: String(runId) }
    } catch (err) {
      if (controller.signal.aborted) {
        this._emitEvent('chat', { sessionKey: key, runId: String(runId), state: 'aborted' })
        return { ok: true, aborted: true, runId: String(runId) }
      }
      this._emitEvent('chat', {
        sessionKey: key,
        runId: String(runId),
        state: 'error',
        errorMessage: err?.message || '请求失败',
      })
      throw err
    } finally {
      this._abortByRunId.delete(String(runId))
    }
  }

  /**
   * Resume long-running collab task progress independent of chat run.
   * It attaches to /api/collab/threads/{threadId}/task-stream and emits `thread_state`
   * snapshots so UI can keep showing progress even when the main assistant run ended.
   */
  async taskResume(sessionKey, threadId) {
    const key = sessionKey || MAIN_SESSION_KEY
    if (!threadId) return { ok: false }

    const runId = `task-stream:${String(threadId)}`
    const controller = new AbortController()
    this._abortByRunId.set(String(runId), controller)
    this._latestRunBySession.set(key, String(runId))

    const started = nowTs()
    let finalEmitted = false
    let forceTerminal = false

    const takeCompleteSseFrames = (raw) => {
      const normalized = raw.replace(/\r\n/g, '\n')
      const parts = normalized.split('\n\n')
      const rest = parts.pop() ?? ''
      return { frames: parts, rest }
    }

    const handleTaskProgressData = (data) => {
        const snap = data?.snapshot || null
        const mem = data?.memory || null
        const terminalFromServer = !!data?.terminal
        const main = snap?.main_task || null
        const mainStatus = String(main?.status || '').trim()
        const mainStatusLc = mainStatus.toLowerCase()
        const prog = main?.progress != null ? Number(main.progress) : null
        const step = mem?.current_step ? String(mem.current_step) : ''
        // Task-stream details are internal monitor signals; do not show debug details in top banner.
        const detail = ''
        const taskName = String(main?.name || '').trim()
        const mainTaskId = String(main?.taskId || '').trim()
        const memStatus = String(mem?.status || '').trim()
        const summary = String(mem?.output_summary || '').trim()
        const runningText = [
          taskName ? `主任务：${taskName}` : '主任务执行中',
          mainStatus ? `状态：${mainStatus}` : '',
          prog != null && !Number.isNaN(prog) ? `进度：${prog}%` : '',
          step ? `当前步骤：${step}` : '',
          memStatus ? `记忆状态：${memStatus}` : '',
          mainTaskId ? `任务ID：${mainTaskId}` : '',
        ]
          .filter(Boolean)
          .join('\n')

        const subs = Array.isArray(snap?.subtasks) ? snap.subtasks : []
        const subTerminal =
          subs.length > 0 &&
          subs.every((st) => {
            const s = String(st?.status || '').trim().toLowerCase()
            return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'timed_out'
          })
        const terminalLocal =
          mainStatusLc === 'completed' ||
          mainStatusLc === 'failed' ||
          mainStatusLc === 'cancelled' ||
          subTerminal
        const terminal = terminalFromServer || terminalLocal

        this._emitEvent('thread_state', {
          sessionKey: key,
          runId,
          partial: false,
          title: null,
          todos: [],
          activityKind: terminal ? 'idle' : 'tools',
          activityDetail: detail || (terminal ? '' : '任务执行中'),
          toolNames: [],
          reasoningPreview: null,
          clarification: null,
          // Extra fields for consumers that want full snapshot (safe: extra keys ignored)
          collabPhase: data?.collab_phase,
          boundTaskId: snap?.bound_task_id ?? snap?.main_task?.taskId ?? null,
          boundProjectId: snap?.bound_project_id ?? snap?.main_task?.projectId ?? null,
        })

        // 非终态阶段不再向主对话注入调试型 delta 文案，避免“主任务：...状态...”刷屏。
        // 进度展示由 thread_state / 任务侧栏承载；终态仍会发 final。

        if (terminal && !finalEmitted) {
          finalEmitted = true
          forceTerminal = true
          const statusText = mainStatus ? `状态：${mainStatus}` : '状态：completed'
          const progressText = prog != null && !Number.isNaN(prog) ? `进度：${prog}%` : ''
          const summaryText = summary ? `结果摘要：${summary}` : ''
          const taskText = mainTaskId ? `任务ID：${mainTaskId}` : ''
          const finalText = [statusText, progressText, taskText, summaryText].filter(Boolean).join('\n')
          this._emitEvent('chat', {
            sessionKey: key,
            runId: String(runId),
            state: 'final',
            durationMs: nowTs() - started,
            message: { role: 'assistant', content: [{ type: 'text', text: finalText || '任务已结束。' }] },
          })
        }
    }

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
      if (eventName === 'task_progress') handleTaskProgressData(data)
    }

    try {
      // 首次接流前，先回放该任务最近一条持久化快照，避免“跳回对话页时空白等待”。
      try {
        const collab = await this.getThreadCollabState(threadId)
        const replayTaskId = String(collab?.bound_task_id || '').trim()
        if (replayTaskId) {
          const events = await this.getTaskStreamLog(replayTaskId, 1)
          const last = events[events.length - 1]
          if (last && typeof last === 'object') {
            handleTaskProgressData({
              snapshot: last.snapshot || null,
              memory: last.memory || null,
              terminal: !!last.terminal,
              collab_phase: last.collab_phase || null,
            })
          }
        }
      } catch {
        // replay is best-effort only
      }

      const resp = await deerflowFetchStream(
        `/api/collab/threads/${encodeURIComponent(threadId)}/task-stream`,
        { method: 'GET', signal: controller.signal },
      )
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(text || `HTTP ${resp.status}`)
      }
      if (!resp.body) throw new Error('响应流为空')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = takeCompleteSseFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          if (!frame.trim()) continue
          dispatchSseFrame(frame)
          if (forceTerminal) break
        }
        if (forceTerminal) break
      }

      if (buffer.trim()) {
        dispatchSseFrame(buffer.replace(/\r\n/g, '\n'))
      }

      return { ok: true, runId }
    } catch (err) {
      if (controller.signal.aborted) {
        return { ok: true, aborted: true, runId }
      }
      throw err
    } finally {
      this._abortByRunId.delete(String(runId))
      // do not emit chat events here; this stream is task-only
      void started
    }
  }

  /**
   * 聊天历史：GET LangGraph `threads/{thread_id}/state`，优先 `values.ui_messages`（完整展示），否则 `values.messages`。
   * 与列表用的 `POST /api/langgraph/threads/search` 不同：search 只同步 thread 元数据 ↔ 本地 session 映射，不拉完整消息。
   */
  async chatHistory(sessionKey, limit = 200) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    const threadId = map[key]?.threadId
    if (!threadId) return { messages: [], valuesSnapshot: null }
    try {
      const state = await fetchJson(`/api/langgraph/threads/${encodeURIComponent(threadId)}/state`)
      const values = state?.values && typeof state.values === 'object' ? state.values : null
      const messages = pickDisplayMessages(values)
      const result = messages.slice(-Math.max(1, limit))
      // 仅拉历史不要用「当前时间」刷 updatedAt，否则下次列表排序会把刚点过的会话顶来顶去
      map[key].messageCount = messages.length
      saveSessionMap(map)
      return { messages: result, valuesSnapshot: values }
    } catch (e) {
      console.warn('[ws-client] threads/state 获取失败，返回空消息', e?.message || e)
      return { messages: [], valuesSnapshot: null }
    }
  }

  async chatSuggestions(sessionKey, n = 3, modelName = undefined, recentMessages = undefined) {
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    const threadId = map[key]?.threadId
    if (!threadId) return { suggestions: [] }

    let recent = []
    if (Array.isArray(recentMessages) && recentMessages.length) {
      recent = recentMessages
        .map(m => ({
          role: m?.role === 'assistant' ? 'assistant' : 'user',
          content: (typeof m?.content === 'string' ? m.content : '').trim(),
        }))
        .filter(x => x.content)
        .slice(-6)
    } else {
      const state = await fetchJson(`/api/langgraph/threads/${encodeURIComponent(threadId)}/state`)
      const values = state?.values && typeof state.values === 'object' ? state.values : null
      const all = pickDisplayMessages(values)
      recent = all
        .filter(m => isHumanMessage(m) || isAssistantMessage(m))
        .map(m => {
          const role = isHumanMessage(m) ? 'user' : 'assistant'
          const content = (extractAssistantText(m) || '').trim()
          return { role, content }
        })
        .filter(x => x.content)
        .slice(-6)
    }

    if (!recent.length) return { suggestions: [] }

    const data = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: recent,
        n: Math.max(1, Math.min(5, Number(n) || 3)),
        model_name: modelName,
      }),
    })

    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : []
    return {
      suggestions: suggestions
        .map(s => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .slice(0, 5),
    }
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
    this._clearWorkspaceHistoryForSession(key)
    saveSessionMap(map)
    if (threadId) {
      await deerflowFetch(`/api/langgraph/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }).catch(() => {})
      await deerflowFetch(`/api/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }).catch(() => {})
    }
    return { ok: true }
  }

  async sessionsReset(key) {
    const sessionKey = key || MAIN_SESSION_KEY
    const map = loadSessionMap()
    const oldThread = map[sessionKey]?.threadId
    const oldContext = map[sessionKey]?.context
    if (oldThread) {
      await deerflowFetch(`/api/langgraph/threads/${encodeURIComponent(oldThread)}`, { method: 'DELETE' }).catch(() => {})
      await deerflowFetch(`/api/threads/${encodeURIComponent(oldThread)}`, { method: 'DELETE' }).catch(() => {})
    }
    const created = await createThreadRobust(sessionKey)
    const threadId = extractThreadId(created)
    if (!threadId) {
      const snippet = debugPayloadSnippet(created)
      throw new Error(`重置会话失败：未返回 thread_id（返回=${snippet}）`)
    }
    map[sessionKey] = {
      threadId,
      createdAt: map[sessionKey]?.createdAt || nowTs(),
      updatedAt: nowTs(),
      messageCount: 0,
      context: oldContext || { ...buildDefaultSessionContext() },
    }
    saveSessionMap(map)
    return { ok: true, threadId }
  }

  updateSessionContext(sessionKey, context) {
    const key = sessionKey || MAIN_SESSION_KEY
    migrateLegacyGlobalWorkspaceOnce()
    const map = loadSessionMap()
    if (!map[key]) {
      map[key] = { context: { ...buildDefaultSessionContext() } }
    }
    const merged = { ...(map[key].context || {}), ...context }
    for (const k of Object.keys(context)) {
      if (context[k] === null) delete merged[k]
    }
    map[key].context = merged
    saveSessionMap(map)
  }

  getSessionContext(sessionKey) {
    migrateLegacyGlobalWorkspaceOnce()
    const key = sessionKey || MAIN_SESSION_KEY
    const map = loadSessionMap()
    return map[key]?.context || { ...buildDefaultSessionContext() }
  }

  /** 某会话的工作空间历史目录列表（与 sessionKey 绑定） */
  getWorkspaceHistory(sessionKey) {
    migrateLegacyGlobalWorkspaceOnce()
    const key = sessionKey || MAIN_SESSION_KEY
    const m = loadWorkspaceHistoryMap()
    const arr = m[key]
    if (!Array.isArray(arr)) return []
    return arr.map((x) => String(x || '').trim()).filter(Boolean)
  }

  /** 写入某会话的工作空间历史（去重、截断由调用方处理） */
  setWorkspaceHistory(sessionKey, list) {
    migrateLegacyGlobalWorkspaceOnce()
    const key = sessionKey || MAIN_SESSION_KEY
    const m = loadWorkspaceHistoryMap()
    m[key] = Array.isArray(list) ? list.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 30) : []
    saveWorkspaceHistoryMap(m)
  }

  _clearWorkspaceHistoryForSession(sessionKey) {
    const key = sessionKey || MAIN_SESSION_KEY
    const m = loadWorkspaceHistoryMap()
    if (m[key]) {
      delete m[key]
      saveWorkspaceHistoryMap(m)
    }
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
      const msgs = pickDisplayMessages(values)
      const prev = map[sk] || {}
      map[sk] = {
        threadId: tid,
        createdAt: prev.createdAt || threadSearchCreatedTs(t) || nowTs(),
        updatedAt: Math.max(prev.updatedAt || 0, updated || 0),
        messageCount: msgs.length || prev.messageCount || 0,
        context: prev.context && typeof prev.context === 'object'
          ? { ...buildDefaultSessionContext(), ...prev.context }
          : { ...buildDefaultSessionContext() },
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

/** 供历史加载/外部同步：从 LangGraph checkpoint values 生成输入区上方线程面板状态 */
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
if (!_g.__ytpanelWsClient) _g.__ytpanelWsClient = new WsClient()
export const wsClient = _g.__ytpanelWsClient
