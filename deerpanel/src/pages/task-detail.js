/**
 * 任务详情页面 - 子任务监控与 Supervisor 协调
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { subscribeProjectEventStream } from '../lib/collab-events.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'

export async function render() {
  const taskId = extractTaskId()
  if (!taskId) {
    const page = document.createElement('div')
    page.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">无效的任务 ID，<a href="#/tasks">返回任务列表</a></div>'
    return page
  }

  const page = document.createElement('div')
  page.className = 'page task-detail-page'

  page.innerHTML = `
    <div class="task-detail-hero">
      <div class="task-detail-hero-main">
        <button class="btn btn-ghost task-detail-back" id="btn-back" type="button">
          <span>← 返回列表</span>
        </button>
        <h1 class="task-detail-hero-title" id="task-title">加载中...</h1>
        <p class="task-detail-hero-desc" id="task-desc"></p>
        <div class="task-detail-meta" id="task-meta"></div>
        <div class="task-detail-progress-wrap" aria-hidden="false">
          <div class="task-detail-progress-bar">
            <div class="task-detail-progress-fill" id="task-progress-fill" style="width:0%"></div>
          </div>
        </div>
      </div>
      <div class="task-detail-hero-actions">
        <button class="btn btn-primary" id="btn-start" type="button">开始执行</button>
        <button class="btn btn-secondary" id="btn-add-subtask" type="button">添加子任务</button>
        <button class="btn btn-secondary" id="btn-refresh" type="button">刷新</button>
        <button class="btn btn-secondary" id="btn-back-chat" type="button" title="返回实时聊天页">回聊天</button>
      </div>
    </div>

    <div class="task-detail-content">
      <div class="task-main">
        <div class="supervisor-panel" id="supervisor-panel">
          <div class="panel-header">
            <h3>🧠 Supervisor 面板</h3>
            <span class="supervisor-status" id="supervisor-status"></span>
          </div>
          <div class="supervisor-content" id="supervisor-content">
            <div class="supervisor-message" id="supervisor-message">等待启动任务...</div>
            <div class="supervisor-log" id="supervisor-log"></div>
          </div>
        </div>

        <div class="subtasks-section">
          <div class="section-header">
            <h3>📋 子任务列表</h3>
            <div class="task-stats" id="task-stats"></div>
          </div>
          <div class="subtasks-list subtasks-grid" id="subtasks-list"></div>
        </div>
      </div>

      <div class="task-sidebar">
        <div class="facts-panel">
          <h3>🧠 任务记忆</h3>
          <div class="facts-search">
            <input class="form-input" id="facts-search" placeholder="搜索事实...">
          </div>
          <div class="facts-list" id="facts-list">
            <div class="facts-empty">暂无记忆</div>
          </div>
        </div>

        <div class="agents-panel">
          <h3>🤖 执行者状态</h3>
          <div class="agents-list" id="agents-list">
            <div class="agents-empty">暂无执行中的 Agent</div>
          </div>
        </div>
      </div>
    </div>
  `

  const state = {
    taskId,
    projectId: null,
    task: null,
    subtasks: [],
    facts: [],
    agents: [],
    supervisorActive: false,
    eventSubscription: null,
  }

  page.querySelector('#btn-back').addEventListener('click', () => {
    window.location.hash = '#/tasks'
  })

  page.querySelector('#btn-back-chat')?.addEventListener('click', () => {
    window.location.hash = '#/chat'
  })

  page.querySelector('#btn-add-subtask').addEventListener('click', () => {
    showAddSubtaskDialog(page, state)
  })

  page.querySelector('#btn-start').addEventListener('click', () => {
    startTaskExecution(page, state)
  })

  page.querySelector('#btn-refresh').addEventListener('click', async () => {
    await loadTaskDetail(page, state)
    toast('已刷新', 'success')
  })

  page.querySelector('#facts-search').addEventListener('input', async (e) => {
    const keyword = e.target.value.trim()
    if (keyword) {
      // Backend doesn't implement `GET /api/task-memory/tasks/{taskId}/facts/search`.
      // Filter locally to keep the facts panel responsive.
      const kw = keyword.toLowerCase()
      const results = (state.facts || []).filter(f =>
        String(f?.content || '').toLowerCase().includes(kw)
      )
      renderFacts(page, results)
    } else {
      renderFacts(page, state.facts)
    }
  })

  await loadTaskDetail(page, state)
  setupEventSource(page, state)

  return page
}

async function loadTaskDetail(page, state) {
  try {
    state.task = await api.getTask(state.taskId)
    state.projectId = (state.task?.parent_project_id ?? null)
    state.subtasks = state.task.subtasks || []

    page.querySelector('#task-title').textContent = state.task.name || '未命名任务'
    page.querySelector('#task-desc').textContent = state.task.description || ''
    syncTaskHeroProgress(page, state)

    const factsData = await api.getTaskFacts(state.taskId)
    state.facts = factsData.facts || []

    try {
      const runtime = await api.getTaskRuntime(state.taskId)
      state.agents = runtime.agents || []
    } catch {
      state.agents = []
    }

    renderSubtasks(page, state)
    renderFacts(page, state.facts)
    renderAgents(page, state)
    updateTaskStats(page, state)
    updateSupervisorPanel(page, state)
    updateButtons(page, state)
  } catch (e) {
    toast('加载任务详情失败: ' + e, 'error')
  }
}

function renderSubtasks(page, state) {
  const container = page.querySelector('#subtasks-list')

  if (!state.subtasks.length) {
    container.innerHTML = '<div class="subtasks-empty">暂无子任务<br><span style="font-size:11px;color:var(--text-tertiary)">AI 将自动拆解任务，或手动添加子任务</span></div>'
    return
  }

  container.innerHTML = state.subtasks.map(sub => {
    const statusIcon = getSubtaskStatusIcon(sub.status)
    const progressBar = sub.progress > 0 ? `<div class="task-progress-bar"><div class="task-progress-fill" style="width:${sub.progress}%"></div></div>` : ''
    const assignedBadge = sub.assigned_to ? `<span class="task-assigned">🤖 ${escapeHtml(sub.assigned_to)}</span>` : ''
    const depBadge = sub.dependencies?.length ? `<span class="task-deps">依赖: ${sub.dependencies.length}</span>` : ''
    const wpBadge = sub.worker_profile ? '<span class="task-deps">🧩 配置</span>' : ''

    return `
      <div class="subtask-item" data-subtask-id="${sub.id}">
        <div class="subtask-item-header">
          <div class="subtask-status-icon">${statusIcon}</div>
          <div class="subtask-item-title">
            <span class="subtask-name">${escapeHtml(sub.name || '未命名')}</span>
            ${assignedBadge}
            ${depBadge}
            ${wpBadge}
          </div>
          <div class="subtask-item-actions">
            <button class="btn btn-xs btn-ghost" data-action="detail" data-id="${sub.id}">详情</button>
            <button class="btn btn-xs btn-ghost" data-action="assign" data-id="${sub.id}">分配</button>
            <button class="btn btn-xs btn-ghost" data-action="delete" data-id="${sub.id}">删除</button>
          </div>
        </div>
        <div class="subtask-item-body">
          <p class="subtask-desc">${escapeHtml(sub.description || '无描述')}</p>
          ${progressBar}
        </div>
        <div class="subtask-item-footer">
          <span class="subtask-status-text">${getSubtaskStatusText(sub.status)}</span>
          ${sub.progress > 0 ? `<span class="subtask-progress-text">${sub.progress}%</span>` : ''}
          ${sub.result ? `<button class="btn btn-xs btn-ghost" data-action="view-result" data-id="${sub.id}">查看结果</button>` : ''}
        </div>
      </div>
    `
  }).join('')

  container.querySelectorAll('[data-action="detail"]').forEach(btn => {
    btn.addEventListener('click', () => showSubtaskDetail(page, state, btn.dataset.id))
  })

  container.querySelectorAll('[data-action="assign"]').forEach(btn => {
    btn.addEventListener('click', () => showAssignDialog(page, state, btn.dataset.id))
  })

  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteSubtask(page, state, btn.dataset.id))
  })

  container.querySelectorAll('[data-action="view-result"]').forEach(btn => {
    btn.addEventListener('click', () => viewSubtaskResult(page, state, btn.dataset.id))
  })
}

function renderFacts(page, facts) {
  const container = page.querySelector('#facts-list')

  if (!facts.length) {
    container.innerHTML = '<div class="facts-empty">暂无记忆<br><span style="font-size:11px;color:var(--text-tertiary)">任务执行后会自动提取关键事实</span></div>'
    return
  }

  const categoryLabels = { finding: '发现', decision: '决策', data: '数据', conclusion: '结论' }
  const categoryColors = { finding: '#3b82f6', decision: '#f59e0b', data: '#10b981', conclusion: '#8b5cf6' }

  container.innerHTML = facts.map(fact => `
    <div class="fact-item">
      <div class="fact-header">
        <span class="fact-category" style="background:${categoryColors[fact.category] || '#6b7280'}">${categoryLabels[fact.category] || fact.category}</span>
        <span class="fact-confidence">${Math.round((fact.confidence || 0.5) * 100)}%</span>
      </div>
      <p class="fact-content">${escapeHtml(fact.content || '')}</p>
    </div>
  `).join('')
}

function renderAgents(page, state) {
  const container = page.querySelector('#agents-list')

  if (!state.agents.length) {
    container.innerHTML = '<div class="agents-empty">暂无执行中的 Agent</div>'
    return
  }

  container.innerHTML = state.agents.map(agent => {
    const statusIcon = agent.status === 'busy' ? '🔴' : agent.status === 'failed' ? '⚫' : '🟢'
    return `
      <div class="agent-item">
        <div class="agent-info">
          <span class="agent-status-icon">${statusIcon}</span>
          <span class="agent-name">${escapeHtml(agent.agent_name || agent.agent_id)}</span>
        </div>
        ${agent.current_subtask_id ? `<div class="agent-task">子任务: ${agent.current_subtask_id}</div>` : ''}
        ${agent.progress > 0 ? `<div class="agent-progress">进度: ${agent.progress}%</div>` : ''}
      </div>
    `
  }).join('')
}

function updateTaskStats(page, state) {
  const container = page.querySelector('#task-stats')
  const stats = {
    total: state.subtasks.length,
    pending: state.subtasks.filter(t => t.status === 'pending').length,
    executing: state.subtasks.filter(t => t.status === 'executing').length,
    completed: state.subtasks.filter(t => t.status === 'completed').length,
    failed: state.subtasks.filter(t => t.status === 'failed').length,
  }

  container.innerHTML = `
    <span class="stat-item">总计: ${stats.total}</span>
    <span class="stat-item stat-pending">待处理: ${stats.pending}</span>
    <span class="stat-item stat-executing">执行中: ${stats.executing}</span>
    <span class="stat-item stat-completed">完成: ${stats.completed}</span>
    ${stats.failed > 0 ? `<span class="stat-item stat-failed">失败: ${stats.failed}</span>` : ''}
  `
  syncTaskHeroProgress(page, state)
}

/** 顶栏进度条与 meta 中的状态（与 SSE / 统计联动） */
function syncTaskHeroProgress(page, state) {
  const t = state.task
  if (!t) return
  const prog = Math.max(0, Math.min(100, parseInt(t.progress, 10) || 0))
  const fill = page.querySelector('#task-progress-fill')
  if (fill) fill.style.width = `${prog}%`
  const metaEl = page.querySelector('#task-meta')
  if (metaEl) {
    const tid = t.id || state.taskId
    const pid = t.parent_project_id ?? state.projectId ?? '—'
    const th = t.thread_id || '—'
    const st = t.status || '—'
    metaEl.innerHTML = `
      <span class="task-meta-chip">task <code>${escapeHtml(String(tid))}</code></span>
      <span class="task-meta-chip">project <code>${escapeHtml(String(pid))}</code></span>
      <span class="task-meta-chip">thread <code>${escapeHtml(String(th))}</code></span>
      <span class="task-meta-chip">状态 ${escapeHtml(String(st))}</span>
    `
  }
}

