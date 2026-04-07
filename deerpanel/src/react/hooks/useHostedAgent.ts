import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { wsClient } from '../../lib/ws-client.js'
import { uuid, stripAnsi } from '../../lib/chat-normalize.js'
import { toast } from '../../components/toast.js'

const HOSTED_STATUS = { IDLE: 'idle', RUNNING: 'running', WAITING: 'waiting_reply', PAUSED: 'paused', ERROR: 'error' } as const
type HostedStatus = (typeof HOSTED_STATUS)[keyof typeof HOSTED_STATUS]

const HOSTED_SESSIONS_KEY = 'ytpanel-hosted-agent-sessions'
const STORAGE_SESSION_KEY = 'ytpanel-last-session'

const HOSTED_SYSTEM_PROMPT = `你是一个托管调度 Agent。你的职责是：根据用户设定的目标，持续引导 DeerFlow AI Agent 完成任务。
规则：
1. 你每一轮只输出一条简洁的指令（1-3 句话），发给 DeerFlow 执行
2. 根据 DeerFlow 的回复评估进展，决定下一步指令
3. 如果任务已完成或无法继续，回复包含"完成"或"停止"来结束循环
4. 不要重复相同的指令，不要输出解释性文字，只输出下一步要执行的指令`

const HOSTED_DEFAULTS = {
  enabled: false,
  prompt: '',
  autoRunAfterTarget: true,
  stopPolicy: 'self',
  maxSteps: 50,
  stepDelayMs: 1200,
  retryLimit: 2,
  autoStopMinutes: 0,
}

const HOSTED_RUNTIME_DEFAULT: {
  status: HostedStatus
  stepCount: number
  lastRunAt: number
  lastRunId: string
  lastError: string
  pending: boolean
  errorCount: number
} = {
  status: HOSTED_STATUS.IDLE,
  stepCount: 0,
  lastRunAt: 0,
  lastRunId: '',
  lastError: '',
  pending: false,
  errorCount: 0,
}

const HOSTED_CONTEXT_MAX = 30
const HOSTED_COMPRESS_THRESHOLD = 20

type HostedHistoryItem =
  | { role: 'system'; content: string; ts: number }
  | { role: 'assistant' | 'target'; content: string; ts: number }

type HostedSessionConfig = {
  enabled: boolean
  prompt: string
  maxSteps: number
  stepDelayMs: number
  retryLimit: number
  autoStopMinutes: number
  state: typeof HOSTED_RUNTIME_DEFAULT
  history: HostedHistoryItem[]
}

function safeReadJson(key: string): any {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}')
  } catch {
    return {}
  }
}

function detectStopFromText(text: string) {
  if (!text) return false
  return /\b(完成|无需继续|结束|停止|done|stop|final)\b/i.test(text)
}

function iconForStatus(status: HostedStatus) {
  if (!status) return '—'
  if (status === HOSTED_STATUS.RUNNING) return '▶'
  if (status === HOSTED_STATUS.WAITING) return '…'
  if (status === HOSTED_STATUS.PAUSED) return '⏸'
  if (status === HOSTED_STATUS.ERROR) return '!'
  return '○'
}

async function readHostedAssistantConfig() {
  try {
    const raw = localStorage.getItem('ytpanel-assistant') || localStorage.getItem('clawpanel-assistant')
    const stored = raw ? JSON.parse(raw) : {}
    return {
      baseUrl: stored.baseUrl || '',
      apiKey: stored.apiKey || '',
      model: stored.model || '',
      temperature: stored.temperature || 0.7,
    }
  } catch {
    return { baseUrl: '', apiKey: '', model: '', temperature: 0.7 }
  }
}

