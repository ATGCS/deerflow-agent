import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { wsClient } from '../lib/ws-client.js'
import {
  upsertTool,
  extractChatContent,
  normalizeChatToolPayloadToEntries,
  accumulateStreamAssistantText,
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
import { openMobileShellAside, toggleShellAsideCollapsed } from '../components/shell-aside.js'
import { useHostedAgent } from './hooks/useHostedAgent.js'
import { getBackendBaseURL } from '../lib/tauri-api.js'

// ========== 任务进度可视化系统集成 ==========
import { tasksAPI } from '../lib/api-client.js'
// ============================================

import type {
  ChatAttachment,
  ChatSessionRow,
  ChatWsPayload,
  DisplayRow,
  MessageSegment,
  StreamState,
  ThreadPanelState,
} from './chat-types.js'

const STORAGE_SESSION_META_KEY = 'clawpanel-chat-session-meta'
const STORAGE_MODEL_KEY = 'clawpanel-chat-selected-model'
const STORAGE_SESSION_NAMES_KEY = 'clawpanel-chat-session-names'
const STORAGE_SELECTED_SESSION_KEY = 'clawpanel-chat-selected-session'

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
  }
}

function safeReadSessionMetaMap(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_SESSION_META_KEY) || '{}')
  } catch {
    return {}
  }
}

function getSessionNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_SESSION_NAMES_KEY) || '{}')
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

function getSessionMessageCount(s: ChatSessionRow): number {
  if (typeof s.messageCount === 'number') return s.messageCount
  if (typeof s.messages === 'number') return s.messages
  return 0
}

