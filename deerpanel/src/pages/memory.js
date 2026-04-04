/**
 * 记忆管理页面 — 按 Agent 分栏（全局 memory.json + agents/{id}/memory.json）
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'

const CATEGORIES = ['workContext', 'personalContext', 'topOfMind']
const HISTORY_CATEGORIES = ['recentMonths', 'earlierContext', 'longTermBackground']

function formatTimeAgo(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const diff = (now - date) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  if (diff < 604800) return Math.floor(diff / 86400) + ' 天前'
  return date.toLocaleDateString('zh-CN')
}

function confidenceToLevel(confidence) {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return { key: 'unknown', value: null }
  const value = Math.min(1, Math.max(0, confidence))
  if (value >= 0.85) return { key: 'veryHigh', value }
  if (value >= 0.65) return { key: 'high', value }
  return { key: 'normal', value }
}

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function filterTabsHtml() {
  return `
    <div class="tab-bar memory-filter-tabs" role="tablist">
      <button type="button" class="tab active" data-filter="all" role="tab">全部</button>
      <button type="button" class="tab" data-filter="summaries" role="tab">摘要</button>
      <button type="button" class="tab" data-filter="facts" role="tab">事实</button>
    </div>
  `
}

/**
 * @param {boolean} settingsModal
 */
