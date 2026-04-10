import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownHtml } from './MarkdownHtml.js'
import type { SubagentStreamTask, ThreadPanelState, CollabSubtaskSnapshot, CollabTaskSnapshot, SupervisorStepSnapshot } from '../chat-types.js'

interface TaskSidebarProps {
  state: ThreadPanelState
  taskHistory?: CollabTaskSnapshot[]
  selectedTaskId?: string | null
  activeTaskSubtasks?: CollabSubtaskSnapshot[]
  activeTaskSteps?: SupervisorStepSnapshot[]
  isOpen: boolean
}

function getStatusIcon(status?: string): string {
  switch (status) {
    case 'completed':
      return '✅'
    case 'in_progress':
    case 'running':
    case 'executing':
      return '🔄'
    case 'pending':
    default:
      return '⏳'
  }
}

function normalizeSubtaskStatus(status?: string): string {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

function isSubtaskRunning(status?: string): boolean {
  const s = normalizeSubtaskStatus(status)
  return s === 'in_progress' || s === 'running' || s === 'executing' || s === 'active'
}

function isSubtaskCompleted(status?: string): boolean {
  const s = normalizeSubtaskStatus(status)
  return s === 'completed' || s === 'done'
}

function getStatusClass(status?: string): string {
  const s = normalizeSubtaskStatus(status)
  switch (s) {
    case 'completed':
    case 'done':
      return 'task-status-completed'
    case 'in_progress':
    case 'running':
    case 'executing':
    case 'active':
      return 'task-status-progress'
    case 'pending':
    case 'planned':
    default:
      return 'task-status-pending'
  }
}

function subtaskStatusZh(status?: string): string {
  if (!status) return '待处理'
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'done') return '已完成'
  if (s === 'in_progress' || s === 'running' || s === 'executing') return '进行中'
  if (s === 'pending') return '待执行'
  if (s === 'failed' || s === 'error') return '失败'
  return status
}

function toProgress(progress?: number): number | null {
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null
  return Math.min(100, Math.max(0, Math.round(progress)))
}

// NOTE: 进度优化/融合逻辑已移除：进度以服务端快照值为准。

function isTerminalStatus(status?: string): boolean {
  const s = String(status || '').toLowerCase()
  return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'timed_out'
}

function findSubagentLiveForCollabSubtask(
  tasksMap: Record<string, SubagentStreamTask> | undefined,
  collabSubtaskId: string,
  fallbackText?: string,
): { text: string; matched: boolean } {
  const cid = String(collabSubtaskId || '').trim()
  const cid8 = cid.length > 8 ? cid.slice(-8) : cid
  const all = Object.values(tasksMap || {})
  const preferText = (t: SubagentStreamTask | undefined): string => {
    if (!t) return ''
    const rawLive = String(t.liveOutput || '').trim()
    if (rawLive) return rawLive
    const hint = String(t.progressHint || '').trim()
    if (hint) return hint
    const tools = (t.tools || []) as Record<string, unknown>[]
    if (!tools.length) return ''
    const names = tools
      .map((o) => {
        const name = String(o.name || '').trim() || 'tool'
        const st = String(o.status || '').trim()
        return st ? `${name} · ${st}` : name
      })
      .filter(Boolean)
    if (!names.length) return ''
    return `工具过程：${names.slice(0, 10).join(' · ')}`
  }
  if (!all.length) return { text: '', matched: false }
  if (cid) {
    const byId = all.find((t) => {
      const raw = String(t.collabSubtaskId || '').trim()
      if (!raw) return false
      if (raw === cid) return true
      const raw8 = raw.length > 8 ? raw.slice(-8) : raw
      return raw8 === cid8
    })
    const txt = preferText(byId)
    if (byId) return { text: txt, matched: true }
  }
  const txt = String(fallbackText || '').trim().toLowerCase()
  if (!txt) return { text: '', matched: false }
  const pick = (arr: SubagentStreamTask[]) =>
    arr.find((t) => {
      const d = String(t.description || '').trim().toLowerCase()
      return d && (txt.includes(d) || d.includes(txt))
    })
  const running = all.filter((t) => t.phase === 'running')
  const hit = pick(running) || pick(all)
  const byDescText = preferText(hit)
  if (byDescText) return { text: byDescText, matched: !!hit }
  if (hit && Array.isArray(hit.tools) && hit.tools.length > 0) {
    return { text: `工具调用进行中（${hit.tools.length}）`, matched: true }
  }
  return { text: '', matched: !!hit }
}

