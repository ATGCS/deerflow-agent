/**
 * 工具管理页面 - 管理 MCP 服务器 + MCP 市场
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm, showModal } from '../components/modal.js'
import { icon } from '../lib/icons.js'

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')
}

let _loadSeq = 0

/**
 * 根据 MCP 服务器名称/类型匹配图标 emoji
 */
const MCP_ICON_MAP = [
  [/filesystem|file|local/i, '📁'],
  [/fetch|web|http|request/i, '🌐'],
  [/brave-search|search|google|bing/i, '🔍'],
  [/github|git|repo|commit/i, '💻'],
  [/slack|discord|chat|message/i, '💬'],
  [/database|postgres|mysql|mongo|sqlite|supabase/i, '🗄️'],
  [/memory|context|store|redis|ioredis/i, '🧠'],
  [/puppeteer|playwright|browser|selenium/i, '🌍'],
  [/aws|azure|gcp|cloud|infra|terraform/i, '☁️'],
  [/docker|k8s|kubernetes|container/i, '🐳'],
  [/notion|obsidian|confluence|wiki/i, '📝'],
  [/calendar|schedule|outlook|google-calendar/i, '📅'],
  [/email|mail|imap|smtp|gmail\.?outlook/i, '📧'],
  [/spotify|music|audio|sound/i, '🎵'],
  [/stripe|payment|finance|billing/i, '💳'],
  [/openai|anthropic|claude|gemini|llm|ai/i, '🤖'],
  [/ssh|terminal|shell|exec|command/i, '⚙️'],
  [/time|date|clock/i, '⏰'],
  [/weather|forecast/i, '🌤️'],
  [/map|location|geo/i, '🗺️'],
  [/json|yaml|config|parse/i, '📋'],
  [/sequential-thinking|reason|think/i, '🧮'],
  [/everything|mcp|server|tool/i, '🔌'],
]

const DEFAULT_MCP_ICON = '🔌'

/** 市场结果图标映射（基于 Glama 数据特征） */
function getMarketIcon(name, title) {
  const combined = `${name} ${title}`
  if (!combined.trim()) return DEFAULT_MCP_ICON
  for (const [regex, icon] of MCP_ICON_MAP) {
    if (regex.test(combined)) return icon
  }
  return DEFAULT_MCP_ICON
}

