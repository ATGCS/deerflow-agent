import type { ThreadPanelState, CollabSubtaskSnapshot } from '../chat-types.js'

interface TaskSidebarProps {
  state: ThreadPanelState
  isOpen: boolean
  /** 收起为右侧窄条（仍占位），与主导航 « » 类似 */
  collapsed: boolean
  onToggleCollapse: () => void
  onClose: () => void
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
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

function getStatusClass(status?: string): string {
  switch (status) {
    case 'completed':
      return 'task-status-completed'
    case 'in_progress':
    case 'running':
    case 'executing':
      return 'task-status-progress'
    case 'pending':
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

function SubtaskCard({ s }: { s: CollabSubtaskSnapshot }) {
  const title = (s.name || s.subtaskId || '').trim() || '子任务'
  const agent = (s.assignedAgent || '').trim()
  return (
    <div className={`react-chat-subtask-card ${getStatusClass(s.status)}`}>
      <div className="react-chat-subtask-card-top">
        <span className="react-chat-subtask-card-icon" aria-hidden>
          {getStatusIcon(s.status)}
        </span>
        <div className="react-chat-subtask-card-head">
          <div className="react-chat-subtask-card-title" title={title}>
            {title}
          </div>
          <div className="react-chat-subtask-card-badges">
            <span className="react-chat-subtask-badge react-chat-subtask-badge--status">
              {subtaskStatusZh(s.status)}
            </span>
            {agent ? (
              <span className="react-chat-subtask-badge react-chat-subtask-badge--agent" title={agent}>
                {agent}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {s.description ? (
        <p className="react-chat-subtask-card-desc" title={s.description}>
          {s.description}
        </p>
      ) : null}
      {typeof s.progress === 'number' ? (
        <div className="react-chat-subtask-card-progress">
          <div
            className="react-chat-subtask-card-progress-bar"
            style={{ width: `${Math.min(100, Math.max(0, s.progress))}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

export function TaskSidebar({ state, isOpen, collapsed, onToggleCollapse, onClose }: TaskSidebarProps) {
  const hasTodos = Array.isArray(state.todos) && state.todos.length > 0
  const hasTitle = !!(state.title || '').trim()
  const hasActivity = !!(state.activityDetail || '').trim() && state.activityKind !== 'idle'
  const collab = state.collabTask
  const hasCollab = !!(collab?.taskId && String(collab.taskId).trim())
  const steps = state.supervisorSteps || []
  const subtasks = state.collabSubtasks || []
  const hasSteps = steps.length > 0
  const hasSubtasks = subtasks.length > 0

  const showEmpty =
    !hasTodos &&
    !hasCollab &&
    !hasSteps &&
    !hasSubtasks &&
    !hasTitle &&
    !hasActivity &&
    !state.reasoningPreview &&
    !state.clarification?.preview

  if (!isOpen) return null

  const asideClass = `react-chat-task-sidebar${collapsed ? ' react-chat-task-sidebar--collapsed' : ''}`

  if (collapsed) {
    return (
      <aside className={asideClass} aria-label="任务进度（已收起）">
        <div className="react-chat-task-sidebar-rail">
          <button
            type="button"
            className="react-chat-task-sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title="展开任务进度"
          >
            <IconChevronLeft />
          </button>
          <button type="button" className="react-chat-task-sidebar-close" onClick={onClose} title="关闭任务面板">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className={asideClass}>
      <div className="react-chat-task-sidebar-header">
        <h3 className="react-chat-task-sidebar-title">任务进度</h3>
        <div className="react-chat-task-sidebar-header-actions">
          <button
            type="button"
            className="react-chat-task-sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title="收起为窄条"
          >
            <IconChevronRight />
          </button>
          <button
            type="button"
            className="react-chat-task-sidebar-close"
            onClick={onClose}
            title="关闭任务面板"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="react-chat-task-sidebar-content">
        {hasTitle && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">任务名称</div>
            <div className="react-chat-task-title">{state.title}</div>
          </div>
        )}

        {hasActivity && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">当前活动</div>
            <div className="react-chat-task-activity">
              {state.activityKind === 'tools' && '🔧 '}
              {state.activityKind === 'thinking' && '🤔 '}
              {state.activityKind === 'clarification' && '❓ '}
              {state.activityDetail || '处理中...'}
            </div>
          </div>
        )}

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

        {hasSteps && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">调度进度</div>
            <ul className="react-chat-task-steps" aria-label="Supervisor 步骤">
              {steps.map((st) => (
                <li
                  key={st.id}
                  className={`react-chat-task-step ${st.done ? 'react-chat-task-step--done' : 'react-chat-task-step--pending'}`}
                >
                  <span className="react-chat-task-step-dot" aria-hidden />
                  <span className="react-chat-task-step-label">{st.label}</span>
                  <span className="react-chat-task-step-state">{st.done ? '完成' : '…'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasCollab && collab && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">协作主任务</div>
            <div className="react-chat-task-title">{collab.name?.trim() || collab.taskId}</div>
            <div className="react-chat-task-meta">
              {collab.status != null && collab.status !== '' ? `状态: ${collab.status}` : ''}
              {collab.progress != null ? ` · 进度: ${collab.progress}%` : ''}
            </div>
            {collab.projectId ? (
              <div className="react-chat-task-meta">项目: {collab.projectId}</div>
            ) : null}
            <a className="react-chat-task-link" href={`#/task/${encodeURIComponent(collab.taskId)}`}>
              打开任务详情
            </a>
          </div>
        )}

        {hasSubtasks && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">子任务</div>
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