function updateSupervisorPanel(page, state) {
  const status = page.querySelector('#supervisor-status')
  const message = page.querySelector('#supervisor-message')
  const log = page.querySelector('#supervisor-log')

  const taskStatus = state.task?.status || 'pending'

  if (taskStatus === 'executing') {
    status.textContent = '🟢 执行中'
    status.className = 'supervisor-status active'
    message.textContent = 'Supervisor 正在协调子任务执行...'

    if (state.supervisorLog) {
      log.innerHTML = state.supervisorLog.map(entry =>
        `<div class="log-entry"><span class="log-time">${entry.time}</span><span class="log-msg">${escapeHtml(entry.msg)}</span></div>`
      ).join('')
    }
  } else if (taskStatus === 'planning') {
    status.textContent = '🔵 规划中'
    status.className = 'supervisor-status planning'
    message.textContent = 'Supervisor 正在分析任务并拆解子任务...'
  } else if (taskStatus === 'completed') {
    status.textContent = '✅ 完成'
    status.className = 'supervisor-status completed'
    message.textContent = '所有子任务已完成'
  } else if (taskStatus === 'failed') {
    status.textContent = '❌ 失败'
    status.className = 'supervisor-status failed'
    message.textContent = state.task.error || '任务执行失败'
  } else {
    status.textContent = '⚪ 待机'
    status.className = 'supervisor-status idle'
    message.textContent = '点击「开始执行」启动任务'
  }
}