function buildSubtaskMarkdown(s: CollabSubtaskSnapshot, previewText: string): string {
  const lines: string[] = []
  if (previewText) {
    lines.push(`## 实时摘要`)
    lines.push('')
    lines.push(previewText.trim())
    lines.push('')
  }
  if (Array.isArray(s.observedToolCalls) && s.observedToolCalls.length) {
    lines.push('## 工具调用（observed_tool_calls）')
    lines.push('')
    try {
      lines.push('```json')
      lines.push(JSON.stringify(s.observedToolCalls, null, 2))
      lines.push('```')
    } catch {
      lines.push('```')
      lines.push(String(s.observedToolCalls))
      lines.push('```')
    }
  }
  return lines.join('\n').trim()
}

function copyToClipboard(text: string): void {
  const t = String(text || '')
  if (!t) return
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(t)
      return
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = t
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch {
    // ignore
  }
}

function debugSubtaskUiEnabled(): boolean {
  try {
    return localStorage.getItem('DEERFLOW_DEBUG_SUBTASK_UI') !== '0'
  } catch {
    return true
  }
}

/** liveOutput 多段用 ─── 拼接时，跑马灯只展示最新一段（模型输出不被前面的工具摘要盖住） */
function latestLiveSegment(full: string): string {
  const t = String(full || '').trim()
  if (!t) return ''
  const sep = '\n\n───\n\n'
  if (!t.includes(sep)) return t
  const parts = t.split(sep)
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = String(parts[i] || '').trim()
    if (!seg) continue
    // 完成事件有时只会追加「【完成】」，这不应覆盖最后一段真实输出。
    if (seg === '【完成】') continue
    if (seg.startsWith('【完成】\n')) {
      const body = seg.replace(/^【完成】\n+/, '').trim()
      if (body) return body
      continue
    }
    return seg
  }
  return t
}

