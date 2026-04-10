/**
 * Skills 页面
 * 基于 openclaw skills CLI，按状态分组展示所有 Skills
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm, showModal } from '../components/modal.js'
import { icon } from '../lib/icons.js'

let _loadSeq = 0

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')
}

/**
 * 根据技能名称关键词匹配图标 emoji（按优先级排列）
 */
const SKILL_ICON_MAP = [
  // --- AI / Agent ---
  [/agent|openai|gpt|chatgpt|claude|gemini|copilot|llm|ai-assist/i, '🤖'],
  [/self.improv|autonomous|proactive|reasoning|thinking|chain-of-thought/i, '🧠'],
  [/memory|knowledge|rag|retriev|embedd|vector|context/i, '🧠'],

  // --- 开发 / Git / 代码 ---
  [/github|gitlab|bitbucket|pr|pull.request|commit|issue|code.review/i, '🐙'],
  [/browser|playwright|puppeteer|selenium|crawl|scraper|web.automation/i, '🌐'],
  [/docker|kubernetes|k8s|container|deploy|ci.cd|vercel|railway|infra/i, '🐳'],
  [/code|program|develop|sdk|api|rest|graphql|integrat/i, '💻'],
  [/debug|test|lint|format|quality|vet|audit|check|spec/i, '🧪'],

  // --- 文件 / 文档 ---
  [/filesystem|file.manager|local.file|folder|directory/i, '📁'],
  [/pdf|document|docx|word|office|read.pdf/i, '📄'],
  [/excel|spreadsheet|sheet|csv|xlsx/i, '📊'],
  [/pptx|slide|presentation|powerpoint/i, '📽️'],
  [/notion|obsidian|wiki|markdown|note|write|doc/i, '📝'],

  // --- 图像 / 视频 / 音频 ---
  [/image.gen|dall.e|midjourney|stable.diffus|flux|photo|picture|img.gen/i, '🎨'],
  [/video.gen|remotion|movie|film|anim|ffmpeg/i, '🎬'],
  [/audio|music|tts|voice|whisper|speech.to.text|text.to.speech|sound/i, '🎵'],
  [/edit.image|photo.edit|canvas|draw|design|svg|manipulat/i, '✏️'],

  // --- 搜索 / 研究 / 数据 ---
  [/brave.search|google.search|web.search|searxng|serper|search/i, '🔍'],
  [/deep.research|research|investig|analys|report|summariz/i, '🔬'],
  [/fetch|web.fetch|http|url|request|scrape/i, '🌐'],
  [/data|analytics|chart|graph|dashboard|metric|stat/i, '📈'],
  [/json|yaml|config|parse|transform|structur/i, '📋'],

  // --- 数据库 / 存储 ---
  [/postgres|mysql|sqlite|supabase|mongodb|redis|database|db/i, '🗄️'],
  [/aws|azure|gcp|cloudflare|cloud|storage|s3|bucket/i, '☁️'],

  // --- 通信 / 社交 ---
  [/slack|discord|telegram|team|message|chat|im/i, '💬'],
  [/email|mail|imap|smtp|outlook|gmail/i, '📧'],
  [/feishu|lark|wecom|dingtalk|enterprise/i, '💼'],
  [/twitter|social|weibo|wechat|bilibili|tiktok|douyin|redbook/i, '📱'],
  [/calendar|schedule|meeting|event|outlook.calendar|goog.cal/i, '📅'],

  // --- 金融 / 市场 / 商业 ---
  [/stock|trading|finance|market|price|coin|crypto|polymarket/i, '📈'],
  [/stripe|payment|invoice|billing|receipt/i, '💳'],
  [/ad|marketing|seo|rank|traffic|admapix/i, '📢'],

  // --- 知识图谱 / 本体 / 结构化数据 ---
  [/ontology|knowledge.graph|schema|entity|relation|linked/i, '🔗'],

  // --- 安全 / 加密 ---
  [/security|auth|encrypt|pass|key|secret|vault|1pass|ssh/i, '🔐'],

  // --- 工具 / 系统 / 效率 ---
  [/time|date|clock|cron|scheduler|timer/i, '⏰'],
  [/weather|forecast|climate/i, '🌤️'],
  [/map|location|geo|gps|place/i, '🗺️'],
  [/translate|i18n|locale|lang|translat/i, '🌍'],
  [/ssh|terminal|shell|exec|command|process|sysadmin/i, '⚙️'],
  [/everything|search.local|file.search|locate/i, '🔎'],
  [/sequential.thinking|step.by.step|logic|reason/i, '🧮'],
  [/podcast|audio.gen|voice.gen/i, '🎙️'],
]

