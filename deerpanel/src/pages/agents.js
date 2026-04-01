/**
 * Agent 管理页面
 * Agent 增删改查 + 身份编辑
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
        <h1 class="page-title">Agent 管理</h1>
        <p class="page-desc">创建和管理 OpenClaw Agent，配置描述、模型与工具组</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="btn-refresh-agents">刷新</button>
      </div>
    </div>
    <div class="page-content">
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <input class="form-input" id="agents-search" placeholder="搜索 Agent 名称 / 描述 / 模型" style="max-width:360px">
        <span id="agents-count" style="font-size:12px;color:var(--text-tertiary)"></span>
      </div>
      <div id="agents-list"></div>
    </div>
  `

  const state = { agents: [], filter: '' }
  // 非阻塞：先返回 DOM，后台加载数据
  loadAgents(page, state)

  page.querySelector('#btn-refresh-agents').addEventListener('click', async () => {
    invalidate('agents_list')
    await loadAgents(page, state)
    toast('Agent 列表已刷新', 'success')
  })
  page.querySelector('#agents-search').addEventListener('input', (e) => {
    state.filter = String(e.target.value || '').trim().toLowerCase()
    renderAgents(page, state)
  })

  return page
}

function renderSkeleton(container) {
  const item = () => `
    <div class="agent-card" style="pointer-events:none">
      <div class="agent-card-header">
        <div class="skeleton" style="width:40px;height:40px;border-radius:50%"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <div class="skeleton" style="width:45%;height:16px;border-radius:4px"></div>
          <div class="skeleton" style="width:60%;height:12px;border-radius:4px"></div>
        </div>
      </div>
    </div>`
  container.innerHTML = [item(), item(), item()].join('')
}

async function loadAgents(page, state) {
  const container = page.querySelector('#agents-list')
  const countEl = page.querySelector('#agents-count')
  if (countEl) countEl.textContent = '加载中...'
  renderSkeleton(container)
  try {
    const agents = await api.listAgents()
    state.agents = agents.sort((a, b) => {
      if (a.name === 'main') return -1
      if (b.name === 'main') return 1
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    renderAgents(page, state)

    // 只在第一次加载时绑定事件（避免重复绑定）
    if (!state.eventsAttached) {
      attachAgentEvents(page, state)
      state.eventsAttached = true
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error);padding:20px">加载失败: ${escapeHtml(String(e))}</div>`
    if (countEl) countEl.textContent = '加载失败'
    toast('加载 Agent 列表失败: ' + e, 'error')
  }
}

function renderAgents(page, state) {
  const container = page.querySelector('#agents-list')
  const countEl = page.querySelector('#agents-count')
  const list = state.agents.filter((a) => {
    if (!state.filter) return true
    const text = [
      a.name,
      a.description,
      parseModelValue(a),
      a.tool_groups?.join(','),
    ].map(v => String(v || '').toLowerCase()).join(' ')
    return text.includes(state.filter)
  })

  if (countEl) countEl.textContent = `共 ${list.length} 个`

  if (!list.length) {
    container.innerHTML = '<div style="color:var(--text-tertiary);padding:20px;text-align:center">暂无 Agent</div>'
    return
  }

  container.innerHTML = `<div class="agent-list">${list.map(a => {
    const isDefault = a.isDefault || a.name === 'main'
    const name = a.name || '-'
    const desc = a.description || '无描述'
    const modelText = parseModelValue(a) || '未设置'
    const groups = Array.isArray(a.tool_groups) ? a.tool_groups.join(', ') : '未限制'
    return `
      <div class="agent-card" data-id="${a.name}">
        <div class="agent-card-header">
          <div class="agent-card-title">
            <span class="agent-id">${escapeHtml(name)}</span>
            ${isDefault ? '<span class="badge badge-success">默认</span>' : ''}
          </div>
        </div>
        <div class="agent-card-body">
          <div class="agent-info-row">
            <span class="agent-info-label">描述:</span>
            <span class="agent-info-value">${escapeHtml(desc)}</span>
          </div>
          <div class="agent-info-row">
            <span class="agent-info-label">模型:</span>
            <span class="agent-info-value">${escapeHtml(modelText)}</span>
          </div>
          <div class="agent-info-row">
            <span class="agent-info-label">工具组:</span>
            <span class="agent-info-value">${escapeHtml(groups)}</span>
          </div>
        </div>
        <div class="agent-card-footer">
          <button class="btn btn-sm btn-primary" data-action="chat" data-id="${a.name}">Chat</button>
          <button class="btn btn-sm btn-secondary" data-action="detail" data-id="${a.name}">详情</button>
          <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${a.name}">编辑</button>
          <button class="btn btn-sm btn-secondary" data-action="backup" data-id="${a.name}">备份</button>
          ${!isDefault ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.name}">删除</button>` : ''}
        </div>
      </div>
    `
  }).join('')}</div>`
}

function attachAgentEvents(page, state) {
  const container = page.querySelector('#agents-list')
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id

    if (action === 'chat') {
      const hash = `#/chat?agent=${encodeURIComponent(id)}`
      window.location.hash = hash
      // 强制触发路由更新
      setTimeout(() => {
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      }, 100)
    } else if (action === 'detail') await showAgentDetailDialog(id)
    else if (action === 'edit') showEditAgentDialog(page, state, id)
    else if (action === 'delete') await deleteAgent(page, state, id)
    else if (action === 'backup') await backupAgent(id)
  })
}

async function showAgentDetailDialog(id) {
  try {
    const agent = await api.getAgent(id)
    const soulContent = agent.soul || '无'
    const toolGroupsContent = Array.isArray(agent.tool_groups) && agent.tool_groups.length > 0 ? agent.tool_groups.join(', ') : '未限制'
    
    showModal({
      title: `Agent 详情 — ${id}`,
      fields: [
        { name: 'name', label: '名称', value: agent.name || '', readonly: true },
        { name: 'description', label: '描述', value: agent.description || '无', readonly: true },
        { name: 'model', label: '模型', value: parseModelValue(agent) || '未设置', readonly: true },
        { name: 'toolGroups', label: '工具组', value: toolGroupsContent, readonly: true },
      ],
      onConfirm: () => {}
    })
    
    // 在弹窗中添加 SOUL 内容
    setTimeout(() => {
      const modal = document.querySelector('.modal')
      if (modal) {
        modal.style.cssText = 'max-width:1200px !important;width:90vw !important;min-width:500px;max-height:90vh;overflow-y:auto'
        const soulDiv = document.createElement('div')
        soulDiv.className = 'form-group'
        soulDiv.innerHTML = `
          <label class="form-label">SOUL</label>
          <textarea class="form-input" readonly style="height:400px;opacity:0.6;cursor:not-allowed;resize:vertical;white-space:pre-wrap;overflow-y:auto;font-family:var(--font-mono);font-size:12px;line-height:1.6">${escapeHtml(soulContent)}</textarea>
        `
        modal.querySelector('.modal-actions')?.before(soulDiv)
      }
    }, 0)
  } catch (e) {
    toast('获取 Agent 详情失败: ' + e, 'error')
  }
}

async function showEditAgentDialog(page, state, id) {
  const agent = state.agents.find(a => a.name === id)
  if (!agent) return

  // 获取模型列表
  let models = []
  try {
    const config = await api.readOpenclawConfig()
    const providers = config?.models?.providers || {}
    for (const [pk, pv] of Object.entries(providers)) {
      for (const m of (pv.models || [])) {
        const mid = typeof m === 'string' ? m : m.id
        if (mid) models.push({ value: `${pk}/${mid}`, label: `${pk}/${mid}` })
      }
    }
    console.log('[Agent编辑] 获取到模型列表:', models.length, '个')
  } catch (e) {
    console.error('[Agent编辑] 获取模型列表失败:', e)
  }

  const fields = [
    { name: 'description', label: '描述', value: agent.description || '', placeholder: '例如：翻译助手' },
  ]

  if (models.length) {
    const modelField = {
      name: 'model', label: '模型', type: 'select',
      value: parseModelValue(agent) || models[0]?.value || '',
      options: models,
    }
    fields.push(modelField)
    console.log('[Agent编辑] 当前模型:', agent.model)
    console.log('[Agent编辑] 模型选项:', models)
  } else {
    console.warn('[Agent编辑] 模型列表为空，不显示模型选择器')
  }

  fields.push({
    name: 'toolGroups', label: '工具组',
    value: Array.isArray(agent.tool_groups) ? agent.tool_groups.join(', ') : '',
    placeholder: '逗号分隔，例如：search,files',
  })
  fields.push({
    name: 'soul', label: 'SOUL',
    value: agent.soul || '',
    placeholder: '可选：Agent 个性与约束（简要）',
  })
  fields.push({
    name: 'nameReadonly', label: 'Agent 名称',
    value: agent.name || '',
    placeholder: '',
    readonly: true,
  })

  showModal({
    title: `编辑 Agent — ${id}`,
    fields,
    onConfirm: async (result) => {
      console.log('[Agent编辑] 保存数据:', result)
      const newDesc = (result.description || '').trim()
      const model = (result.model || '').trim()
      const soul = (result.soul || '').trim()
      const toolGroups = String(result.toolGroups || '').split(',').map(x => x.trim()).filter(Boolean)

      try {
        await api.updateAgent(id, {
          description: newDesc,
          model: model || null,
          tool_groups: toolGroups.length ? toolGroups : null,
          soul: soul || null,
        })

        // 手动更新 state 并重新渲染，确保立即生效
        agent.description = newDesc
        if (model) agent.model = model
        agent.tool_groups = toolGroups
        agent.soul = soul
        renderAgents(page, state)

        toast('已更新', 'success')
      } catch (e) {
        console.error('[Agent编辑] 保存失败:', e)
        toast('更新失败: ' + e, 'error')
      }
    }
  })
}

async function deleteAgent(page, state, id) {
  const yes = await showConfirm(`确定删除 Agent「${id}」？\n\n此操作将删除该 Agent 的所有数据和会话。`)
  if (!yes) return

  try {
    await api.deleteAgent(id)
    toast('已删除', 'success')
    await loadAgents(page, state)
  } catch (e) {
    toast('删除失败: ' + e, 'error')
  }
}

async function backupAgent(id) {
  toast(`正在备份 Agent「${id}」...`, 'info')
  try {
    const zipPath = await api.backupAgent(id)
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      const dir = zipPath.substring(0, zipPath.lastIndexOf('/')) || zipPath
      await open(dir)
    } catch { /* fallback */ }
    toast(`备份完成: ${zipPath.split('/').pop()}`, 'success')
  } catch (e) {
    toast('备份失败: ' + e, 'error')
  }
}

function parseModelValue(agent) {
  const model = agent?.model
  if (!model) return ''
  if (typeof model === 'string') return model
  if (typeof model === 'object') return model.primary || model.id || ''
  return ''
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