function updateButtons(page, state) {
  const btnStart = page.querySelector('#btn-start')
  const taskStatus = state.task?.status || 'pending'

  if (taskStatus === 'pending' || taskStatus === 'failed') {
    btnStart.textContent = '开始执行'
    btnStart.disabled = false
    btnStart.className = 'btn btn-primary'
  } else if (taskStatus === 'planning' || taskStatus === 'executing') {
    btnStart.textContent = '暂停'
    btnStart.disabled = false
    btnStart.className = 'btn btn-warning'
  } else if (taskStatus === 'completed') {
    btnStart.textContent = '已完成'
    btnStart.disabled = true
    btnStart.className = 'btn btn-secondary'
  }
}

function startTaskExecution(page, state) {
  state.supervisorActive = true
  toast('任务开始执行，Supervisor 正在分析...', 'success')

  state.task.status = 'planning'
  state.task.subtasks = state.task.subtasks || []
  updateSupervisorPanel(page, state)
  updateButtons(page, state)
  renderSubtasks(page, state)
  updateTaskStats(page, state)
}

function setupEventSource(page, state) {
  if (state.eventSubscription) {
    state.eventSubscription.close()
    state.eventSubscription = null
  }

  if (!state.projectId) return

  try {
    state.eventSubscription = subscribeProjectEventStream(
      state.projectId,
      (payload) => {
        const t = payload.type
        const d = payload.data || {}

        const root = () => state.task
        const subtaskById = (id) => state.subtasks.find(st => st.id === id)

        if (t === 'task:started') {
          const tid = d.task_id
          if (tid === state.taskId) {
            const r = root()
            if (r) r.status = 'executing'
            updateTaskStats(page, state)
            return
          }
          const st = subtaskById(tid)
          if (st) {
            st.status = 'executing'
            renderSubtasks(page, state)
            updateTaskStats(page, state)
          }
          return
        }

        if (t === 'task:progress') {
          const tid = d.task_id
          const prog = typeof d.progress === 'number' ? d.progress : (parseInt(d.progress || 0, 10) || 0)
          if (tid === state.taskId) {
            const r = root()
            if (r) r.progress = prog
            updateTaskStats(page, state)
            return
          }
          const st = subtaskById(tid)
          if (st) {
            st.progress = prog
            renderSubtasks(page, state)
            updateTaskStats(page, state)
          }
          return
        }

        if (t === 'task:completed') {
          const tid = d.task_id
          if (tid === state.taskId) {
            const r = root()
            if (r) {
              r.status = 'completed'
              r.progress = 100
              r.result = d.result
            }
            updateTaskStats(page, state)
            return
          }
          const st = subtaskById(tid)
          if (st) {
            st.status = 'completed'
            st.progress = 100
            st.result = d.result
            renderSubtasks(page, state)
            updateTaskStats(page, state)
            toast(`子任务「${st.name}」已完成`, 'success')
          }
          return
        }

        if (t === 'task:failed') {
          const tid = d.task_id
          if (tid === state.taskId) {
            const r = root()
            if (r) {
              r.status = 'failed'
              r.error = d.error
            }
            updateTaskStats(page, state)
            return
          }
          const st = subtaskById(tid)
          if (st) {
            st.status = 'failed'
            st.error = d.error
            renderSubtasks(page, state)
            updateTaskStats(page, state)
            toast(`子任务「${st.name}」失败: ${d.error}`, 'error')
          }
          return
        }

        if (t === 'task_memory:updated') {
          // 网关发的是 { task_id, facts_count }，这里刷新详情页要展示的事实列表
          if (d.task_id === state.taskId) {
            void (async () => {
              try {
                const factsData = await api.getTaskFacts(state.taskId)
                state.facts = factsData.facts || []
                renderFacts(page, state.facts)
              } catch {
                /* ignore */
              }
            })()
          }
          return
        }
      },
      {
        onConnected: () => console.log('SSE connected (task detail)'),
        onError: () => console.error('SSE error (task detail)'),
      },
    )
  } catch (e) {
    console.error('Failed to setup SSE:', e)
  }
}

