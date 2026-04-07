import type { ThreadPanelState, CollabSubtaskSnapshot, CollabTaskSnapshot, SupervisorStepSnapshot } from '../chat-types.js'

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

function taskStatusZh(status?: string): string {
  return subtaskStatusZh(status)
}

function toProgress(progress?: number): number | null {
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null
  return Math.min(100, Math.max(0, Math.round(progress)))
}

function stagePercent(step: SupervisorStepSnapshot): number {
  const action = String(step.action || '').toLowerCase()
  const label = String(step.label || '').toLowerCase()
  if (action.includes('create_task') || label.includes('创建主任务')) return 10
  if (action.includes('create_subtask') || label.includes('创建子任务')) return 25
  if (action.includes('assign_subtask') || label.includes('分配子任务')) return 40
  if (action.includes('start_execution') || label.includes('开始执行')) return 55
  if (label.includes('执行中') || action.includes('execute')) return 75
  if (label.includes('完成') || action.includes('complete')) return 100
  return step.done ? 80 : 65
}

function deriveScheduleProgress(steps: SupervisorStepSnapshot[]): { percent: number | null; text: string } {
  if (!steps.length) return { percent: null, text: '' }
  let maxPct = 0
  for (const st of steps) {
    maxPct = Math.max(maxPct, stagePercent(st))
  }
  const latest = steps[steps.length - 1]
  const latestLabel = (latest?.label || latest?.action || '处理中').toString()
  const text = latest.done ? `已完成：${latestLabel}` : `进行中：${latestLabel}`
  return { percent: Math.min(100, Math.max(0, maxPct)), text }
}

function isTerminalStatus(status?: string): boolean {
  const s = String(status || '').toLowerCase()
  return s === 'completed' || s === 'failed' || s === 'cancelled'
}

function SubtaskCard({ s }: { s: CollabSubtaskSnapshot }) {
  const contentText =
    (s.name || s.description || s.subtaskId || '').trim() || '子任务'
  const agentName = (s.assignedAgent || '').trim() || '未分配'
  const running = isSubtaskRunning(s.status)
  const done = isSubtaskCompleted(s.status)
  const showTrailingLabel = !running && !done
  const fullTitle = `${agentName} · ${contentText}`
  return (
    <div className={`react-chat-subtask-card ${getStatusClass(s.status)}`}>
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
          <span className="react-chat-subtask-agent">
            <span className="react-chat-subtask-agent-ico" aria-hidden>
              🤖
            </span>
            <span className="react-chat-subtask-agent-name">{agentName}</span>
          </span>
          <span className="react-chat-subtask-card-text">{contentText}</span>
        </div>
        {showTrailingLabel ? (
          <span className="react-chat-subtask-badge react-chat-subtask-badge--status">
            {subtaskStatusZh(s.status)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function TaskSidebar({
  state,
  taskHistory,
  selectedTaskId,
  activeTaskSubtasks,
  activeTaskSteps,
  isOpen,
}: TaskSidebarProps) {
  const hasTodos = Array.isArray(state.todos) && state.todos.length > 0
  const history = (taskHistory || []).filter((t) => !!(t.taskId || '').trim())
  const collabFromHistory =
    history.find((t) => (t.taskId || '').trim() === (selectedTaskId || '').trim()) ||
    history.find((t) => (t.taskId || '').trim() === (selectedTaskId || '').trim()) ||
    history[0] ||
    null
  const collab = collabFromHistory || state.collabTask
  const latestTaskId = (collab?.taskId || '').trim()
  const hasCollab = !!latestTaskId
  const steps = activeTaskSteps || state.supervisorSteps || []
  const subtasksAll = state.collabSubtasks || []
  const subtasksSrc = activeTaskSubtasks || subtasksAll
  const subtasks = latestTaskId ? subtasksSrc.filter((s) => !s.parentTaskId || s.parentTaskId === latestTaskId) : []
  const hasSteps = steps.length > 0
  const hasSubtasks = subtasks.length > 0
  const schedule = deriveScheduleProgress(steps)
  // 协作总进度融合：
  // - schedule.percent 体现创建/分配/启动等“编排阶段”
  // - collab.progress 体现子任务执行阶段（后端快照）
  // 目标：既保留后端稳定值，又让“创建/分配”成为总进度的一部分，避免过早 100%。
  const collabProgressPct = toProgress(collab?.progress)
  const schedulePct = toProgress(schedule.percent ?? undefined)
  const terminal = isTerminalStatus(collab?.status)
  const hasOpenSubtasks = subtasks.some((s) => !isTerminalStatus(s.status))
  let displayCollabPct: number | null = null
  if (collabProgressPct != null && schedulePct != null) {
    // 将编排阶段（约 0-55）作为下限，执行阶段取后端快照。
    const scheduleFloor = Math.min(schedulePct, 55)
    displayCollabPct = Math.max(collabProgressPct, scheduleFloor)
  } else {
    displayCollabPct = collabProgressPct ?? schedulePct
  }
  // 若主任务尚未终态或仍有未终态子任务，不展示 100%，避免“看起来已结束”。
  if (displayCollabPct != null && displayCollabPct >= 100 && (!terminal || hasOpenSubtasks)) {
    displayCollabPct = 99
  }

  const showEmpty =
    !hasTodos &&
    !hasCollab &&
    !hasSteps &&
    !hasSubtasks &&
    !state.reasoningPreview &&
    !state.clarification?.preview

  if (!isOpen) return null

  const asideClass = 'react-chat-thread-panel react-chat-task-sidebar'

  return (
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

        {hasCollab && collab && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-title">{collab.name?.trim() || collab.taskId}</div>
            <div className="react-chat-task-state-row">
              <span className={`react-chat-task-state-badge ${getStatusClass(collab.status)}`}>
                {taskStatusZh(collab.status)}
              </span>
              {displayCollabPct != null ? (
                <span className="react-chat-task-state-percent">
                  {displayCollabPct}%
                </span>
              ) : null}
            </div>
            {displayCollabPct != null ? (
              <div className="react-chat-task-progress">
                <div
                  className="react-chat-task-progress-bar"
                  style={{ width: `${displayCollabPct}%` }}
                />
              </div>
            ) : null}
          </div>
        )}

        {hasSubtasks && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">TODO</div>
            <div className="react-chat-task-subgrid">
              {subtasks.map((s) => (
                <SubtaskCard key={s.subtaskId} s={s} />
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
        ) : showEmpty ? (
          <div className="react-chat-task-empty">
            <p>暂无任务</p>
            <p className="react-chat-task-hint">
              流式对话中 Supervisor 创建任务后会自动展开本侧栏；计划模式待办显示在「计划待办」区域。
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