function createMemoryRoot(settingsModal) {
  const page = document.createElement('div')
  if (settingsModal) {
    page.className = 'settings-modal-pane settings-modal-pane--memory'
    page.innerHTML = `
      <div class="settings-modal-pane-toolbar settings-modal-pane-toolbar--memory memory-pane-toolbar">
        <div class="memory-toolbar-meta">
          <span class="memory-toolbar-title">记忆</span>
          <span class="memory-toolbar-hint">按助手分栏，每个 Agent 独立存储</span>
        </div>
        <span class="settings-modal-pane-toolbar-spacer" aria-hidden="true"></span>
        <button type="button" class="btn btn-sm btn-secondary" id="btn-reload">刷新</button>
        <button type="button" class="btn btn-sm btn-danger" id="btn-clear-all">清空当前</button>
      </div>
      <div class="settings-modal-pane-body settings-modal-pane-body--memory">
        <div id="memory-loading" class="settings-modal-pane-loading" role="status"><span>加载中…</span></div>
        <div id="memory-main" class="settings-modal-pane-fill memory-pane-fill" hidden>
          <div id="memory-agent-bar" class="memory-agent-bar" hidden></div>
          <div class="memory-subtoolbar">
            <input class="form-input memory-search" type="search" id="memory-search" placeholder="搜索当前助手记忆…" autocomplete="off">
            ${filterTabsHtml()}
          </div>
          <div id="memory-content" class="memory-content-area"></div>
        </div>
        <div id="memory-error" class="settings-modal-pane-fill settings-modal-pane-error" hidden></div>
      </div>
    `
    return page
  }

  page.className = 'page memory-page'
  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">记忆管理</h1>
        <p class="page-desc">按助手分栏查看摘要与事实；全局与自定义 Agent 各自对应一份 memory.json</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-sm btn-secondary" id="btn-reload">刷新</button>
        <button type="button" class="btn btn-sm btn-danger" id="btn-clear-all">清空当前</button>
      </div>
    </div>
    <div class="page-content memory-page-content">
      <div id="memory-loading" class="memory-phase-loading" role="status">加载中…</div>
      <div id="memory-main" class="memory-main-layout" style="display:none">
        <div id="memory-agent-bar" class="memory-agent-bar" hidden></div>
        <div class="memory-subtoolbar memory-subtoolbar--page">
          <input class="form-input memory-search" type="search" id="memory-search" placeholder="搜索当前助手记忆…" autocomplete="off">
          ${filterTabsHtml()}
        </div>
        <div id="memory-content" class="memory-content-area"></div>
      </div>
      <div id="memory-error" class="memory-phase-error" style="display:none"></div>
    </div>
  `
  return page
}

function setMemoryPhase(page, phase) {
  const loadingEl = page.querySelector('#memory-loading')
  const mainEl = page.querySelector('#memory-main')
  const errorEl = page.querySelector('#memory-error')
  const modal = !!page.querySelector('.settings-modal-pane-body--memory')
  if (modal) {
    if (phase === 'loading') {
      loadingEl?.removeAttribute('hidden')
      mainEl?.setAttribute('hidden', '')
      errorEl?.setAttribute('hidden', '')
    } else if (phase === 'content') {
      loadingEl?.setAttribute('hidden', '')
      mainEl?.removeAttribute('hidden')
      errorEl?.setAttribute('hidden', '')
    } else if (phase === 'error') {
      loadingEl?.setAttribute('hidden', '')
      mainEl?.setAttribute('hidden', '')
      errorEl?.removeAttribute('hidden')
    }
    return
  }
  if (loadingEl) loadingEl.style.display = phase === 'loading' ? 'block' : 'none'
  if (mainEl) mainEl.style.display = phase === 'content' ? 'flex' : 'none'
  if (errorEl) errorEl.style.display = phase === 'error' ? 'block' : 'none'
}

function selectedAgentLabel(state) {
  const row = state.agents?.find((a) => (a.id == null && state.agentId == null) || a.id === state.agentId)
  return row?.display_name || (state.agentId ? state.agentId : '全局')
}

function renderAgentBar(page, state) {
  const bar = page.querySelector('#memory-agent-bar')
  if (!bar || !state.agents?.length) return

  const multi = state.agents.length > 1
  bar.hidden = !multi
  if (!multi) {
    bar.innerHTML = ''
    return
  }

  const chips = state.agents
    .map((a) => {
      const id = a.id
      const active = (id == null && state.agentId == null) || id === state.agentId
      const key = id == null ? '' : escapeHtml(id)
      const hint = a.description ? escapeHtml(a.description) : ''
      const newBadge = a.has_memory_file ? '' : '<span class="memory-agent-chip-badge">未落盘</span>'
      return `
        <button type="button" class="memory-agent-chip${active ? ' is-active' : ''}"
          data-agent="${key}"
          title="${hint}"
          aria-pressed="${active ? 'true' : 'false'}">
          <span class="memory-agent-chip-name">${escapeHtml(a.display_name || id || '全局')}</span>
          ${id != null ? `<code class="memory-agent-chip-id">${escapeHtml(id)}</code>` : ''}
          ${newBadge}
        </button>
      `
    })
    .join('')

  bar.innerHTML = chips

  bar.querySelectorAll('.memory-agent-chip').forEach((btn) => {
    btn.onclick = () => {
      const raw = btn.getAttribute('data-agent') || ''
      state.agentId = raw === '' ? null : raw
      bar.querySelectorAll('.memory-agent-chip').forEach((b) => {
        const d = b.getAttribute('data-agent') || ''
        const on = state.agentId == null ? d === '' : d === state.agentId
        b.classList.toggle('is-active', on)
        b.setAttribute('aria-pressed', on ? 'true' : 'false')
      })
      void loadMemoryPage(page, state, { refreshAgents: false })
    }
  })
}

function renderMemoryContent(page, state) {
  const contentEl = page.querySelector('#memory-content')
  const { memory, filter, query } = state

  if (!memory || !contentEl) return

  const normalizedQuery = query.trim().toLowerCase()
  const showSummaries = filter !== 'facts'
  const showFacts = filter !== 'summaries'

  const summarySections = []

  const userContextTitle = '用户上下文'
  for (const cat of CATEGORIES) {
    const section = memory.user?.[cat]
    if (section) {
      const label = cat === 'workContext' ? '工作' : cat === 'personalContext' ? '个人' : '最重要的事'
      if (!normalizedQuery || `${label} ${section.summary}`.toLowerCase().includes(normalizedQuery)) {
        summarySections.push({
          group: userContextTitle,
          label,
          summary: section.summary,
          updatedAt: section.updatedAt,
        })
      }
    }
  }

  const historyTitle = '历史背景'
  for (const cat of HISTORY_CATEGORIES) {
    const section = memory.history?.[cat]
    if (section) {
      const label = cat === 'recentMonths' ? '最近几个月' : cat === 'earlierContext' ? '更早的上下文' : '长期背景'
      if (!normalizedQuery || `${label} ${section.summary}`.toLowerCase().includes(normalizedQuery)) {
        summarySections.push({
          group: historyTitle,
          label,
          summary: section.summary,
          updatedAt: section.updatedAt,
        })
      }
    }
  }

  const filteredFacts = (memory.facts || []).filter((fact) => {
    if (!normalizedQuery) return true
    return `${fact.content} ${fact.category}`.toLowerCase().includes(normalizedQuery)
  })

  const hasSummary = summarySections.some((s) => s.summary && s.summary.trim())
  const hasFacts = filteredFacts.length > 0

  let html = ''

  const scopeHint = `<p class="memory-scope-hint">当前：<strong>${escapeHtml(selectedAgentLabel(state))}</strong> · 更新 ${escapeHtml(memory.lastUpdated ? formatTimeAgo(memory.lastUpdated) : '—')}</p>`

  if (!hasSummary && !hasFacts) {
    contentEl.innerHTML = `
      <div class="memory-inline-empty">
        ${scopeHint}
        <p class="memory-inline-empty-title">暂无匹配内容</p>
        <p class="memory-inline-empty-desc">可切换其他助手、调整筛选或清空搜索后重试。</p>
      </div>
    `
    return
  }

  html += scopeHint

  if (showSummaries && hasSummary) {
    html += `
      <section class="memory-block" aria-label="记忆摘要">
        <div class="memory-block-head">
          <h3 class="memory-block-title">摘要</h3>
          <p class="memory-block-desc">只读展示；可删除单条事实或清空当前助手全部记忆</p>
        </div>
    `

    const grouped = {}
    for (const s of summarySections) {
      if (!grouped[s.group]) grouped[s.group] = []
      grouped[s.group].push(s)
    }

    for (const [groupTitle, sections] of Object.entries(grouped)) {
      html += `<div class="memory-group">`
      html += `<h4 class="memory-group-title">${escapeHtml(groupTitle)}</h4>`
      for (const s of sections) {
        html += `
          <article class="memory-summary-card">
            <div class="memory-summary-card-head">
              <span class="memory-summary-card-label">${escapeHtml(s.label)}</span>
              ${s.updatedAt ? `<time class="memory-summary-card-time">更新于 ${escapeHtml(formatTimeAgo(s.updatedAt))}</time>` : ''}
            </div>
            <div class="memory-summary-card-body">
              ${s.summary ? escapeHtml(s.summary) : '<span class="memory-muted">暂无内容</span>'}
            </div>
          </article>
        `
      }
      html += `</div>`
    }

    html += `</section>`
  }

  if (showFacts && hasFacts) {
    html += `
      <section class="memory-block" aria-label="记忆事实">
        <div class="memory-block-head">
          <h3 class="memory-block-title">事实</h3>
        </div>
        <ul class="memory-fact-list">
    `

    for (const fact of filteredFacts) {
      const { key } = confidenceToLevel(fact.confidence)
      const confidenceLabel = key === 'veryHigh' ? '非常高' : key === 'high' ? '高' : '一般'
      const categoryLabel =
        fact.category === 'context'
          ? '上下文'
          : fact.category === 'preference'
            ? '偏好'
            : fact.category === 'fact'
              ? '事实'
              : escapeHtml(fact.category)

      html += `
        <li class="memory-fact-card">
          <div class="memory-fact-main">
            <div class="memory-fact-meta">
              <span class="memory-fact-tag">${categoryLabel}</span>
              <span class="memory-fact-meta-item">置信 ${confidenceLabel}</span>
              ${fact.createdAt ? `<span class="memory-fact-meta-item">${escapeHtml(formatTimeAgo(fact.createdAt))}</span>` : ''}
            </div>
            <p class="memory-fact-text">${escapeHtml(fact.content)}</p>
          </div>
          <button type="button" class="btn btn-sm btn-danger memory-fact-delete" data-action="delete-fact" data-id="${escapeHtml(fact.id)}">删除</button>
        </li>
      `
    }

    html += `</ul></section>`
  }

  contentEl.innerHTML = html

  contentEl.querySelectorAll('[data-action="delete-fact"]').forEach((btn) => {
    btn.onclick = async () => {
      const factId = btn.dataset.id
      const yes = await showConfirm('确定删除这条记忆事实？此操作无法撤销。')
      if (!yes) return
      try {
        await api.deleteMemoryFact(factId, state.agentId)
        toast('已删除', 'success')
        await loadMemoryPage(page, state)
      } catch (e) {
        toast('删除失败: ' + e, 'error')
      }
    }
  })
}

async function loadAgents(page, state) {
  try {
    const res = await api.getMemoryAgents()
    state.agents = res.agents && res.agents.length ? res.agents : [{ id: null, display_name: '全局', description: '', has_memory_file: false }]
  } catch {
    state.agents = [{ id: null, display_name: '全局', description: '', has_memory_file: false }]
  }
  if (state.agentId != null && !state.agents.some((a) => a.id === state.agentId)) {
    state.agentId = null
  }
  renderAgentBar(page, state)
}

/**
 * @param {{ refreshAgents?: boolean }} [opts]
 */
async function loadMemoryPage(page, state, opts = {}) {
  const refreshAgents = opts.refreshAgents !== false
  const errorEl = page.querySelector('#memory-error')

  setMemoryPhase(page, 'loading')

  try {
    if (refreshAgents) {
      await loadAgents(page, state)
    }
    const memory = await api.getMemory(state.agentId)
    state.memory = memory
    state.loading = false
    setMemoryPhase(page, 'content')
    renderMemoryContent(page, state)
  } catch (e) {
    setMemoryPhase(page, 'error')
    if (errorEl) errorEl.textContent = '加载失败: ' + e
    toast('加载记忆失败: ' + e, 'error')
  }
}

function bindFilterTabs(page, state) {
  page.querySelectorAll('.memory-filter-tabs .tab').forEach((tab) => {
    tab.onclick = () => {
      page.querySelectorAll('.memory-filter-tabs .tab').forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      state.filter = tab.dataset.filter
      renderMemoryContent(page, state)
    }
  })
}

function bindMemoryPage(page, state) {
  page.querySelector('#btn-reload').onclick = () => loadMemoryPage(page, state)

  page.querySelector('#btn-clear-all').onclick = async () => {
    const name = selectedAgentLabel(state)
    const yes = await showConfirm(
      state.agentId == null
        ? `确定清空「全局」的全部记忆？未选择自定义助手时的主对话将失去长期记忆。`
        : `确定清空助手「${name}」的全部记忆？此操作无法撤销。`,
    )
    if (!yes) return
    try {
      await api.clearMemory(state.agentId)
      toast('已清空当前助手记忆', 'success')
      await loadMemoryPage(page, state)
    } catch (e) {
      toast('清空失败: ' + e, 'error')
    }
  }

  const search = page.querySelector('#memory-search')
  if (search) {
    search.oninput = (e) => {
      state.query = e.target.value
      renderMemoryContent(page, state)
    }
  }

  bindFilterTabs(page, state)
}

export async function render() {
  const page = createMemoryRoot(false)
  const state = {
    agents: [],
    agentId: null,
    memory: null,
    filter: 'all',
    query: '',
    loading: true,
  }
  bindMemoryPage(page, state)
  await loadMemoryPage(page, state)
  return page
}

export function mountMemoryForSettingsModal(container) {
  const page = createMemoryRoot(true)
  const state = {
    agents: [],
    agentId: null,
    memory: null,
    filter: 'all',
    query: '',
    loading: true,
  }
  container.replaceChildren(page)
  bindMemoryPage(page, state)
  void loadMemoryPage(page, state)
}
