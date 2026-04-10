import type { ThreadPanelState } from '../chat-types.js'

export function ThreadPanel({ state }: { state: ThreadPanelState }) {
  const showReasoning = !!(state.reasoningPreview || '').trim()
  const showClarify = !!(state.clarification?.preview || '').trim()
  // 顶部 ThreadPanel 仅展示「思考/待确认」等轻量信息；
  // 任务进度/子任务 TODO 统一在 TaskSidebar 中显示，避免重复两套 UI。

  // 如果没有任何内容，不显示面板（不再展示会话标题）
  if (!showReasoning && !showClarify) return null

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

      {/* 任务进度/子任务 TODO 迁移到 TaskSidebar */}
    </div>
  )
}

