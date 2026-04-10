/**
 * 角色管理页面
 * 角色（Agent）增删改查 + 身份编辑 + 工具/MCP/技能配置
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'

// 工具元数据缓存（从后端动态加载）
let _toolsMetadata = null

/**
 * 根据技能名称关键词匹配图标 emoji
 * 技能目录没有自带 icon 字段，所以用关键词映射
 */
const SKILL_ICON_MAP = [
  [/pdf|docx|word|document/i, '📄'],
  [/xlsx|excel|sheet|spreadsheet/i, '📊'],
  [/pptx|powerpoint|slide|presentation/i, '📽️'],
  [/image|img|photo|picture|pic|draw|paint|canvas|svg|design/i, '🎨'],
  [/video|remotion|movie|film|media/i, '🎬'],
  [/audio|sound|music|tts|voice|whisper|speech/i, '🎵'],
  [/git|github|commit|repo|code|coding|dev/i, '💻'],
  [/search|web|scrape|crawl|fetch|browse/i, '🔍'],
  [/chat|agent|bot|ai|gpt|claude|gemini|openai/i, '🤖'],
  [/mail|email|imap|smtp|outlook/i, '📧'],
  [/weather|forecast/i, '🌤️'],
  [/map|location|geo|place/i, '🗺️'],
  [/file|upload|download|drive|storage|cloud/i, '☁️'],
  [/translate|lang|i18n|locale/i, '🌐'],
  [/stock|finance|trade|money|price/i, '💰'],
  [/game|play|gaming/i, '🎮'],
  [/note|notion|obsidian|write|doc|wiki|md|markdown/i, '📝'],
  [/calendar|schedule|meeting|event|date|time/i, '📅'],
  [/security|auth|pass|key|secret|encrypt|1password/i, '🔐'],
  [/deploy|server|host|docker|vercel|infra/i, '🚀'],
  [/data|analysis|analytics|report|chart|graph/i, '📈'],
  [/skill|creator|architect|manager|lint|vetter/i, '🧩'],
  [/test|qa|quality|check|health|monitor/i, '✅'],
  [/social|weixin|wechat|weibo|twitter|xhs|redbook|douyin|bilibili|tiktok|discord|slack/i, '📱'],
  [/feishu|wecom|dingtalk|lark/i, '💼'],
  [/travel|flight|hotel|trip|ctrip/i, '✈️'],
  [/food|recipe|cook|restaurant|dine|meal/i, '🍽️'],
]

/** 默认技能图标 */
const DEFAULT_SKILL_ICON = '⚡'

function getSkillIcon(name) {
  if (!name) return DEFAULT_SKILL_ICON
  for (const [regex, icon] of SKILL_ICON_MAP) {
    if (regex.test(name)) return icon
  }
  return DEFAULT_SKILL_ICON
}

/**
 * 获取工具/MCP/技能元数据（带缓存）
 */
async function getToolsMetadata() {
  if (_toolsMetadata) return _toolsMetadata
  try {
    const data = await api.getToolsMetadata()
    _toolsMetadata = data
    console.log('[角色] 工具元数据:', data.tools?.length, '个工具,', data.mcp_servers?.length, '个MCP,', data.skills?.length, '个技能')
    return data
  } catch (e) {
    console.warn('[角色] 获取工具元数据失败，使用 fallback:', e)
    return { tools: [], mcp_servers: [], skills: [] }
  }
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page role-page'

  page.innerHTML = `
    <div class="role-header">
      <div class="role-header-left">
        <h1 class="role-title">角色管理</h1>
        <p class="role-desc">创建和管理 AI 角色配置，定义描述、模型、工具、MCP 和技能</p>
      </div>
    </div>

    <div class="role-toolbar">
      <div class="role-search-wrap">
        <svg class="role-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="role-search-input" id="roles-search" placeholder="搜索角色名称、描述或模型...">
      </div>
      <span class="role-total" id="roles-count"></span>
    </div>

    <div class="role-grid" id="roles-list"></div>
  `

  const state = { agents: [], filter: '' }
  loadRoles(page, state)

  page.querySelector('#roles-search').addEventListener('input', (e) => {
    state.filter = String(e.target.value || '').trim().toLowerCase()
    renderRoles(page, state)
  })

  return page
}

// ========== 骨架屏 ==========
function renderSkeleton(container) {
  container.innerHTML = Array.from({ length: 4 }, () => `
    <div class="role-card skeleton-card">
      <div class="role-card-top">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line w50"></div>
          <div class="skeleton-line w70"></div>
        </div>
      </div>
      <div class="role-card-tags">
        <div class="skeleton-tag"></div>
        <div class="skeleton-tag short"></div>
      </div>
      <div class="role-card-bottom">
        <div class="skeleton-btn"></div>
        <div class="skeleton-btn"></div>
        <div class="skeleton-btn"></div>
      </div>
    </div>
  `).join('')
}

