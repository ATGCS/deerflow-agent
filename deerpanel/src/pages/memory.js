/**
 * 记忆管理页面 - 与 Web 版一致
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'

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

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">记忆管理</h1>
        <p class="page-desc">管理用户记忆上下文、历史摘要和事实</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-secondary" id="btn-reload">刷新</button>
        <button class="btn btn-sm btn-danger" id="btn-clear-all">清空全部</button>
      </div>
    </div>
    <div class="page-content">
      <div style="margin-bottom:var(--space-md);display:flex;gap:var(--space-sm);flex-wrap:wrap;align-items:center">
        <input class="form-input" id="memory-search" placeholder="搜索记忆..." style="max-width:300px">
        <div class="tab-bar" style="display:flex;gap:4px">
          <div class="tab active" data-filter="all">全部</div>
          <div class="tab" data-filter="summaries">摘要</div>
          <div class="tab" data-filter="facts">事实</div>
        </div>
      </div>
      <div id="memory-loading" style="padding:40px;text-align:center;color:var(--text-tertiary)">加载中...</div>
      <div id="memory-content" style="display:none"></div>
      <div id="memory-empty" style="display:none;padding:40px;text-align:center;color:var(--text-tertiary)">暂无记忆数据</div>
      <div id="memory-error" style="display:none;padding:40px;text-align:center;color:var(--error)"></div>
    </div>
  `

  const state = {
    memory: null,
    filter: 'all',
    query: '',
    loading: true
  }

  // 加载记忆数据
  async function loadMemory() {
    const loadingEl = page.querySelector('#memory-loading')
    const contentEl = page.querySelector('#memory-content')
    const emptyEl = page.querySelector('#memory-empty')
    const errorEl = page.querySelector('#memory-error')

    loadingEl.style.display = 'block'
    contentEl.style.display = 'none'
    emptyEl.style.display = 'none'
    errorEl.style.display = 'none'

    try {
      const memory = await api.getMemory()
      state.memory = memory
      state.loading = false
      loadingEl.style.display = 'none'
      renderMemory(page, state)
    } catch (e) {
      loadingEl.style.display = 'none'
      errorEl.textContent = '加载失败: ' + e
      errorEl.style.display = 'block'
      toast('加载记忆失败: ' + e, 'error')
    }
  }

  // 渲染记忆内容
  function renderMemory(page, state) {
    const contentEl = page.querySelector('#memory-content')
    const emptyEl = page.querySelector('#memory-empty')
    const { memory, filter, query } = state

    if (!memory) return

    const normalizedQuery = query.trim().toLowerCase()
    const showSummaries = filter !== 'facts'
    const showFacts = filter !== 'summaries'

    // 构建摘要 sections
    const summarySections = []

    // 用户上下文
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
            updatedAt: section.updatedAt
          })
        }
      }
    }

    // 历史上下文
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
            updatedAt: section.updatedAt
          })
        }
      }
    }

    // 过滤事实
    const filteredFacts = (memory.facts || []).filter(fact => {
      if (!normalizedQuery) return true
      return `${fact.content} ${fact.category}`.toLowerCase().includes(normalizedQuery)
    })

    // 检查是否有内容
    const hasSummary = summarySections.some(s => s.summary && s.summary.trim())
    const hasFacts = filteredFacts.length > 0

    if (!hasSummary && !hasFacts) {
      contentEl.style.display = 'none'
      emptyEl.style.display = 'block'
      return
    }

    emptyEl.style.display = 'none'
    contentEl.style.display = 'block'

    let html = ''

    // 渲染摘要
    if (showSummaries && hasSummary) {
      html += `
        <div class="memory-section" style="margin-bottom:var(--space-xl)">
          <div style="margin-bottom:var(--space-md)">
            <h3 style="font-size:var(--font-size-lg);font-weight:600;margin-bottom:var(--space-xs)">记忆摘要</h3>
            <p style="font-size:var(--font-size-sm);color:var(--text-tertiary)">摘要内容为只读，你可以清空全部记忆或删除单个事实</p>
          </div>
      `

      // 按组分类
      const grouped = {}
      for (const s of summarySections) {
        if (!grouped[s.group]) grouped[s.group] = []
        grouped[s.group].push(s)
      }

      for (const [groupTitle, sections] of Object.entries(grouped)) {
        html += `<div style="margin-bottom:var(--space-lg)">`
        html += `<h4 style="font-size:var(--font-size-base);font-weight:500;color:var(--text-secondary);margin-bottom:var(--space-sm)">${escapeHtml(groupTitle)}</h4>`
        for (const s of sections) {
          html += `
            <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-sm)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-xs)">
                <span style="font-weight:500">${escapeHtml(s.label)}</span>
                ${s.updatedAt ? `<span style="font-size:var(--font-size-xs);color:var(--text-tertiary)">更新于 ${formatTimeAgo(s.updatedAt)}</span>` : ''}
              </div>
              <div style="color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.6">
                ${s.summary ? escapeHtml(s.summary) : '<span style="color:var(--text-tertiary)">暂无内容</span>'}
              </div>
            </div>
          `
        }
        html += `</div>`
      }

      html += `</div>`
    }

    // 渲染事实
    if (showFacts && hasFacts) {
      html += `
        <div class="memory-section">
          <div style="margin-bottom:var(--space-md)">
            <h3 style="font-size:var(--font-size-lg);font-weight:600;margin-bottom:var(--space-xs)">记忆事实</h3>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
      `

      for (const fact of filteredFacts) {
        const { key } = confidenceToLevel(fact.confidence)
        const confidenceLabel = key === 'veryHigh' ? '非常高' : key === 'high' ? '高' : '一般'
        const categoryLabel = fact.category === 'context' ? '上下文' : fact.category === 'preference' ? '偏好' : fact.category === 'fact' ? '事实' : escapeHtml(fact.category)

        html += `
          <div style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-md)">
              <div style="flex:1;min-width:0">
                <div style="display:flex;flex-wrap:wrap;gap:var(--space-md);font-size:var(--font-size-xs);color:var(--text-tertiary);margin-bottom:var(--space-xs)">
                  <span>分类: <span style="color:var(--text-secondary)">${categoryLabel}</span></span>
                  <span>置信度: <span style="color:var(--text-secondary)">${confidenceLabel}</span></span>
                  ${fact.createdAt ? `<span>创建于: <span style="color:var(--text-secondary)">${formatTimeAgo(fact.createdAt)}</span></span>` : ''}
                </div>
                <div style="font-size:var(--font-size-sm);color:var(--text-primary);line-height:1.6;word-break:break-word">
                  ${escapeHtml(fact.content)}
                </div>
              </div>
              <button class="btn btn-sm btn-danger" data-action="delete-fact" data-id="${escapeHtml(fact.id)}" style="flex-shrink:0">删除</button>
            </div>
          </div>
        `
      }

      html += `</div></div>`
    }

    contentEl.innerHTML = html

    // 绑定删除事实事件
    contentEl.querySelectorAll('[data-action="delete-fact"]').forEach(btn => {
      btn.onclick = async () => {
        const factId = btn.dataset.id
        const yes = await showConfirm('确定删除这条记忆事实？此操作无法撤销。')
        if (!yes) return
        try {
          await api.deleteMemoryFact(factId)
          toast('已删除', 'success')
          await loadMemory()
        } catch (e) {
          toast('删除失败: ' + e, 'error')
        }
      }
    })
  }

  // 事件绑定
  page.querySelector('#btn-reload').onclick = loadMemory

  page.querySelector('#btn-clear-all').onclick = async () => {
    const yes = await showConfirm('确定清空全部记忆？此操作无法撤销。')
    if (!yes) return
    try {
      await api.clearMemory()
      toast('已清空全部记忆', 'success')
      await loadMemory()
    } catch (e) {
      toast('清空失败: ' + e, 'error')
    }
  }

  page.querySelector('#memory-search').oninput = (e) => {
    state.query = e.target.value
    renderMemory(page, state)
  }

  page.querySelectorAll('.tab-bar .tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      state.filter = tab.dataset.filter
      renderMemory(page, state)
    }
  })

  // 初始加载
  await loadMemory()

  return page
}