const DEFAULT_SKILL_ICON = '⚡'

function getSkillIcon(name) {
  if (!name) return DEFAULT_SKILL_ICON
  for (const [regex, icon] of SKILL_ICON_MAP) {
    if (regex.test(name)) return icon
  }
  return DEFAULT_SKILL_ICON
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <h1 class="page-title">Skills</h1>
        <p class="page-desc">管理已安装的 Skills（安装后默认启用），或从社区搜索安装新技能</p>
      </div>
      <button id="btn-import-skill" style="flex-shrink:0;margin-top:4px">${icon('plus', 14)} 导入本地技能</button>
    </div>

    <div class="tab-bar" id="skills-main-tabs">
      <div class="tab active" data-main-tab="installed">已安装</div>
      <div class="tab" data-main-tab="store">搜索安装</div>
    </div>

    <div id="skills-tab-installed" class="config-section">
      <div class="stat-card loading-placeholder" style="height:96px"></div>
    </div>

    <div id="skills-tab-store" class="config-section" style="display:none">
      <div class="clawhub-toolbar" style="margin-bottom:var(--space-sm);display:flex;gap:var(--space-xs);align-items:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="form-input" id="skill-install-search" placeholder="搜索技能，如 weather / github / tavily..." type="text" style="flex:1">
      </div>
      <div id="install-source-results" style="max-height:calc(100vh - 280px);overflow-y:auto">
        <div style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary)">正在加载技能市场...</div>
      </div>
    </div>
  `

  bindEvents(page)
  loadSkills(page)
  return page
}

async function loadSkills(page) {
  const el = page.querySelector('#skills-tab-installed')
  if (!el) return
  const seq = ++_loadSeq

  el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-tertiary)">正在加载 Skills...</div>`

  try {
    const data = await api.loadSkills()
    if (seq !== _loadSeq) return
    renderSkills(page, el, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    el.innerHTML = `<div style="padding:20px">
      <div style="color:var(--error);margin-bottom:8px">加载失败: ${esc(e?.message || e)}</div>
      <button class="btn btn-secondary btn-sm" id="btn-skill-retry">重试</button>
    </div>`
    el.querySelector('#btn-skill-retry').onclick = () => loadSkills(page)
  }
}