// ========== 数据加载 ==========
async function loadRoles(page, state) {
  const container = page.querySelector('#roles-list')
  const countEl = page.querySelector('#roles-count')
  if (countEl) countEl.textContent = ''
  renderSkeleton(container)
  try {
    const agents = await api.listAgents()
    state.agents = agents.sort((a, b) => {
      if (a.name === 'main') return -1
      if (b.name === 'main') return 1
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    renderRoles(page, state)
    window._roleState = state  // 供详情弹窗的"编辑"按钮使用
    if (!state.eventsAttached) {
      attachRoleEvents(page, state)
      state.eventsAttached = true
    }
  } catch (e) {
    container.innerHTML = `<div class="role-empty"><span>加载失败: ${String(e)}</span></div>`
    toast('加载角色列表失败: ' + e, 'error')
  }
}

// ========== 渲染卡片列表 ==========
function renderRoles(page, state) {
  const container = page.querySelector('#roles-list')
  const countEl = page.querySelector('#roles-count')

  const list = state.agents.filter((a) => {
    if (!state.filter) return true
    const text = [
      a.name, a.description, parseModelValue(a),
      a.tool_groups?.join(','), a.tools?.join(','),
      a.mcp_servers?.join(','), a.skills?.join(','),
    ].map(v => String(v || '').toLowerCase()).join(' ')
    return text.includes(state.filter)
  })

  if (countEl) countEl.textContent = `共 ${list.length} 个角色`

  if (!list.length) {
    container.innerHTML = `<div class="role-empty">${state.filter ? '<span>没有匹配的角色</span>' : '<span>暂无角色</span>'}</div>`
    return
  }

  // 根据模型名取颜色
  const modelColorMap = {}
  let colorIdx = 0
  const MODEL_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#ef4444']

  container.innerHTML = list.map(a => {
    const isDefault = a.isDefault || a.name === 'main'
    const name = a.name || '-'
    const desc = a.description || '暂无描述'
    const modelText = parseModelValue(a) || '未设置'
    
    // 模型颜色
    if (!(modelText in modelColorMap)) modelColorMap[modelText] = MODEL_COLORS[colorIdx++ % MODEL_COLORS.length]
    const modelColor = modelColorMap[modelText]

    // 能力标签（null = 全部可用，显示"全"）
    const toolsCount = Array.isArray(a.tools) ? a.tools.length : null   // null 表示全部可用
    const mcpCount = Array.isArray(a.mcp_servers) ? a.mcp_servers.length : null
    const skillsCount = Array.isArray(a.skills) ? a.skills.length : null

    const tags = []
    if (modelText && modelText !== '未设置') tags.push({ icon: '⚡', text: modelText.split('/').pop(), color: modelColor })
    // 始终展示工具/MCP/技能数量标签
    if (toolsCount !== null) {
      tags.push({ icon: '🔧', text: `${toolsCount} 工具`, color: 'var(--tag-tool)' })
    } else {
      tags.push({ icon: '🔧', text: `全工具`, color: 'var(--tag-tool)', dim: true })
    }
    if (mcpCount !== null) {
      tags.push({ icon: '🔌', text: `${mcpCount} MCP`, color: 'var(--tag-mcp)' })
    } else {
      tags.push({ icon: '🔌', text: `全MCP`, color: 'var(--tag-mcp)', dim: true })
    }
    if (skillsCount !== null) {
      tags.push({ icon: '🎯', text: `${skillsCount} 技能`, color: 'var(--tag-skill)' })
    } else {
      tags.push({ icon: '🎯', text: `全技能`, color: 'var(--tag-skill)', dim: true })
    }

    // 头像颜色 — 基于名字 hash
    const avatarColors = ['#6366f1', '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#14b8a6']
    const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const avatarBg = avatarColors[hash % avatarColors.length]
    const initial = name.charAt(0).toUpperCase()

    return `
      <div class="role-card" data-id="${a.name}">
        <div class="role-card-top">
          <div class="role-avatar" style="background:${avatarBg}">${initial}</div>
          <div class="role-info">
            <div class="role-name-row">
              <span class="role-name">${escapeHtml(name)}</span>
              ${isDefault ? '<span class="role-badge role-badge--default">默认</span>' : ''}
            </div>
            <div class="role-model" style="color:${modelColor}">${escapeHtml(modelText)}</div>
          </div>
        </div>
        
        <p class="role-desc-text">${escapeHtml(desc)}</p>

        ${tags.length > 0 ? `<div class="role-tags">${tags.map(t =>
          `<span class="role-tag${t.dim ? ' role-tag--dim' : ''}" style="--tc:${t.color}"><span class="rt-icon">${t.icon}</span>${t.text}</span>`
        ).join('')}</div>` : ''}

        <div class="role-actions">
          <button class="role-btn" data-action="edit" data-id="${a.name}" title="编辑配置">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            编辑
          </button>
          <button class="role-btn" data-action="detail" data-id="${a.name}" title="查看详情">详情</button>
        </div>
        ${!isDefault ? `<button class="role-delete-btn" data-action="delete" data-id="${a.name}" title="删除角色">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>` : ''}
      </div>
    `
  }).join('')
}

// ========== 事件绑定 ==========
function attachRoleEvents(page, state) {
  const container = page.querySelector('#roles-list')
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id

    if (action === 'detail') await showRoleDetailDialog(id)
    else if (action === 'edit') showEditRoleDialog(page, state, id)
    else if (action === 'delete') await deleteRole(page, state, id)
  })
}

