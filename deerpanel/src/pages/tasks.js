/**
 * 任务管理页面 - 多智能体协作核心
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">任务中心</h1>
        <p class="page-desc">创建复杂任务，AI 自动拆解并协调多 Agent 执行</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="btn-new-task">新建任务</button>
        <button class="btn btn-secondary" id="btn-refresh">刷新</button>
      </div>
    </div>
    <div class="page-content">
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <input class="form-input" id="tasks-search" placeholder="搜索任务名称 / 描述" style="max-width:360px">
        <span id="tasks-count" style="font-size:12px;color:var(--text-tertiary)"></span>
      </div>
      <div id="tasks-list"></div>
    </div>
  `

  const state = { tasks: [], filter: '' }
  loadTasks(page, state)

  page.querySelector('#btn-new-task').addEventListener('click', () => {
    showCreateTaskDialog(page, state)
  })

  page.querySelector('#btn-refresh').addEventListener('click', async () => {
    invalidate('tasks_list')
    await loadTasks(page, state)
    toast('已刷新', 'success')
  })

  page.querySelector('#tasks-search').addEventListener('input', (e) => {
    state.filter = String(e.target.value || '').trim().toLowerCase()
    renderTasks(page, state)
  })

  return page
}

function renderSkeleton(container) {
  const item = () => `
    <div class="task-card-skeleton" style="pointer-events:none">
      <div class="skeleton" style="width:60%;height:20px;border-radius:4px"></div>
      <div class="skeleton" style="width:80%;height:14px;border-radius:4px;margin-top:8px"></div>
      <div class="skeleton" style="width:40%;height:14px;border-radius:4px;margin-top:12px"></div>
    </div>`
  container.innerHTML = [item(), item(), item()].join('')
}

async function loadTasks(page, state) {
  const container = page.querySelector('#tasks-list')
  const countEl = page.querySelector('#tasks-count')
  if (countEl) countEl.textContent = '加载中...'
  renderSkeleton(container)

  try {
    const tasks = await api.listAllTasks()
    state.tasks = tasks || []
    renderTasks(page, state)
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error);padding:20px">加载失败: ${escapeHtml(String(e))}</div>`
    if (countEl) countEl.textContent = '加载失败'
    toast('加载任务列表失败: ' + e, 'error')
  }
}

function renderTasks(page, state) {
  const container = page.querySelector('#tasks-list')
  const countEl = page.querySelector('#tasks-count')

  const list = state.tasks.filter(t => {
    if (!state.filter) return true
    const text = [t.name, t.description, t.status].map(v => String(v || '').toLowerCase()).join(' ')
    return text.includes(state.filter)
  })

  if (countEl) countEl.textContent = `共 ${list.length} 个任务`

  if (!list.length) {
    container.innerHTML = '<div style="color:var(--text-tertiary);padding:40px;text-align:center"><p>暂无任务</p><p style="margin-top:8px;font-size:12px">点击「新建任务」创建一个复杂任务，AI 将自动拆解执行</p></div>'
    return
  }

  container.innerHTML = `<div class="task-grid">${list.map(t => {
    const statusBadge = getStatusBadge(t.status)
    const subtaskCount = t.subtasks?.length || 0
    const completedCount = t.subtasks?.filter(s => s.status === 'completed').length || 0
    const progress = subtaskCount > 0 ? Math.round((completedCount / subtaskCount) * 100) : (t.progress || 0)
    const progressBar = progress > 0 ? `<div class="task-progress-bar"><div class="task-progress-fill" style="width:${progress}%"></div></div>` : ''

    return `
      <div class="task-card" data-id="${t.id}">
        <div class="task-card-header">
          <div class="task-card-title">
            <span class="task-name">${escapeHtml(t.name || '未命名')}</span>
            ${statusBadge}
          </div>
        </div>
        <div class="task-card-body">
          <p class="task-desc">${escapeHtml(t.description || '无描述')}</p>
          ${progressBar}
          ${subtaskCount > 0 ? `<div class="task-subtask-info">子任务: ${completedCount}/${subtaskCount}</div>` : ''}
        </div>
        <div class="task-card-footer">
          <button class="btn btn-sm btn-primary" data-action="open" data-id="${t.id}">查看详情</button>
          ${t.status === 'planning' ? `<button class="btn btn-sm btn-warning" data-action="start" data-id="${t.id}">开始执行</button>` : ''}
          ${t.status === 'executing' ? `<button class="btn btn-sm btn-secondary" data-action="stop" data-id="${t.id}">暂停</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-action="delete" data-id="${t.id}">删除</button>
        </div>
      </div>
    `
  }).join('')}</div>`
}

function attachTaskEvents(page, state) {
  const container = page.querySelector('#tasks-list')
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id

    if (action === 'open') {
      window.location.hash = `#/task/${id}`
      setTimeout(() => {
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      }, 100)
    } else if (action === 'start') {
      await startTaskExecution(id)
    } else if (action === 'stop') {
      await stopTaskExecution(id)
    } else if (action === 'delete') {
      await deleteTask(page, state, id)
    }
  })
}

function showCreateTaskDialog(page, state) {
  showModal({
    title: '新建任务',
    fields: [
      { name: 'name', label: '任务名称', value: '', placeholder: '例如：竞品分析与报告' },
      { name: 'description', label: '任务描述', value: '', placeholder: '详细描述任务目标和要求' },
    ],
    onConfirm: async (result) => {
      const name = (result.name || '').trim()
      if (!name) {
        toast('请输入任务名称', 'error')
        return
      }

      try {
        const task = await api.createTask(name, result.description || '')
        toast('任务已创建，Supervisor 正在分析并拆解...', 'success')
        await loadTasks(page, state)
      } catch (e) {
        toast('创建失败: ' + e, 'error')
      }
    }
  })
}

async function startTaskExecution(taskId) {
  try {
    await api.startTaskPlanning(taskId)
    toast('任务开始执行', 'success')
    window.location.hash = `#/task/${taskId}`
    setTimeout(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    }, 100)
  } catch (e) {
    toast('启动失败: ' + e, 'error')
  }
}

async function stopTaskExecution(taskId) {
  try {
    await api.stopTaskExecution(taskId)
    toast('任务已暂停', 'info')
    await loadTasks(document.querySelector('.page'), { tasks: [], filter: '' })
  } catch (e) {
    toast('暂停失败: ' + e, 'error')
  }
}

async function deleteTask(page, state, taskId) {
  const yes = await showConfirm('确定删除该任务？\n\n此操作将删除任务及其所有子任务。')
  if (!yes) return

  try {
    await api.deleteTask(taskId)
    toast('已删除', 'success')
    await loadTasks(page, state)
  } catch (e) {
    toast('删除失败: ' + e, 'error')
  }
}

function getStatusBadge(status) {
  const badges = {
    'pending': '<span class="badge">待开始</span>',
    'planning': '<span class="badge badge-info">规划中</span>',
    'executing': '<span class="badge badge-primary">执行中</span>',
    'paused': '<span class="badge badge-warning">已暂停</span>',
    'completed': '<span class="badge badge-success">已完成</span>',
    'failed': '<span class="badge badge-danger">失败</span>',
    'cancelled': '<span class="badge">已取消</span>',
  }
  return badges[status] || `<span class="badge">${status}</span>`
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
