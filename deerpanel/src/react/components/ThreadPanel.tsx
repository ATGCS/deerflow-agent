import type { ThreadPanelState } from '../chat-types.js'

function normalizeTodoStatus(status?: string): string {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
}

function isTodoRunning(status?: string): boolean {
  const s = normalizeTodoStatus(status)
  return s === 'in_progress' || s === 'running' || s === 'executing' || s === 'active'
}

function ThreadTodoMark({ status }: { status?: string }) {
  if (isTodoRunning(status)) {
    return (
      <span className="react-chat-thread-todo-mark" aria-hidden>
        <span className="react-chat-subtask-spinner" />
      </span>
    )
  }
  if (normalizeTodoStatus(status) === 'completed') {
    return (
      <span className="react-chat-thread-todo-mark react-chat-thread-todo-mark--done" aria-hidden>
        ✓
      </span>
    )
  }
  return (
    <span className="react-chat-thread-todo-mark" aria-hidden>
      <span className="react-chat-subtask-dot" />
    </span>
  )
}

export function ThreadPanel({ state }: { state: ThreadPanelState }) {
  const showReasoning = !!(state.reasoningPreview || '').trim()
  const showClarify = !!(state.clarification?.preview || '').trim()
  const showTodos = Array.isArray(state.todos) && state.todos.length > 0

  // 如果没有任何内容，不显示面板（不再展示会话标题）
  if (!showReasoning && !showClarify && !showTodos) return null

  return (
    <div className="react-chat-thread-panel">
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
                <ThreadTodoMark status={todo?.status} />
                <span className="react-chat-thread-todo-content">{String(todo?.content ?? '').trim()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