// ========== 详情弹窗（和编辑页同款 UI，只读） ==========
const DETAIL_TABS = [
  { id: 'basic', label: '基本信息', icon: '✦' },
  { id: 'tools', label: '内置工具', icon: '⚙' },
  { id: 'mcp', label: 'MCP 服务', icon: '◈' },
  { id: 'skills', label: '技能模块', icon: '✧' },
  { id: 'soul', label: '人格 SOUL', icon: '◎' },
]

async function showRoleDetailDialog(id) {
  try {
    const agent = await api.getAgent(id)

    // 获取模型列表（用于显示模型名）
    let modelLabel = parseModelValue(agent) || '未设置'
    if (!modelLabel || modelLabel === '未设置') {
      try {
        await api.readOpenclawConfig()
        // 如果 parseModelValue 没解析出来，直接用原始值
        if (agent.model && typeof agent.model === 'string') modelLabel = agent.model
      } catch (e) { /* ignore */ }
    }

    // 获取元数据用于展示工具/MCP/技能的图标和标签
    let metaTools = [], metaMcpServers = [], metaSkills = []
    try {
      // MCP 优先从 /api/mcp/config
      const mcpConfig = await api.getMCPConfig()
      if (mcpConfig?.mcp_servers) {
        for (const [name, cfg] of Object.entries(mcpConfig.mcp_servers)) {
          if (cfg.enabled !== false) metaMcpServers.push({ value: name, label: cfg.description || name, icon: '🔌' })
        }
      }
    } catch (e) { /* ignore */ }
    if (!metaMcpServers.length) {
      try {
        const meta = await getToolsMetadata()
        metaMcpServers = (meta.mcp_servers || []).filter(s => s.enabled !== false).map(s => ({ value: s.value || s.name, label: s.label || s.name, icon: s.icon || '🔌' }))
      } catch (e) { /* ignore */ }
    }
    try {
      const meta = await getToolsMetadata()
      metaTools = (meta.tools || []).map(t => ({ value: t.name, label: t.label || t.name, icon: t.icon || '', desc: t.description || '' }))
      // Skills are now SkillInfo objects (name/label/description/icon)
      if (!metaSkills.length && meta.skills?.length) {
        metaSkills = meta.skills.map(s => ({ value: s.name, label: s.label || s.name, icon: s.icon || getSkillIcon(s.name), desc: s.description || '' }))
      }
    } catch (e) { /* ignore */ }
    if (!metaSkills.length) {
      try { const sd = await api.loadSkills(); metaSkills = sd.filter(s => s.enabled !== false).map(s => ({ value: s.name, label: s.name, icon: getSkillIcon(s.name), desc: s.description || '' })) } catch (e) {}
    }

    // 解析当前选中项
    const activeTools = Array.isArray(agent.tools) ? agent.tools : (metaTools.map(t => t.value))
    const activeMcp = Array.isArray(agent.mcp_servers) ? agent.mcp_servers : (metaMcpServers.map(s => s.value))
    const activeSkills = Array.isArray(agent.skills) ? agent.skills : (metaSkills.map(s => s.value))
    const isAllTools = activeTools.length === metaTools.length && metaTools.length > 0
    const isAllMcp = activeMcp.length === metaMcpServers.length && metaMcpServers.length > 0
    const isAllSkills = activeSkills.length === metaSkills.length && metaSkills.length > 0

    // 创建 overlay
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay role-editor-overlay'

    const navHtml = DETAIL_TABS.map((tab, i) => `
      <button type="button" class="re-nav-item${i === 0 ? ' re-nav-item--active' : ''}" data-detail-tab="${tab.id}">
        <span class="re-nav-ico">${tab.icon}</span><span>${tab.label}</span>
      </button>
    `).join('')

    overlay.innerHTML = `
      <div class="role-editor-modal">
        <header class="re-header">
          <div class="re-header-left">
            <span class="re-header-dot" style="background:#10b981"></span>
            <strong>角色详情 · ${escapeHtml(id)}</strong>
          </div>
          <button type="button" class="re-close" data-action="close">&times;</button>
        </header>
        <div class="re-body">
          <nav class="re-nav">${navHtml}</nav>
          <main class="re-main">
            <div class="re-panel-head">
              <h3 id="detail-panel-title">基本信息</h3>
              <p id="detail-panel-desc">角色的基本配置信息</p>
            </div>
            <div class="re-panels">

              <!-- 基本信息 -->
              <section class="re-panel" data-panel="basic">
                <div class="detail-grid">
                  <div class="detail-field">
                    <label class="detail-label">角色标识</label>
                    <div class="detail-value"><code>${escapeHtml(agent.name || '-')}</code></div>
                  </div>
                  <div class="detail-field">
                    <label class="detail-label">描述</label>
                    <div class="detail-value">${escapeHtml(agent.description || '暂无描述')}</div>
                  </div>
                  <div class="detail-field">
                    <label class="detail-label">绑定模型</label>
                    <div class="detail-value" style="color:#6366f1;font-weight:600">${escapeHtml(modelLabel)}</div>
                  </div>
                  <div class="detail-field">
                    <label class="detail-label">类型</label>
                    <div class="detail-value">${id === 'main' ? '<span class="re-badge re-badge--default">主智能体</span>' : '<span class="re-badge">自定义角色</span>'}</div>
                  </div>
                </div>
              </section>

              <!-- 内置工具（只显示已选中的） -->
              <section class="re-panel" data-panel="tools" hidden>
                <div class="re-bar">
                  <span class="re-count">${isAllTools ? '<em style="color:#10b981">全部可用 (' + metaTools.length + ')</em>' : `<em class="re-num">${activeTools.length}</em> 个工具`}</span>
                </div>
                <div class="re-grid detail-list">
                  ${isAllTools ? metaTools.map(t => `
                    <div class="re-check" data-search="${escapeAttr((t.value + ' ' + t.label + ' ' + t.desc).toLowerCase())}">
                      <span class="re-ci-icon">${t.icon || '⚙'}</span>
                      <span class="re-ci-text"><strong>${escapeHtml(t.label)}</strong>${t.desc ? `<small>${escapeHtml(t.desc)}</small>` : ''}</span>
                      <span class="re-check-ok">✓</span>
                    </div>`).join('') : metaTools.filter(t => activeTools.includes(t.value)).map(t => `
                    <div class="re-check" data-search="${escapeAttr((t.value + ' ' + t.label + ' ' + t.desc).toLowerCase())}">
                      <span class="re-ci-icon">${t.icon || '⚙'}</span>
                      <span class="re-ci-text"><strong>${escapeHtml(t.label)}</strong>${t.desc ? `<small>${escapeHtml(t.desc)}</small>` : ''}</span>
                      <span class="re-check-ok">✓</span>
                    </div>`).join('')}
                  ${(!isAllTools && activeTools.length === 0) ? '<div class="re-empty">未配置具体工具（使用默认工具集）</div>' : ''}
                  ${metaTools.length === 0 ? '<div class="re-empty">暂无可用工具</div>' : ''}
                </div>
              </section>

              <!-- MCP 服务（只显示已选中的） -->
              <section class="re-panel" data-panel="mcp" hidden>
                <div class="re-bar">
                  <span class="re-count">${isAllMcp ? '<em style="color:#10b981">全部已连接 (' + metaMcpServers.length + ')</em>' : `<em class="re-num">${activeMcp.length}</em> 个MCP`}</span>
                </div>
                <div class="re-grid detail-list">
                  ${isAllMcp ? metaMcpServers.map(s => `
                    <div class="re-check" data-search="${escapeAttr((s.value + ' ' + s.label).toLowerCase())}">
                      <span class="re-ci-icon">${s.icon}</span>
                      <span class="re-ci-text"><strong>${escapeHtml(s.label)}</strong></span>
                      <span class="re-check-ok">✓</span>
                    </div>`).join('') : metaMcpServers.filter(s => activeMcp.includes(s.value)).map(s => `
                    <div class="re-check" data-search="${escapeAttr((s.value + ' ' + s.label).toLowerCase())}">
                      <span class="re-ci-icon">${s.icon}</span>
                      <span class="re-ci-text"><strong>${escapeHtml(s.label)}</strong></span>
                      <span class="re-check-ok">✓</span>
                    </div>`).join('')}
                  ${(!isAllMcp && activeMcp.length === 0) ? '<div class="re-empty">未配置 MCP 服务器</div>' : ''}
                  ${metaMcpServers.length === 0 ? '<div class="re-empty">暂无 MCP 服务器</div>' : ''}
                </div>
              </section>

              <!-- 技能模块（只显示已选中的） -->
              <section class="re-panel" data-panel="skills" hidden>
                <div class="re-bar">
                  <span class="re-count">${isAllSkills ? '<em style="color:#10b981">全部可用 (' + metaSkills.length + ')</em>' : `<em class="re-num">${activeSkills.length}</em> 个技能`}</span>
                </div>
                <div class="re-grid detail-list skill-card-list">
                  ${isAllSkills ? metaSkills.map(s => `
                    <div class="skill-card" data-search="${escapeAttr(s.value.toLowerCase())} ${escapeAttr((s.label||'').toLowerCase())} ${escapeAttr((s.desc||'').toLowerCase())}">
                      <div class="skill-card-head">
                        <span class="skill-card-icon">${s.icon}</span>
                        <strong class="skill-card-name">${escapeHtml(s.label)}</strong>
                      </div>
                      <p class="skill-card-desc">${s.desc ? escapeHtml(s.desc) : '<em style="color:var(--text-tertiary)">暂无描述</em>'}</p>
                    </div>`).join('') : metaSkills.filter(s => activeSkills.includes(s.value)).map(s => `
                    <div class="skill-card" data-search="${escapeAttr(s.value.toLowerCase())} ${escapeAttr((s.label||'').toLowerCase())} ${escapeAttr((s.desc||'').toLowerCase())}">
                      <div class="skill-card-head">
                        <span class="skill-card-icon">${s.icon}</span>
                        <strong class="skill-card-name">${escapeHtml(s.label)}</strong>
                      </div>
                      <p class="skill-card-desc">${s.desc ? escapeHtml(s.desc) : '<em style="color:var(--text-tertiary)">暂无描述</em>'}</p>
                    </div>`).join('')}
                  ${(!isAllSkills && activeSkills.length === 0) ? '<div class="re-empty">未配置技能</div>' : ''}
                  ${metaSkills.length === 0 ? '<div class="re-empty">暂无已安装技能</div>' : ''}
                </div>
              </section>

              <!-- SOUL 人格 -->
              <section class="re-panel" data-panel="soul" hidden>
                <div class="detail-soul-wrap">
                  <pre class="detail-soul">${escapeHtml(agent.soul || '(空 — 尚未配置人格)')}</pre>
                </div>
              </section>

            </div>
          </main>
        </div>
        <footer class="re-footer">
          <button class="btn btn-secondary" data-action="close">关闭</button>
          <button class="btn btn-primary" data-action="edit">编辑此角色</button>
        </footer>
      </div>
    `

    document.body.appendChild(overlay)

    const closeFn = () => overlay.remove()
    overlay.querySelector('[data-action=close]')?.addEventListener('click', closeFn)
    overlay.addEventListener('click', e => { if (e.target === overlay) closeFn() })

    // 编辑按钮 → 关闭详情，打开编辑器
    overlay.querySelector('[data-action=edit]')?.addEventListener('click', () => {
      closeFn()
      // 触发编辑：通过 dispatchEvent 模拟点击编辑按钮
      const page = document.querySelector('.role-page')
      if (page) showEditRoleDialog(page, window._roleState || { agents: [] }, id)
    })

    // Tab 切换
    const tabMeta = Object.fromEntries(DETAIL_TABS.map(t => [t.id, t]))
    overlay.addEventListener('click', e => {
      const tabBtn = e.target.closest('[data-detail-tab]')
      if (tabBtn) {
        const tid = tabBtn.dataset.detailTab
        overlay.querySelectorAll('.re-nav-item').forEach(b => b.classList.toggle('re-nav-item--active', b.dataset.detailTab === tid))
        overlay.querySelectorAll('.re-panel').forEach(p => p.toggleAttribute('hidden', p.dataset.panel !== tid))
        const m = tabMeta[tid]
        if (m) {
          overlay.querySelector('#detail-panel-title').textContent = m.label
          overlay.querySelector('#detail-panel-desc').textContent = _getDetailPanelDesc(tid)
        }
      }
    })

    // 搜索过滤（只影响显示，不影响数据）
    overlay.querySelectorAll('.re-search').forEach(input => {
      input.addEventListener('input', () => {
        const kw = input.value.trim().toLowerCase()
        input.closest('.re-panel').querySelectorAll('.re-check').forEach(item => {
          item.style.display = (!kw || (item.dataset.search || '').includes(kw)) ? '' : 'none'
        })
      })
    })

    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { closeFn(); document.removeEventListener('keydown', onKey) }
    })
  } catch (e) {
    toast('获取详情失败: ' + e, 'error')
  }
}