function SubtaskCard({
  s,
  subagentTasks,
  onOpen,
}: {
  s: CollabSubtaskSnapshot
  subagentTasks?: Record<string, SubagentStreamTask>
  onOpen: (payload: { title: string; text: string; status: string; progress: number | null }) => void
}) {
  const contentText =
    (s.name || s.description || s.subtaskId || '').trim() || '子任务'
  const agentName = (s.assignedAgent || '').trim() || '未分配'
  const running = isSubtaskRunning(s.status)
  const done = isSubtaskCompleted(s.status)
  const terminal = isTerminalStatus(s.status) || String(s.status || '').trim().toLowerCase() === 'timed_out'
  const showTrailingLabel = !running && !done
  const fullTitle = `${agentName} · ${contentText}`
  const liveFromStream = findSubagentLiveForCollabSubtask(subagentTasks, s.subtaskId, contentText)
  const liveFromObserved = (() => {
    const calls = Array.isArray(s.observedToolCalls) ? (s.observedToolCalls as Record<string, any>[]) : []
    if (!calls.length) return ''
    const lines = calls
      .slice(-12)
      .map((c) => {
        const name = String(c.name || c.tool_name || c.tool || 'tool')
        const st = String(c.status || c.state || '').trim()
        return st ? `${name} · ${st}` : name
      })
      .filter(Boolean)
    if (!lines.length) return ''
    return `工具过程：${lines.join(' · ')}`
  })()
  // 运行态只展示子智能体原始流（task_running），不回退到摘要字段。
  const streamFull = (liveFromStream.text || '').trim()
  const live = (latestLiveSegment(streamFull) || streamFull).trim()
  const terminalFallback = (
    String(s.outputSummary || '').trim() ||
    liveFromObserved
  ).trim()
  const fallbackWhileRunning = running ? '运行中…' : ''
  const previewText =
    live ||
    (liveFromStream.matched
      ? '（已启动，等待首条输出…）'
      : fallbackWhileRunning
        ? fallbackWhileRunning
        : terminal
          ? terminalFallback
          : '')
  const hasPreview = !!String(previewText || '').trim()
  /** 跑马灯单行展示：避免换行 + 固定 14px 高度把多行裁成不可见 */
  const tickerLine = String(previewText || '')
    .replace(/\s*\n\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()
  useEffect(() => {
    if (!debugSubtaskUiEnabled()) return
    // eslint-disable-next-line no-console
    console.debug(
      `[subtask-ui] sid=${String(s.subtaskId || '')} running=${running} terminal=${terminal} has_preview=${hasPreview} ticker="${String(tickerLine || '').slice(0, 180)}"`,
    )
  }, [s.subtaskId, running, terminal, hasPreview, tickerLine])
  const renderedPreview = useMemo(() => {
    const txt = String(tickerLine || '')
    // 过长文本不做逐字动画，避免 DOM 过重
    if (!running || txt.length > 220) return txt
    return Array.from(txt).map((ch, i) => (
      <span
        key={`c-${i}`}
        className="react-chat-subtask-ticker-char"
        style={{ ['--i' as any]: i } as any}
      >
        {ch}
      </span>
    ))
  }, [tickerLine, running])
  const modalMd = useMemo(
    () => buildSubtaskMarkdown(s, streamFull || previewText),
    [s, streamFull, previewText],
  )
  const status = useMemo(() => String(s.status || '').trim() || 'pending', [s.status])
  const progress = useMemo(() => toProgress(s.progress), [s.progress])
  const tickerRef = useRef<HTMLSpanElement | null>(null)
  const tickerInnerRef = useRef<HTMLSpanElement | null>(null)
  const [tickerDist, setTickerDist] = useState<number>(0)
  const [tickerDur, setTickerDur] = useState<number>(0)

  useEffect(() => {
    const el = tickerRef.current
    const inner = tickerInnerRef.current
    if (!el || !inner) return
    const calc = () => {
      const dist = Math.max(0, inner.scrollWidth - el.clientWidth)
      if (dist <= 4) {
        setTickerDist(0)
        setTickerDur(0)
        return
      }
      // 约 34px/s，限定 6-30s，避免过快/过慢
      const dur = Math.min(30, Math.max(6, dist / 34))
      setTickerDist(dist)
      setTickerDur(dur)
    }
    // 下一帧测量，确保 DOM 已布局
    const raf = requestAnimationFrame(calc)
    window.addEventListener('resize', calc)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', calc)
    }
  }, [tickerLine])
  const showLiveTicker = !terminal && hasPreview
  return (
    <div
      className={`react-chat-subtask-card ${getStatusClass(s.status)}${showLiveTicker ? ' react-chat-subtask-card--live' : ''}`}
      onClick={() => {
        onOpen({ title: fullTitle, text: modalMd, status, progress })
      }}
      role="button"
      tabIndex={0}
    >
      <div className="react-chat-subtask-card-row">
        <span className="react-chat-subtask-card-icon-slot" aria-hidden>
          {running ? (
            <span className="react-chat-subtask-spinner" />
          ) : done ? (
            <span className="react-chat-subtask-check">✓</span>
          ) : (
            <span className="react-chat-subtask-dot" />
          )}
        </span>
        <div className="react-chat-subtask-card-main" title={fullTitle}>
          <div className="react-chat-subtask-card-headline">
            <span className="react-chat-subtask-agent-ico" aria-hidden>
              🤖
            </span>
            <span className="react-chat-subtask-agent-name">{agentName}</span>
            <span className="react-chat-subtask-head-sep" aria-hidden>
              ·
            </span>
            <span className="react-chat-subtask-card-title">{contentText}</span>
          </div>
        </div>
        {showTrailingLabel ? (
          <span className="react-chat-subtask-badge react-chat-subtask-badge--status">
            {subtaskStatusZh(s.status)}
          </span>
        ) : null}
      </div>
      {showLiveTicker ? (
        <div className="react-chat-subtask-live-ticker">
          <span
            ref={tickerRef}
            className={[
              'react-chat-subtask-ticker',
              'react-chat-subtask-ticker--fullrow',
              tickerDist > 0 ? 'react-chat-subtask-ticker--scroll' : '',
              running ? 'react-chat-subtask-ticker--glow' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              {
                ['--subtask-ticker-dist' as any]: `${tickerDist}px`,
                ['--subtask-ticker-dur' as any]: `${tickerDur}s`,
              } as any
            }
            title={previewText}
          >
            <span ref={tickerInnerRef} className="react-chat-subtask-ticker__inner">
              {renderedPreview}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function TaskSidebar({
  state,
  taskHistory,
  selectedTaskId,
  activeTaskSubtasks,
  // activeTaskSteps, // 主任务行/步骤区已隐藏
  isOpen,
}: TaskSidebarProps) {
  const [subtaskModal, setSubtaskModal] = useState<
    null | { title: string; text: string; status: string; progress: number | null }
  >(null)
  const hasTodos = Array.isArray(state.todos) && state.todos.length > 0
  const history = (taskHistory || []).filter((t) => !!(t.taskId || '').trim())
  const collabFromHistory =
    history.find((t) => (t.taskId || '').trim() === (selectedTaskId || '').trim()) ||
    history.find((t) => (t.taskId || '').trim() === (selectedTaskId || '').trim()) ||
    history[0] ||
    null
  const collab = collabFromHistory || state.collabTask
  const latestTaskId = (collab?.taskId || '').trim()
  // const steps = activeTaskSteps || state.supervisorSteps || [] // 主任务行/步骤区已隐藏
  const subtasksAll = state.collabSubtasks || []
  const subtasksSrc = activeTaskSubtasks || subtasksAll
  const subtasks = latestTaskId ? subtasksSrc.filter((s) => !s.parentTaskId || s.parentTaskId === latestTaskId) : []
  const hasSubtasks = subtasks.length > 0
  // const collabProgressPct = toProgress(collab?.progress) // 进度展示已下线
  // NOTE: 主任务进度条/百分比已隐藏，仅保留状态徽标。

  const hasAnythingToShow =
    !!subtaskModal ||
    hasSubtasks ||
    hasTodos ||
    !!state.reasoningPreview ||
    !!state.clarification?.preview

  if (!isOpen) return null
  // 空态文案已移除：无内容时直接不渲染侧栏容器，避免出现空 div
  if (!hasAnythingToShow) return null

  const asideClass = 'react-chat-thread-panel react-chat-task-sidebar'

  const modalNode =
    subtaskModal && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="react-chat-modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSubtaskModal(null)
            }}
          >
            <div
              className="react-chat-modal-card react-chat-modal-card--settings react-chat-subtask-modal-card"
              style={{ width: 'min(980px, 96vw)' }}
            >
              <div className="react-chat-modal-header">
                <div className="react-chat-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    className={`react-chat-subtask-status-light ${getStatusClass(subtaskModal.status)}`}
                    aria-label={`状态：${subtaskModal.status}${subtaskModal.progress != null ? `，进度：${subtaskModal.progress}%` : ''}`}
                    title={`状态：${subtaskModal.status}${subtaskModal.progress != null ? `，进度：${subtaskModal.progress}%` : ''}`}
                  />
                  <span>{subtaskModal.title}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="react-chat-modal-btn react-chat-modal-btn--ghost"
                    onClick={() => copyToClipboard(subtaskModal.text)}
                  >
                    复制
                  </button>
                  <button type="button" className="react-chat-modal-close" onClick={() => setSubtaskModal(null)}>
                    ×
                  </button>
                </div>
              </div>
              <div className="react-chat-modal-body react-chat-subtask-modal-body">
                <div className="react-chat-subtask-modal-content">
                  <MarkdownHtml text={subtaskModal.text} className="msg-text" />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <Fragment>
      <aside className={asideClass}>
        <div className="react-chat-task-sidebar-content">
          {state.reasoningPreview && (
            <div className="react-chat-task-section">
              <div className="react-chat-task-section-label">思考过程</div>
              <pre className="react-chat-task-reasoning">{state.reasoningPreview}</pre>
            </div>
          )}

          {state.clarification?.preview && (
            <div className="react-chat-task-section">
              <div className="react-chat-task-section-label">待确认</div>
              <div className="react-chat-task-clarify">{state.clarification.preview}</div>
            </div>
          )}

          {/* 主任务行已隐藏：侧栏仅展示子任务 TODO / 计划待办 */}

          {hasSubtasks && (
            <div className="react-chat-task-section" role="group" aria-label="子任务">
              <div className="react-chat-task-subgrid">
                {subtasks.map((s) => (
                  <SubtaskCard
                    key={s.subtaskId}
                    s={s}
                    subagentTasks={state.subagentTasks}
                    onOpen={(payload) => setSubtaskModal(payload)}
                  />
                ))}
              </div>
            </div>
          )}

          {hasTodos ? (
            <div className="react-chat-task-section">
              <div className="react-chat-task-section-label">
                计划待办
                <span className="react-chat-task-count">
                  {state.todos.filter((t) => t.status === 'completed').length} / {state.todos.length}
                </span>
              </div>
              <ul className="react-chat-task-list">
                {state.todos.map((todo, index) => (
                  <li
                    key={`${todo.status || 'pending'}-${index}`}
                    className={`react-chat-task-item ${getStatusClass(todo.status)}`}
                  >
                    <span className="react-chat-task-status-icon">{getStatusIcon(todo.status)}</span>
                    <span className="react-chat-task-content">{String(todo.content ?? '').trim()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </aside>
      {modalNode}
    </Fragment>
  )
}
