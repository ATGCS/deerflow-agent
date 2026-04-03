import type { ThreadPanelState } from '../chat-types.js'

function iconForActivityKind(kind?: string) {
  if (kind === 'thinking') return '...'
  if (kind === 'tools') return '[tool]'
  if (kind === 'clarification') return '[?]'
  return '-'
}

function markForTodoStatus(status?: string) {
  if (status === 'completed') return 'OK'
  if (status === 'in_progress') return '>'
  return 'o'
}

function parseActivityDetail(detail: string) {
  const raw = String(detail || '').trim()
  if (!raw) return { lead: '', calls: [] as string[] }
  const m = raw.match(/调用[：:]\s*(.+)$/)
  if (!m) return { lead: raw, calls: [] as string[] }
  const callsRaw = m[1] || ''
  const calls = callsRaw
    .split(/[·,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
  const lead = raw.slice(0, m.index).trim()
  return { lead, calls }
}

export function ThreadPanel({ state }: { state: ThreadPanelState }) {
  const titleText = (state.title || '').trim()
  const showTitle = !!titleText
  const showReasoning = !!(state.reasoningPreview || '').trim()
  const showClarify = !!(state.clarification?.preview || '').trim()
  const showTodos = Array.isArray(state.todos) && state.todos.length > 0
  const showActivity = !!(state.activityDetail || '').trim() && state.activityKind !== 'idle'
  const activity = parseActivityDetail(state.activityDetail || '')

  if (!showTitle && !showReasoning && !showClarify && !showTodos && !showActivity) return null

  return (
    <div className="react-chat-thread-panel">
      {showTitle && <div className="react-chat-thread-title">{titleText}</div>}

      <div className="react-chat-thread-section">
        <div className="react-chat-thread-label">进行状态</div>
        <div className="react-chat-thread-activity">
          <span className="react-chat-thread-activity-icon">{iconForActivityKind(state.activityKind)}</span>
          <span className={`react-chat-thread-activity-kind react-chat-thread-activity-kind--${state.activityKind || 'idle'}`}>
            {state.activityKind || 'idle'}
          </span>
          <span className="react-chat-thread-activity-detail">{activity.lead || '处理中'}</span>
          {activity.calls.length ? (
            <span className="react-chat-thread-activity-calls">
              {activity.calls.map((name, idx) => (
                <span key={`${name}-${idx}`} className="react-chat-thread-activity-call-chip">
                  {name}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      {showReasoning && (
        <div className="react-chat-thread-section">
          <div className="react-chat-thread-label">思考</div>
          <pre className="react-chat-thread-reasoning">{state.reasoningPreview}</pre>
        </div>
      )}

      {showClarify && (
        <div className="react-chat-thread-section">
          <div className="react-chat-thread-label">待确认</div>
          <div className="react-chat-thread-clarify">{state.clarification?.preview || ''}</div>
        </div>
      )}

      {showTodos && (
        <div className="react-chat-thread-section">
          <div className="react-chat-thread-label">任务进度</div>
          <ul className="react-chat-thread-todos">
            {state.todos.map((todo, i) => (
              <li
                key={`${todo?.status || 'todo'}-${i}`}
                className={`react-chat-thread-todo react-chat-thread-todo--${todo?.status || 'pending'}`}
              >
                <span className="react-chat-thread-todo-mark">{markForTodoStatus(todo?.status)}</span>
                <span className="react-chat-thread-todo-content">{String(todo?.content ?? '').trim()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