async function showAddSubtaskDialog(page, state) {
  const availableSubtasks = state.subtasks.filter(t => t.status !== 'executing')
  const dependencyOptions = availableSubtasks.map(t => ({ value: t.id, label: t.name || t.id }))

  showModal({
    title: '添加子任务',
    fields: [
      { name: 'name', label: '子任务名称', value: '', placeholder: '例如：搜索竞品信息' },
      { name: 'description', label: '任务描述', value: '', placeholder: '详细描述子任务内容' },
      ...(dependencyOptions.length > 0 ? [{ name: 'dependencies', label: '依赖任务', type: 'multiselect', options: dependencyOptions, value: [] }] : []),
    ],
    onConfirm: async (result) => {
      const name = (result.name || '').trim()
      if (!name) {
        toast('请输入子任务名称', 'error')
        return
      }

      try {
        await api.addSubtask(state.taskId, name, result.description || '', result.dependencies || [])
        toast('子任务已添加', 'success')
        await loadTaskDetail(page, state)
      } catch (e) {
        toast('添加失败: ' + e, 'error')
      }
    }
  })
}

function showAssignDialog(page, state, subtaskId) {
  const agents = [
    { value: 'researcher', label: '研究员 Agent' },
    { value: 'writer', label: '写作 Agent' },
    { value: 'coder', label: '代码 Agent' },
    { value: 'general', label: '通用 Agent' },
  ]

  showModal({
    title: '分配子任务',
    fields: [
      { name: 'agent', label: '选择执行者', type: 'select', options: agents, value: '' },
    ],
    onConfirm: async (result) => {
      if (!result.agent) {
        toast('请选择执行者', 'error')
        return
      }

      try {
        await api.assignSubtask(state.taskId, subtaskId, result.agent)
        await loadTaskDetail(page, state)
        toast('已分配给 ' + result.agent, 'success')
      } catch (e) {
        toast('分配失败: ' + e, 'error')
      }
    }
  })
}

