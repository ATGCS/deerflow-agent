import type { ThreadPanelState, ThreadTodo } from '../chat-types.js'

interface TaskSidebarProps {
  state: ThreadPanelState
  isOpen: boolean
  onClose: () => void
}

function getStatusIcon(status?: string): string {
  switch (status) {
    case 'completed':
      return '✅'
    case 'in_progress':
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
      return 'task-status-progress'
    case 'pending':
    default:
      return 'task-status-pending'
  }
}

export function TaskSidebar({ state, isOpen, onClose }: TaskSidebarProps) {
  const hasTodos = Array.isArray(state.todos) && state.todos.length > 0
  const hasTitle = !!(state.title || '').trim()
  const hasActivity = !!(state.activityDetail || '').trim() && state.activityKind !== 'idle'

  // 如果侧边栏关闭，不显示任何内容
  if (!isOpen) return null

  return (
    <aside className="react-chat-task-sidebar">
      <div className="react-chat-task-sidebar-header">
        <h3 className="react-chat-task-sidebar-title">任务进度</h3>
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

      <div className="react-chat-task-sidebar-content">
        {/* 任务标题 */}
        {hasTitle && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">任务名称</div>
            <div className="react-chat-task-title">{state.title}</div>
          </div>
        )}

        {/* 活动状态 */}
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

        {/* 思考预览 */}
        {state.reasoningPreview && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">思考过程</div>
            <pre className="react-chat-task-reasoning">{state.reasoningPreview}</pre>
          </div>
        )}

        {/* 待确认 */}
        {state.clarification?.preview && (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">待确认</div>
            <div className="react-chat-task-clarify">{state.clarification.preview}</div>
          </div>
        )}

        {/* 任务列表 */}
        {hasTodos ? (
          <div className="react-chat-task-section">
            <div className="react-chat-task-section-label">
              任务列表
              <span className="react-chat-task-count">
                {state.todos.filter(t => t.status === 'completed').length} / {state.todos.length}
              </span>
            </div>
            <ul className="react-chat-task-list">
              {state.todos.map((todo, index) => (
                <li
                  key={`${todo.status || 'pending'}-${index}`}
                  className={`react-chat-task-item ${getStatusClass(todo.status)}`}
                >
                  <span className="react-chat-task-status-icon">
                    {getStatusIcon(todo.status)}
                  </span>
                  <span className="react-chat-task-content">
                    {String(todo.content ?? '').trim()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="react-chat-task-empty">
            <p>暂无任务</p>
            <p className="react-chat-task-hint">
              启用计划模式后，复杂任务会自动创建任务列表
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
