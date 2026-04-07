import { useEffect, useState } from 'react'
import { tasksAPI } from '../../lib/api-client.js'

interface RunInfo {
  run_id: string
  thread_id: string
  assistant_id: string
  status: 'pending' | 'running' | 'success' | 'failed'
  created_at: string
  updated_at: string | null
  model_name: string | null
  is_plan_mode: boolean | null
  subagent_enabled: boolean | null
}

interface RunsResponse {
  runs: RunInfo[]
  total: number
  pending: number
  running: number
}

interface RunManagerProps {
  isOpen: boolean
  taskNames?: Array<{ taskId: string; name: string }>
  selectedTaskId?: string | null
  onSelectTaskId?: (taskId: string) => void
  onClose: () => void
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  return date.toLocaleDateString('zh-CN')
}

function getStatusText(status: string): string {
  switch (status) {
    case 'pending':
      return '等待中'
    case 'running':
      return '运行中'
    case 'success':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return status
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'run-status-pending'
    case 'running':
      return 'run-status-running'
    case 'success':
      return 'run-status-success'
    case 'failed':
      return 'run-status-failed'
    default:
      return ''
  }
}

export function RunManager({
  isOpen,
  taskNames,
  selectedTaskId,
  onSelectTaskId,
  onClose,
}: RunManagerProps) {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [taskNameFallback, setTaskNameFallback] = useState<Array<{ taskId: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const fetchRuns = async () => {
    try {
      setLoading(true)
      const resp = await fetch('/api/langgraph/runs/')
      if (!resp.ok) throw new Error('获取运行列表失败')
      const data: RunsResponse = await resp.json()
      setRuns(data.runs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误')
    } finally {
      setLoading(false)
    }
  }

  const handleCancelAll = async () => {
    if (!confirm('确定要取消所有运行中的任务吗？')) return
    
    try {
      setCancelling(true)
      const resp = await fetch('/api/langgraph/runs/cancel', { method: 'POST' })
      if (!resp.ok) throw new Error('取消任务失败')
      const result = await resp.json()
      alert(`已取消 ${result.cancelled_count || 0} 个任务`)
      await fetchRuns()
    } catch (err) {
      alert(err instanceof Error ? err.message : '取消任务失败')
    } finally {
      setCancelling(false)
    }
  }

  const fetchTaskNamesFallback = async () => {
    try {
      const data = await tasksAPI.listTasks()
      const rows = Array.isArray(data) ? data : []
      const next = rows
        .map((r: any) => {
          const taskId = String(r?.id || r?.task_id || '').trim()
          if (!taskId) return null
          const name = String(r?.name || r?.title || taskId).trim() || taskId
          return { taskId, name }
        })
        .filter(Boolean) as Array<{ taskId: string; name: string }>
      setTaskNameFallback(next)
    } catch {
      // 兜底也失败时静默，不覆盖主错误展示
    }
  }

  useEffect(() => {
    if (isOpen) {
      fetchRuns()
      fetchTaskNamesFallback()
      // 每 5 秒刷新一次
      const interval = setInterval(fetchRuns, 5000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  if (!isOpen) return null

  const runningRuns = runs.filter(r => r.status === 'running')
  const pendingRuns = runs.filter(r => r.status === 'pending')
  const displayTaskNames =
    taskNames && taskNames.length > 0
      ? taskNames
      : taskNameFallback

  return (
    <aside className="react-chat-run-manager">
      <div className="react-chat-run-manager-header">
        <h3 className="react-chat-run-manager-title">任务管理器</h3>
        <button
          type="button"
          className="react-chat-run-manager-close"
          onClick={onClose}
          title="关闭任务管理器"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="react-chat-run-manager-content">
        {displayTaskNames.length > 0 ? (
          <div className="react-chat-run-task-names">
            <div className="react-chat-run-task-names-title">任务列表</div>
            <ul className="react-chat-run-task-names-list">
              {displayTaskNames.map((t) => (
                <li key={t.taskId}>
                  <button
                    type="button"
                    className={`react-chat-run-task-name-item${
                      selectedTaskId && selectedTaskId === t.taskId ? ' active' : ''
                    }`}
                    onClick={() => onSelectTaskId?.(t.taskId)}
                    title={t.name}
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* 统计信息 */}
        <div className="react-chat-run-stats">
          <div className="react-chat-run-stat">
            <span className="react-chat-run-stat-value running">{runningRuns.length}</span>
            <span className="react-chat-run-stat-label">运行中</span>
          </div>
          <div className="react-chat-run-stat">
            <span className="react-chat-run-stat-value pending">{pendingRuns.length}</span>
            <span className="react-chat-run-stat-label">等待中</span>
          </div>
          <div className="react-chat-run-stat">
            <span className="react-chat-run-stat-value">{runs.length}</span>
            <span className="react-chat-run-stat-label">总计</span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="react-chat-run-actions">
          <button
            type="button"
            className="react-chat-run-cancel-btn"
            onClick={handleCancelAll}
            disabled={cancelling || runs.length === 0}
          >
            {cancelling ? '取消中...' : '取消所有任务'}
          </button>
          <button
            type="button"
            className="react-chat-run-refresh-btn"
            onClick={fetchRuns}
            disabled={loading}
          >
            刷新
          </button>
        </div>

        {/* 任务列表 */}
        {loading ? (
          <div className="react-chat-run-loading">加载中...</div>
        ) : error ? (
          <div className="react-chat-run-error">{error}</div>
        ) : runs.length === 0 ? (
          <div className="react-chat-run-empty">
            <p>暂无运行中的任务</p>
            <p className="react-chat-run-hint">所有任务都已完成或未开始</p>
          </div>
        ) : (
          <ul className="react-chat-run-list">
            {runs.map(run => (
              <li key={run.run_id} className={`react-chat-run-item ${getStatusClass(run.status)}`}>
                <div className="react-chat-run-item-header">
                  <span className="react-chat-run-status-badge">
                    {getStatusText(run.status)}
                  </span>
                  <span className="react-chat-run-time" title={new Date(run.created_at).toLocaleString()}>
                    {formatTime(run.created_at)}
                  </span>
                </div>
                <div className="react-chat-run-item-body">
                  <div className="react-chat-run-field">
                    <span className="react-chat-run-label">线程 ID:</span>
                    <span className="react-chat-run-value">{run.thread_id.slice(0, 8)}...</span>
                  </div>
                  <div className="react-chat-run-field">
                    <span className="react-chat-run-label">智能体:</span>
                    <span className="react-chat-run-value">{run.assistant_id}</span>
                  </div>
                  {run.model_name && (
                    <div className="react-chat-run-field">
                      <span className="react-chat-run-label">模型:</span>
                      <span className="react-chat-run-value">{run.model_name}</span>
                    </div>
                  )}
                  <div className="react-chat-run-field">
                    <span className="react-chat-run-label">计划模式:</span>
                    <span className="react-chat-run-value">{run.is_plan_mode ? '是' : '否'}</span>
                  </div>
                  {run.updated_at && (
                    <div className="react-chat-run-field">
                      <span className="react-chat-run-label">更新:</span>
                      <span className="react-chat-run-value">{formatTime(run.updated_at)}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