function renderSkills(page, el, data) {
  const skills = Array.isArray(data) ? data : (data?.skills || [])
  const eligibleCount = skills.filter(s => s.enabled !== false).length
  const disabledCount = skills.filter(s => s.enabled === false).length

  const summary = `${eligibleCount} 可用 / ${disabledCount} 已禁用`

  let html = `
    <div class="role-toolbar" style="margin-bottom:var(--space-sm);padding:0 0 18px">
      <div class="role-search-wrap" style="width:auto;flex:1;max-width:400px;min-width:200px">
        <svg class="role-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="role-search-input" id="skill-filter-input" placeholder="过滤 Skills...">
      </div>
      <div class="filter-dropdown" id="skill-status-dd">
        <button class="filter-dropdown-btn" type="button">
          <span class="filter-dropdown-label" id="skill-status-label">全部</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="filter-dropdown-menu">
          <div class="filter-dropdown-item active" data-value="all">全部</div>
          <div class="filter-dropdown-item" data-value="enabled">已启用</div>
          <div class="filter-dropdown-item" data-value="disabled">已禁用</div>
        </div>
      </div>
      <span class="role-total">${summary}</span>
    </div>

    <div class="skills-list-grid">
      ${skills.map(s => renderSkillCard(s)).join('')}
    </div>
  `

  el.innerHTML = html

  // 自定义下拉
  const dd = el.querySelector('#skill-status-dd')
  const label = el.querySelector('#skill-status-label')
  let currentStatus = 'all'

  // 打开/关闭
  dd.querySelector('.filter-dropdown-btn').addEventListener('click', (e) => {
    e.stopPropagation()
    document.querySelectorAll('.filter-dropdown.open').forEach(d => { if (d !== dd) d.classList.remove('open') })
    dd.classList.toggle('open')
  })

  // 选项点击
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

  // 点击外部关闭
  document.addEventListener('click', function closeDd(e) {
    if (!e.target.closest('.filter-dropdown')) {
      dd.classList.remove('open')
    }
  })

  // 联合过滤：文本搜索 + 状态下拉
  const applyFilter = () => {
    const q = (el.querySelector('#skill-filter-input').value || '').toLowerCase()
    el.querySelectorAll('.skill-card').forEach(card => {
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

  el.querySelector('#skill-filter-input').oninput = applyFilter

  // 导入本地技能按钮
  const importBtn = page.querySelector('#btn-import-skill')
  if (importBtn) {
    importBtn.onclick = () => {
      showModal({
        title: '导入本地技能',
        fields: [
          {
            name: 'name',
            label: '技能名称',
            placeholder: '例如 my-custom-skill',
            hint: '用于标识该技能的唯一名称（英文，无空格）'
          },
          {
            name: 'path',
            label: '技能路径',
            placeholder: '/path/to/skill 或 https://github.com/...',
            hint: '本地目录路径、Git 仓库地址或 npm 包名'
          },
          {
            name: 'enabled',
            type: 'checkbox',
            label: '导入后立即启用',
            value: true
          }
        ],
        onConfirm: async (vals) => {
          if (!vals.name || !vals.path) {
            toast('请填写技能名称和路径', 'warning')
            return
          }
          try {
            await api.installSkill({ name: vals.name.trim(), path: vals.path.trim(), enabled: !!vals.enabled })
            toast('技能「' + vals.name + '」导入成功', 'success')
            loadSkills(page)
          } catch (e) {
            toast('导入失败: ' + e, 'error')
          }
        }
      })
    }
  }

  // 绑定技能卡片事件
  el.querySelectorAll('.skill-card').forEach(card => {
    const name = card.dataset.name

    // 启用/禁用开关 — 就地更新，不刷新整个列表
    const toggle = card.querySelector('.skill-toggle')
    if (toggle) {
      toggle.onchange = async () => {
        try {
          await api.enableSkill(name, toggle.checked)
          toast(`技能 ${name} 已${toggle.checked ? '启用' : '禁用'}`, 'success')
          // 就地更新：切换卡片状态样式 + 摘要数字
          card.dataset.status = toggle.checked ? 'enabled' : 'disabled'
          // 同步更新摘要统计（避免全量重渲染）
          const summaryEl = el.querySelector('.role-total')
          if (summaryEl) {
            const totalCards = el.querySelectorAll('.skill-card').length
            const enabledCount = el.querySelectorAll('.skill-toggle:checked').length
            const disabledCount = totalCards - enabledCount
            summaryEl.textContent = `${enabledCount} 可用 / ${disabledCount} 已禁用`
          }
          // 如果当前筛选状态与卡片新状态冲突，自动隐藏该卡片
          if (currentStatus === 'enabled' && !toggle.checked) card.style.display = 'none'
          else if (currentStatus === 'disabled' && toggle.checked) card.style.display = 'none'
          else card.style.display = ''
        } catch (e) {
          toggle.checked = !toggle.checked
          toast('操作失败: ' + e, 'error')
        }
      }
    }

    // 删除按钮 — showConfirm 确认后调用 uninstall API
    const delBtn = card.querySelector('.skill-delete-btn')
    if (delBtn) {
      delBtn.onclick = async () => {
        const skillName = delBtn.dataset.skillName || name
        const yes = await showConfirm('确定删除技能「' + skillName + '」？\n\n此操作将永久删除该技能文件，且不可恢复。')
        if (!yes) return
        try {
          delBtn.disabled = true
          delBtn.style.opacity = '0.5'
          await api.skillsUninstall({ name: skillName })
          toast('技能「' + skillName + '」已删除', 'success')
          // 动画移除卡片
          card.style.transition = 'all 0.3s ease'
          card.style.opacity = '0'
          card.style.transform = 'scale(0.95)'
          setTimeout(() => {
            card.remove()
            // 更新摘要
            const summaryEl = el.querySelector('.role-total')
            if (summaryEl) {
              const totalCards = el.querySelectorAll('.skill-card').length
              const enabledCount = el.querySelectorAll('.skill-toggle:checked').length
              summaryEl.textContent = enabledCount + ' 可用 / ' + (totalCards - enabledCount) + ' 已禁用'
            }
          }, 300)
        } catch (e) {
          toast('删除失败: ' + e, 'error')
          delBtn.disabled = false
          delBtn.style.opacity = ''
        }
      }
    }
  })
}

function renderSkillCard(skill) {
  const rawName = (skill.name || '').trim().replace(/^["']|["']$/g, '')
  const rawDesc = (skill.description || skill.desc || '').trim().replace(/^["']|["']$/g, '')
  const name = esc(rawName)
  const desc = esc(rawDesc)
  const category = esc(skill.category || '')
  const skillIcon = getSkillIcon(skill.name)

  const isEnabled = skill.enabled !== false
  const actions = `
    <label class="skill-toggle-wrap card-toggle">
      <span class="skill-toggle-switch">
        <input type="checkbox" class="skill-toggle" ${isEnabled ? 'checked' : ''} data-name="${name}">
        <span class="skill-toggle-slider"></span>
      </span>
    </label>
  `

  return `
    <div class="skill-card" data-name="${name}" data-desc="${desc}" data-status="${isEnabled ? 'enabled' : 'disabled'}">
      ${actions}
      <div class="skill-card-main">
        <div class="skill-card-head">
          <span class="skill-card-icon">${skillIcon}</span>
          <strong class="skill-card-name">${name}</strong>
        </div>
        <p class="skill-card-desc">${desc || '<em style="color:var(--text-tertiary)">暂无描述</em>'}</p>
      </div>
      ${category ? `<span class="skill-card-category">分类: ${category}</span>` : ''}
      <div class="skill-card-actions">
        <button class="skill-delete-btn" data-skill-name="${name}" title="删除技能">${icon('trash', 12)}</button>
      </div>
    </div>
  `
}

function bindEvents(page) {
  // Tab 切换
  page.querySelectorAll('.tab-bar .tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('.tab-bar .tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      const tabName = tab.dataset.mainTab
      page.querySelector('#skills-tab-installed').style.display = tabName === 'installed' ? '' : 'none'
      page.querySelector('#skills-tab-store').style.display = tabName === 'store' ? '' : 'none'

      // 首次切到商店 tab 时自动加载热门技能
      if (tabName === 'store' && !page._storeLoaded) {
        page._storeLoaded = true
        doSearchInstall(page)
      }
    }
  })

  // 回车搜索 / 实时输入过滤
  const searchInput = page.querySelector('#skill-install-search')
  let debounceTimer = null
  searchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearchInstall(page) }
  searchInput.oninput = () => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => doSearchInstall(page), 400)
  }
}

/** 加载/搜索 ClawHub 技能市场（空关键词=热门列表，有关键词=过滤）
 *  已按下载量降序排列（后端 sort=downloads dir=desc）
 */
let _installedSlugs = new Set()  // 缓存已安装的 slug 集合
let _storeCursor = null         // 分页游标
let _storeHasMore = false       // 是否还有更多
let _isLoadingMore = false      // 是否正在加载更多（防重复触发）
let _storeObserver = null       // IntersectionObserver 实例

async function doSearchInstall(page, append = false) {
  const query = (page.querySelector('#skill-install-search').value || '').trim()
  const resultsEl = page.querySelector('#install-source-results')

  if (!append) {
    // 全新搜索：重置分页状态
    _storeCursor = null
    _storeHasMore = false
    if (_storeObserver) { _storeObserver.disconnect(); _storeObserver = null }
    resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-tertiary)">正在加载热门技能（按下载量排序）...</div>`
  }

  try {
    const result = await api.skillsSkillHubSearch(query, _storeCursor)

    const items = Array.isArray(result) ? result : (result?.skills || [])
    const hasMore = result?.hasMore || false
    _storeCursor = result?.cursor || null
    _storeHasMore = hasMore

    // 同步已安装状态
    try {
      const localData = await api.loadSkills()
      const localSkills = Array.isArray(localData) ? localData : (localData?.skills || [])
      _installedSlugs = new Set(localSkills.map(s => (s.name || s.slug || '').toLowerCase()))
    } catch (_) { /* 保持上一次缓存 */ }

    if (!items || items.length === 0 && !append) {
      resultsEl.innerHTML = `<div class="skills-list-grid" style="padding:var(--space-xl);justify-items:center"><div style="color:var(--text-tertiary);grid-column:-1/1;text-align:center">
        ${query ? `未找到「${esc(query)}」相关技能，试试其他关键词` : '暂无可用技能'}
      </div></div>`
      return
    }

    // 渲染商店网格卡片（与已安装 tab 的 .skill-card 风格一致）
    console.log('[store] 原始数据样例:', items[0])
    const cardsHtml = items.map(item => renderStoreCard(item)).join('')

    if (append) {
      // 追加模式：移除旧的哨兵元素，追加新卡片
      const oldSentinel = resultsEl.querySelector('.store-scroll-sentinel')
      if (oldSentinel) oldSentinel.remove()
      const grid = resultsEl.querySelector('.skills-list-grid')
      if (grid) {
        grid.insertAdjacentHTML('beforeend', cardsHtml)
      }
    } else {
      // 首次渲染：完整替换
      resultsEl.innerHTML = `<div class="skills-list-grid">${cardsHtml}</div>`
    }

    // 安装事件绑定
    bindStoreInstallEvents(resultsEl, page)

    // 如果还有更多数据，添加滚动哨兵 + 启动无限滚动观察器
    if (_storeHasMore) {
      const grid = resultsEl.querySelector('.skills-list-grid') || resultsEl
      grid.insertAdjacentHTML('beforeend', '<div class="store-scroll-sentinel" style="height:1px"></div>')
      setupScrollObserver(resultsEl, page)
    }

  } catch (e) {
    if (!append) {
      resultsEl.innerHTML = `<div style="padding:20px;color:var(--error)">加载失败: ${esc(String(e))}</div>`
    }
  }
}

/** 渲染单个商店卡片（与已安装 .skill-card 风格对齐：网格布局、圆角边框、hover 效果） */
function renderStoreCard(item) {
  // 兼容多种后端字段格式
  const slug = String(item.slug || item.id || '')
  const name = esc(item.name || item.displayName || item.title || item.slug || item.id || '未命名')
  const desc = esc(item.description || item.summary || item.desc || '暂无描述')
  // downloads/stars 可能是数字或字符串
  const downloads = item.downloads ?? item.downloadCount
  const stars = item.stars ?? item.starCount ?? item.rating
  const storeIcon = getSkillIcon(item.name || item.displayName || item.slug || item.id)
  const isInstalled = _installedSlugs.has(slug.toLowerCase())

  return `
    <div class="skill-card" data-slug="${esc(slug)}">
      <div class="skill-card-main">
        <div class="skill-card-head">
          <span class="skill-card-icon">${storeIcon}</span>
          <strong class="skill-card-name">${name}</strong>
        </div>
        <p class="skill-card-desc">${desc || '<em style="color:var(--text-tertiary)">暂无描述</em>'}</p>
        ${downloads || stars ? `<div class="store-skill-meta-row">
          ${downloads ? `<span title="下载量" style="color:var(--accent,#3b82f6);font-weight:600;font-size:11.5px">⬇ ${Number(downloads).toLocaleString()}</span>` : ''}
          ${stars ? `<span title="Stars" style="color:#f59e0b;font-size:11.5px">⭐ ${Number(stars).toLocaleString()}</span>` : ''}
        </div>` : ''}
      </div>
      <div class="skill-card-actions">
        ${isInstalled
          ? `<span class="install-badge-installed">已安装 ✓</span>`
          : `<button class="btn btn-sm btn-primary install-btn" data-slug="${esc(slug)}">安装</button>`
        }
      </div>
    </div>`
}

/** 绑定商店卡片的安装按钮事件 */
function bindStoreInstallEvents(container, page) {
  container.querySelectorAll('.install-btn').forEach(btn => {
    btn.onclick = async () => {
      const slug = btn.dataset.slug
      btn.disabled = true
      btn.textContent = '安装中...'
      try {
        await api.skillsSkillHubInstall(slug)
        _installedSlugs.add(slug.toLowerCase())
        toast(`技能「${slug}」已安装！默认为启用状态`, 'success')
        // 更新当前卡片 UI
        const card = btn.closest('.skill-card')
        if (card) {
          const actionsEl = card.querySelector('.skill-card-actions')
          if (actionsEl) actionsEl.innerHTML = `<span class="install-badge-installed">已安装 ✓</span>`
        }
        // 不再全量刷新已安装 tab，避免页面闪烁
      } catch (e) {
        toast('安装失败: ' + e, 'error')
        btn.disabled = false
        btn.textContent = '安装'
      }
    }
  })
}

/** 设置 IntersectionObserver 实现滚动到底部自动加载 */
function setupScrollObserver(resultsEl, page) {
  if (_storeObserver) _storeObserver.disconnect()

  const sentinel = resultsEl.querySelector('.store-scroll-sentinel')
  if (!sentinel) return

  _storeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && _storeHasMore && !_isLoadingMore) {
        _isLoadingMore = true
        doSearchInstall(page, true).finally(() => { _isLoadingMore = false })
      }
    })
  }, { root: resultsEl, rootMargin: '120px', threshold: 0 })

  _storeObserver.observe(sentinel)
}
