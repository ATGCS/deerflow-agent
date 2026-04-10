import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { wsClient } from '../lib/ws-client.js'
import {
  upsertTool,
  extractChatContent,
  normalizeChatToolPayloadToEntries,
  parseUsageToStats,
  flattenStreamDisplayText,
  CHAT_MAIN_SESSION_KEY,
} from '../lib/chat-normalize.js'
import { useThreadHistory } from './hooks/useThreadHistory.js'
import { MessageVirtualList } from './components/MessageVirtualList.js'
import { ChatComposer } from './components/ChatComposer.js'
import { ThreadPanel } from './components/ThreadPanel.js'
import { HostedAgentPanel } from './components/HostedAgentPanel.js'
import { TaskSidebar } from './components/TaskSidebar.js'
import { RunManager } from './components/RunManager.js'
import { toast } from '../components/toast.js'
import { showConfirm, showModal } from '../components/modal.js'
import { openMobileShellAside, toggleShellAsideCollapsed } from '../components/shell-aside.js'
import { useHostedAgent } from './hooks/useHostedAgent.js'
import { getUseVirtualPaths, setUseVirtualPaths } from '../lib/path-mode.js'

// ========== 任务进度可视化系统集成 ==========
import { tasksAPI } from '../lib/api-client.js'
import { buildCollabSidebarFromTools } from '../lib/collab-sidebar-from-tools.js'
// ============================================

import type {
  ChatAttachment,
  ChatSessionRow,
  ChatWsPayload,
  DisplayRow,
  MessageSegment,
  StreamState,
  SubagentStreamTask,
  CollabTaskSnapshot,
  CollabSubtaskSnapshot,
  SupervisorStepSnapshot,
  ThreadPanelState,
} from './chat-types.js'
import { mergeSubagentStreamEvent } from './subagent-stream-merge.js'

const STORAGE_SESSION_META_KEY = 'ytpanel-chat-session-meta'
const STORAGE_MODEL_KEY = 'ytpanel-chat-selected-model'
const STORAGE_SESSION_NAMES_KEY = 'ytpanel-chat-session-names'
const STORAGE_SELECTED_SESSION_KEY = 'ytpanel-chat-selected-session'
/** 与 shell-aside 共用：离开聊天路由后仍渲染「会话列表」快照（shell-aside 内结构须一致） */
const SHELL_SIDEBAR_SYNC_STORAGE_KEY = 'ytpanel_shell_sidebar_sync'
/** 与「新建任务」等生成的草稿会话 id 一致，避免 includes(':new-') 误匹配普通会话 key */
const NEW_DRAFT_SESSION_KEY_RE = /^agent:[^:]+:new-[a-z0-9]+$/i

function _pathBasename(p: string): string {
  const s = String(p || '').trim()
  if (!s) return ''
  const noSlash = s.replace(/[\\/]+$/, '')
  const parts = noSlash.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || noSlash
}

function promptWorkspacePath(current: string): Promise<string> {
  return new Promise((resolve) => {
    showModal({
      title: '设置工作空间目录',
      fields: [
        {
          name: 'path',
          label: '本机工作空间目录（绝对路径）',
          value: current || '',
          placeholder: '例如：D:\\work\\project',
          hint: '提示：Web 模式无法读取系统绝对路径；桌面端建议直接使用「选择文件夹」窗口。',
        },
      ],
      onConfirm: (result: any) => {
        resolve(String(result?.path || '').trim())
      },
    })
  })
}

// 状态过期时间：5 分钟（300 秒）
const THREAD_STATE_EXPIRY_MS = 5 * 60 * 1000

type SessionMode = 'flash' | 'thinking' | 'pro' | 'ultra'

const SESSION_MODES: Array<{ value: SessionMode; label: string }> = [
  { value: 'flash', label: '闪速' },
  { value: 'thinking', label: '思考' },
  { value: 'pro', label: 'Pro' },
  { value: 'ultra', label: 'Ultra' },
]

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: '开始创作', prompt: '开始创作：给我一个可直接执行的第一步方案，并附上下一步行动清单。' },
  { label: '写作', prompt: '撰写一篇关于[主题]的博客文章' },
  { label: '深入研究', prompt: '深入浅出的研究一下[主题]，并总结发现。' },
  { label: '收集', prompt: '从[来源]收集数据并创建报告。' },
  { label: '学习', prompt: '帮我学习[主题]：先给学习路线，再出练习题并批改。' },
  { label: '创建', prompt: '创建一个[类型]的作品：给方案、步骤和可交付物。' },
]

function debugSubtaskTooltipEnabled(): boolean {
  try {
    // 默认开启；显式设为 '0' 才关闭
    return localStorage.getItem('DEERFLOW_DEBUG_SUBTASK_TOOLTIP') !== '0'
  } catch {
    return true
  }
}

function debugSubtaskFlowEnabled(): boolean {
  try {
    // 默认开启；显式设为 '0' 才关闭
    return localStorage.getItem('DEERFLOW_DEBUG_SUBTASK_FLOW') !== '0'
  } catch {
    return true
  }
}

function parseParentAndSubtaskIdFromComposite(taskId: string): { parentTaskId: string; subtaskId: string } | null {
  const raw = String(taskId || '').trim()
  if (!raw) return null
  const parts = raw.split('-').filter(Boolean)
  if (parts.length < 3) return null
  const a = parts[parts.length - 3] || ''
  const b = parts[parts.length - 2] || ''
  if (!/^[a-f0-9]{8}$/i.test(a) || !/^[a-f0-9]{8}$/i.test(b)) return null
  return { parentTaskId: a.toLowerCase(), subtaskId: b.toLowerCase() }
}

function shortLogText(v: unknown, maxLen = 220): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
}

function textFromSubtaskRawMessage(msg: unknown): string {
  if (msg == null) return ''
  if (typeof msg === 'string') return shortLogText(msg, 220)
  if (typeof msg !== 'object') return shortLogText(String(msg), 220)
  const m = msg as Record<string, unknown>
  const c = m.content
  if (typeof c === 'string') return shortLogText(c, 220)
  if (Array.isArray(c)) {
    let out = ''
    for (const b of c) {
      if (typeof b === 'string') out += b
      else if (b && typeof b === 'object') {
        const bb = b as Record<string, unknown>
        const t = bb.text
        if (typeof t === 'string') out += t
      }
    }
    return shortLogText(out, 220)
  }
  return ''
}

function emptyStream(): StreamState {
  return {
    runId: null,
    segments: [],
    text: '',
    tools: [],
    images: [],
    videos: [],
    audios: [],
    files: [],
    startTs: null,
    subagentTasks: {},
  }
}

function emptyThreadPanel(): ThreadPanelState {
  return {
    title: null,
    todos: [],
    activityKind: 'idle',
    activityDetail: '',
    reasoningPreview: null,
    clarification: null,
    subagentTasks: {},
    collabTask: null,
    collabSubtasks: [],
    supervisorSteps: [],
    collabPhase: null,
    boundTaskId: null,
    boundProjectId: null,
  }
}

/** 子智能体流事件 → 协作子任务 status（与 DeerFlow 存储 / TaskSidebar 一致） */
function collabStatusFromSubagentStreamEv(ev: Record<string, unknown>): string | null {
  const t = ev.type
  // running/started 只能表示“执行中”，绝不能把子任务误置为终态（否则 UI 会抖动：变绿/显示名称）
  if (t === 'task_started' || t === 'task_running') return 'executing'
  if (t === 'task_completed') return 'completed'
  if (t === 'task_failed') return 'failed'
  if (t === 'task_timed_out') return 'timed_out'
  return null
}

function patchCollabSubtasksById(
  list: CollabSubtaskSnapshot[],
  subtaskId: string,
  status: string,
  patch?: Partial<CollabSubtaskSnapshot>,
): CollabSubtaskSnapshot[] {
  const normalizeStatus = (v?: string) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_')
  const isTerminal = (v?: string) => {
    const s = normalizeStatus(v)
    return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'timed_out'
  }
  const nextStatusNorm = normalizeStatus(status)
  const nextIsTerminal = isTerminal(nextStatusNorm)
  let changed = false
  const next = list.map((s) => {
    if (s.subtaskId !== subtaskId) return s
    // 终态子任务禁止被后续心跳/进度回刷为 executing，避免 UI 在 completed <-> running 闪烁。
    if (isTerminal(s.status) && !nextIsTerminal) return s
    changed = true
    return { ...s, status, ...(status === 'completed' ? { progress: 100 } : {}), ...(patch || {}) }
  })
  return changed ? next : list
}

function mapSnapSupervisorSteps(raw: unknown): SupervisorStepSnapshot[] {
  if (!Array.isArray(raw)) return []
  return raw.map((x, i) => {
    const r = x as Record<string, unknown>
    return {
      id: String(r.id ?? r.step_id ?? `step-${i}`),
      action: String(r.action ?? ''),
      label: String(r.label ?? r.action ?? '步骤'),
      done: !!(r.done ?? r.completed),
    }
  })
}

type SidebarTaskView = {
  task: CollabTaskSnapshot
  subtasks: CollabSubtaskSnapshot[]
  steps: SupervisorStepSnapshot[]
  updatedAt: number
}

function trimStepsToLatestTask(steps?: SupervisorStepSnapshot[]): SupervisorStepSnapshot[] | undefined {
  if (!steps || !steps.length) return steps
  let start = -1
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const label = String(s.label || '').toLowerCase()
    const action = String(s.action || '').toLowerCase()
    if (
      label.includes('创建主任务') ||
      label.includes('create task') ||
      action.includes('create_task')
    ) {
      start = i
    }
  }
  if (start <= 0) return steps
  return steps.slice(start)
}

function safeReadSessionMetaMap(): Record<string, any> {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_SESSION_META_KEY) ||
        localStorage.getItem('clawpanel-chat-session-meta') ||
        '{}',
    )
  } catch {
    return {}
  }
}

function getSessionNames(): Record<string, string> {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_SESSION_NAMES_KEY) ||
        localStorage.getItem('clawpanel-chat-session-names') ||
        '{}',
    )
  } catch {
    return {}
  }
}

function parseSessionAgent(key: string) {
  const parts = (key || '').split(':')
  return parts.length >= 2 ? parts[1] : ''
}