function formatSessionRecordMeta(
  s: ChatSessionRow,
  opts: { isSelectedStreaming: boolean },
): string {
  const n = getSessionMessageCount(s)
  const ts = s.updatedAt ?? s.lastActivity ?? s.createdAt ?? 0
  const timeStr = ts ? formatSessionTime(ts) : ''
  let status = '已完成'
  if (opts.isSelectedStreaming) status = '进行中'
  else if (!n) status = '草稿'
  return timeStr ? `${timeStr} · ${status}` : status
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

function finalizeAssistantSegments(S: StreamState): MessageSegment[] | undefined {
  const seg: MessageSegment[] = [...S.segments]
  if (S.text.trim()) seg.push({ kind: 'text', text: S.text })
  
  if (S.tools.length) {
    const ids = S.tools
      .map((t) => String((t as Record<string, unknown>).id || (t as Record<string, unknown>).tool_call_id || ''))
      .filter(Boolean)
    if (ids.length) {
      seg.push({ kind: 'tools', ids })
    }
  }
  
  return seg.length ? seg : undefined
}

/**
 * 从工具调用结果中提取任务 ID
 * 当检测到 supervisor_tool 或 task_tool 被调用时，从输出中提取任务 ID
 */
function extractTaskIdFromTools(tools: unknown[]): { taskId?: string; projectId?: string } {
  for (const tool of tools) {
    const t = tool as Record<string, unknown>
    const name = String(t.name || '')
    const input = t.input as Record<string, unknown> | null
    const output = t.output as Record<string, unknown> | string | null
    
    console.log('[任务系统] 检查工具:', name)
    console.log('[任务系统] 工具输入:', input)
    console.log('[任务系统] 工具输出:', output)
    
    // 检查是否是任务相关的工具
    if (name.includes('supervisor') || name.includes('task_tool') || name.includes('task')) {
      console.log('[任务系统] ✅ 检测到任务工具调用:', name)
      
      // 1. 尝试从输出对象中提取
      if (output && typeof output === 'object') {
        const taskId = String(output.taskId || output.id || output.task_id || '')
        const projectId = String(output.projectId || output.project_id || output.parent_project_id || '')
        
        if (taskId) {
          console.log('[任务系统] ✅ 从输出对象中提取到任务 ID:', taskId)
          console.log('[任务系统] ✅ 从输出对象中提取到项目 ID:', projectId)
          return { taskId, projectId }
        }
      }
      
      // 2. 尝试从输出字符串中提取（格式："Task created successfully. ID: xxx, Name: ..."）
      if (typeof output === 'string') {
        console.log('[任务系统] 尝试从输出字符串中解析...')
        
        // 匹配 "ID: xxx" 格式
        const idMatch = output.match(/ID:\s*([a-zA-Z0-9_-]+)/i)
        if (idMatch) {
          const taskId = idMatch[1]
          console.log('[任务系统] ✅ 从字符串中提取到任务 ID:', taskId)
          
          // 尝试匹配项目 ID（如果有）
          const projectIdMatch = output.match(/project[_\s]?ID:\s*([a-zA-Z0-9_-]+)/i)
          const projectId = projectIdMatch ? projectIdMatch[1] : undefined
          console.log('[任务系统] ✅ 从字符串中提取到项目 ID:', projectId)
          
          return { taskId, projectId }
        }
        
        // 尝试解析为 JSON（如果输出是 JSON 字符串）
        try {
          const parsed = JSON.parse(output)
          const taskId = String(parsed.taskId || parsed.id || parsed.task_id || '')
          const projectId = String(parsed.projectId || parsed.project_id || parsed.parent_project_id || '')
          
          if (taskId) {
            console.log('[任务系统] ✅ 从 JSON 字符串中提取到任务 ID:', taskId)
            console.log('[任务系统] ✅ 从 JSON 字符串中提取到项目 ID:', projectId)
            return { taskId, projectId }
          }
        } catch {
          // 不是 JSON 格式，忽略
        }
      }
      
      // 3. 尝试从输入中提取（如果输出中没有）
      if (input && typeof input === 'object') {
        const taskId = String(input.taskId || input.id || input.task_id || '')
        const projectId = String(input.projectId || input.project_id || '')
        
        if (taskId) {
          console.log('[任务系统] ✅ 从输入中提取到任务 ID:', taskId)
          console.log('[任务系统] ✅ 从输入中提取到项目 ID:', projectId)
          return { taskId, projectId }
        }
      }
    }
  }
  
  console.log('[任务系统] ❌ 未找到任务 ID')
  return {}
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
  const streamRef = useRef<StreamState>(emptyStream())
  const [threadPanelState, setThreadPanelState] = useState<ThreadPanelState>(emptyThreadPanel())
  const apiRef = useRef<any>(null)
  const [sessionMode, setSessionMode] = useState<SessionMode>(() => getSessionModeFromMeta(selectedSessionKey))
  const [collabOn, setCollabOn] = useState<boolean>(() => getSessionCollabModeFromMeta(selectedSessionKey))
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [collabBusy, setCollabBusy] = useState(false)
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(false)
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
  const [pendingNewAgentBootstrapName, setPendingNewAgentBootstrapName] = useState<string | null>(null)
  const [newAgentModalOpen, setNewAgentModalOpen] = useState(false)
  const [newAgentNameDraft, setNewAgentNameDraft] = useState('')
  const [newAgentModalBusy, setNewAgentModalBusy] = useState(false)
  const [newAgentModalError, setNewAgentModalError] = useState<string | null>(null)
  const bottomModelRootRef = useRef<HTMLDivElement | null>(null)
  const bottomAgentRootRef = useRef<HTMLDivElement | null>(null)
  const bottomCreativeRootRef = useRef<HTMLDivElement | null>(null)
  const newAgentNameInputRef = useRef<HTMLInputElement | null>(null)
  const [sessionFilter, setSessionFilter] = useState('')

  /** 从 MCP/技能等页点侧栏任务记录进入聊天时，shell-aside 写入待选会话 */
  useEffect(() => {
    console.log('%c====== [ChatApp] 组件初始化 ======', 'color: #00ff00; font-size: 16px; font-weight: bold;')
    console.log('[ChatApp] 时间:', new Date().toLocaleTimeString())
    console.log('[ChatApp] 当前会话:', selectedSessionKey)
    
    // ========== 任务进度可视化系统初始化 ==========
    console.log('%c[ChatApp] 正在初始化任务系统...', 'color: #00ffff; font-size: 14px')
    console.log('[ChatApp] 任务系统已就绪，将监听工具调用')
    console.log('%c====== [ChatApp] 任务系统初始化完成 ======', 'color: #00ff00; font-size: 16px; font-weight: bold;')
    
    try {
      const pending = sessionStorage.getItem('deerpanel_pending_shell_session')
      if (pending) {
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
    if (!bottomModelOpen && !bottomAgentOpen && !bottomCreativeOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (bottomModelRootRef.current && bottomModelRootRef.current.contains(target)) return
      if (bottomAgentRootRef.current && bottomAgentRootRef.current.contains(target)) return
      if (bottomCreativeRootRef.current && bottomCreativeRootRef.current.contains(target)) return
      setBottomModelOpen(false)
      setBottomAgentOpen(false)
      setBottomCreativeOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setBottomModelOpen(false)
        setBottomAgentOpen(false)
        setBottomCreativeOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [bottomModelOpen, bottomAgentOpen, bottomCreativeOpen])

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
        wsClient.cancelAllGlobalRunsBestEffort().catch(() => {
          // 忽略错误
        })
      })
    }
    
    streamRef.current = emptyStream()
    seenRunIdsRef.current = new Set()
    setThreadPanelState(emptyThreadPanel())
    setHasReceivedTodos(false)  // 重置 todos 接收标志
    // 清除新会话的活跃时间，让它立即过期
    delete lastActivityRef.current[selectedSessionKey]
    setSessionMode(getSessionModeFromMeta(selectedSessionKey))
    setCollabOn(getSessionCollabModeFromMeta(selectedSessionKey))
    setModeMenuOpen(false)
    bumpStream()
  }, [selectedSessionKey])

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
          setTaskSidebarOpen(true)
        }
        
        setThreadPanelState({
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
        })
        // 如果是新会话（sessionKey 包含 new-）且之前没有标题，现在有标题了，自动保存
        if (selectedSessionKey.includes('new-') && !prevTitle && newTitle) {
          try {
            const names = JSON.parse(localStorage.getItem('clawpanel-chat-session-names') || '{}')
            names[selectedSessionKey] = newTitle
            localStorage.setItem('clawpanel-chat-session-names', JSON.stringify(names))
            window.dispatchEvent(new CustomEvent('session-name-updated'))
          } catch {
            // ignore
          }
        }
        return
      }

      if (msg.event !== 'chat') return
      const payload = msg.payload
      if (!payload) return
      if (payload.sessionKey && payload.sessionKey !== sessionRef.current) return
      
      // ========== 流式响应调试日志 - 只显示工具相关 ==========
      // 检查是否有工具调用
      const hasTools = payload.message?.tools && payload.message.tools.length > 0
      const isToolState = payload.state === 'tool'
      
      // 只有工具调用时才输出日志
      if (hasTools || isToolState) {
        console.log('%c====== [流式响应] 🎯 检测到工具调用 ======', 'color: #ff00ff; font-size: 16px; font-weight: bold; background: #000')
        console.log('[流式响应] 事件类型:', msg.event)
        console.log('[流式响应] 状态:', payload.state)
        console.log('[流式响应] runId:', payload.runId)
        console.log('[流式响应] 时间:', new Date().toLocaleTimeString())
        
        // 输出工具详情
        if (payload.message?.tools) {
          console.log('%c[流式响应] 工具数量:', 'color: #00ffff; font-size: 14px', payload.message.tools.length)
          
          payload.message.tools.forEach((tool: any, index: number) => {
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
        noteNewToolIds(S, newIds)
        for (const e of entries) upsertTool(S.tools, { ...e })
        if (!S.runId && runId) S.runId = runId
        if (!S.startTs) S.startTs = Date.now()
        scheduleBump()
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
          noteNewToolIds(S, newIds)
          for (const t of c.tools) upsertTool(S.tools, t)
          changed = true
        }
        if (changed) {
          if (!S.runId && runId) S.runId = runId
          if (!S.startTs) S.startTs = Date.now()
          scheduleBump()
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
          
          // ========== 任务系统：从工具调用中提取任务 ID ==========
          console.log('[ChatApp] 检测到工具调用，检查是否有任务创建...')
          const { taskId, projectId } = extractTaskIdFromTools(finalTools)
          
          if (taskId) {
            console.log('%c====== [ChatApp] 检测到任务创建 ======', 'color: #00ff00; font-size: 16px; font-weight: bold; background: #000')
            console.log('[ChatApp] 任务 ID:', taskId)
            console.log('[ChatApp] 项目 ID:', projectId)
            
            // 延迟一点获取任务详情，确保后端已完全创建
            setTimeout(async () => {
              try {
                console.log('[ChatApp] 正在获取任务详情...')
                const task = await tasksAPI.getTask(taskId)
                console.log('[ChatApp] 任务获取结果:', task ? '✅ 成功' : '❌ 失败')
                
                if (task) {
                  console.log('[ChatApp] 任务名称:', task.name)
                  console.log('[ChatApp] 任务状态:', task.status)
                  console.log('[ChatApp] 打开任务侧边栏...')
                  setTaskSidebarOpen(true)
                  console.log('%c[ChatApp] ✅✅✅ 任务已显示在侧边栏！', 'color: #00ff00; font-size: 16px; font-weight: bold')
                }
              } catch (err) {
                console.error('[ChatApp] ❌ 获取任务失败:', err.message)
              }
            }, 800)  // 延迟 800ms
          }
          // ============================================
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
            },
          ]
          return newRows
        })

        // final 事件后清空 streamRef 和 threadPanelState，停止进度条并清除提示区域
        streamRef.current = emptyStream()
        setThreadPanelState(emptyThreadPanel())
        setIsSending(false)
        scheduleBump()
        void refreshSessions()
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
  }, [scheduleBump, setRows, refreshSessions])

  const streaming = !!(
    streamRef.current.text ||
    streamRef.current.segments?.length ||
    streamRef.current.tools?.length ||
    streamRef.current.images?.length ||
    streamRef.current.videos?.length ||
    streamRef.current.audios?.length ||
    streamRef.current.files?.length
  )
  const hasTodos = Array.isArray(threadPanelState.todos) && threadPanelState.todos.length > 0

  const shellSyncPayload = useMemo(() => {
    const rows = filteredSessions.map((s) => {
      const mode = getSessionModeFromMeta(s.sessionKey)
      const modePill = mode === 'pro' ? null : modeLabel(mode)
      return {
        sessionKey: s.sessionKey,
        title: getDisplayLabel(s.sessionKey),
        meta: formatSessionRecordMeta(s, {
          isSelectedStreaming: selectedSessionKey === s.sessionKey && (streaming || isSending),
        }),
        active: selectedSessionKey === s.sessionKey,
        modePill,
        canDelete: s.sessionKey !== CHAT_MAIN_SESSION_KEY,
      }
    })
    return {
      listLoading,
      sessionFilter,
      moreMenuKey,
      newTaskActive: selectedSessionKey.includes(':new-'),
      rows,
    }
  }, [
    filteredSessions,
    listLoading,
    sessionFilter,
    moreMenuKey,
    selectedSessionKey,
    streaming,
    isSending,
    sessionNamesTick,
  ])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('deerpanel:chat-sidebar-sync', { detail: shellSyncPayload }))
    return () => {
      window.dispatchEvent(new CustomEvent('deerpanel:chat-sidebar-sync', { detail: null }))
    }
  }, [shellSyncPayload])

  // 底部操作区不依赖对话中是否已出现用户/助手消息：保持“创意”按钮常驻

  async function handleSend(message: string, attachments?: ChatAttachment[]) {
    if (!selectedSessionKey) return
    // 更新活跃时间，防止状态被过期
    lastActivityRef.current[selectedSessionKey] = Date.now()
    
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
    const { api } = await import('../lib/tauri-api.js')
    await api.chatAbort(selectedSessionKey)
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
    if (!confirm('删除此会话？')) return
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
    window.addEventListener('deerpanel:shell-select-session', onSelect as EventListener)
    window.addEventListener('deerpanel:shell-new-session', onNew)
    window.addEventListener('deerpanel:shell-session-filter', onFilter as EventListener)
    window.addEventListener('deerpanel:shell-delete-session', onDelete as EventListener)
    window.addEventListener('deerpanel:shell-refresh-session', onRefresh as EventListener)
    window.addEventListener('deerpanel:shell-more-toggle', onMoreToggle as EventListener)
    return () => {
      window.removeEventListener('deerpanel:shell-select-session', onSelect as EventListener)
      window.removeEventListener('deerpanel:shell-new-session', onNew)
      window.removeEventListener('deerpanel:shell-session-filter', onFilter as EventListener)
      window.removeEventListener('deerpanel:shell-delete-session', onDelete as EventListener)
      window.removeEventListener('deerpanel:shell-refresh-session', onRefresh as EventListener)
      window.removeEventListener('deerpanel:shell-more-toggle', onMoreToggle as EventListener)
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
                title="任务进度"
                onClick={() => setTaskSidebarOpen((v) => !v)}
                disabled={!hasTodos && !threadPanelState.title}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
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
              rows={rows}
              streamRef={streamRef}
              streamTick={streamTick}
              historyLoading={historyLoading}
              layoutKey={hosted.hosted.panelOpen ? 1 : 0}
            />
          </div>
          {streaming || isSending ? (
            <div className="react-chat-processing-row" aria-live="polite">
              <div className="react-chat-processing-bar react-chat-processing-bar--thread">
                <span className="react-chat-processing-cursor" aria-hidden />
                <span className="react-chat-processing-text">
                  {(() => {
                    const d = (threadPanelState.activityDetail || '').trim()
                    const k = threadPanelState.activityKind
                    if (d && (k === 'tools' || k === 'thinking')) return `正在处理 · ${d}`
                    return '正在处理中'
                  })()}
                </span>
              </div>
            </div>
          ) : null}
          <ThreadPanel state={threadPanelState} sessionKey={selectedSessionKey} />
          <TaskSidebar
            state={threadPanelState}
            isOpen={taskSidebarOpen}
            onClose={() => setTaskSidebarOpen(false)}
          />
          <RunManager
            isOpen={runManagerOpen}
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

                    {/* creative dropdown 常驻在 row1，避免占用 row2 */}
                  </div>
                )
              }}
            />
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