export function useHostedAgent({
  sessionKey,
  onAppendSystemMessage,
}: {
  sessionKey: string | null
  onAppendSystemMessage: (text: string) => void
}) {
  const sessionKeyRef = useRef(sessionKey)
  useEffect(() => {
    sessionKeyRef.current = sessionKey
  }, [sessionKey])

  const defaultsRef = useRef<any>(null)

  const hostedConfigRef = useRef<HostedSessionConfig | null>(null)
  const hostedRuntimeRef = useRef(HOSTED_RUNTIME_DEFAULT)
  const busyRef = useRef(false)
  const hostedAbortRef = useRef<AbortController | null>(null)
  const lastTargetTsRef = useRef(0)

  const autoStopTimerRef = useRef<number | null>(null)
  const countdownIntervalRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)

  const [panelOpen, setPanelOpen] = useState(false)
  const [ui, setUi] = useState(() => ({
    enabled: false,
    status: HOSTED_STATUS.IDLE as HostedStatus,
    prompt: '',
    maxSteps: HOSTED_DEFAULTS.maxSteps,
    autoStopMinutes: 0,
    stepCount: 0,
    lastError: '',
    countdownText: '',
    isRunning: false,
  }))

  const getHostedSessionKey = useCallback(() => {
    return sessionKeyRef.current || localStorage.getItem(STORAGE_SESSION_KEY) || 'agent:main:main'
  }, [])

  const persistConfig = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    cfg.state = { ...hostedRuntimeRef.current }
    const data = safeReadJson(HOSTED_SESSIONS_KEY)
    data[getHostedSessionKey()] = cfg
    localStorage.setItem(HOSTED_SESSIONS_KEY, JSON.stringify(data))
  }, [getHostedSessionKey])

  const syncUiFromRefs = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    const rt = hostedRuntimeRef.current
    setUi((prev) => ({
      enabled: cfg.enabled,
      status: rt.status,
      prompt: cfg.prompt,
      maxSteps: cfg.maxSteps,
      autoStopMinutes: cfg.autoStopMinutes,
      stepCount: rt.stepCount,
      lastError: rt.lastError || '',
      countdownText: prev.countdownText,
      isRunning: cfg.enabled && rt.status !== HOSTED_STATUS.IDLE,
    }))
  }, [])

  const clearTimers = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current)
      autoStopTimerRef.current = null
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
  }, [])

  const updateCountdown = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    if (!cfg.autoStopMinutes || cfg.autoStopMinutes <= 0) return
    if (!startTimeRef.current) return
    const totalMs = cfg.autoStopMinutes * 60000
    const elapsed = Date.now() - startTimeRef.current
    const remaining = Math.max(0, totalMs - elapsed)
    const mins = Math.floor(remaining / 60000)
    const secs = Math.floor((remaining % 60000) / 1000)
    setUi((prev) => ({ ...prev, countdownText: `剩余 ${mins}:${secs.toString().padStart(2, '0')}` }))
    if (remaining <= 0) {
      clearTimers()
    }
  }, [clearTimers])

  const startCountdown = useCallback(() => {
    clearTimers()
    const cfg = hostedConfigRef.current
    if (!cfg || !cfg.autoStopMinutes || cfg.autoStopMinutes <= 0) return
    if (!startTimeRef.current) return
    updateCountdown()
    countdownIntervalRef.current = window.setInterval(() => updateCountdown(), 1000)
  }, [clearTimers, updateCountdown])

  const loadHostedDefaults = useCallback(async () => {
    try {
      const mod = await import('../../lib/tauri-api.js')
      const panel = await mod.api.readPanelConfig()
      defaultsRef.current = panel?.hostedAgent?.default || null
    } catch {
      defaultsRef.current = null
    }
  }, [])

  const loadHostedSessionConfig = useCallback(() => {
    const key = getHostedSessionKey()
    const data = safeReadJson(HOSTED_SESSIONS_KEY)
    const cur = data[key] || {}
    const cfg: HostedSessionConfig = {
      ...(HOSTED_DEFAULTS as any),
      ...(defaultsRef.current || {}),
      ...(cur || {}),
      state: (cur?.state && typeof cur.state === 'object' ? cur.state : HOSTED_RUNTIME_DEFAULT) as any,
      history: Array.isArray(cur?.history) ? cur.history : [],
    }
    hostedConfigRef.current = cfg
    hostedRuntimeRef.current = { ...HOSTED_RUNTIME_DEFAULT, ...(cfg.state || {}) }
    setUi((prev) => ({
      ...prev,
      enabled: cfg.enabled,
      status: hostedRuntimeRef.current.status,
      prompt: cfg.prompt,
      maxSteps: cfg.maxSteps,
      autoStopMinutes: cfg.autoStopMinutes,
      stepCount: hostedRuntimeRef.current.stepCount,
      lastError: hostedRuntimeRef.current.lastError || '',
      isRunning: cfg.enabled && hostedRuntimeRef.current.status !== HOSTED_STATUS.IDLE,
    }))
  }, [getHostedSessionKey])

  const appendHostedOutput = useCallback(
    (text: string) => {
      if (!text) return
      onAppendSystemMessage(`[托管 Agent] ${text}`)
    },
    [onAppendSystemMessage],
  )

  const appendHostedTarget = useCallback((text: string) => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    if (!cfg.history) cfg.history = []
    cfg.history.push({ role: 'target', content: text, ts: Date.now() })
    persistConfig()
  }, [persistConfig])

  const compressHostedContext = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg?.history) return
    const history = cfg.history
    if (history.length <= HOSTED_COMPRESS_THRESHOLD) return
    const sysEntry = history[0]?.role === 'system' ? history[0] : null
    const recent = history.slice(-8)
    const older = history.slice(sysEntry ? 1 : 0, -8)
    const summary = older.map((h) => `[${h.role}] ${(h.content || '').slice(0, 80)}`).join('\n')
    const compressed: HostedHistoryItem[] = []
    if (sysEntry) compressed.push(sysEntry)
    compressed.push({ role: 'target', content: `[上下文摘要 - 已压缩 ${older.length} 条历史]\n${summary}`, ts: Date.now() })
    compressed.push(...(recent as any))
    cfg.history = compressed
    persistConfig()
  }, [persistConfig])

  const buildHostedMessages = useCallback(() => {
    compressHostedContext()
    const cfg = hostedConfigRef.current
    const history = cfg?.history || []
    const mapped = history.slice(-HOSTED_CONTEXT_MAX).map((item) => {
      if (item.role === 'system') return { role: 'system', content: item.content }
      if (item.role === 'assistant') return { role: 'assistant', content: item.content }
      return { role: 'user', content: item.content }
    })
    const hasUserMsg = mapped.some((m: any) => m.role === 'user' || m.role === 'assistant')
    if (!hasUserMsg && cfg?.prompt) {
      mapped.push({ role: 'user', content: cfg.prompt })
    }
    return mapped
  }, [compressHostedContext])

  const callHostedAI = useCallback(
    async (messages: any[], onChunk: (chunk: string) => void) => {
      const cfg = await readHostedAssistantConfig()
      if (!cfg.baseUrl || !cfg.model) throw new Error('托管 Agent 未配置模型（请在 AI 助手页面配置）')
      const base = cfg.baseUrl
        .replace(/\/+$/, '')
        .replace(/\/chat\/completions\/?$/, '')
        .replace(/\/completions\/?$/, '')
        .replace(/\/messages\/?$/, '')
        .replace(/\/models\/?$/, '')

      if (hostedAbortRef.current) {
        hostedAbortRef.current.abort()
      }
      hostedAbortRef.current = new AbortController()
      const signal = hostedAbortRef.current.signal
      const timeout = window.setTimeout(() => {
        if (hostedAbortRef.current) hostedAbortRef.current.abort()
      }, 120000)

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`
        const body = { model: cfg.model, messages, stream: true, temperature: cfg.temperature || 0.7 }
        const resp = await fetch(base + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        })
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          let errMsg = `API 错误 ${resp.status}`
          try {
            errMsg = JSON.parse(errText).error?.message || errMsg
          } catch {}
          throw new Error(errMsg)
        }
        const reader = resp.body?.getReader()
        if (!reader) throw new Error('托管 Agent 流式响应为空')
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') return
            try {
              const json = JSON.parse(data)
              const chunk = json?.choices?.[0]?.delta?.content
              if (chunk) onChunk(stripAnsi(String(chunk)))
            } catch {
              /* ignore */
            }
          }
        }
      } finally {
        clearTimeout(timeout)
        hostedAbortRef.current = null
      }
    },
    [],
  )

  const runHostedAgentStep = useCallback(async () => {
    const cfg = hostedConfigRef.current
    const rt = hostedRuntimeRef.current
    if (!cfg?.enabled) return
    if (busyRef.current) return
    if (!cfg.prompt?.trim()) return

    const curSessionKey = sessionKeyRef.current
    if (!wsClient.gatewayReady || !curSessionKey) {
      rt.status = HOSTED_STATUS.PAUSED
      rt.lastError = ''
      persistConfig()
      syncUiFromRefs()
      return
    }
    if (rt.errorCount >= cfg.retryLimit) {
      rt.status = HOSTED_STATUS.ERROR
      persistConfig()
      syncUiFromRefs()
      appendHostedOutput('需要人工介入: 连续错误超过阈值')
      return
    }
    if (rt.stepCount >= cfg.maxSteps) {
      rt.status = HOSTED_STATUS.IDLE
      rt.pending = false
      persistConfig()
      syncUiFromRefs()
      return
    }

    busyRef.current = true
    rt.pending = true
    rt.status = HOSTED_STATUS.RUNNING
    rt.lastRunAt = Date.now()
    rt.lastRunId = uuid()
    persistConfig()
    syncUiFromRefs()

    const delay = cfg.stepDelayMs || HOSTED_DEFAULTS.stepDelayMs
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))

    try {
      const messages = buildHostedMessages()
      let resultText = ''
      await callHostedAI(messages, (chunk) => {
        resultText += chunk
      })

      rt.stepCount += 1
      rt.errorCount = 0
      rt.lastError = ''
      cfg.history.push({ role: 'assistant', content: resultText, ts: Date.now() })
      persistConfig()

      appendHostedOutput(resultText + ` | step=${rt.stepCount}`)

      const instruction = resultText.trim()
      if (instruction && !detectStopFromText(instruction)) {
        rt.status = HOSTED_STATUS.WAITING
        rt.pending = false
        persistConfig()
        syncUiFromRefs()
        try {
          // 发给 Gateway Agent
          const apiMod = await import('../../lib/tauri-api.js')
          await apiMod.api.chatSend(curSessionKey, instruction)
        } catch {
          /* ignore */
        }
      } else {
        rt.status = HOSTED_STATUS.IDLE
        rt.pending = false
        persistConfig()
        syncUiFromRefs()
      }
    } catch (e: any) {
      rt.errorCount = (rt.errorCount || 0) + 1
      rt.lastError = e?.message || String(e)
      rt.pending = false
      if (rt.errorCount >= cfg.retryLimit) {
        rt.status = HOSTED_STATUS.ERROR
        persistConfig()
        syncUiFromRefs()
        appendHostedOutput('需要人工介入: ' + rt.lastError)
        return
      }
      persistConfig()
      syncUiFromRefs()
      setTimeout(() => {
        busyRef.current = false
        runHostedAgentStep()
      }, delay)
      return
    } finally {
      busyRef.current = false
    }
  }, [appendHostedOutput, buildHostedMessages, callHostedAI, persistConfig, sessionKeyRef, syncUiFromRefs])

  // TS 递归引用修复：上面 useCallback 里 self 引用可能导致错误，这里不用递归优化。
  // 实际运行时由 start/shouldCapture 触发下一轮。

  const startHostedAgent = useCallback(async () => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    const prompt = (cfg.prompt || '').trim()
    if (!prompt) {
      toast('请输入任务目标', 'warning')
      return
    }

    const rawSteps = parseInt(String(cfg.maxSteps || HOSTED_DEFAULTS.maxSteps), 10)
    const maxSteps = rawSteps >= 205 ? 999999 : Math.max(1, rawSteps)
    const stepDelayMs = Math.max(200, parseInt(String(cfg.stepDelayMs || HOSTED_DEFAULTS.stepDelayMs), 10))
    const retryLimit = Math.max(0, parseInt(String(cfg.retryLimit || HOSTED_DEFAULTS.retryLimit), 10))
    const autoStopMinutes = Math.max(0, parseInt(String(cfg.autoStopMinutes || 0), 10))

    const curSessionKey = sessionKeyRef.current
    if (!curSessionKey) return

    const sysContent = HOSTED_SYSTEM_PROMPT + '\n\n用户目标: ' + prompt
    if (!cfg.history?.length) cfg.history = [{ role: 'system', content: sysContent, ts: Date.now() } as any]
    else if (cfg.history[0]?.role === 'system') cfg.history[0].content = sysContent
    else cfg.history.unshift({ role: 'system', content: sysContent, ts: Date.now() } as any)

    cfg.enabled = true
    cfg.prompt = prompt
    cfg.maxSteps = maxSteps
    cfg.stepDelayMs = stepDelayMs
    cfg.retryLimit = retryLimit
    cfg.autoStopMinutes = autoStopMinutes

    hostedRuntimeRef.current = { ...HOSTED_RUNTIME_DEFAULT, status: HOSTED_STATUS.RUNNING }
    startTimeRef.current = Date.now()
    persistConfig()
    syncUiFromRefs()

    clearTimers()
    if (autoStopMinutes > 0) {
      autoStopTimerRef.current = window.setTimeout(() => {
        appendHostedOutput(`定时 ${autoStopMinutes} 分钟已到，自动停止`)
        stopHostedAgent()
      }, autoStopMinutes * 60000) as any
      startCountdown()
    }
    setTimeout(() => runHostedAgentStep(), 0)
    toast('托管 Agent 已启动', 'success')
  }, [appendHostedOutput, clearTimers, persistConfig, runHostedAgentStep, startCountdown, syncUiFromRefs])

  const stopHostedAgent = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    if (hostedAbortRef.current) {
      hostedAbortRef.current.abort()
      hostedAbortRef.current = null
    }
    clearTimers()
    busyRef.current = false
    cfg.enabled = false
    hostedRuntimeRef.current = { ...HOSTED_RUNTIME_DEFAULT }
    startTimeRef.current = 0
    persistConfig()
    syncUiFromRefs()
    toast('托管 Agent 已停止', 'info')
  }, [clearTimers, persistConfig, syncUiFromRefs])

  const toggleHostedRun = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    const rt = hostedRuntimeRef.current
    if (cfg.enabled && rt.status !== HOSTED_STATUS.IDLE) stopHostedAgent()
    else startHostedAgent()
  }, [startHostedAgent, stopHostedAgent])

  const maybeTriggerHostedRun = useCallback(() => {
    const cfg = hostedConfigRef.current
    if (!cfg?.enabled) return
    const rt = hostedRuntimeRef.current
    if (rt.status === HOSTED_STATUS.IDLE || rt.status === HOSTED_STATUS.PAUSED || rt.status === HOSTED_STATUS.ERROR) return
    if (rt.pending || busyRef.current) return
    if (!wsClient.gatewayReady) {
      rt.status = HOSTED_STATUS.PAUSED
      persistConfig()
      syncUiFromRefs()
      return
    }
    rt.status = HOSTED_STATUS.IDLE
    persistConfig()
    syncUiFromRefs()
    runHostedAgentStep()
  }, [persistConfig, runHostedAgentStep, syncUiFromRefs])

  const shouldCaptureHostedTarget = useCallback((payload: any) => {
    const cfg = hostedConfigRef.current
    if (!cfg?.enabled) return false
    const rt = hostedRuntimeRef.current
    if (rt.status === HOSTED_STATUS.PAUSED || rt.status === HOSTED_STATUS.ERROR || rt.status === HOSTED_STATUS.IDLE) return false
    if (payload?.message?.role && payload.message.role !== 'assistant') return false
    const ts = payload?.timestamp || Date.now()
    if (ts && ts === lastTargetTsRef.current) return false
    lastTargetTsRef.current = ts
    return true
  }, [])

  const onChatFinal = useCallback(
    async (payload: any, assistantText: string) => {
      const capturedText = assistantText || ''
      if (!capturedText) return
      if (!shouldCaptureHostedTarget(payload)) return
      appendHostedTarget(capturedText)
      if (detectStopFromText(capturedText)) {
        appendHostedOutput('DeerFlow 回复包含完成信号，自动停止')
        stopHostedAgent()
      } else {
        maybeTriggerHostedRun()
      }
    },
    [appendHostedOutput, appendHostedTarget, maybeTriggerHostedRun, shouldCaptureHostedTarget, stopHostedAgent],
  )

  // Mount + sessionKey change: load config
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadHostedDefaults()
      if (cancelled) return
      loadHostedSessionConfig()
    })()
    return () => {
      cancelled = true
    }
  }, [loadHostedDefaults, loadHostedSessionConfig])

  const setDraft = useCallback((next: Partial<Pick<HostedSessionConfig, 'prompt' | 'maxSteps' | 'autoStopMinutes'>>) => {
    const cfg = hostedConfigRef.current
    if (!cfg) return
    if (typeof next.prompt === 'string') cfg.prompt = next.prompt
    if (typeof next.maxSteps === 'number') cfg.maxSteps = next.maxSteps
    if (typeof next.autoStopMinutes === 'number') cfg.autoStopMinutes = next.autoStopMinutes
    syncUiFromRefs()
  }, [syncUiFromRefs])

  const statusText = useMemo(() => {
    if (!ui.enabled) return '未启用'
    if (ui.status === HOSTED_STATUS.RUNNING) return `运行中 · 剩余 ${Math.max(0, ui.maxSteps - ui.stepCount)} 步`
    if (ui.status === HOSTED_STATUS.WAITING) return '等待回复'
    if (ui.status === HOSTED_STATUS.PAUSED) return '已暂停'
    if (ui.status === HOSTED_STATUS.ERROR) return ui.lastError ? `异常: ${ui.lastError}` : '异常'
    return '待命'
  }, [ui.enabled, ui.status, ui.stepCount, ui.maxSteps])

  return {
    hosted: {
      panelOpen,
      setPanelOpen,
      ui,
      statusText,
      hostedStatusIcon: iconForStatus(ui.status),
      setDraft,
      toggleHostedRun,
      startHostedAgent,
      stopHostedAgent,
    },
    hostedCapture: {
      onChatFinal,
    },
  }
}