async function deleteSubtask(page, state, subtaskId) {
  const yes = await showConfirm('确定删除该子任务？')
  if (!yes) return

  try {
    await api.deleteSubtask(state.taskId, subtaskId)
    toast('已删除', 'success')
    await loadTaskDetail(page, state)
  } catch (e) {
    toast('删除失败: ' + e, 'error')
  }
}

async function viewSubtaskResult(page, state, subtaskId) {
  const subtask = state.subtasks.find(t => t.id === subtaskId)
  if (!subtask) return

  showModal({
    title: `子任务结果: ${subtask.name}`,
    fields: [
      { name: 'result', label: '执行结果', type: 'textarea', value: subtask.result || '无结果', readonly: true },
    ],
    onConfirm: () => {}
  })
}

async function showSubtaskDetail(page, state, subtaskId) {
  const subtask = state.subtasks.find(t => t.id === subtaskId)
  if (!subtask) return

  let memoryData = null
  try {
    memoryData = await api.getSubtaskMemory(state.taskId, subtaskId)
  } catch {
    memoryData = null
  }

  showModal({
    title: `子任务详情: ${subtask.name}`,
    fields: [
      { name: 'status', label: '状态', value: getSubtaskStatusText(subtask.status), readonly: true },
      { name: 'assigned', label: '执行者', value: subtask.assigned_to || '未分配', readonly: true },
      { name: 'progress', label: '进度', value: `${subtask.progress || 0}%`, readonly: true },
      { name: 'description', label: '描述', value: subtask.description || '无', readonly: true },
      { name: 'worker_profile', label: '子智能体配置', type: 'textarea', value: formatWorkerProfile(subtask.worker_profile), readonly: true },
    ],
    onConfirm: () => {}
  })
}

function formatWorkerProfile(profile) {
  if (!profile || typeof profile !== 'object') return '未配置'
  const lines = []
  if (profile.base_subagent) lines.push(`base_subagent: ${profile.base_subagent}`)
  if (Array.isArray(profile.tools) && profile.tools.length) lines.push(`tools: ${profile.tools.join(', ')}`)
  if (Array.isArray(profile.skills) && profile.skills.length) lines.push(`skills: ${profile.skills.join(', ')}`)
  if (Array.isArray(profile.depends_on) && profile.depends_on.length) lines.push(`depends_on: ${profile.depends_on.join(', ')}`)
  if (profile.instruction) lines.push(`instruction:\n${profile.instruction}`)
  return lines.length ? lines.join('\n') : '未配置'
}

function getSubtaskStatusIcon(status) {
  const icons = {
    pending: '⚪',
    executing: '🔴',
    completed: '✅',
    failed: '❌',
    cancelled: '⚫',
  }
  return icons[status] || '⚪'
}

function getSubtaskStatusText(status) {
  const texts = {
    pending: '待处理',
    executing: '执行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return texts[status] || status
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function extractTaskId() {
  const hash = window.location.hash || ''
  const match = hash.match(/^#\/task\/([^/?]+)/)
  return match ? match[1] : null
}