function getMcpIcon(name, type) {
  const combined = `${name} ${type}`
  if (!combined.trim()) return DEFAULT_MCP_ICON
  for (const [regex, icon] of MCP_ICON_MAP) {
    if (regex.test(combined)) return icon
  }
  return DEFAULT_MCP_ICON
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <h1 class="page-title">工具管理</h1>
        <p class="page-desc">管理 MCP 服务器和工具配置</p>
      </div>
      <button id="btn-add-mcp" style="flex-shrink:0;margin-top:4px">${icon('plus', 14)} 添加服务器</button>
    </div>

    <div class="tab-bar" id="mcp-main-tabs">
      <div class="tab active" data-main-tab="installed">已安装</div>
      <div class="tab" data-main-tab="market">市场</div>
    </div>

    <div id="mcp-tab-installed">
      <div id="tools-loading" style="padding:40px;text-align:center;color:var(--text-tertiary)">加载中...</div>
      <div id="tools-content" style="display:none"></div>
      <div id="tools-empty" style="display:none;padding:40px;text-align:center;color:var(--text-tertiary)">暂无 MCP 服务器配置</div>
      <div id="tools-error" style="display:none;padding:40px;text-align:center;color:var(--error)"></div>
    </div>

    <div id="mcp-tab-market" style="display:none">
      <div class="role-toolbar" style="margin-bottom:var(--space-sm);padding:0 0 18px">
        <div class="role-search-wrap" style="width:auto;flex:1;max-width:420px;min-width:200px">
          <svg class="role-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="role-search-input" id="market-search-input" placeholder="搜索 MCP 服务器...">
        </div>
        <span class="role-total" id="market-hint" style="font-size:12px;color:var(--text-tertiary)">从社区发现热门 MCP 服务器</span>
      </div>

      <div id="market-results" class="market-list">
        <div style="padding:40px 20px;text-align:center;color:var(--text-tertiary)">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.35;margin-bottom:12px"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          输入关键词搜索 MCP 服务器，一键添加到本地配置
        </div>
      </div>
    </div>
  `

  bindEvents(page)
  loadTools(page)
  return page
}

// ========== 已安装 Tab ==========

async function loadTools(page) {
  const loadingEl = page.querySelector('#tools-loading')
  const contentEl = page.querySelector('#tools-content')
  const emptyEl = page.querySelector('#tools-empty')
  const errorEl = page.querySelector('#tools-error')

  loadingEl.style.display = 'block'
  contentEl.style.display = 'none'
  emptyEl.style.display = 'none'
  errorEl.style.display = 'none'

  const seq = ++_loadSeq

  try {
    const data = await api.getMCPConfig()
    if (seq !== _loadSeq) return

    const servers = data?.mcp_servers || {}
    const serverList = Object.entries(servers)

    loadingEl.style.display = 'none'

    if (serverList.length === 0) {
      emptyEl.style.display = 'block'
      return
    }

    contentEl.style.display = 'block'
    renderInstalled(page, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    loadingEl.style.display = 'none'
    errorEl.textContent = '加载失败: ' + e
    errorEl.style.display = 'block'
    toast('加载工具配置失败: ' + e, 'error')
  }
}

function renderInstalled(page, data) {
  const contentEl = page.querySelector('#tools-content')
  const servers = data?.mcp_servers || {}
  const serverList = Object.entries(servers)

  const enabledCount = serverList.filter(([, s]) => s.enabled).length
  const disabledCount = serverList.length - enabledCount

  let html = `
    <div class="role-toolbar" style="margin-bottom:var(--space-sm);padding:0 0 18px">
      <div class="role-search-wrap" style="width:auto;flex:1;max-width:400px;min-width:200px">
        <svg class="role-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="role-search-input" id="mcp-filter-input" placeholder="过滤 MCP 服务器...">
      </div>
      <div class="filter-dropdown" id="mcp-status-dd">
        <button class="filter-dropdown-btn" type="button">
          <span class="filter-dropdown-label" id="mcp-status-label">全部</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="filter-dropdown-menu">
          <div class="filter-dropdown-item active" data-value="all">全部</div>
          <div class="filter-dropdown-item" data-value="enabled">已启用</div>
          <div class="filter-dropdown-item" data-value="disabled">已禁用</div>
        </div>
      </div>
      <span class="role-total">${serverList.length} 个服务器，${enabledCount} 个启用，${disabledCount} 个禁用</span>
    </div>

    <div class="mcp-server-grid">
      ${serverList.map(([name, config]) => renderMcpCard(name, config)).join('')}
    </div>
  `

  contentEl.innerHTML = html

  // 自定义下拉
  const dd = contentEl.querySelector('#mcp-status-dd')
  const label = contentEl.querySelector('#mcp-status-label')
  let currentStatus = 'all'

  dd.querySelector('.filter-dropdown-btn').addEventListener('click', (e) => {
    e.stopPropagation()
    document.querySelectorAll('.filter-dropdown.open').forEach(d => { if (d !== dd) d.classList.remove('open') })
    dd.classList.toggle('open')
  })

  dd.querySelectorAll('.filter-dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      currentStatus = item.dataset.value
      label.textContent = item.textContent
      dd.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('active'))
      item.classList.add('active')
      dd.classList.remove('open')
      applyFilter()
    })
  })

  document.addEventListener('click', function closeDd(e) {
    if (!e.target.closest('.filter-dropdown')) {
      dd.classList.remove('open')
    }
  })

  const applyFilter = () => {
    const q = (contentEl.querySelector('#mcp-filter-input').value || '').toLowerCase()
    contentEl.querySelectorAll('.mcp-server-card').forEach(card => {
      const name = card.dataset.name?.toLowerCase() || ''
      const desc = card.dataset.desc?.toLowerCase() || ''
      const isEnabled = card.dataset.status === 'enabled'

      let matchText = !q || name.includes(q) || desc.includes(q)
      let matchStatus = true
      if (currentStatus === 'enabled') matchStatus = isEnabled
      else if (currentStatus === 'disabled') matchStatus = !isEnabled

      card.style.display = (matchText && matchStatus) ? '' : 'none'
    })
  }

  contentEl.querySelector('#mcp-filter-input').oninput = applyFilter

  // 绑定启用/禁用事件
  contentEl.querySelectorAll('.mcp-toggle').forEach(checkbox => {
    checkbox.onchange = async () => {
      const name = checkbox.dataset.name
      const enabled = checkbox.checked

      try {
        const currentData = await api.getMCPConfig()
        const srv = currentData?.mcp_servers || {}
        srv[name] = { ...srv[name], enabled }
        await api.updateMCPConfig(srv)

        toast(`MCP 服务器 ${name} 已${enabled ? '启用' : '禁用'}`, 'success')
        // 就地更新，避免全量刷新
        const card = checkbox.closest('.mcp-server-card')
        if (card) card.dataset.status = enabled ? 'enabled' : 'disabled'
        const summaryEl = contentEl.querySelector('.role-total')
        if (summaryEl) {
          const allCards = contentEl.querySelectorAll('.mcp-server-card')
          const enCount = contentEl.querySelectorAll('.mcp-toggle:checked').length
          summaryEl.textContent = allCards.length + ' 个服务器，' + enCount + ' 个启用，' + (allCards.length - enCount) + ' 个禁用'
        }
      } catch (e) {
        checkbox.checked = !enabled
        toast('操作失败: ' + e, 'error')
      }
    }
  })

  // 添加自定义 MCP 服务器按钮
  const addBtn = page.querySelector('#btn-add-mcp')
  if (addBtn) {
    addBtn.onclick = () => {
      const sampleJson = `{
  // ====== stdio 类型（本地进程）======
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
    "enabled": true,
    "description": "文件系统访问"
  },
  // ====== SSE 类型 ======
  "my-sse-server": {
    "type": "sse",
    "url": "http://localhost:3000/sse",
    "enabled": true,
    "description": "SSE 连接的远程服务器"
  },
  // ====== Streamable HTTP 类型 ======
  "remote-mcp": {
    "type": "streamable-http",
    "url": "http://localhost:8080/mcp",
    "enabled": false,
    "description": "HTTP 流式连接"
  }
}`

      showModal({
        title: '导入 MCP 服务器配置',
        fields: [
          {
            name: 'json',
            type: 'textarea',
            label: 'JSON 配置',
            placeholder: sampleJson,
            value: '',
            rows: 12,
            hint: '支持 stdio / SSE / streamable-http 三种类型，可一次导入多个服务器'
          }
        ],
        onConfirm: async (vals) => {
          let parsed
          try { parsed = JSON.parse(vals.json || '{}') } catch (e) {
            toast('JSON 格式错误: ' + e.message, 'warning'); return
          }
          if (typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
            toast('请输入有效的 JSON 对象', 'warning'); return
          }

          try {
            const currentData = await api.getMCPConfig()
            const servers = { ...currentData?.mcp_servers, ...parsed }
            await api.updateMCPConfig(servers)
            const addedNames = Object.keys(parsed).join(', ')
            toast('已导入 ' + Object.keys(parsed).length + ' 个 MCP 服务器: ' + addedNames, 'success')
            renderInstalled(page, await api.getMCPConfig())
          } catch (e) {
            toast('导入失败: ' + e, 'error')
          }
        }
      })
    }
  }

  // 删除按钮
  contentEl.querySelectorAll('.skill-delete-btn').forEach(btn => {
    btn.onclick = async () => {
      const serverName = btn.dataset.serverName || ''
      if (!serverName) return
      const yes = await showConfirm('确定删除 MCP 服务器「' + serverName + '」？\n\n此操作将从配置中移除该服务器。')
      if (!yes) return
      try {
        btn.disabled = true
        btn.style.opacity = '0.5'
        const currentData = await api.getMCPConfig()
        const servers = currentData?.mcp_servers || {}
        delete servers[serverName]
        await api.updateMCPConfig(servers)
        toast('MCP 服务器「' + serverName + '」已删除', 'success')
        // 动画移除卡片
        const card = btn.closest('.mcp-server-card')
        if (card) {
          card.style.transition = 'all 0.3s ease'
          card.style.opacity = '0'
          card.style.transform = 'scale(0.95)'
          setTimeout(() => {
            card.remove()
            const summaryEl = contentEl.querySelector('.role-total')
            if (summaryEl) {
              const remaining = contentEl.querySelectorAll('.mcp-server-card')
              const enCount = contentEl.querySelectorAll('.mcp-toggle:checked').length
              summaryEl.textContent = remaining.length + ' 个服务器，' + enCount + ' 个启用，' + (remaining.length - enCount) + ' 个禁用'
            }
            if (contentEl.querySelectorAll('.mcp-server-card').length === 0) {
              contentEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-tertiary)">暂无 MCP 服务器配置</div>'
            }
          }, 300)
        }
      } catch (e) {
        toast('删除失败: ' + e, 'error')
        btn.disabled = false
        btn.style.opacity = ''
      }
    }
  })
}

function renderMcpCard(name, config) {
  const rawName = (name || '').trim()
  const rawDesc = (config.description || '').trim()
  const displayName = esc(rawName)
  const desc = esc(rawDesc)
  const type = esc(config.type || 'stdio')
  const command = esc(config.command || '')
  const url = esc(config.url || '')
  const mcpIcon = getMcpIcon(rawName, type)
  const isEnabled = !!config.enabled

  const metaChips = []
  metaChips.push(`类型 <code>${type}</code>`)
  if (command) metaChips.push(`命令 <code>${command}</code>`)
  if (url) metaChips.push(`URL <code>${url}</code>`)

  return `
    <article class="mcp-server-card" data-name="${displayName}" data-desc="${desc}" data-status="${isEnabled ? 'enabled' : 'disabled'}">
      <label class="skill-toggle-wrap card-toggle">
        <span class="skill-toggle-switch">
          <input type="checkbox" class="mcp-toggle" data-name="${displayName}" ${isEnabled ? 'checked' : ''}>
          <span class="skill-toggle-slider"></span>
        </span>
      </label>
      <div class="mcp-server-main">
        <div class="skill-card-head">
          <span class="skill-card-icon">${mcpIcon}</span>
          <strong class="skill-card-name">${displayName}</strong>
        </div>
        <p class="skill-card-desc">${desc || '<em style="color:var(--text-tertiary)">暂无描述</em>'}</p>
        <div class="mcp-meta-chips">
          ${metaChips.map(c => `<span class="mcp-meta-chip">${c}</span>`).join('')}
        </div>
      </div>
      <div class="skill-card-actions">
        <button class="skill-delete-btn" data-server-name="${displayName}" title="删除 MCP 服务器">${icon('trash', 12)}</button>
      </div>
    </article>
  `
}

// ========== 市场 Tab ==========
async function searchMarket(page, isAutoLoad) {
  const input = page.querySelector('#market-search-input')
  const resultsEl = page.querySelector('#market-results')

  const query = (input.value || '').trim()

  // 手动搜索时，空关键词显示提示
  if (!query && !isAutoLoad) {
    resultsEl.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--text-tertiary)">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.35;margin-bottom:12px"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        输入关键词搜索 MCP 服务器，一键添加到本地配置
      </div>`
    return
  }

  // 首次自动加载或搜索时显示 loading
  resultsEl.innerHTML = `
    <div style="padding:30px 20px;text-align:center;color:var(--text-secondary)">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <div class="loading-spinner-sm" style="border-color:var(--accent);border-top-color:transparent;width:18px;height:18px;border-radius:50%;animation:spin 0.7s linear infinite"></div>
        ${isAutoLoad ? '正在加载热门推荐...' : '正在搜索 MCP 市场...'}
      </div>
    </div>`

  try {
    // 首次加载用空字符串让接口返回热门列表，否则用用户输入的关键词
    const data = await api.mcpMarketSearch(isAutoLoad ? '' : query)

    // 处理各种可能的返回格式
    let items = []
    if (Array.isArray(data)) {
      items = data
    } else if (data && typeof data === 'object') {
      if (data.servers && Array.isArray(data.servers)) items = data.servers
      else if (data.results && Array.isArray(data.results)) items = data.results
      else if (data.data && Array.isArray(data.data)) items = data.data
      else if (data.raw) items = Array.isArray(data.raw) ? data.raw : [data.raw]
    }

    // 归一化字段：Glama 每个条目可能包含不同字段名
    items = items.map(raw => {
      if (typeof raw === 'string') return { slug: raw, name: raw, description: '' }
      const obj = raw
      return {
        slug: obj.slug || obj.name || obj.id || obj.package || '',
        name: obj.name || obj.title || obj.slug || obj.id || '',
        title: obj.title || obj.name || '',
        description: obj.description || obj.summary || obj.about || obj.short_desc || '',
        author: obj.author || '',
        url: obj.url || obj.npm_url || obj.github_url || obj.website || '',
        install_cmd: obj.install_cmd || obj.npx || obj.command || '',
        verified: !!obj.verified || false,
        stars: obj.stars || obj.downloads || 0,
      }
    }).filter(i => i.slug || i.name)

    if (items.length === 0) {
      resultsEl.innerHTML = `
        <div style="padding:40px 20px;text-align:center;color:var(--text-tertiary)">
          ${isAutoLoad ? '暂无热门推荐' : '未找到匹配的 MCP 服务器，换个关键词试试？'}
        </div>`
      return
    }

    resultsEl.innerHTML = items.map(item => renderMarketCard(item)).join('')
    bindMarketEvents(page, items)
  } catch (e) {
    const isRateLimit = String(e).includes('rate_limited')
    resultsEl.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:${isRateLimit ? 'var(--warning)' : 'var(--error)'}">
        ${isRateLimit ? '⚠️ 搜索频率超限，请稍后再试' : '搜索失败: ' + esc(String(e))}
      </div>`
  }
}

function renderMarketCard(item) {
  const marketIcon = getMarketIcon(item.slug, item.title)
  const name = esc(item.name || item.slug)
  const desc = esc(item.description || item.title || '暂无描述')
  const author = item.author ? `<span class="market-author">@${esc(item.author)}</span>` : ''
  let starsHtml = ''
  if (item.stars) {
    const level = Math.min(5, Math.floor(Math.log10(item.stars + 1)))
    starsHtml = '<span class="market-stars">' + esc('★'.repeat(level)) + '</span>'
  }

  return `
    <article class="mcp-server-card market-item" data-slug="${esc(item.slug)}" data-name="${name}">
      <div class="mcp-server-main">
        <div class="skill-card-head">
          <span class="skill-card-icon">${marketIcon}</span>
          <strong class="skill-card-name">${name}</strong>
        </div>
        <p class="skill-card-desc">${desc || '<em style="color:var(--text-tertiary)">暂无描述</em>'}</p>
        ${author ? `<div class="mcp-meta-chips"><span class="mcp-meta-chip">${author}</span></div>` : ''}
      </div>
      <div class="skill-card-actions">
        <button class="btn btn-primary btn-sm market-add-btn">添加</button>
      </div>
    </article>
  `
}

function bindMarketEvents(page, items) {
  // 搜索回车
  page.querySelector('#market-search-input').onkeydown = (e) => {
    if (e.key === 'Enter') searchMarket(page)
  }

  // 添加按钮
  page.querySelectorAll('.market-add-btn').forEach(btn => {
    btn.onclick = async () => {
      const card = btn.closest('.market-item')
      const slug = card?.dataset.slug || ''
      const name = card?.dataset.name || slug

      if (!slug) return

      btn.disabled = true
      btn.textContent = '添加中...'

      try {
        const currentData = await api.getMCPConfig()
        const servers = currentData?.mcp_servers || {}

        // 如果已存在则跳过
        if (servers[name] || servers[slug]) {
          toast('该 MCP 服务器已存在', 'warning')
          btn.disabled = false
          btn.textContent = '已存在'
          return
        }

        // 尝试从 Glama 数据推断最佳安装命令
        const item = items.find(i => i.slug === slug || i.name === name)
        const cmd = item?.install_cmd || item?.npx || ''

        let newServer = {
          enabled: true,
          description: item?.description || item?.title || '',
        }

        if (cmd) {
          // npx 格式：解析 command 和 args
          const parts = cmd.split(/\s+/)
          if (parts[0] === 'npx' && parts[1] === '-y') {
            newServer.type = 'stdio'
            newServer.command = 'npx'
            newServer.args = parts.slice(2)
          } else if (parts[0].includes('/') || cmd.startsWith('npx')) {
            newServer.type = 'stdio'
            newServer.command = parts[0]
            newServer.args = parts.slice(1)
          } else {
            newServer.type = 'stdio'
            newServer.command = cmd
            newServer.args = []
          }
        } else {
          // 无 install_cmd，创建基本 stdio 配置让用户手动填写
          newServer.type = 'stdio'
          newServer.command = 'npx'
          newServer.args = ['-y', slug.startsWith('@') ? slug : `-y @modelcontextprotocol/server-${slug}`]
        }

        servers[name] = newServer
        await api.updateMCPConfig(servers)

        toast(`MCP 服务器「${name}」已添加`, 'success')
        btn.disabled = false
        btn.textContent = '已添加'
        btn.classList.replace('btn-primary', 'btn-success')

        // 自动切到已安装 tab 并刷新
        page.querySelector('[data-main-tab="installed"]').click()
      } catch (e) {
        toast('添加失败: ' + e, 'error')
        btn.disabled = false
        btn.textContent = '重试'
      }
    }
  })
}

function bindEvents(page) {
  let marketLoaded = false

  // Tab 切换
  page.querySelectorAll('.tab-bar .tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      const tabName = tab.dataset.mainTab
      page.querySelector('#mcp-tab-installed').style.display = tabName === 'installed' ? '' : 'none'
      page.querySelector('#mcp-tab-market').style.display = tabName === 'market' ? '' : 'none'

      if (tabName === 'installed') loadTools(page)
      else if (tabName === 'market' && !marketLoaded) {
        // 首次进入市场 Tab，自动加载热门推荐
        marketLoaded = true
        const input = page.querySelector('#market-search-input')
        input.value = ''
        searchMarket(page, true) // 首次加载走推荐接口
      }
    }
  })
}