function _getDetailPanelDesc(tabId) {
  return { basic: '角色的基本配置信息', tools: '该角色可使用的内置工具列表', mcp: '该角色可连接的 MCP 服务器', skills: '该角色可调用的技能模块', soul: 'AI 角色的核心人格与行为边界' }[tabId] || ''
}

// ========== 编辑弹窗：左右分栏 ==========
const EDITOR_TABS = [
  { id: 'basic', label: '基本信息', icon: '✦' },
  { id: 'tools', label: '内置工具', icon: '⚙' },
  { id: 'mcp', label: 'MCP 服务', icon: '◈' },
  { id: 'skills', label: '技能模块', icon: '✧' },
  { id: 'soul', label: '人格 SOUL', icon: '◎' },
]

/**
 * 打开角色编辑器弹窗
 */
async function showEditRoleDialog(page, state, id) {
  const agent = state.agents.find(a => a.name === id)
  if (!agent) return

  // 获取模型列表
  let models = []
  try {
    const config = await api.readOpenclawConfig()
    for (const [pk, pv] of Object.entries(config?.models?.providers || {})) {
      for (const m of (pv.models || [])) {
        const mid = typeof m === 'string' ? m : m.id
        if (mid) models.push({ value: `${pk}/${mid}`, label: `${pk}/${mid}` })
      }
    }
  } catch (e) { /* ignore */ }

  // 从后端获取工具元数据
  let metaTools = []
  let metaMcpServers = []
  let metaSkills = []
  try {
    const meta = await getToolsMetadata()
    metaTools = (meta.tools || []).map(t => ({ value: t.name, label: t.label || t.name, icon: t.icon || '', desc: t.description || '' }))
    // Skills are now SkillInfo objects (name/label/description/icon)
    metaSkills = (meta.skills || []).map(s => ({ value: s.name, label: s.label || s.name, icon: s.icon || getSkillIcon(s.name), desc: s.description || '' }))
  } catch (e) { /* ignore */ }

  // MCP 数据：优先用 /api/mcp/config 接口（更可靠），fallback 到 metadata 接口
  try {
    const mcpConfig = await api.getMCPConfig()
    if (mcpConfig?.mcp_servers) {
      for (const [name, cfg] of Object.entries(mcpConfig.mcp_servers)) {
        if (cfg.enabled !== false) metaMcpServers.push({ value: name, label: cfg.description || name, icon: '🔌' })
      }
    }
  } catch (e) { /* fallback to metadata 中的 mcp */ }
  // 如果 mcp/config 没拿到数据，从 metadata fallback
  if (!metaMcpServers.length) {
    try {
      const meta = await getToolsMetadata()
      metaMcpServers = (meta.mcp_servers || []).filter(s => s.enabled !== false).map(s => ({ value: s.value || s.name, label: s.label || s.name, icon: s.icon || '🔌' }))
    } catch (e) { /* ignore */ }
  }

  // Skills fallback
  if (!metaSkills.length) {
    try {
      const skillsData = await api.loadSkills()
      metaSkills = skillsData.filter(s => s.enabled !== false).map(s => ({ value: s.name, label: s.name, icon: getSkillIcon(s.name), desc: s.description || '' }))
    } catch (e) { /* ignore */ }
  }

  // editState 初始化：
  //   null 表示"全部可用" → 填入完整列表（全选）
  //   有值则用实际列表
  const editState = {
    description: agent.description || '',
    model: parseModelValue(agent) || models[0]?.value || '',
    tools: (Array.isArray(agent.tools) ? agent.tools : metaTools.map(t => t.value)),
    mcp_servers: (Array.isArray(agent.mcp_servers) ? agent.mcp_servers : metaMcpServers.map(s => s.value)),
    skills: (Array.isArray(agent.skills) ? agent.skills : metaSkills.map(s => s.value)),
    soul: agent.soul || '',
  }

  // 创建 overlay
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay role-editor-overlay'

  const navHtml = EDITOR_TABS.map((tab, i) => `
    <button type="button" class="re-nav-item${i === 0 ? ' re-nav-item--active' : ''}" data-editor-tab="${tab.id}">
      <span class="re-nav-ico">${tab.icon}</span><span>${tab.label}</span>
    </button>
  `).join('')

  overlay.innerHTML = `
    <div class="role-editor-modal">
      <header class="re-header">
        <div class="re-header-left">
          <span class="re-header-dot" style="background:#6366f1"></span>
          <strong>编辑角色 · ${escapeHtml(id)}</strong>
        </div>
        <button type="button" class="re-close" data-action="close">&times;</button>
      </header>
      <div class="re-body">
        <nav class="re-nav">${navHtml}</nav>
        <main class="re-main">
          <div class="re-panel-head">
            <h3 id="editor-panel-title">基本信息</h3>
            <p id="editor-panel-desc">配置角色的名称、描述和模型</p>
          </div>
          <div class="re-panels">

            <!-- 基本信息面板 -->
            <section class="re-panel" data-panel="basic">
              <div class="form-group">
                <label class="form-label">角色标识</label>
                <input class="form-input re-field-id" value="${escapeHtml(id)}" readonly style="opacity:.55;cursor:not-allowed;font-family:var(--font-mono)">
              </div>
              <div class="form-group">
                <label class="form-label">角色描述</label>
                <input class="form-input re-field-desc" value="${escapeHtml(editState.description)}" placeholder="例如：翻译助手、代码审查助手">
              </div>
              ${models.length > 0 ? `
              <div class="form-group">
                <label class="form-label">绑定模型</label>
                <select class="form-input re-field-model">
                  ${models.map(m => `<option value="${escapeAttr(m.value)}"${m.value === editState.model ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
                </select>
              </div>` : ''}
            </section>

            <!-- 工具面板 -->
            <section class="re-panel" data-panel="tools" hidden>
              <input class="re-search" placeholder="搜索内置工具..." data-filter="tools">
              <div class="re-bar">
                <span class="re-count"><em class="re-num tools-count">${editState.tools.length}</em> / ${metaTools.length}</span>
                <div class="re-bar-btns">
                  <button class="btn btn-sm btn-secondary re-sel-all-tools">全选</button>
                  <button class="btn btn-sm btn-secondary re-clr-tools">清空</button>
                </div>
              </div>
              <div class="re-grid editor-tool-list">
                ${metaTools.map(t => {
                  const checked = editState.tools.includes(t.value) ? 'checked' : ''
                  return `<label class="re-check" data-search="${escapeAttr(t.value.toLowerCase())} ${escapeAttr(t.label.toLowerCase())} ${escapeAttr((t.desc || '').toLowerCase())}">
                    <input type="checkbox" name="tools" value="${escapeAttr(t.value)}" ${checked}>
                    <span class="re-ci-icon">${t.icon || '⚙'}</span>
                    <span class="re-ci-text">
                      <strong>${escapeHtml(t.label)}</strong>
                      ${t.desc ? `<small>${escapeHtml(t.desc)}</small>` : ''}
                    </span>
                  </label>`
                }).join('')}
                ${metaTools.length === 0 ? '<div class="re-empty">暂无可用工具</div>' : ''}
              </div>
            </section>

            <!-- MCP 面板 -->
            <section class="re-panel" data-panel="mcp" hidden>
              <input class="re-search" placeholder="搜索 MCP 服务器..." data-filter="mcp_servers">
              <div class="re-bar">
                <span class="re-count"><em class="re-num mcp-count">${editState.mcp_servers.length}</em> / ${metaMcpServers.length}</span>
                <div class="re-bar-btns">
                  <button class="btn btn-sm btn-secondary re-sel-all-mcp">全选</button>
                  <button class="btn btn-sm btn-secondary re-clr-mcp">清空</button>
                </div>
              </div>
              <div class="re-grid editor-mcp-list">
                ${metaMcpServers.map(s => {
                  const checked = editState.mcp_servers.includes(s.value) ? 'checked' : ''
                  return `<label class="re-check" data-search="${escapeAttr(s.value.toLowerCase())} ${escapeAttr(s.label.toLowerCase())}">
                    <input type="checkbox" name="mcp_servers" value="${escapeAttr(s.value)}" ${checked}>
                    <span class="re-ci-icon">${s.icon}</span>
                    <span class="re-ci-text"><strong>${escapeHtml(s.label)}</strong></span>
                  </label>`
                }).join('')}
                ${metaMcpServers.length === 0 ? '<div class="re-empty">暂无 MCP 服务器</div>' : ''}
              </div>
            </section>

            <!-- 技能面板 -->
            <section class="re-panel" data-panel="skills" hidden>
              <input class="re-search" placeholder="搜索技能..." data-filter="skills">
              <div class="re-bar">
                <span class="re-count"><em class="re-num skills-count">${editState.skills.length}</em> / ${metaSkills.length}</span>
                <div class="re-bar-btns">
                  <button class="btn btn-sm btn-secondary re-sel-all-skills">全选</button>
                  <button class="btn btn-sm btn-secondary re-clr-skills">清空</button>
                </div>
              </div>
              <div class="re-grid editor-skill-list skill-card-list">
                ${metaSkills.map(s => {
                  const checked = editState.skills.includes(s.value) ? 'checked' : ''
                  return `<label class="skill-card skill-card--editable" data-search="${escapeAttr(s.value.toLowerCase())} ${escapeAttr((s.label||'').toLowerCase())} ${escapeAttr((s.desc||'').toLowerCase())}">
                    <input type="checkbox" name="skills" value="${escapeAttr(s.value)}" ${checked}>
                    <div class="skill-card-head">
                      <span class="skill-card-icon">${s.icon}</span>
                      <strong class="skill-card-name">${escapeHtml(s.label)}</strong>
                    </div>
                    <p class="skill-card-desc">${s.desc ? escapeHtml(s.desc) : '<em style=\"color:var(--text-tertiary)\">暂无描述</em>'}</p>
                  </label>`
                }).join('')}
                ${metaSkills.length === 0 ? '<div class="re-empty">暂无已安装技能</div>' : ''}
              </div>
            </section>

            <!-- SOUL 面板 -->
            <section class="re-panel" data-panel="soul" hidden>
              <div class="form-group" style="margin-bottom:0">
                <textarea class="form-input re-field-soul" placeholder="定义角色的个性、行为约束、输出风格等。&#10;&#10;示例：&#10;- 你是一个专业的翻译助手&#10;- 翻译要准确且自然流畅&#10;- 不确定时主动询问用户" rows="16" style="font-family:var(--font-mono);font-size:13px;line-height:1.75;resize:vertical;border-radius:var(--radius-lg);border-color:var(--border-primary)">${escapeHtml(editState.soul)}</textarea>
                <div class="form-hint">SOUL 定义了 AI 角色的核心人格与行为边界</div>
              </div>
            </section>

          </div>
        </main>
      </div>
      <footer class="re-footer">
        <button class="btn btn-secondary" data-action="cancel">取消</button>
        <button class="btn btn-primary" data-action="save">保存更改</button>
      </footer>
    </div>
  `

  document.body.appendChild(overlay)

  // ---- 事件 ----
  const closeFn = () => overlay.remove()
  overlay.querySelector('[data-action=close]')?.addEventListener('click', closeFn)
  overlay.querySelector('[data-action=cancel]')?.addEventListener('click', closeFn)
  overlay.addEventListener('click', e => { if (e.target === overlay) closeFn() })

  // Tab 切换
  const tabMeta = Object.fromEntries(EDITOR_TABS.map(t => [t.id, t]))
  overlay.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-editor-tab]')
    if (tabBtn) {
      const tid = tabBtn.dataset.editorTab
      overlay.querySelectorAll('.re-nav-item').forEach(b => b.classList.toggle('re-nav-item--active', b.dataset.editorTab === tid))
      overlay.querySelectorAll('.re-panel').forEach(p => p.toggleAttribute('hidden', p.dataset.panel !== tid))
      const meta = tabMeta[tid]
      if (meta) {
        overlay.querySelector('#editor-panel-title').textContent = meta.label
        overlay.querySelector('#editor-panel-desc').textContent = _getPanelDesc(tid)
      }
    }
  })

  // 搜索过滤
  overlay.querySelectorAll('.re-search').forEach(input => {
    input.addEventListener('input', () => {
      const kw = input.value.trim().toLowerCase()
      input.closest('.re-panel').querySelectorAll('.re-check').forEach(item => {
        item.style.display = (!kw || (item.dataset.search || '').includes(kw)) ? '' : 'none'
      })
    })
  })

  // 全选 / 清空
  const bindSelClr = (selCls, clrCls, listName, fieldName) => {
    overlay.querySelector(selCls)?.addEventListener('click', () => {
      overlay.querySelectorAll(`.${listName} input`).forEach(cb => cb.checked = true)
      updateCount(overlay, fieldName)
    })
    overlay.querySelector(clrCls)?.addEventListener('click', () => {
      overlay.querySelectorAll(`.${listName} input`).forEach(cb => cb.checked = false)
      updateCount(overlay, fieldName)
    })
  }
  bindSelClr('.re-sel-all-tools', '.re-clr-tools', 'editor-tool-list', 'tools')
  bindSelClr('.re-sel-all-mcp', '.re-clr-mcp', 'editor-mcp-list', 'mcp_servers')
  bindSelClr('.re-sel-all-skills', '.re-clr-skills', 'editor-skill-list', 'skills')

  // checkbox 计数更新
  overlay.querySelectorAll('.editor-tool-list input').forEach(cb => cb.addEventListener('change', () => updateCount(overlay, 'tools')))
  overlay.querySelectorAll('.editor-mcp-list input').forEach(cb => cb.addEventListener('change', () => updateCount(overlay, 'mcp_servers')))
  overlay.querySelectorAll('.editor-skill-list input').forEach(cb => cb.addEventListener('change', () => updateCount(overlay, 'skills')))

  // 保存
  overlay.querySelector('[data-action=save]')?.addEventListener('click', async () => {
    const description = overlay.querySelector('.re-field-desc').value.trim()
    const model = overlay.querySelector('.re-field-model')?.value?.trim() || ''
    const soul = overlay.querySelector('.re-field-soul')?.value?.trim() || ''
    const tools = [...overlay.querySelectorAll('.editor-tool-list input:checked')].map(el => el.value)
    const mcp_servers = [...overlay.querySelectorAll('.editor-mcp-list input:checked')].map(el => el.value)
    const skills = [...overlay.querySelectorAll('.editor-skill-list input:checked')].map(el => el.value)

    try {
      // 保存逻辑：全选时存 null（= 全部可用），部分选/空则存实际数组
      const isAllTools = tools.length === metaTools.length && tools.every((v,i) => v === metaTools[i]?.value)
      const isAllMcp = mcp_servers.length === metaMcpServers.length && mcp_servers.every((v,i) => v === metaMcpServers[i]?.value)
      const isAllSkills = skills.length === metaSkills.length && skills.every((v,i) => v === metaSkills[i]?.value)

      await api.updateAgent(id, {
        description,
        model: model || null,
        // 全选存 null（= 未限制），部分选/空选存实际数组（[] 表示显式清空）
        tools: isAllTools ? null : tools,
        mcp_servers: isAllMcp ? null : mcp_servers,
        skills: isAllSkills ? null : skills,
        soul: soul || null
      })
      agent.description = description
      if (model) agent.model = model
      agent.tools = tools; agent.mcp_servers = mcp_servers; agent.skills = skills; agent.soul = soul
      renderRoles(page, state)
      closeFn()
      toast(`角色「${id}」已更新`, 'success')
    } catch (e) {
      console.error('[角色编辑] 保存失败:', e)
      toast('保存失败: ' + e, 'error')
    }
  })

  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { closeFn(); document.removeEventListener('keydown', onKey) }
  })
}

function _getPanelDesc(tabId) {
  return { basic: '配置角色的名称、描述和绑定模型', tools: '选择该角色可使用的内置工具', mcp: '选择该角色可连接的 MCP 服务器', skills: '选择该角色可调用的技能模块', soul: '定义角色的个性、行为约束与输出风格' }[tabId] || ''
}

function updateCount(overlay, fieldName) {
  const map = { tools: 'tool', mcp_servers: 'mcp', skills: 'skill' }
  const cls = map[fieldName] || fieldName
  const el = overlay.querySelector(`.${fieldName}-count .re-num`)
  if (el) el.textContent = overlay.querySelectorAll(`.editor-${cls}list input:checked`).length
}

// ========== 删除 ==========
async function deleteRole(page, state, id) {
  const yes = await showConfirm(`确定删除角色「${id}」？\n\n此操作将永久删除该角色的所有数据和会话记录。`)
  if (!yes) return
  try {
    await api.deleteAgent(id)
    toast('已删除', 'success')
    await loadRoles(page, state)
  } catch (e) {
    toast('删除失败: ' + e, 'error')
  }
}

// ========== 工具函数 ==========
function parseModelValue(agent) {
  const model = agent?.model
  if (!model) return ''
  if (typeof model === 'string') return model
  if (typeof model === 'object') return model.primary || model.id || ''
  return ''
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function escapeAttr(value) {
  return String(value || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
