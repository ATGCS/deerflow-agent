import type React from 'react'

export function HostedAgentPanel({
  panelOpen,
  setPanelOpen,
  ui,
  statusText,
  setDraft,
  onToggleRun,
}: {
  panelOpen: boolean
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  ui: {
    enabled: boolean
    status: string
    prompt: string
    maxSteps: number
    autoStopMinutes: number
    stepCount: number
    lastError: string
    countdownText: string
    isRunning: boolean
  }
  statusText: string
  setDraft: (next: { prompt?: string; maxSteps?: number; autoStopMinutes?: number }) => void
  onToggleRun: () => void
}) {
  if (!panelOpen) return null

  const timerOn = (ui.autoStopMinutes || 0) > 0

  return (
    <div className="react-chat-hosted-panel">
      <div className="react-chat-hosted-header">
        <strong>托管 Agent</strong>
        <button className="react-chat-hosted-close" onClick={() => setPanelOpen(false)} title="关闭">
          ×
        </button>
      </div>

      <div className="react-chat-hosted-body">
        <div className="react-chat-hosted-form-group">
          <label className="react-chat-hosted-label">任务目标</label>
          <textarea
            className="react-chat-hosted-prompt"
            rows={3}
            value={ui.prompt}
            disabled={ui.isRunning}
            placeholder="例如：持续优化此仓库代码质量，直到没有可改进的地方"
            onChange={(e) => setDraft({ prompt: e.target.value })}
          />
          <div className="react-chat-hosted-hint">
            托管 Agent 会持续引导 DeerFlow 完成此目标。模型使用 <a href="#/assistant">AI 助手</a> 的配置。
          </div>
        </div>

        <div className="react-chat-hosted-slider-group">
          <div className="react-chat-hosted-slider-label">
            最大回复次数 <span className="react-chat-hosted-slider-val">{ui.maxSteps}</span>
          </div>
          <input
            type="range"
            className="react-chat-hosted-slider"
            min={5}
            max={205}
            step={5}
            value={ui.maxSteps}
            disabled={ui.isRunning}
            onChange={(e) => setDraft({ maxSteps: Number(e.target.value) })}
          />
          <div className="react-chat-hosted-slider-ticks">
            <span>5</span>
            <span>50</span>
            <span>100</span>
            <span>200</span>
            <span>∞</span>
          </div>
        </div>

        <div className="react-chat-hosted-timer-group">
          <div className="react-chat-hosted-timer-header">
            <span>定时自动停止</span>
            <label className="react-chat-hosted-toggle">
              <input
                type="checkbox"
                checked={timerOn}
                disabled={ui.isRunning}
                onChange={(e) => setDraft({ autoStopMinutes: e.target.checked ? (ui.autoStopMinutes || 30) : 0 })}
              />
              <span className="react-chat-hosted-toggle-track" />
            </label>
          </div>

          {timerOn ? (
            <div className="react-chat-hosted-timer-body">
              <input
                type="range"
                className="react-chat-hosted-slider"
                min={5}
                max={120}
                step={5}
                value={ui.autoStopMinutes}
                disabled={ui.isRunning}
                onChange={(e) => setDraft({ autoStopMinutes: Number(e.target.value) })}
              />
              <div className="react-chat-hosted-slider-ticks">
                <span>5分</span>
                <span>30分</span>
                <span>60分</span>
                <span>120分</span>
              </div>

              <div className="react-chat-hosted-countdown">
                <div className="react-chat-hosted-countdown-text">{ui.isRunning ? ui.countdownText : '剩余 --:--'}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="react-chat-hosted-actions">
        <button
          type="button"
          className={`btn ${ui.isRunning ? 'btn-ghost' : 'btn-primary'}`}
          onClick={() => onToggleRun()}
          style={{ flex: 1 }}
        >
          {ui.isRunning ? '⏹ 停止托管' : '▶ 启动托管'}
        </button>
      </div>

      <div className="react-chat-hosted-footer">{statusText || '就绪'}</div>
    </div>
  )
}