function parseSessionLabel(key: string) {
  const k = key || ''
  if (k.startsWith('thread:')) {
    const id = k.slice(7)
    if (!id) return '会话'
    return id.length <= 14 ? `会话 · ${id}` : `会话 · ${id.slice(0, 12)}…`
  }
  const parts = k.split(':')
  if (parts.length < 3) return key || '未知'
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return 'leader-agnet'
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

function getDisplayLabel(key: string) {
  const custom = getSessionNames()[key]
  return custom || parseSessionLabel(key)
}

function persistSessionTitleIfMissing(sessionKey: string, title: string): boolean {
  const cleanKey = String(sessionKey || '').trim()
  const cleanTitle = String(title || '').trim()
  if (!cleanKey || !cleanTitle) return false
  try {
    const names = getSessionNames()
    if (typeof names[cleanKey] === 'string' && names[cleanKey].trim()) return false
    names[cleanKey] = cleanTitle
    localStorage.setItem(STORAGE_SESSION_NAMES_KEY, JSON.stringify(names))
    window.dispatchEvent(new CustomEvent('session-name-updated'))
    return true
  } catch {
    return false
  }
}

function formatSessionTime(ts: number) {
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  if (diffMs < 60000) return '刚刚'
  if (diffMs < 3600000) return Math.floor(diffMs / 60000) + ' 分钟前'
  if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + ' 小时前'
  if (diffMs < 604800000) return Math.floor(diffMs / 86400000) + ' 天前'
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}

/** 侧栏会话列表右侧仅展示相对时间 */
function formatSessionListTime(s: ChatSessionRow): string {
  const ts = s.updatedAt ?? s.lastActivity ?? s.createdAt ?? 0
  return ts ? formatSessionTime(ts) : ''
}

function safeWriteSessionMetaMap(map: Record<string, any>) {
  try {
    localStorage.setItem(STORAGE_SESSION_META_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function getSessionModeFromMeta(sessionKey: string): SessionMode {
  const raw = safeReadSessionMetaMap()[sessionKey]?.mode
  if (raw === 'normal') return 'pro'
  if (raw === 'fast') return 'flash'
  if (raw === 'think') return 'thinking'
  if (raw === 'deep') return 'ultra'
  return (raw as SessionMode) || 'pro'
}

function setSessionModeInMeta(sessionKey: string, mode: SessionMode) {
  if (!sessionKey) return
  const map = safeReadSessionMetaMap()
  if (mode && mode !== 'pro') {
    map[sessionKey] = { ...(map[sessionKey] || {}), mode }
  } else {
    const cur = map[sessionKey] || {}
    const next = { ...cur }
    delete next.mode
    if (Object.keys(next).length) map[sessionKey] = next
    else delete map[sessionKey]
  }
  safeWriteSessionMetaMap(map)
}

function getSessionCollabModeFromMeta(sessionKey: string): boolean {
  return !!safeReadSessionMetaMap()[sessionKey]?.collabMode
}

function setSessionCollabModeInMeta(sessionKey: string, on: boolean) {
  if (!sessionKey) return
  const map = safeReadSessionMetaMap()
  if (on) {
    map[sessionKey] = { ...(map[sessionKey] || {}), collabMode: true }
  } else {
    const cur = map[sessionKey] || {}
    const next = { ...cur }
    delete next.collabMode
    if (Object.keys(next).length) map[sessionKey] = next
    else delete map[sessionKey]
  }
  safeWriteSessionMetaMap(map)
}

function modeLabel(mode: SessionMode) {
  return SESSION_MODES.find((m) => m.value === mode)?.label || 'Pro'
}

function collectNewToolIds(tools: unknown[], entries: unknown[]): string[] {
  const before = new Set(
    tools.map((t) => String((t as Record<string, unknown>).id || (t as Record<string, unknown>).tool_call_id || '')),
  )
  const out: string[] = []
  for (const r of entries) {
    const e = r as Record<string, unknown>
    const id = e.id || e.tool_call_id
    if (id && !before.has(String(id))) {
      out.push(String(id))
      before.add(String(id))
    }
  }
  return out
}

function noteNewToolIds(S: StreamState, newIds: string[]) {
  if (!newIds.length) return
  for (const e of newIds) {
    if (!S.tools.some((t) => String((t as Record<string, unknown>).id || (t as Record<string, unknown>).tool_call_id || '') === e)) {
      S.tools.push({ id: e, name: '工具', input: null, output: null, status: 'pending' } as any)
    }
  }
}

function collectToolIdsFromSegments(segments: MessageSegment[]): Set<string> {
  const seen = new Set<string>()
  for (const s of segments) {
    if (s.kind === 'tools') {
      for (const id of s.ids || []) {
        if (id) seen.add(String(id))
      }
    }
  }
  return seen
}

function finalizeAssistantSegments(S: StreamState): MessageSegment[] | undefined {
  const seg: MessageSegment[] = [...S.segments]
  if (S.text.trim()) seg.push({ kind: 'text', text: S.text })

  const seenInSeg = collectToolIdsFromSegments(seg)
  const remaining = S.tools
    .map((t) => String((t as Record<string, unknown>).id || (t as Record<string, unknown>).tool_call_id || ''))
    .filter(Boolean)
    .filter((id) => !seenInSeg.has(id))
  if (remaining.length) {
    seg.push({ kind: 'tools', ids: remaining })
  }

  return seg.length ? seg : undefined
}

/** 流式尾文封存为 text segment，再在其后插入本轮新工具（与 delta / tool 事件顺序一致） */
function flushStreamTailTextToSegments(S: StreamState) {
  const raw = S.text || ''
  if (!raw.trim()) {
    S.text = ''
    return
  }
  S.segments.push({ kind: 'text', text: raw })
  S.text = ''
}

function appendStreamToolSegments(S: StreamState, newIds: string[]) {
  if (!newIds.length) return
  flushStreamTailTextToSegments(S)
  S.segments.push({ kind: 'tools', ids: [...newIds] })
}

/** 流式正文：单调合并到 S.text；工具由 delta/tool 事件写入 S.tools，由 MessageRow 实时渲染 */
function applyAssistantTextDelta(S: StreamState, incoming: string): boolean {
  const inc = String(incoming || '')
  if (!inc) return false
  
  const prevText = S.text || ''
  if (inc.startsWith(prevText)) {
    const nextText = inc.slice(prevText.length)
    if (nextText) {
      S.text = inc
      return true
    }
    return false
  }
  // 明显回退片段（更短且是前缀）直接忽略，避免闪烁。
  if (prevText.startsWith(inc)) return false

  // 尝试“尾-头重叠”拼接，避免重复堆叠。
  const maxOverlap = Math.min(prevText.length, inc.length, 240)
  for (let k = maxOverlap; k >= 40; k--) {
    if (prevText.endsWith(inc.slice(0, k))) {
      const next = prevText + inc.slice(k)
      if (next !== prevText) {
        S.text = next
        return true
      }
      return false
    }
  }

  // 若新片段像是“本轮重写的完整文本”（同开头，且长度明显更长），用新文本覆盖。
  const headN = Math.min(48, prevText.length, inc.length)
  if (headN >= 24 && prevText.slice(0, headN) === inc.slice(0, headN) && inc.length >= Math.max(80, prevText.length * 0.85)) {
    S.text = inc
    return true
  }

  S.text = prevText + inc
  return true
}

export default function ChatApp() {
  const [sessions, setSessions] = useState<ChatSessionRow[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_SELECTED_SESSION_KEY)
    return stored || CHAT_MAIN_SESSION_KEY
  })
  const { rows, setRows, loading: historyLoading, error: historyError, reload, tokenTotals } =
    useThreadHistory(selectedSessionKey)

  const [listLoading, setListLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const streamRef = useRef<StreamState>(emptyStream())
  const [resumeBusy, setResumeBusy] = useState(false)
  const resumeInFlightRef = useRef(false)
  // 断点续流只允许“每个会话一次”，防止 busy 残留导致反复触发 resume-stream
  const resumeAttemptedRef = useRef<Record<string, boolean>>({})
  // NOTE: 已移除 task-progress 快照刷新逻辑

  useEffect(() => {
    isSendingRef.current = isSending
  }, [isSending])
  const [threadPanelState, setThreadPanelState] = useState<ThreadPanelState>(emptyThreadPanel())
  const apiRef = useRef<any>(null)
  const [sessionMode, setSessionMode] = useState<SessionMode>(() => getSessionModeFromMeta(selectedSessionKey))
  const [collabOn, setCollabOn] = useState<boolean>(() => getSessionCollabModeFromMeta(selectedSessionKey))
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [collabBusy, setCollabBusy] = useState(false)
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(false)
  const openTaskSidebar = useCallback(() => {
    setTaskSidebarOpen(true)
  }, [])
  const [runManagerOpen, setRunManagerOpen] = useState(false)
  const [hasReceivedTodos, setHasReceivedTodos] = useState(false)
  const [streamTick, bumpStream] = useReducer((x: number) => x + 1, 0)
  const rafRef = useRef<number | null>(null)
  const seenRunIdsRef = useRef(new Set<string>())
  const sessionRef = useRef(selectedSessionKey)
  const lastErrorRef = useRef({ msg: '', ts: 0 })
  const unsubRef = useRef<(() => void) | null>(null)
  const [moreMenuKey, setMoreMenuKey] = useState<string | null>(null)
  const [pendingRefreshKey, setPendingRefreshKey] = useState<string | null>(null)
  const [sessionNamesTick, setSessionNamesTick] = useState(0)  // 用于强制刷新会话名称显示
  const lastActivityRef = useRef<Record<string, number>>({})  // 记录每个会话的最后活跃时间
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelName, setModelName] = useState<string>(() => localStorage.getItem(STORAGE_MODEL_KEY) || '')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [agents, setAgents] = useState<any[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [bottomModelOpen, setBottomModelOpen] = useState(false)
  const [bottomAgentOpen, setBottomAgentOpen] = useState(false)
  const [bottomCreativeOpen, setBottomCreativeOpen] = useState(false)
  const [bottomWorkspaceOpen, setBottomWorkspaceOpen] = useState(false)
  const [useVirtualPaths, setUseVirtualPathsState] = useState<boolean>(() => getUseVirtualPaths())
  const [localWorkspaceRoot, setLocalWorkspaceRoot] = useState<string>('')
  const [workspaceHistory, setWorkspaceHistory] = useState<string[]>([])
  const [pendingNewAgentBootstrapName, setPendingNewAgentBootstrapName] = useState<string | null>(null)
  const [newAgentModalOpen, setNewAgentModalOpen] = useState(false)
  const [newAgentNameDraft, setNewAgentNameDraft] = useState('')
  const [newAgentModalBusy, setNewAgentModalBusy] = useState(false)
  const [newAgentModalError, setNewAgentModalError] = useState<string | null>(null)
  const [, setSubagentDockTasks] = useState<Record<string, SubagentStreamTask>>({})
  const [sidebarTaskViews, setSidebarTaskViews] = useState<Record<string, SidebarTaskView>>({})
  const [sidebarSelectedTaskId, setSidebarSelectedTaskId] = useState<string | null>(null)
  const bottomModelRootRef = useRef<HTMLDivElement | null>(null)
  const bottomAgentRootRef = useRef<HTMLDivElement | null>(null)
  const bottomCreativeRootRef = useRef<HTMLDivElement | null>(null)
  const bottomWorkspaceRootRef = useRef<HTMLDivElement | null>(null)
  const newAgentNameInputRef = useRef<HTMLInputElement | null>(null)
  const [sessionFilter, setSessionFilter] = useState('')
  const projectEventsRef = useRef<EventSource | null>(null)
  const [projectEventsRetry, bumpProjectEventsRetry] = useReducer((x: number) => x + 1, 0)
  const parentTaskToSubtaskRef = useRef<Record<string, string>>({})

  const upsertSidebarTaskView = useCallback(
    (
      task: CollabTaskSnapshot | null | undefined,
      subtasks?: CollabSubtaskSnapshot[],
      steps?: SupervisorStepSnapshot[],
    ) => {
      const taskId = (task?.taskId || '').trim()
      if (!taskId || !task) return
      const normalizedSteps = trimStepsToLatestTask(steps)
      setSidebarTaskViews((prev) => {
        const cur = prev[taskId]
        return {
          ...prev,
          [taskId]: {
            task: { ...(cur?.task || {}), ...task },
            subtasks: subtasks ?? cur?.subtasks ?? [],
            steps: normalizedSteps ?? cur?.steps ?? [],
            updatedAt: Date.now(),
          },
        }
      })
      setSidebarSelectedTaskId(taskId)
    },
    [],
  )

  /** 从流式工具结果构建侧栏所需的主任务/子任务/步骤（不再依赖 task-progress 快照）。 */
  const patchCollabFromStreamTools = useCallback(() => {
    const tools = streamRef.current.tools as unknown[]
    const built = buildCollabSidebarFromTools(tools) as {
      main: CollabTaskSnapshot | null
      subtasks: CollabSubtaskSnapshot[]
      supervisorSteps: SupervisorStepSnapshot[]
    }
    const hasAny =
      !!(built.main?.taskId && String(built.main.taskId).trim()) ||
      built.subtasks.length > 0 ||
      built.supervisorSteps.length > 0
    if (!hasAny) return
    // 进度优化/快照功能下线后：子任务需要直接由工具结果驱动写入 state。
    if (built.main?.taskId || built.subtasks.length || built.supervisorSteps.length) {
      setThreadPanelState((prev) => {
        const incomingTaskId = (built.main?.taskId || '').trim()
        const prevTaskId = (prev.collabTask?.taskId || '').trim()
        const switchedTask = !!incomingTaskId && !!prevTaskId && incomingTaskId !== prevTaskId
        return {
          ...prev,
          ...(built.main?.taskId
            ? { collabTask: { ...(switchedTask ? {} : prev.collabTask || {}), ...built.main } as CollabTaskSnapshot }
            : {}),
          ...(built.subtasks.length
            ? { collabSubtasks: built.subtasks }
            : switchedTask
              ? { collabSubtasks: [] }
              : {}),
          ...(built.supervisorSteps.length
            ? { supervisorSteps: built.supervisorSteps }
            : switchedTask
              ? { supervisorSteps: [] }
              : {}),
        }
      })
      upsertSidebarTaskView(built.main || null, built.subtasks, built.supervisorSteps)
    }
    // 仅当已经创建出子任务时才展开侧栏（避免“只有主任务”时就展示 TODO 区域）
    if (built.subtasks.length > 0) {
      openTaskSidebar()
    }
  }, [openTaskSidebar, upsertSidebarTaskView])

  // 子任务 detached 模式下，LangGraph custom 流可能只发 task_started；用 Project SSE 事件补齐持续状态/心跳/结果。
  useEffect(() => {
    const projId =
      String(threadPanelState.collabTask?.projectId || threadPanelState.boundProjectId || '').trim()
    if (!projId) return

    // 防止重复连接
    if (projectEventsRef.current) return

    const es = new EventSource(`/api/events/projects/${encodeURIComponent(projId)}/stream`)
    projectEventsRef.current = es
    if (debugSubtaskFlowEnabled()) {
      // eslint-disable-next-line no-console
      console.debug(`[subtask-flow][project-sse] connected project_id=${projId}`)
    }
    let lastMessageAt = Date.now()
    const staleCheckTimer = window.setInterval(() => {
      const age = Date.now() - lastMessageAt
      // 连接长时间无任何事件（含 ping/业务事件）时，主动重连，避免“看起来一直运行中但无后续”。
      if (age < 45000) return
      if (debugSubtaskFlowEnabled()) {
        // eslint-disable-next-line no-console
        console.debug(`[subtask-flow][project-sse] stale-reconnect project_id=${projId} idle_ms=${age}`)
      }
      try { es.close() } catch {}
      if (projectEventsRef.current === es) projectEventsRef.current = null
      bumpProjectEventsRetry()
    }, 10000)

    const patchByTaskId = (
      taskId: string,
      patch: Partial<CollabSubtaskSnapshot>,
      extraIds?: string[],
    ) => {
      const tid = String(taskId || '').trim()
      if (!tid) return
      const candidateIds = [tid, ...(Array.isArray(extraIds) ? extraIds : [])]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
      const candidate8 = candidateIds.map((x) => (x.length > 8 ? x.slice(-8) : x))
      setThreadPanelState((prev) => {
        const allSubtasks = prev.collabSubtasks || []
        const mappedSid = candidateIds
          .map((id) => String(parentTaskToSubtaskRef.current[id] || '').trim())
          .find(Boolean)
        const parentMatched = allSubtasks.filter((s) => {
          const pid = String(s.parentTaskId || '').trim()
          const pid8 = pid.length > 8 ? pid.slice(-8) : pid
          return !!pid && (candidateIds.includes(pid) || candidate8.includes(pid8))
        })
        // 兜底策略：若没有 parent->subtask 映射，父任务只允许命中“一个”子任务，避免同父任务全量刷
        const parentFallbackSid = (() => {
          if (mappedSid || !parentMatched.length) return ''
          const runningOne = parentMatched.find((s) => {
            const st = String(s.status || '').trim().toLowerCase()
            return st === 'executing' || st === 'running' || st === 'in_progress' || st === 'pending'
          })
          return String((runningOne || parentMatched[0])?.subtaskId || '').trim()
        })()
        let matchedSubtask = 0
        let matchedParent = 0
        const next = allSubtasks.map((s) => {
          const sid = String(s.subtaskId || '').trim()
          const sid8 = sid.length > 8 ? sid.slice(-8) : sid
          const pid = String(s.parentTaskId || '').trim()
          const pid8 = pid.length > 8 ? pid.slice(-8) : pid
          const hitSubtask = candidateIds.includes(sid) || candidate8.includes(sid8)
          // 某些 project-sse 事件只给主任务 task_id：允许用 parentTaskId 兜底命中子任务
          const hitParent = !hitSubtask && (!!pid && (candidateIds.includes(pid) || candidate8.includes(pid8)))
          const hitMappedSubtask =
            !hitSubtask &&
            !!mappedSid &&
            (sid === mappedSid || (sid8 && mappedSid.length > 8 ? mappedSid.slice(-8) === sid8 : false))
          const hitParentFallback =
            !hitSubtask &&
            !hitMappedSubtask &&
            !mappedSid &&
            !!parentFallbackSid &&
            sid === parentFallbackSid &&
            hitParent
          if (hitSubtask || hitMappedSubtask || hitParentFallback) {
            if (hitSubtask) matchedSubtask += 1
            if (hitMappedSubtask || hitParentFallback) matchedParent += 1
            return { ...s, ...patch }
          }
          return s
        })
        if (debugSubtaskFlowEnabled()) {
          const patchOutputSummary = shortLogText((patch as any)?.outputSummary || '')
          // eslint-disable-next-line no-console
          console.debug(
            `[subtask-flow][project-sse][output] task_id=${tid} text="${patchOutputSummary}" matched_subtask=${matchedSubtask} matched_parent=${matchedParent}`,
          )
        }
        return next === allSubtasks ? prev : { ...prev, collabSubtasks: next }
      })
    }

    es.onmessage = (ev) => {
      lastMessageAt = Date.now()
      let msg: any = null
      try {
        msg = JSON.parse(String(ev.data || ''))
      } catch {
        // 非 JSON 的 keepalive 帧（如 ping）也算活跃流量
        lastMessageAt = Date.now()
        return
      }
      const type = String(msg?.type || '')
      const data = msg?.data || {}
      if (!data || typeof data !== 'object') return
      if (debugSubtaskFlowEnabled()) {
        const stepForLog = shortLogText((data as any).current_step || '')
        const resultForLog = shortLogText((data as any).result || '')
        const errorForLog = shortLogText((data as any).error || '')
        const outputText = stepForLog || resultForLog || errorForLog || ''
        const outputSource = stepForLog
          ? 'current_step'
          : resultForLog
            ? 'result'
            : errorForLog
              ? 'error'
              : ''
        // eslint-disable-next-line no-console
        console.debug(
          `[subtask-flow][project-sse][event] type=${type} task_id=${String((data as any).task_id || '')} source=${outputSource} text="${outputText}"`,
        )
      }

      if (type === 'task:started') {
        patchByTaskId(
          String((data as any).task_id || ''),
          { status: 'executing' },
          [String((data as any).subtask_id || ''), String((data as any).collab_subtask_id || '')],
        )
        return
      }
      if (type === 'task:running') {
        const resolvedCollabSid = String(
          (data as any).collab_subtask_id || (data as any).subtask_id || (data as any).task_id || '',
        )
        const evObj: Record<string, unknown> = {
          type: 'task_running',
          task_id: String((data as any).task_exec_id || (data as any).task_id || ''),
          collab_subtask_id: resolvedCollabSid,
          message: (data as any).message,
          message_index: (data as any).message_index,
          total_messages: (data as any).total_messages,
          subagent_type: (data as any).subagent_type,
        }
        if (debugSubtaskFlowEnabled()) {
          const sTaskId = String((data as any).task_id || '')
          const sCollabId = resolvedCollabSid
          const sText = textFromSubtaskRawMessage((data as any).message)
          // eslint-disable-next-line no-console
          console.debug(
            `[subtask-flow][project-sse][raw] task_id=${sTaskId} collab_subtask_id=${sCollabId} source=message text="${sText}"`,
          )
        }
        setSubagentDockTasks((prev) => {
          const next = { ...prev }
          mergeSubagentStreamEvent(next, evObj)
          setThreadPanelState((tp) => ({ ...tp, subagentTasks: next }))
          return next
        })
        patchByTaskId(
          String((data as any).task_id || ''),
          { status: 'executing' },
          [String((data as any).subtask_id || ''), String((data as any).collab_subtask_id || '')],
        )
        return
      }
      if (type === 'task_memory:updated') {
        const tId = String((data as any).task_id || '')
        const subtaskId = String((data as any).subtask_id || '')
        const collabSubtaskId = String((data as any).collab_subtask_id || '')
        patchByTaskId(tId, { status: 'executing' }, [subtaskId, collabSubtaskId])
        return
      }
      if (type === 'task:heartbeat' || type === 'task:progress') {
        const tId = String((data as any).task_id || '')
        const subtaskId = String((data as any).subtask_id || '')
        const collabSubtaskId = String((data as any).collab_subtask_id || '')
        const st = String((data as any).status || '').trim()
        const prog = (data as any).progress
        patchByTaskId(tId, {
          status: st || 'executing',
          ...(typeof prog === 'number' ? { progress: prog } : {}),
        }, [subtaskId, collabSubtaskId])
        return
      }
      if (type === 'task:completed') {
        patchByTaskId(
          String((data as any).task_id || ''),
          {
            status: 'completed',
            progress: 100,
            ...(typeof (data as any).result === 'string' ? { outputSummary: (data as any).result } : {}),
          },
          [String((data as any).subtask_id || ''), String((data as any).collab_subtask_id || '')],
        )
        return
      }
      if (type === 'task:failed') {
        patchByTaskId(
          String((data as any).task_id || ''),
          {
            status: 'failed',
            progress: 0,
            ...(typeof (data as any).error === 'string' ? { outputSummary: (data as any).error } : {}),
          },
          [String((data as any).subtask_id || ''), String((data as any).collab_subtask_id || '')],
        )
      }
    }

    es.onerror = () => {
      if (debugSubtaskFlowEnabled()) {
        // eslint-disable-next-line no-console
        console.debug(`[subtask-flow][project-sse] error/close project_id=${projId}`)
      }
      // 断线后立即触发重连，避免卡在“运行中…”且无后续事件
      try { es.close() } catch {}
      if (projectEventsRef.current === es) projectEventsRef.current = null
      bumpProjectEventsRetry()
    }

    return () => {
      if (debugSubtaskFlowEnabled()) {
        // eslint-disable-next-line no-console
        console.debug(`[subtask-flow][project-sse] cleanup project_id=${projId}`)
      }
      window.clearInterval(staleCheckTimer)
      try { es.close() } catch {}
      if (projectEventsRef.current === es) projectEventsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadPanelState.collabTask?.projectId, threadPanelState.boundProjectId, projectEventsRetry])

  /** task-progress / 刷新 / 本轮 final 后：合并 collab_phase、bound_*、持久化 supervisor_steps 与主任务快照 */
  const applyTaskProgressSnapshot = useCallback(
    (snap: Record<string, unknown> | null) => {
      if (!snap) return
      const phase = typeof snap.collab_phase === 'string' ? snap.collab_phase : null
      const boundTaskId =
        typeof snap.bound_task_id === 'string' && snap.bound_task_id.trim()
          ? snap.bound_task_id.trim()
          : null
      const boundProjectId =
        typeof snap.bound_project_id === 'string' && snap.bound_project_id.trim()
          ? snap.bound_project_id.trim()
          : null
      const stepsFromSnap = mapSnapSupervisorSteps(snap.supervisor_steps)

      const mainRaw = snap.main_task
      if (!mainRaw || typeof mainRaw !== 'object') {
        setThreadPanelState((prev) => ({
          ...prev,
          ...(phase != null ? { collabPhase: phase } : {}),
          ...(boundTaskId != null ? { boundTaskId } : {}),
          ...(boundProjectId != null ? { boundProjectId } : {}),
          ...(stepsFromSnap.length ? { supervisorSteps: stepsFromSnap } : {}),
        }))
        return
      }
      const main = mainRaw as Record<string, unknown>
      const taskId = typeof main.taskId === 'string' ? main.taskId.trim() : ''
      if (!taskId) {
        setThreadPanelState((prev) => ({
          ...prev,
          ...(phase != null ? { collabPhase: phase } : {}),
          ...(boundTaskId != null ? { boundTaskId } : {}),
          ...(boundProjectId != null ? { boundProjectId } : {}),
          ...(stepsFromSnap.length ? { supervisorSteps: stepsFromSnap } : {}),
        }))
        return
      }
      const subsRaw = snap.subtasks
      const collabSubtasks: CollabSubtaskSnapshot[] = Array.isArray(subsRaw)
        ? (subsRaw
            .map((row) => {
              const r = row as Record<string, unknown>
              const sid = typeof r.subtaskId === 'string' ? r.subtaskId.trim() : ''
              if (!sid) return null
              const out: CollabSubtaskSnapshot = {
                subtaskId: sid,
                ...(typeof r.parentTaskId === 'string' ? { parentTaskId: r.parentTaskId } : {}),
                ...(typeof r.name === 'string' ? { name: r.name } : {}),
                ...(typeof r.description === 'string' ? { description: r.description } : {}),
                ...(typeof r.status === 'string' ? { status: r.status } : {}),
                ...(typeof r.progress === 'number' ? { progress: r.progress } : {}),
                ...(typeof r.assignedAgent === 'string' ? { assignedAgent: r.assignedAgent } : {}),
                ...(typeof (r as any).memory?.output_summary === 'string'
                  ? { outputSummary: (r as any).memory.output_summary }
                  : typeof (r as any).outputSummary === 'string'
                    ? { outputSummary: (r as any).outputSummary }
                    : {}),
                ...(Array.isArray((r as any).observedToolCalls)
                  ? { observedToolCalls: (r as any).observedToolCalls }
                  : Array.isArray((r as any).observed_tool_calls)
                    ? { observedToolCalls: (r as any).observed_tool_calls }
                    : []),
              }
              return out
            })
            .filter(Boolean) as CollabSubtaskSnapshot[])
        : []

      const collabTask: CollabTaskSnapshot = {
        taskId,
        ...(typeof main.projectId === 'string' && main.projectId.trim()
          ? { projectId: main.projectId.trim() }
          : {}),
        ...(typeof main.name === 'string' ? { name: main.name } : {}),
        ...(typeof main.status === 'string' ? { status: main.status } : {}),
        ...(typeof main.progress === 'number' ? { progress: main.progress } : {}),
      }

      setThreadPanelState((prev) => {
        const prevTaskId = (prev.collabTask?.taskId || '').trim()
        const switchedTask = !!prevTaskId && prevTaskId !== taskId
        return {
          ...prev,
          collabPhase: phase ?? prev.collabPhase,
          boundTaskId: boundTaskId ?? prev.boundTaskId,
          boundProjectId: boundProjectId ?? prev.boundProjectId,
          // 如果快照缺少 progress（或进度暂时未返回），避免把旧的 progress 覆盖成空
          // 只有在 taskId 切换时才重置为新快照的 collabTask。
          collabTask: switchedTask ? collabTask : { ...(prev.collabTask || {}), ...collabTask },
          collabSubtasks: switchedTask ? collabSubtasks : collabSubtasks,
          supervisorSteps: stepsFromSnap.length ? stepsFromSnap : switchedTask ? [] : prev.supervisorSteps,
        }
      })
      upsertSidebarTaskView(collabTask, collabSubtasks, stepsFromSnap)
    },
    [upsertSidebarTaskView],
  )

  // NOTE: 已移除 scheduleCollabTaskProgressRefresh（不再通过 /task-progress 拉取侧栏快照）

  /** 从 MCP/技能等页点侧栏会话列表进入聊天时，shell-aside 写入待选会话 */
  useEffect(() => {
    console.log('%c====== [ChatApp] 组件初始化 ======', 'color: #00ff00; font-size: 16px; font-weight: bold;')
    console.log('[ChatApp] 时间:', new Date().toLocaleTimeString())
    console.log('[ChatApp] 当前会话:', selectedSessionKey)
    
    // ========== 任务进度可视化系统初始化 ==========
    console.log('%c[ChatApp] 正在初始化任务系统...', 'color: #00ffff; font-size: 14px')
    console.log('[ChatApp] 任务系统已就绪，将监听工具调用')
    console.log('%c====== [ChatApp] 任务系统初始化完成 ======', 'color: #00ff00; font-size: 16px; font-weight: bold;')
    
    try {
      const pending =
        sessionStorage.getItem('ytpanel_pending_shell_session') ||
        sessionStorage.getItem('deerpanel_pending_shell_session')
      if (pending) {
        sessionStorage.removeItem('ytpanel_pending_shell_session')
        sessionStorage.removeItem('deerpanel_pending_shell_session')
        setSelectedSessionKey(pending)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    sessionRef.current = selectedSessionKey
    try {
      localStorage.setItem(STORAGE_SELECTED_SESSION_KEY, selectedSessionKey)
    } catch {
      /* ignore */
    }
  }, [selectedSessionKey])

  // 如果用户在某个会话条目点击“刷新”，先切换会话，再在切换完成后触发 reload。
  useEffect(() => {
    if (!pendingRefreshKey) return
    if (pendingRefreshKey !== selectedSessionKey) return
    setPendingRefreshKey(null)
    void reload()
  }, [pendingRefreshKey, reload, selectedSessionKey])

  // 新建 Agent：在历史加载完成后发送引导消息，避免与乐观渲染/历史回填打架。
  useEffect(() => {
    if (!pendingNewAgentBootstrapName) return
    if (historyLoading) return
    const agentId = parseSessionAgent(selectedSessionKey)
    if (!agentId || agentId !== pendingNewAgentBootstrapName) return
    setPendingNewAgentBootstrapName(null)
    const text = `新智能体的名称是 ${agentId}，现在开始为它生成 **SOUL**。`
    void handleSend(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewAgentBootstrapName, historyLoading, selectedSessionKey])

  useEffect(() => {
    if (!newAgentModalOpen) return
    const t = window.setTimeout(() => {
      newAgentNameInputRef.current?.focus()
      newAgentNameInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [newAgentModalOpen])

  // 点击空白处关闭“更多操作”菜单
  useEffect(() => {
    if (!moreMenuKey) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-session-more-root]')) return
      setMoreMenuKey(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [moreMenuKey])

  // 底部下拉（模型/智能体）：点击空白处关闭
  useEffect(() => {
    if (!bottomModelOpen && !bottomAgentOpen && !bottomCreativeOpen && !bottomWorkspaceOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (bottomModelRootRef.current && bottomModelRootRef.current.contains(target)) return
      if (bottomAgentRootRef.current && bottomAgentRootRef.current.contains(target)) return
      if (bottomCreativeRootRef.current && bottomCreativeRootRef.current.contains(target)) return
      if (bottomWorkspaceRootRef.current && bottomWorkspaceRootRef.current.contains(target)) return
      setBottomModelOpen(false)
      setBottomAgentOpen(false)
      setBottomCreativeOpen(false)
      setBottomWorkspaceOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setBottomModelOpen(false)
        setBottomAgentOpen(false)
        setBottomCreativeOpen(false)
        setBottomWorkspaceOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [bottomModelOpen, bottomAgentOpen, bottomCreativeOpen, bottomWorkspaceOpen])

  const appendHostedSystemMessage = useCallback(
    (text: string) => {
      setRows((r) => [
        ...r,
        {
          role: 'system',
          text,
          timestamp: Date.now(),
        },
      ])
    },
    [setRows],
  )

  const hosted = useHostedAgent({
    sessionKey: selectedSessionKey,
    onAppendSystemMessage: appendHostedSystemMessage,
  })

  const scheduleBump = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      bumpStream()
    })
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const { api } = await import('../lib/tauri-api.js')
      const data = await api.chatSessionsList(50)
      const nextSessions = (data?.sessions || []) as ChatSessionRow[]
      setSessions(nextSessions)

      const keys = new Set(nextSessions.map((s) => String(s.sessionKey || '')).filter(Boolean))
      if (keys.size > 0 && !keys.has(sessionRef.current)) {
        const stored = localStorage.getItem(STORAGE_SELECTED_SESSION_KEY) || ''
        if (stored && keys.has(stored)) {
          setSelectedSessionKey(stored)
        } else if (keys.has(CHAT_MAIN_SESSION_KEY)) {
          setSelectedSessionKey(CHAT_MAIN_SESSION_KEY)
        } else {
          setSelectedSessionKey(nextSessions[0]?.sessionKey || CHAT_MAIN_SESSION_KEY)
        }
      }
    } catch (e) {
      console.warn('[ChatApp] sessions', e)
    } finally {
      setListLoading(false)
    }
  }, [])

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions]
    sorted.sort((a, b) => {
      const da = ((b.updatedAt ?? b.lastActivity ?? b.createdAt) || 0) - ((a.updatedAt ?? a.lastActivity ?? b.createdAt) || 0)
      if (da !== 0) return da
      const ka = String(a.sessionKey || '')
      const kb = String(b.sessionKey || '')
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
    return sorted
  }, [sessions, sessionNamesTick])  // 添加 sessionNamesTick 依赖，名称更新时重新排序

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase()
    if (!q) return sortedSessions
    return sortedSessions.filter((s) => getDisplayLabel(s.sessionKey).toLowerCase().includes(q))
  }, [sortedSessions, sessionFilter, sessionNamesTick])

  async function getApi() {
    if (apiRef.current) return apiRef.current
    const mod = await import('../lib/tauri-api.js')
    apiRef.current = mod.api
    return apiRef.current
  }

  const applyLocalWorkspaceRoot = useCallback(
    async (inputPath: string) => {
      const raw = (inputPath || '').trim()
      if (!raw) return
      try {
        const api = await getApi()
        const resolvedInfo = await api.resolveWorkspacePath(raw)
        const resolved = String(resolvedInfo?.resolved || raw).trim()
        if (!resolved) return
        if (resolvedInfo && resolvedInfo.exists === false) {
          toast(`目录不存在：${resolved}`, 'error')
          return
        }
        if (resolvedInfo && resolvedInfo.is_dir === false) {
          toast(`不是文件夹：${resolved}`, 'error')
          return
        }

        setLocalWorkspaceRoot(resolved)

        // 历史：按当前会话存储；去重 + 最新置顶 + 截断
        setWorkspaceHistory((prev) => {
          const next = [resolved, ...prev.filter((x) => x !== resolved)].slice(0, 30)
          if (selectedSessionKey) wsClient.setWorkspaceHistory(selectedSessionKey, next)
          return next
        })

        if (selectedSessionKey) {
          await api.chatUpdateContext(selectedSessionKey, { local_workspace_root: resolved, use_virtual_paths: false })
        }
        if (useVirtualPaths) {
          setUseVirtualPaths(false)
          setUseVirtualPathsState(false)
        }
        toast(`已设置工作空间：${resolved}`, 'success')
      } catch (err) {
        toast(String((err as Error)?.message || err), 'error')
      }
    },
    [selectedSessionKey, useVirtualPaths],
  )

  const openWorkspaceFolderPicker = useCallback(async () => {
    try {
      // Tauri v2：优先用系统目录选择对话框
      if ((window as any).__TAURI__) {
        const dlg = await import('@tauri-apps/plugin-dialog')
        const picked = await dlg.open({
          directory: true,
          multiple: false,
          title: '选择工作空间文件夹',
        })
        const p = Array.isArray(picked) ? picked[0] : picked
        if (!p) return
        await applyLocalWorkspaceRoot(String(p))
        return
      }
    } catch {
      // ignore and fallback
    }
    // Web fallback：用自定义弹窗替代 window.prompt（更美观）
    const current = (localWorkspaceRoot || '').trim()
    const next = await promptWorkspacePath(current)
    if (!next) return
    await applyLocalWorkspaceRoot(next)
  }, [applyLocalWorkspaceRoot, localWorkspaceRoot])

  async function reconcileCollabWithMode(sessionKey: string) {
    const api = await getApi()
    const on = getSessionCollabModeFromMeta(sessionKey)
    if (on) {
      await api.chatUpdateContext(sessionKey, {
        subagent_enabled: true,
        is_plan_mode: true,
        collab_task_id: null,
      })
    } else {
      await api.chatUpdateContext(sessionKey, { collab_task_id: null })
    }
  }

  async function applySessionModePreset(sessionKey: string, mode: SessionMode) {
    const api = await getApi()
    let contextUpdate: any = null
    if (mode === 'ultra') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: 'high',
        is_plan_mode: true,
        subagent_enabled: true,
      }
    } else if (mode === 'pro') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: 'medium',
        is_plan_mode: true,
        subagent_enabled: false,
      }
    } else if (mode === 'thinking') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: 'low',
        is_plan_mode: false,
        subagent_enabled: false,
      }
    } else if (mode === 'flash') {
      contextUpdate = {
        thinking_enabled: false,
        reasoning_effort: 'minimal',
        is_plan_mode: false,
        subagent_enabled: false,
      }
    }
    if (contextUpdate) {
      await api.chatUpdateContext(sessionKey, contextUpdate)
    }
    await reconcileCollabWithMode(sessionKey)
  }

  async function applyCollabServerPatch(sessionKey: string, on: boolean) {
    const threadId = on ? await wsClient.ensureChatThread(sessionKey) : wsClient.getSessionThreadId(sessionKey)
    if (!threadId) return
    if (on) {
      await wsClient.putThreadCollabState(threadId, { collab_phase: 'planning' })
    } else {
      await wsClient.putThreadCollabState(threadId, {
        collab_phase: 'idle',
        bound_task_id: null,
        bound_project_id: null,
      })
    }
  }

  async function setSessionModeAndApply(mode: SessionMode) {
    if (!selectedSessionKey) return
    if (mode === sessionMode) return
    setSessionModeInMeta(selectedSessionKey, mode)
    setSessionMode(mode)
    try {
      await applySessionModePreset(selectedSessionKey, mode)
      toast(`已切换为：${modeLabel(mode)}`, 'success')
    } catch (e) {
      toast(`切换模式失败: ${String((e as Error)?.message || e)}`, 'error')
    }
  }

  async function toggleCollab(on: boolean) {
    if (!selectedSessionKey) return
    if (collabBusy) return
    setCollabBusy(true)
    try {
      setSessionCollabModeInMeta(selectedSessionKey, on)
      setCollabOn(on)
      // 先应用当前模式 preset，再进入/退出协作，保证 thinking/reasoning/subagent 与旧页一致。
      await applySessionModePreset(selectedSessionKey, sessionMode)
      await applyCollabServerPatch(selectedSessionKey, on)
      toast(on ? '已开启任务协作' : '已退出任务协作', on ? 'success' : 'info')
    } catch (e) {
      toast(`协作切换失败: ${String((e as Error)?.message || e)}`, 'error')
    } finally {
      setCollabBusy(false)
    }
  }

  async function createNewAgentAndSwitch(agentNameRaw: string) {
    const name = (agentNameRaw || '').trim().toLowerCase()
    if (!name) return
    if (!/^[a-z0-9-]+$/.test(name)) {
      toast('Agent 名称只能包含小写字母、数字和连字符', 'warning')
      return
    }

    setNewAgentModalBusy(true)
    setNewAgentModalError(null)
    try {
      // 检查名称是否可用（失败时仍继续创建，匹配 legacy）
      try {
        const api = await getApi()
        const check = await api.checkAgentName(name)
        if (check?.available === false) {
          toast('Agent 名称已存在', 'warning')
          return
        }
      } catch {
        // ignore
      }

      const api = await getApi()
      await api.createAgent({
        name,
        description: '',
        model: null,
        tool_groups: null,
        soul: '',
      })
      toast('Agent 已创建', 'success')

      const nextKey = `agent:${name}:new-${Date.now().toString(36)}`
      setSessionModeInMeta(nextKey, 'flash')
      setSessionCollabModeInMeta(nextKey, collabOn)
      setSessionMode('flash')

      await applySessionModePreset(nextKey, 'flash')

      // 切换到新会话
      setSelectedSessionKey(nextKey)
      sessionRef.current = nextKey
      setPendingNewAgentBootstrapName(name)

      // 刷新 agent 列表 & 历史
      try {
        const listRes = await api.listAgents()
        const list = Array.isArray(listRes) ? listRes : listRes?.agents || []
        setAgents(list)
      } catch {
        // ignore
      }
      await refreshSessions()
      setNewAgentModalOpen(false)
    } catch (e) {
      toast('创建失败: ' + String((e as Error)?.message || e), 'error')
    } finally {
      setNewAgentModalBusy(false)
    }
  }

  useEffect(() => {
    if (!wsClient.connected) wsClient.connect()
    void refreshSessions()
    const u1 = wsClient.onReady(() => {
      void refreshSessions()
    })
    
    // 监听会话名称更新事件
    const onNameUpdate = () => {
      setSessionNamesTick((t) => t + 1)  // 增加 tick，强制重新计算 sortedSessions
      void refreshSessions()
    }
    window.addEventListener('session-name-updated', onNameUpdate)
    
    return () => {
      u1()
      window.removeEventListener('session-name-updated', onNameUpdate)
    }
  }, [refreshSessions])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setModelsLoading(true)
      try {
        const resp = await fetch('/api/models')
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        const rows = Array.isArray(data?.models) ? data.models : []
        const seen = new Set<string>()
        const next: string[] = []
        for (const item of rows) {
          const name = item?.name && typeof item.name === 'string' ? item.name : ''
          if (!name || seen.has(name)) continue
          seen.add(name)
          next.push(name)
        }

        const ctxModel = wsClient.getSessionContext(selectedSessionKey)?.model_name
        const saved = localStorage.getItem(STORAGE_MODEL_KEY) || ''
        if (ctxModel && typeof ctxModel === 'string' && ctxModel.trim() && !seen.has(ctxModel)) {
          seen.add(ctxModel)
          next.unshift(ctxModel)
        }
        if (saved && !seen.has(saved)) {
          seen.add(saved)
          next.push(saved)
        }

        if (cancelled) return
        setModelOptions(next)

        // 初始化选择：优先用 context，否则用已保存值，否则 Auto
        const initial =
          (ctxModel && typeof ctxModel === 'string' && ctxModel.trim() ? ctxModel.trim() : '') ||
          (saved ? saved : '') ||
          ''
        if (!initial || !next.includes(initial)) {
          setModelName('')
        } else {
          setModelName(initial)
        }
      } catch (e) {
        if (cancelled) return
        setModelOptions([])
        setModelName('')
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 模型列表与 session 无关：只在首次进入加载一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 如果 session context 指定了 model_name，并且它在可选列表中，就同步选择
    const ctxModel = wsClient.getSessionContext(selectedSessionKey)?.model_name
    if (!ctxModel || typeof ctxModel !== 'string') return
    if (!modelOptions.length) return
    if (!modelOptions.includes(ctxModel)) return
    setModelName(ctxModel)
  }, [selectedSessionKey, modelOptions])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setAgentsLoading(true)
      try {
        const api = await getApi()
        const result = await api.listAgents()
        if (cancelled) return
        const list = Array.isArray(result) ? result : result?.agents || []
        setAgents(list)
      } catch {
        if (!cancelled) setAgents([])
      } finally {
        if (!cancelled) setAgentsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // 切换会话时彻底重置流式状态并停止之前的请求
    const prevSessionKey = sessionRef.current
    if (prevSessionKey && prevSessionKey !== selectedSessionKey) {
      // 1. 停止旧会话的流式请求（前端）
      const api = apiRef.current
      if (api) {
        api.chatAbort(prevSessionKey).catch(() => {
          // 忽略错误，可能请求已经结束了
        })
      }
      
      // 2. 取消所有全局运行（释放后端 worker 资源，避免新会话被旧任务阻塞）
      import('../lib/ws-client.js').then(({ wsClient }) => {
        // 同步把“协作阶段”置空闲：用于后端 `resume-stream` SSE 终止
        // 避免某些桌面端取消请求不完全生效，导致仍持续接收/增量推送。
        try {
          const prevThreadId = wsClient.getSessionThreadId(prevSessionKey)
          if (prevThreadId) {
            void wsClient.putThreadCollabState(prevThreadId, { collab_phase: 'idle' }).catch(() => {
              /* ignore */
            })
          }
        } catch {
          /* ignore */
        }
        wsClient.cancelAllGlobalRunsBestEffort().catch(() => {
          // 忽略错误
        })
      })
    }
    
    streamRef.current = emptyStream()
    // 切换会话时，必须清空“发送中/续流中”标记，否则历史会话会错误显示“正在处理中”
    setIsSending(false)
    setResumeBusy(false)
    resumeInFlightRef.current = false
    // 切换到新会话后允许重新尝试一次续流
    if (selectedSessionKey) resumeAttemptedRef.current[String(selectedSessionKey)] = false
    seenRunIdsRef.current = new Set()
    setSubagentDockTasks({})
    setSidebarTaskViews({})
    setSidebarSelectedTaskId(null)
    setThreadPanelState(emptyThreadPanel())
    setHasReceivedTodos(false)  // 重置 todos 接收标志
    // 清除新会话的活跃时间，让它立即过期
    delete lastActivityRef.current[selectedSessionKey]
    setSessionMode(getSessionModeFromMeta(selectedSessionKey))
    setCollabOn(getSessionCollabModeFromMeta(selectedSessionKey))
    setModeMenuOpen(false)
    bumpStream()

    // 工作空间与本会话绑定：切换会话时同步「当前目录」与「历史」显示
    try {
      const ctx = wsClient.getSessionContext(selectedSessionKey)
      setLocalWorkspaceRoot(String(ctx.local_workspace_root || '').trim())
      setWorkspaceHistory(wsClient.getWorkspaceHistory(selectedSessionKey))
    } catch {
      setLocalWorkspaceRoot('')
      setWorkspaceHistory([])
    }
  }, [selectedSessionKey])

  // NOTE: 已移除「刷新/切换会话后恢复任务侧栏（task-progress 快照）」的逻辑（优化进度展示功能下线）

  // 刷新/切换后：如果当前 thread 仍有 pending/running run，
  // 通过后端 `resume-stream` 重新挂接 SSE 流，恢复真正的“流式增量”展示。
  useEffect(() => {
    if (!selectedSessionKey) return

    let cancelled = false
    // 只在挂载后的短窗口内尝试一次“断点续流”，避免正常流式过程中重复发起 resume-stream。
    const startResumeIfNeeded = async () => {
      if (cancelled) return
      // 已经尝试过一次续流就不再试（避免 busy 残留/状态抖动导致重复调用）
      if (resumeAttemptedRef.current[String(selectedSessionKey)]) return
      // 正在发送/已有流式 UI 时，绝不触发断点续流
      if (isSendingRef.current) return
      // 前端已有流或正在发送时，不再续流
      const hasLocalStream =
        !!(
          streamRef.current.text ||
          streamRef.current.segments?.length ||
          streamRef.current.tools?.length ||
          streamRef.current.images?.length ||
          streamRef.current.videos?.length ||
          streamRef.current.audios?.length ||
          streamRef.current.files?.length ||
          Object.keys(streamRef.current.subagentTasks || {}).length > 0
        )
      if (hasLocalStream) return
      if (resumeInFlightRef.current) return

      const threadId = wsClient.getSessionThreadId(selectedSessionKey)
      if (!threadId) return

      const collabSnap = await wsClient.getThreadCollabState(threadId)
      const phaseRaw = collabSnap?.collab_phase
      const phaseStr = typeof phaseRaw === 'string' ? phaseRaw : String(phaseRaw || 'idle')
      const busy = phaseStr !== 'idle' && phaseStr !== 'done'

      if (!busy) return

      // 旧会话残留的 executing 可能导致“打开任意会话都在续流”。
      // 如果协作状态长时间未更新，则视为过期并自动纠偏为 idle，避免误触发 resume-stream。
      try {
        const rawUpdatedAt = (collabSnap as any)?.updated_at
        const ts = rawUpdatedAt ? Date.parse(String(rawUpdatedAt)) : Number.NaN
        // 经验阈值：5 分钟内仍可能是“真实在跑”；更久基本可判定为残留状态（如异常退出/未正确落盘 done）。
        const STALE_MS = 5 * 60 * 1000
        if (!Number.isNaN(ts) && Date.now() - ts > STALE_MS) {
          void wsClient.putThreadCollabState(threadId, { collab_phase: 'idle' }).catch(() => {
            /* ignore */
          })
          return
        }
      } catch {
        /* ignore */
      }

      // 标记：本会话已尝试续流（成功/失败都算），避免后续重复触发
      resumeAttemptedRef.current[String(selectedSessionKey)] = true
      resumeInFlightRef.current = true
      setResumeBusy(true)
      setIsSending(true)

      try {
        // 改为后端 task-stream：即使主对话 run 结束，也能继续看到子任务进度/记忆
        await wsClient.taskResume(selectedSessionKey, threadId)
      } catch (e) {
        // resume 失败时至少不要卡住 UI
      } finally {
        resumeInFlightRef.current = false
        setIsSending(false)
        setResumeBusy(false)
        streamRef.current = emptyStream()
        scheduleBump()
        void reload()
      }
    }

    // 单次触发，不再长期轮询
    void startResumeIfNeeded()

    return () => {
      cancelled = true
    }
  }, [selectedSessionKey, scheduleBump, reload])

  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    unsubRef.current = wsClient.onEvent((msg: { event?: string; payload?: ChatWsPayload }) => {
      if (msg.event === 'thread_state') {
        const p = msg.payload as any
        if (!p) return
        if (p.sessionKey && p.sessionKey !== sessionRef.current) return
        
        // 检查状态是否过期：如果当前有活跃对话，忽略过期的状态
        const now = Date.now()
        const lastActivity = lastActivityRef.current[sessionRef.current]
        const timeSinceLastActivity = lastActivity ? now - lastActivity : Infinity
        
        // 如果是第一次访问这个会话（lastActivity 不存在），或者超过过期时间，并且当前没有在发送消息，忽略这个状态更新
        if (!lastActivity || timeSinceLastActivity > THREAD_STATE_EXPIRY_MS) {
          if (!isSending) {
            // 静默忽略过期状态，避免显示旧的提示信息
            return
          }
        }
        
        const prevTitle = threadPanelState.title
        const newTitle = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : null
        const newTodos = Array.isArray(p.todos) ? p.todos : []

        // 自动打开任务侧边栏：当首次收到 todos 且不为空时
        if (newTodos.length > 0 && !hasReceivedTodos) {
          setHasReceivedTodos(true)
          openTaskSidebar()
        }

        setThreadPanelState((prev) => ({
          title: newTitle,
          todos: newTodos,
          activityKind: String(p.activityKind || 'idle'),
          activityDetail: String(p.activityDetail || ''),
          reasoningPreview: typeof p.reasoningPreview === 'string' ? p.reasoningPreview : null,
          clarification: p.clarification
            ? {
                toolCallId: p.clarification.toolCallId || p.clarification.tool_call_id || undefined,
                preview: p.clarification.preview || p.clarification.content || undefined,
              }
            : null,
          // thread_state 更新不应清空子智能体聚合态，否则 TODO hover 会匹配不到实时输出
          subagentTasks: prev.subagentTasks,
          collabTask: prev.collabTask,
          collabSubtasks: prev.collabSubtasks,
          supervisorSteps: prev.supervisorSteps,
          collabPhase: prev.collabPhase,
          boundTaskId: prev.boundTaskId,
          boundProjectId: prev.boundProjectId,
        }))
        // 首次拿到标题时自动写入会话名（不覆盖已有手动命名）
        if (!prevTitle && newTitle) {
          persistSessionTitleIfMissing(selectedSessionKey, newTitle)
        }
        return
      }

      if (msg.event !== 'chat') return
      const payload = msg.payload
      if (!payload) return
      if (payload.sessionKey && payload.sessionKey !== sessionRef.current) return
      const chatPayloadMsg = payload.message as { tools?: unknown[] } | undefined

      // ========== 流式调试（默认关闭，避免控制台刷屏；控制台执行 localStorage.setItem('DEERFLOW_DEBUG_STREAM','1') 后刷新） ==========
      const hasTools = !!(chatPayloadMsg?.tools && chatPayloadMsg.tools.length > 0)
      const isToolState = payload.state === 'tool'
      const streamDebug =
        import.meta.env.DEV &&
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('DEERFLOW_DEBUG_STREAM') === '1'

      if (streamDebug && (hasTools || isToolState)) {
        console.log('%c====== [流式响应] 🎯 检测到工具调用 ======', 'color: #ff00ff; font-size: 16px; font-weight: bold; background: #000')
        console.log('[流式响应] 事件类型:', msg.event)
        console.log('[流式响应] 状态:', payload.state)
        console.log('[流式响应] runId:', payload.runId)
        console.log('[流式响应] 时间:', new Date().toLocaleTimeString())
        
        // 输出工具详情
        if (chatPayloadMsg?.tools) {
          console.log('%c[流式响应] 工具数量:', 'color: #00ffff; font-size: 14px', chatPayloadMsg.tools.length)
          
          chatPayloadMsg.tools.forEach((tool: any, index: number) => {
            console.log(`%c[流式响应] ━━ 工具 ${index + 1} ━━`, 'color: #00ff00; font-size: 13px; font-weight: bold')
            console.log('[流式响应] 名称:', tool.name)
            console.log('[流式响应] 输入:', JSON.stringify(tool.input, null, 2))
            
            // 输出格式根据类型决定
            if (typeof tool.output === 'string') {
              console.log('[流式响应] 输出 (字符串):')
              console.log(tool.output)
              
              // 尝试解析 JSON 字符串
              try {
                const parsed = JSON.parse(tool.output)
                console.log('%c[流式响应] ✅ 输出解析为 JSON:', 'color: #00ff00; font-size: 12px')
                console.log(JSON.stringify(parsed, null, 2))
              } catch {
                // 不是 JSON，忽略
              }
            } else {
              console.log('[流式响应] 输出 (对象):')
              console.log(JSON.stringify(tool.output, null, 2))
            }
          })
        }
        
        // 工具状态的完整 payload
        if (isToolState) {
          console.log('%c[流式响应] 完整 payload:', 'color: #ffff00; font-size: 13px')
          console.log(JSON.stringify(payload, null, 2))
        }
        
        if (payload.durationMs) {
          console.log('[流式响应] 耗时:', payload.durationMs, 'ms')
        }
        
        console.log('%c====== [流式响应] 工具调用结束 ======', 'color: #ff00ff; font-size: 16px; font-weight: bold; background: #000')
      }
      // ====================================

      const { state } = payload
      const runId = payload.runId
      const S = streamRef.current

      if (runId && state === 'final' && seenRunIdsRef.current.has(runId)) return
      if (
        runId &&
        state === 'delta' &&
        seenRunIdsRef.current.has(runId) &&
        !S.text &&
        !S.tools.length &&
        !S.segments.length
      ) {
        return
      }

      if (state === 'tool') {
        const entries = normalizeChatToolPayloadToEntries(payload as Record<string, unknown>)
        const newIds = collectNewToolIds(S.tools, entries)
        appendStreamToolSegments(S, newIds)
        noteNewToolIds(S, newIds)
        for (const e of entries) upsertTool(S.tools, { ...e })
        if (!S.runId && runId) S.runId = runId
        if (!S.startTs) S.startTs = Date.now()
        scheduleBump()
        patchCollabFromStreamTools()
        return
      }

      if (state === 'subtask') {
        const ev = payload.subtaskEvent
        if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
          const evObj = ev as Record<string, unknown>
          if (!S.subagentTasks) S.subagentTasks = {}
          mergeSubagentStreamEvent(S.subagentTasks, evObj)
          setSubagentDockTasks((prev) => {
            const next = { ...prev }
            mergeSubagentStreamEvent(next, evObj)
            // 子智能体输出不再进主消息区，仅供顶部 TODO hover 预览
            setThreadPanelState((tp) => ({ ...tp, subagentTasks: next }))
            if (debugSubtaskTooltipEnabled()) {
              const type = String(evObj.type || '')
              const tid = String(evObj.task_id || '')
              const cid = String(evObj.collab_subtask_id || evObj.collabSubtaskId || '')
              const t = tid ? next[tid] : null
              const hasTxt = !!String(t?.liveOutput || t?.progressHint || '').trim()
              const toolN = Array.isArray(t?.tools) ? t?.tools.length : 0
              // eslint-disable-next-line no-console
              console.debug(
                `[subtask-tooltip] type=${type} task_id=${tid} collab_subtask_id=${cid} has_text=${hasTxt} tools=${toolN}`,
              )
            }
            if (debugSubtaskFlowEnabled()) {
              const type = String(evObj.type || '')
              const tid = String(evObj.task_id || '')
              const cid = String(evObj.collab_subtask_id || evObj.collabSubtaskId || '')
              const t = tid ? next[tid] : null
              const liveOutputText = shortLogText(t?.liveOutput || '')
              const progressHintText = shortLogText(t?.progressHint || '')
              const mergedOutputText = liveOutputText || progressHintText || ''
              // eslint-disable-next-line no-console
              console.debug(
                `[subtask-flow][custom][output] type=${type} task_id=${tid} collab_subtask_id=${cid} source=${liveOutputText ? 'liveOutput' : progressHintText ? 'progressHint' : ''} text="${mergedOutputText}"`,
              )
            }
            return next
          })
          const collabSid =
            typeof evObj.collab_subtask_id === 'string'
              ? evObj.collab_subtask_id.trim()
              : typeof evObj.collabSubtaskId === 'string'
                ? evObj.collabSubtaskId.trim()
                : ''
          const nextStatus = collabStatusFromSubagentStreamEv(evObj)
          const rawTaskId = String(evObj.task_id || '').trim()
          const parsed = parseParentAndSubtaskIdFromComposite(rawTaskId)
          const evType = String(evObj.type || '')
          const aggTask = rawTaskId ? (S.subagentTasks || {})[rawTaskId] : undefined
          const customOutputText = String(aggTask?.liveOutput || aggTask?.progressHint || '').trim()
          const placeholderOutput =
            evType === 'task_started'
              ? '（已启动，等待首条输出…）'
              : evType === 'task_running'
                ? '运行中…'
                : ''
          const patchOutput = customOutputText || placeholderOutput || undefined
          if (collabSid && parsed?.parentTaskId) {
            parentTaskToSubtaskRef.current[parsed.parentTaskId] = collabSid
            if (debugSubtaskFlowEnabled()) {
              // eslint-disable-next-line no-console
              console.debug(
                `[subtask-flow][custom] parent-map task_id=${rawTaskId} parent_task_id=${parsed.parentTaskId} collab_subtask_id=${collabSid}`,
              )
            }
          }
          if (debugSubtaskFlowEnabled()) {
            // eslint-disable-next-line no-console
            console.debug(
              `[subtask-flow][custom] status-map collab_subtask_id=${collabSid} ev_type=${String(evObj.type || '')} next_status=${nextStatus || ''}`,
            )
          }
          if (collabSid && nextStatus) {
            setThreadPanelState((prev) => ({
              ...prev,
              collabSubtasks: patchCollabSubtasksById(
                prev.collabSubtasks || [],
                collabSid,
                nextStatus,
                patchOutput ? { outputSummary: patchOutput } : undefined,
              ),
            }))
            setSidebarTaskViews((prev) => {
              let touched = false
              const out = { ...prev }
              for (const k of Object.keys(out)) {
                const v = out[k]
                if (!v?.subtasks?.some((s) => s.subtaskId === collabSid)) continue
                const patched = patchCollabSubtasksById(
                  v.subtasks || [],
                  collabSid,
                  nextStatus,
                  patchOutput ? { outputSummary: patchOutput } : undefined,
                )
                if (patched !== v.subtasks) {
                  out[k] = { ...v, subtasks: patched, updatedAt: Date.now() }
                  touched = true
                }
              }
              return touched ? out : prev
            })
          }
          if (!S.runId && runId) S.runId = runId
          if (!S.startTs) S.startTs = Date.now()
          scheduleBump()
        }
        return
      }

      if (state === 'delta') {
        const c = extractChatContent(payload.message)
        if (!c) return
        let changed = false
        if (c.images?.length) {
          S.images = c.images
          changed = true
        }
        if (c.videos?.length) {
          S.videos = c.videos
          changed = true
        }
        if (c.audios?.length) {
          S.audios = c.audios
          changed = true
        }
        if (c.files?.length) {
          S.files = c.files
          changed = true
        }
        /* 同一条 delta 内先合并正文再封存工具，避免「工具在说明文字上方」 */
        if (c.text) {
          if (applyAssistantTextDelta(S, c.text)) changed = true
        }
        if (c.tools?.length) {
          const newIds = collectNewToolIds(S.tools, c.tools)
          appendStreamToolSegments(S, newIds)
          noteNewToolIds(S, newIds)
          for (const t of c.tools) upsertTool(S.tools, t)
          changed = true
        }
        if (changed) {
          if (!S.runId && runId) S.runId = runId
          if (!S.startTs) S.startTs = Date.now()
          scheduleBump()
          if (c.tools?.length) {
            patchCollabFromStreamTools()
          }
        }
        return
      }

      if (state === 'final') {
        const c = extractChatContent(payload.message)
        const finalText = c?.text || ''
        let finalTools = c?.tools || []
        if (!finalTools.length && S.tools.length) finalTools = [...S.tools]
        if (c?.images?.length) S.images = c.images
        if (c?.videos?.length) S.videos = c.videos
        if (c?.audios?.length) S.audios = c.audios
        if (c?.files?.length) S.files = c.files
        if (finalTools.length) {
          S.tools = finalTools
        }
        const segmentsOut = finalizeAssistantSegments(S)
        let textOut: string
        if (segmentsOut && segmentsOut.length) {
          textOut = ''
        } else {
          textOut = finalText || S.text || ''
        }
        const hasContent =
          textOut ||
          (segmentsOut && segmentsOut.length) ||
          S.images.length ||
          S.videos.length ||
          S.audios.length ||
          S.files.length ||
          S.tools.length

        if (!hasContent) {
          streamRef.current = emptyStream()
          setIsSending(false)
          scheduleBump()
          return
        }

        if (runId) {
          const seen = seenRunIdsRef.current
          seen.add(runId)
          if (seen.size > 200) {
            const first = seen.values().next().value
            if (first !== undefined) seen.delete(first)
          }
        }

        let durStr = ''
        if (payload.durationMs) durStr = (payload.durationMs / 1000).toFixed(1) + 's'
        else if (S.startTs) durStr = ((Date.now() - S.startTs) / 1000).toFixed(1) + 's'

        const usageStats = parseUsageToStats(payload as Record<string, unknown>)
        let tokenStr = ''
        if (usageStats && usageStats.total > 0) {
          tokenStr =
            usageStats.input && usageStats.output
              ? `↑${usageStats.input} ↓${usageStats.output}`
              : `${usageStats.total} tokens`
        }

        // 托管 Agent：捕获本轮 DeerFlow assistant 最终回复，驱动下一步指令或停止。
        void hosted.hostedCapture.onChatFinal(payload, finalText || textOut || S.text || '')

        // 添加新消息到 rows
        const subagentSnap =
          S.subagentTasks && Object.keys(S.subagentTasks).length > 0 ? { ...S.subagentTasks } : undefined
        setRows((r) => {
          const newRows = [
            ...r,
            {
              role: 'assistant' as const,
              text: textOut,
              segments: segmentsOut,
              tools: [...S.tools],
              images: [...S.images],
              videos: [...S.videos],
              audios: [...S.audios],
              files: [...S.files],
              timestamp: Date.now(),
              durationStr: durStr || undefined,
              tokenStr: tokenStr || undefined,
              ...(subagentSnap ? { subagentTasks: subagentSnap } : {}),
            },
          ]
          return newRows
        })

        // final：清空流式缓冲；保留 thread_state 下发的标题/todos/协作任务，仅清除进行中活动区
        streamRef.current = emptyStream()
        const built = buildCollabSidebarFromTools(finalTools) as {
          main: CollabTaskSnapshot | null
          subtasks: CollabSubtaskSnapshot[]
          supervisorSteps: SupervisorStepSnapshot[]
        }
        const collabSnap = built.main
        // final 时也不再用工具结果直接覆盖任务进度，统一等后端 task-progress 快照。
        upsertSidebarTaskView(collabSnap || null, undefined, built.supervisorSteps)
        if (collabSnap?.taskId) {
          openTaskSidebar()
          void tasksAPI
            .getTask(collabSnap.taskId)
            .then((task: unknown) => {
              if (!task || typeof task !== 'object') return
              const t = task as Record<string, unknown>
              setThreadPanelState((prev) => ({
                ...prev,
                collabTask: {
                  taskId: String(t.id ?? collabSnap.taskId),
                  projectId: String(
                    t.parent_project_id ?? t.project_id ?? prev.collabTask?.projectId ?? collabSnap.projectId ?? '',
                  ),
                  name: typeof t.name === 'string' ? t.name : prev.collabTask?.name,
                  status: typeof t.status === 'string' ? t.status : prev.collabTask?.status,
                  progress: typeof t.progress === 'number' ? t.progress : prev.collabTask?.progress,
                },
              }))
            })
            .catch(() => {
              /* 侧栏已凭工具输出展示，API 失败不阻断 */
            })
        }
        setThreadPanelState((prev) => ({
          title: prev.title,
          todos: prev.todos,
          activityKind: 'idle',
          activityDetail: '',
          reasoningPreview: null,
          clarification: null,
          collabPhase: prev.collabPhase,
          boundTaskId: prev.boundTaskId,
          boundProjectId: prev.boundProjectId,
          collabTask:
            collabSnap?.taskId != null
              ? { ...(prev.collabTask || {}), ...collabSnap }
              : prev.collabTask,
          collabSubtasks: prev.collabSubtasks,
          supervisorSteps:
            collabSnap?.taskId && (prev.collabTask?.taskId || '').trim() !== collabSnap.taskId
              ? built.supervisorSteps
              : built.supervisorSteps.length
                ? built.supervisorSteps
                : prev.supervisorSteps,
        }))
        setIsSending(false)
        scheduleBump()
        void refreshSessions()
        // 关键：同一会话内主对话先结束、子任务仍在跑时，立即接力 task-stream，
        // 避免用户看到“主智能体回复后就停了”。
        {
          const sk = sessionRef.current
          const tid = wsClient.getSessionThreadId(sk)
          if (tid && !resumeInFlightRef.current) {
            void (async () => {
              try {
                const collabSnap = await wsClient.getThreadCollabState(tid)
                const phaseRaw = collabSnap?.collab_phase
                const phaseStr = typeof phaseRaw === 'string' ? phaseRaw : String(phaseRaw || 'idle')
                const busy = phaseStr !== 'idle' && phaseStr !== 'done'
                if (!busy) return
                // final 后的接力属于强制兜底，不受“本会话仅一次尝试”限制
                resumeAttemptedRef.current[String(sk)] = false
                resumeAttemptedRef.current[String(sk)] = true
                resumeInFlightRef.current = true
                setResumeBusy(true)
                setIsSending(true)
                await wsClient.taskResume(sk, tid)
              } catch (e) {
                // 失败后允许后续再次尝试，避免一次失败永久失去接力能力
                resumeAttemptedRef.current[String(sk)] = false
                console.warn('[ChatApp] taskResume after final failed:', e)
              } finally {
                resumeInFlightRef.current = false
                setIsSending(false)
                setResumeBusy(false)
                streamRef.current = emptyStream()
                scheduleBump()
                void reload()
              }
            })()
          }
        }
        return
      }

      if (state === 'aborted') {
        if (S.text || S.segments.length || S.tools.length) {
          const segmentsOut = finalizeAssistantSegments(S)
          let textOut = ''
          if (segmentsOut && segmentsOut.length) {
            // 有 segments 时，优先让 segments 展示，避免 tail 再重复一份
            textOut = ''
          } else {
            textOut = flattenStreamDisplayText(segmentsOut || [], '') || S.text
          }
          setRows((r) => [
            ...r,
            {
              role: 'assistant' as const,
              text: textOut,
              segments: segmentsOut,
              tools: [...S.tools],
              images: [...S.images],
              videos: [...S.videos],
              audios: [...S.audios],
              files: [...S.files],
              timestamp: Date.now(),
            },
          ])
        }
        setRows((r) => [...r, { role: 'system' as const, text: '生成已停止', timestamp: Date.now() }])
        streamRef.current = emptyStream()
        setSubagentDockTasks({})
        setThreadPanelState(emptyThreadPanel())
        setIsSending(false)
        scheduleBump()
        return
      }

      if (state === 'error') {
        const errMsg = payload.errorMessage || payload.error?.message || '未知错误'
        if (/origin not allowed|NOT_PAIRED|PAIRING_REQUIRED|auth.*fail/i.test(errMsg)) return
        const now = Date.now()
        if (lastErrorRef.current.msg === errMsg && now - lastErrorRef.current.ts < 2000) return
        lastErrorRef.current = { msg: errMsg, ts: now }
        if (S.text || S.tools.length || S.segments.length) return
        toast(errMsg, 'error')
        setIsSending(false)
        streamRef.current = emptyStream()
        setThreadPanelState(emptyThreadPanel())
        scheduleBump()
      }
    })
    return () => {
      if (unsubRef.current) {
        unsubRef.current()
        unsubRef.current = null
      }
    }
  }, [
    scheduleBump,
    setRows,
    refreshSessions,
    patchCollabFromStreamTools,
    applyTaskProgressSnapshot,
    upsertSidebarTaskView,
    hasReceivedTodos,
    isSending,
    openTaskSidebar,
    selectedSessionKey,
    threadPanelState.title,
  ])

  const streaming = !!(
    streamRef.current.text ||
    streamRef.current.segments?.length ||
    streamRef.current.tools?.length ||
    streamRef.current.images?.length ||
    streamRef.current.videos?.length ||
    streamRef.current.audios?.length ||
    streamRef.current.files?.length ||
    Object.keys(streamRef.current.subagentTasks || {}).length > 0
  )
  const sidebarHistory = useMemo(
    () =>
      Object.values(sidebarTaskViews)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((x) => x.task),
    [sidebarTaskViews],
  )

  // 刷新/切换后恢复 run 时：末尾落库的“进行中 assistant”会导致流式气泡不再出现（MessageVirtualList 只在 lastRow 是 user 时渲染 _stream）。
  // 因此 run 忙碌时临时隐藏最后一条 assistant，并用 streamRef 恢复当前文本/工具。
  const renderRows = useMemo(() => {
    if (!resumeBusy) return rows
    if (!Array.isArray(rows) || rows.length === 0) return rows
    const last = rows[rows.length - 1]
    if (last?.role === 'assistant') return rows.slice(0, -1)
    return rows
  }, [rows, resumeBusy])
  const sidebarActiveTaskId = sidebarSelectedTaskId || sidebarHistory[0]?.taskId || threadPanelState.collabTask?.taskId || null
  const sidebarActiveView = sidebarActiveTaskId ? sidebarTaskViews[sidebarActiveTaskId] : undefined
  const runManagerTaskNames = useMemo(
    () =>
      sidebarHistory.map((t) => ({
        taskId: t.taskId,
        name: (t.name || '').trim() || t.taskId,
      })),
    [sidebarHistory],
  )

  const shellSyncPayload = useMemo(() => {
    const rows = filteredSessions.map((s) => ({
      sessionKey: s.sessionKey,
      title: getDisplayLabel(s.sessionKey),
      time: formatSessionListTime(s),
      active: selectedSessionKey === s.sessionKey,
      canDelete: s.sessionKey !== CHAT_MAIN_SESSION_KEY,
    }))
    return {
      listLoading,
      sessionFilter,
      moreMenuKey,
      newTaskActive: NEW_DRAFT_SESSION_KEY_RE.test(selectedSessionKey),
      rows,
    }
  }, [filteredSessions, listLoading, sessionFilter, moreMenuKey, selectedSessionKey, sessionNamesTick])

  useEffect(() => {
    try {
      sessionStorage.setItem(SHELL_SIDEBAR_SYNC_STORAGE_KEY, JSON.stringify(shellSyncPayload))
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('ytpanel:chat-sidebar-sync', { detail: shellSyncPayload }))
    return () => {
      let detail: typeof shellSyncPayload | null = null
      try {
        const raw = sessionStorage.getItem(SHELL_SIDEBAR_SYNC_STORAGE_KEY)
        if (raw) detail = JSON.parse(raw) as typeof shellSyncPayload
      } catch {
        detail = null
      }
      window.dispatchEvent(new CustomEvent('ytpanel:chat-sidebar-sync', { detail }))
    }
  }, [shellSyncPayload])

  // 底部操作区不依赖对话中是否已出现用户/助手消息：保持“创意”按钮常驻

  async function handleSend(message: string, attachments?: ChatAttachment[]) {
    if (!selectedSessionKey) return
    // 更新活跃时间，防止状态被过期
    lastActivityRef.current[selectedSessionKey] = Date.now()
    // 新一轮用户输入后，允许该会话再次触发一次“断点续流”（用于中途断线/异常终止的兜底）
    resumeAttemptedRef.current[String(selectedSessionKey)] = false

    setSubagentDockTasks({})
    if (streamRef.current.subagentTasks) streamRef.current.subagentTasks = {}
    
    setIsSending(true)
    const userRow: DisplayRow = {
      role: 'user',
      text: message || '',
      images: (attachments || []).map((a) => ({
        data: a.content,
        mediaType: a.mimeType || 'image/png',
      })),
      timestamp: Date.now(),
    }
    setRows((r) => [...r, userRow])
    try {
      const { api } = await import('../lib/tauri-api.js')
      const send = api.chatSend as (
        sessionKey: string,
        message: string,
        attachments?: ChatAttachment[],
      ) => Promise<unknown>
      await send(selectedSessionKey, message || '', attachments)
    } catch (e) {
      toast(String((e as Error)?.message || e), 'error')
      setIsSending(false)
    }
  }

  async function handleAbort() {
    const sessionKey = selectedSessionKey
    if (!sessionKey) return

    const { api } = await import('../lib/tauri-api.js')
    try {
      await api.chatAbort(sessionKey)
    } finally {
      // 关键：把 collab_phase 置空闲，让后端 `resume-stream` 退出轮询循环
      // 避免用户点“停止”后刷新/切会话仍继续“接收增量流”。
      try {
        const { wsClient } = await import('../lib/ws-client.js')
        const tid = wsClient.getSessionThreadId(sessionKey)
        if (tid) {
          await wsClient.putThreadCollabState(tid, { collab_phase: 'idle' })
        }
      } catch {
        /* ignore */
      }

      // 前端立刻清理流式缓冲，降低用户看到“仍在接收”的窗口期。
      streamRef.current = emptyStream()
      setIsSending(false)
      setResumeBusy(false)
      resumeInFlightRef.current = false
      scheduleBump()
    }
  }

  async function handleNewSession() {
    const key = `agent:main:new-${Date.now().toString(36)}`
    setSelectedSessionKey(key)
    // 预先在后端创建线程，确保会话可用
    try {
      const { wsClient } = await import('../lib/ws-client.js')
      await wsClient.ensureChatThread(key)
    } catch (e) {
      console.warn('[ChatApp] 预创建线程失败:', e)
    }
    // 不要立即刷新会话列表，因为后端还没有这个会话
    // 等用户发送第一条消息后，后端会自动创建会话
    // 只在会话列表中临时添加一个条目
    setSessions((prev) => [
      {
        sessionKey: key,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
      },
      ...prev,
    ])
  }

  async function handleDeleteSession(key?: string) {
    const targetKey = key || selectedSessionKey
    if (!targetKey || targetKey === CHAT_MAIN_SESSION_KEY) {
      toast('主会话不能删除', 'info')
      return
    }
    const yes = await showConfirm('删除此会话？')
    if (!yes) return
    try {
      const { api } = await import('../lib/tauri-api.js')
      await api.chatSessionsDelete(targetKey)
      if (selectedSessionKey === targetKey) setSelectedSessionKey(CHAT_MAIN_SESSION_KEY)
      await refreshSessions()
    } catch (e) {
      toast(String((e as Error)?.message || e), 'error')
    }
  }

  useEffect(() => {
    const onSelect = (ev: Event) => {
      const k = (ev as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey
      if (k) setSelectedSessionKey(k)
    }
    const onNew = () => {
      void handleNewSession()
    }
    const onFilter = (ev: Event) => {
      const v = (ev as CustomEvent<{ value?: string }>).detail?.value
      if (typeof v === 'string') setSessionFilter(v)
    }
    const onDelete = (ev: Event) => {
      const k = (ev as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey
      if (k) void handleDeleteSession(k)
    }
    const onRefresh = (ev: Event) => {
      const k = (ev as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey
      if (!k) return
      setMoreMenuKey(null)
      setPendingRefreshKey(k)
      setSelectedSessionKey((cur) => (cur !== k ? k : cur))
    }
    const onMoreToggle = (ev: Event) => {
      const k = (ev as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey
      if (!k) return
      setMoreMenuKey((cur) => (cur === k ? null : k))
    }
    window.addEventListener('ytpanel:shell-select-session', onSelect as EventListener)
    window.addEventListener('ytpanel:shell-new-session', onNew)
    window.addEventListener('ytpanel:shell-session-filter', onFilter as EventListener)
    window.addEventListener('ytpanel:shell-delete-session', onDelete as EventListener)
    window.addEventListener('ytpanel:shell-refresh-session', onRefresh as EventListener)
    window.addEventListener('ytpanel:shell-more-toggle', onMoreToggle as EventListener)
    return () => {
      window.removeEventListener('ytpanel:shell-select-session', onSelect as EventListener)
      window.removeEventListener('ytpanel:shell-new-session', onNew)
      window.removeEventListener('ytpanel:shell-session-filter', onFilter as EventListener)
      window.removeEventListener('ytpanel:shell-delete-session', onDelete as EventListener)
      window.removeEventListener('ytpanel:shell-refresh-session', onRefresh as EventListener)
      window.removeEventListener('ytpanel:shell-more-toggle', onMoreToggle as EventListener)
    }
  }, [handleNewSession, handleDeleteSession])

  return (
    <div className="chat-react-full">
      <div className="react-chat-workspace react-chat-workspace--no-aside">
        <div className="chat-main react-chat-main-col">
          <header className="react-chat-header">
            <div className="react-chat-header-left">
              <button
                type="button"
                className="react-chat-toggle-sidebar-btn"
                title="主导航"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
                    openMobileShellAside()
                  } else {
                    toggleShellAsideCollapsed()
                  }
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <button
                type="button"
                className="react-chat-toggle-sidebar-btn"
                title="任务管理器"
                onClick={() => setRunManagerOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 9h6" />
                  <path d="M9 13h6" />
                  <path d="M9 17h6" />
                </svg>
              </button>
              <span className="react-chat-header-title">实时聊天</span>
              {tokenTotals && tokenTotals.total > 0 ? (
                <span
                  className="react-chat-tokens"
                  title={`当前会话累计 Token 消耗（输入 ${tokenTotals.input}，输出 ${tokenTotals.output}）`}
                >
                  ↑{tokenTotals.input} ↓{tokenTotals.output} · Σ{tokenTotals.total}
                </span>
              ) : null}
            </div>
          </header>
          {historyError && <div className="react-chat-error-banner">{historyError}</div>}
          {historyLoading && <div className="react-chat-muted react-chat-loading">加载历史中…</div>}
          <div className="react-chat-messages-wrap chat-messages-wrap">
            <MessageVirtualList
              rows={renderRows}
              streamRef={streamRef}
              streamTick={streamTick}
              historyLoading={historyLoading}
              layoutKey={hosted.hosted.panelOpen ? 1 : 0}
              inlineSubagentTasks={undefined}
            />
          </div>
          <ThreadPanel state={threadPanelState} />
          <TaskSidebar
            state={threadPanelState}
            taskHistory={sidebarHistory}
            selectedTaskId={sidebarActiveTaskId}
            activeTaskSubtasks={sidebarActiveView?.subtasks}
            activeTaskSteps={sidebarActiveView?.steps}
            isOpen={taskSidebarOpen}
          />
          <RunManager
            isOpen={runManagerOpen}
            taskNames={runManagerTaskNames}
            selectedTaskId={sidebarActiveTaskId}
            onSelectTaskId={(taskId) => {
              setSidebarSelectedTaskId(taskId)
              setTaskSidebarOpen(true)
            }}
            onClose={() => setRunManagerOpen(false)}
          />
          <HostedAgentPanel
            panelOpen={hosted.hosted.panelOpen}
            setPanelOpen={hosted.hosted.setPanelOpen}
            ui={hosted.hosted.ui}
            statusText={hosted.hosted.statusText}
            setDraft={hosted.hosted.setDraft}
            onToggleRun={hosted.hosted.toggleHostedRun}
          />
          <div className="react-chat-bottom-dock">
            {streaming || isSending ? (
              <div className="react-chat-processing-row react-chat-processing-row--dock" aria-live="polite">
                <div className="react-chat-processing-bar react-chat-processing-bar--thread">
                  <span className="react-chat-processing-cursor" aria-hidden />
                  <span className="react-chat-processing-text">
                    {(() => {
                      const d = (threadPanelState.activityDetail || '').trim()
                      const k = threadPanelState.activityKind
                      const hideGenericSupervisor =
                        k === 'tools' &&
                        (d.startsWith('调用：supervisor') || d.toLowerCase().includes('supervisor'))
                      if (d && (k === 'tools' || k === 'thinking') && !hideGenericSupervisor) return `正在处理 · ${d}`
                      return '正在处理中'
                    })()}
                  </span>
                </div>
              </div>
            ) : null}
            <div className="react-chat-bottom-area">
            <ChatComposer
              sessionReady={!!selectedSessionKey}
              sending={isSending}
              streaming={streaming || isSending}
              onSend={handleSend}
              onAbort={handleAbort}
              placeholder={collabOn ? '描述多步骤目标；将先对齐需求再规划…' : '输入消息，Enter 发送，/ 打开指令'}
              renderBottomControls={({ pickFiles, insertText }) => {
                const selectedAgent = parseSessionAgent(selectedSessionKey) || 'main'
                const modelDisabled = !selectedSessionKey || modelsLoading
                const agentDisabled = !selectedSessionKey || agentsLoading
                const agentLabel = selectedAgent === 'main' ? '主会话' : selectedAgent
                const creativeDisabled = !selectedSessionKey || isSending || streaming

                return (
                  <div className="react-chat-composer-bottom-controls">
                    <div className="react-chat-composer-bottom-row1">
                      <div className="react-chat-composer-bottom-row1-main">
                      <div className="react-chat-bottom-pill-root" ref={bottomModelRootRef}>
                        <button
                          type="button"
                          className={`react-chat-bottom-pill${
                            modelDisabled ? ' react-chat-bottom-pill--disabled' : ''
                          }${bottomModelOpen ? ' react-chat-bottom-pill--open' : ''}`}
                          title="模型选择：Auto 使用后端默认"
                          disabled={modelDisabled}
                          onClick={() => setBottomModelOpen((v) => !v)}
                        >
                          <svg
                            className="react-chat-bottom-pill-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M4 4h16v16H4z" />
                            <path d="M9 9h6v6H9z" />
                          </svg>
                          <span className="react-chat-bottom-pill-text">{modelName ? modelName : 'Auto'}</span>
                          <span className="react-chat-bottom-pill-caret">▾</span>
                        </button>
                        {bottomModelOpen && !modelDisabled ? (
                          <div className="react-chat-bottom-dropdown" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className={`react-chat-bottom-dropdown-item${
                                !modelName ? ' react-chat-bottom-dropdown-item--active' : ''
                              }`}
                              onClick={async () => {
                                setBottomModelOpen(false)
                                const next = ''
                                setModelName(next)
                                localStorage.setItem(STORAGE_MODEL_KEY, next)
                                try {
                                  const api = await getApi()
                                  await api.chatUpdateContext(selectedSessionKey, { model_name: null })
                                } catch (err) {
                                  toast(String((err as Error)?.message || err), 'error')
                                }
                              }}
                            >
                              Auto
                            </button>
                            {modelOptions.map((m) => (
                              <button
                                key={m}
                                type="button"
                                role="menuitem"
                                className={`react-chat-bottom-dropdown-item${
                                  modelName === m ? ' react-chat-bottom-dropdown-item--active' : ''
                                }`}
                                onClick={async () => {
                                  setBottomModelOpen(false)
                                  setModelName(m)
                                  localStorage.setItem(STORAGE_MODEL_KEY, m)
                                  try {
                                    const api = await getApi()
                                    await api.chatUpdateContext(selectedSessionKey, { model_name: m })
                                  } catch (err) {
                                    toast(String((err as Error)?.message || err), 'error')
                                  }
                                }}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="react-chat-mode-menu-wrap">
                        <button
                          type="button"
                          className="react-chat-bottom-pill react-chat-bottom-mode-pill"
                          disabled={!selectedSessionKey}
                          onClick={() => setModeMenuOpen((v) => !v)}
                          title="切换模式"
                        >
                          <svg className="react-chat-bottom-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2l2.4 6.2L21 9l-5 4 1.6 6.8L12 16.8 6.4 19.8 8 13.1 3 9l6.6-.8L12 2z" />
                          </svg>
                          <span className="react-chat-bottom-pill-text">
                            模式: {modeLabel(sessionMode)}
                            {collabOn ? ' / Plan' : ''}
                          </span>
                          <span className="react-chat-bottom-pill-caret">▾</span>
                        </button>
                        {modeMenuOpen && (
                          <div className="react-chat-mode-menu" role="menu">
                            {SESSION_MODES.map((m) => (
                              <button
                                key={m.value}
                                type="button"
                                className={`react-chat-mode-item${m.value === sessionMode ? ' active' : ''}`}
                                onClick={async () => {
                                  setModeMenuOpen(false)
                                  await setSessionModeAndApply(m.value)
                                }}
                              >
                                {m.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={`react-chat-mode-item${collabOn ? ' active' : ''}`}
                              onClick={async () => {
                                setModeMenuOpen(false)
                                await toggleCollab(!collabOn)
                              }}
                            >
                              Plan（任务协作）
                            </button>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className={`react-chat-bottom-pill react-chat-bottom-hosted-pill${hosted.hosted.ui.isRunning ? ' active' : ''}`}
                        onClick={() => hosted.hosted.setPanelOpen(!hosted.hosted.panelOpen)}
                        title={hosted.hosted.statusText}
                        disabled={!selectedSessionKey}
                      >
                        <svg className="react-chat-bottom-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                        <span className="react-chat-bottom-pill-text">托管</span>
                        <span className="react-chat-bottom-pill-extra">{hosted.hosted.hostedStatusIcon}</span>
                      </button>

                      <div className="react-chat-bottom-pill-root" ref={bottomAgentRootRef}>
                        <button
                          type="button"
                          className={`react-chat-bottom-pill${
                            agentDisabled ? ' react-chat-bottom-pill--disabled' : ''
                          }${bottomAgentOpen ? ' react-chat-bottom-pill--open' : ''}`}
                          title="会话选择"
                          disabled={agentDisabled}
                          onClick={() => setBottomAgentOpen((v) => !v)}
                        >
                          <svg
                            className="react-chat-bottom-pill-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M20 21a8 8 0 0 0-16 0" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <span className="react-chat-bottom-pill-text">{agentLabel}</span>
                          <span className="react-chat-bottom-pill-caret">▾</span>
                        </button>
                        {bottomAgentOpen && !agentDisabled ? (
                          <div className="react-chat-bottom-dropdown" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="react-chat-bottom-dropdown-item"
                              onClick={() => {
                                setBottomAgentOpen(false)
                                setNewAgentModalError(null)
                                setNewAgentModalBusy(false)
                                setNewAgentNameDraft('')
                                setNewAgentModalOpen(true)
                              }}
                            >
                              + 智能体
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className={`react-chat-bottom-dropdown-item${
                                selectedAgent === 'main' ? ' react-chat-bottom-dropdown-item--active' : ''
                              }`}
                              onClick={async () => {
                                setBottomAgentOpen(false)
                                const nextKey = CHAT_MAIN_SESSION_KEY
                                setSelectedSessionKey(nextKey)
                                try {
                                  setSessionModeInMeta(nextKey, 'flash')
                                  setSessionCollabModeInMeta(nextKey, collabOn)
                                  await applySessionModePreset(nextKey, 'flash')
                                } catch (err) {
                                  toast(String((err as Error)?.message || err), 'error')
                                }
                                await refreshSessions()
                              }}
                            >
                              主会话
                            </button>
                            {(agents || []).map((a) => {
                              const name = a?.name
                              if (!name) return null
                              const isActive = selectedAgent === name
                              return (
                                <button
                                  key={name}
                                  type="button"
                                  role="menuitem"
                                  className={`react-chat-bottom-dropdown-item${isActive ? ' react-chat-bottom-dropdown-item--active' : ''}`}
                                  onClick={async () => {
                                    setBottomAgentOpen(false)
                                    const nextKey = `agent:${name}:new-${Date.now().toString(36)}`
                                    setSelectedSessionKey(nextKey)
                                    try {
                                      setSessionModeInMeta(nextKey, 'flash')
                                      setSessionCollabModeInMeta(nextKey, collabOn)
                                      await applySessionModePreset(nextKey, 'flash')
                                    } catch (err) {
                                      toast(String((err as Error)?.message || err), 'error')
                                    }
                                    await refreshSessions()
                                  }}
                                >
                                  {name}
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className="react-chat-bottom-pill-root" ref={bottomCreativeRootRef}>
                        <button
                          type="button"
                          className={`react-chat-bottom-pill${
                            creativeDisabled ? ' react-chat-bottom-pill--disabled' : ''
                          }${bottomCreativeOpen ? ' react-chat-bottom-pill--open' : ''}`}
                          title="创意：开始创作 / 深入研究等"
                          disabled={creativeDisabled}
                          onClick={() => setBottomCreativeOpen((v) => !v)}
                        >
                          <svg
                            className="react-chat-bottom-pill-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path d="M12 2l1.2 4.5L18 8l-4.8 1.5L12 14l-1.2-4.5L6 8l4.8-1.5L12 2z" />
                            <path d="M19 14l.8 2.8L23 18l-3.2 1.2L19 22l-.8-2.8L15 18l3.2-1.2L19 14z" />
                          </svg>
                          <span className="react-chat-bottom-pill-text">创意</span>
                          <span className="react-chat-bottom-pill-caret">▾</span>
                        </button>
                        {bottomCreativeOpen && !creativeDisabled ? (
                          <div className="react-chat-bottom-dropdown" role="menu">
                            {QUICK_PROMPTS.map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                role="menuitem"
                                className="react-chat-bottom-dropdown-item"
                                onClick={() => {
                                  setBottomCreativeOpen(false)
                                  insertText(p.prompt)
                                }}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className="react-chat-attach-icon-btn"
                        disabled={!selectedSessionKey}
                        onClick={pickFiles}
                        title="上传图片"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden="true">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                        </svg>
                      </button>
                      </div>

                      <div className="react-chat-composer-bottom-row1-workspace">
                        <div className="react-chat-bottom-pill-root" ref={bottomWorkspaceRootRef}>
                          <button
                            type="button"
                            className={`react-chat-bottom-pill${bottomWorkspaceOpen ? ' react-chat-bottom-pill--open' : ''}`}
                            title={useVirtualPaths ? '工作空间：虚拟沙箱路径' : (localWorkspaceRoot ? `工作空间：${localWorkspaceRoot}` : '工作空间：未设置')}
                            onClick={() => setBottomWorkspaceOpen((v) => !v)}
                          >
                            <svg
                              className="react-chat-bottom-pill-icon"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M3 7h18" />
                              <path d="M6 3h12l2 4v14H4V7l2-4z" />
                            </svg>
                            <span className="react-chat-bottom-pill-text">
                              工作空间: {useVirtualPaths ? '虚拟' : (localWorkspaceRoot ? _pathBasename(localWorkspaceRoot) : '本机')}
                            </span>
                            <span className="react-chat-bottom-pill-caret">▾</span>
                          </button>
                          {bottomWorkspaceOpen ? (
                            <div className="react-chat-bottom-dropdown" role="menu">
                              <button
                                type="button"
                                role="menuitem"
                                className="react-chat-bottom-dropdown-item"
                                onClick={async () => {
                                  setBottomWorkspaceOpen(false)
                                  await openWorkspaceFolderPicker()
                                }}
                              >
                                设置本机工作目录
                              </button>
                              {(workspaceHistory || []).length ? (
                                <>
                                  <div
                                    className="react-chat-bottom-dropdown-item"
                                    style={{ opacity: 0.75, cursor: 'default' }}
                                    role="presentation"
                                  >
                                    历史工作空间
                                  </div>
                                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                                    {(workspaceHistory || []).map((p) => (
                                      <button
                                        key={p}
                                        type="button"
                                        role="menuitem"
                                        className={`react-chat-bottom-dropdown-item${localWorkspaceRoot === p && !useVirtualPaths ? ' react-chat-bottom-dropdown-item--active' : ''}`}
                                        disabled={useVirtualPaths}
                                        title={p}
                                        onClick={async () => {
                                          setBottomWorkspaceOpen(false)
                                          await applyLocalWorkspaceRoot(p)
                                        }}
                                      >
                                        {_pathBasename(p)}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* creative dropdown 常驻在 row1，避免占用 row2 */}
                  </div>
                )
              }}
            />
            </div>
          </div>
        </div>
      </div>
    {newAgentModalOpen ? (
      <div
        className="react-chat-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="新建智能体"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setNewAgentModalOpen(false)
        }}
      >
        <div className="react-chat-modal-card">
          <div className="react-chat-modal-header">
            <strong>新建智能体</strong>
            <button
              type="button"
              className="react-chat-modal-close"
              onClick={() => setNewAgentModalOpen(false)}
              title="关闭"
            >
              ×
            </button>
          </div>

          <div className="react-chat-modal-body">
            <label className="react-chat-modal-label">Agent 名称</label>
            <input
              ref={newAgentNameInputRef}
              className="react-chat-modal-input"
              value={newAgentNameDraft}
              placeholder="例如：translator（字母/数字/连字符）"
              disabled={newAgentModalBusy}
              onChange={(e) => setNewAgentNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void createNewAgentAndSwitch(newAgentNameDraft)
                }
              }}
            />

            <div className="react-chat-modal-hint">
              仅允许 <span className="react-chat-modal-hint-strong">a-z</span>、<span className="react-chat-modal-hint-strong">0-9</span> 和 <span className="react-chat-modal-hint-strong">-</span>。
              创建完成后会为该 Agent 生成 **SOUL**。
            </div>

            {newAgentModalError ? <div className="react-chat-modal-error">{newAgentModalError}</div> : null}
          </div>

          <div className="react-chat-modal-actions">
            <button
              type="button"
              className="react-chat-modal-btn react-chat-modal-btn--ghost"
              disabled={newAgentModalBusy}
              onClick={() => setNewAgentModalOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="react-chat-modal-btn react-chat-modal-btn--primary"
              disabled={newAgentModalBusy || !newAgentNameDraft.trim()}
              onClick={() => void createNewAgentAndSwitch(newAgentNameDraft)}
            >
              {newAgentModalBusy ? '创建中…' : '创建智能体'}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </div>
  )
}
