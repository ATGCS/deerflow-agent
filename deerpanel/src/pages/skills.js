/**
 * Skills 页面
 * 基于 openclaw skills CLI，按状态分组展示所有 Skills
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'

let _loadSeq = 0

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Skills</h1>
      <p class="page-desc">管理已安装的 Skills，或从社区搜索安装新技能</p>
    </div>

    <div class="tab-bar" id="skills-main-tabs">
      <div class="tab active" data-main-tab="installed">已安装</div>
      <div class="tab" data-main-tab="store">搜索安装</div>
    </div>

    <div id="skills-tab-installed" class="config-section">
      <div class="stat-card loading-placeholder" style="height:96px"></div>
    </div>

    <div id="skills-tab-store" class="config-section" style="display:none">
      <div class="clawhub-toolbar" style="margin-bottom:var(--space-sm)">
        <select class="form-input" id="install-source-select" style="width:auto;min-width:160px">
          <option value="skillhub">SkillHub（国内加速）</option>
          <option value="clawhub">ClawHub（原版海外）</option>
        </select>
        <input class="form-input" id="skill-install-search" placeholder="搜索技能，如 weather / github / tavily" type="text" style="flex:1">
        <button class="btn btn-primary btn-sm" id="btn-source-search">搜索</button>
        <button class="btn btn-secondary btn-sm" id="btn-skillhub-setup" style="display:none">安装 CLI</button>
        <a class="btn btn-secondary btn-sm" id="btn-browse-source" href="https://skillhub.tencent.com" target="_blank" rel="noopener">浏览</a>
      </div>
      <div class="form-hint" id="store-hint" style="margin-bottom:var(--space-sm);display:flex;align-items:center;gap:var(--space-xs)">
        <span id="skillhub-status"></span>
      </div>
      <div id="install-source-results" style="max-height:calc(100vh - 320px);overflow-y:auto">
        <div style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary)">输入关键词搜索社区 Skills，然后一键安装</div>
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
    renderSkills(el, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    el.innerHTML = `<div style="padding:20px">
      <div style="color:var(--error);margin-bottom:8px">加载失败: ${esc(e?.message || e)}</div>
      <button class="btn btn-secondary btn-sm" id="btn-skill-retry">重试</button>
    </div>`
    el.querySelector('#btn-skill-retry').onclick = () => loadSkills(page)
  }
}

function renderSkills(el, data) {
  const skills = Array.isArray(data) ? data : (data?.skills || [])
  const eligible = skills.filter(s => s.enabled !== false)
  const disabled = skills.filter(s => s.enabled === false)

  const summary = `${eligible.length} 可用 / ${disabled.length} 已禁用`

  let html = `
    <div class="clawhub-toolbar" style="margin-bottom:var(--space-sm)">
      <input class="form-input" id="skill-filter-input" placeholder="过滤 Skills..." type="text" style="max-width:300px">
      <button class="btn btn-secondary btn-sm" id="btn-skill-refresh">刷新</button>
    </div>

    <div style="margin-bottom:var(--space-lg);color:var(--text-secondary);font-size:var(--font-size-sm)">
      共 ${skills.length} 个 Skills: ${summary}
    </div>
  `

  if (eligible.length) {
    html += `
    <div style="margin-bottom:var(--space-lg)">
      <div style="color:var(--success);font-weight:500;margin-bottom:var(--space-sm)">✓ 可用 (${eligible.length})</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
        ${eligible.map(s => renderSkillCard(s, 'eligible')).join('')}
      </div>
    </div>`
  }

  if (disabled.length) {
    html += `
    <div style="margin-bottom:var(--space-lg)">
      <div style="color:var(--text-tertiary);font-weight:500;margin-bottom:var(--space-sm)">⏸ 已禁用 (${disabled.length})</div>
      <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
        ${disabled.map(s => renderSkillCard(s, 'disabled')).join('')}
      </div>
    </div>`
  }

  el.innerHTML = html

  // 绑定刷新事件
  el.querySelector('#btn-skill-refresh').onclick = () => loadSkills(page)

  // 绑定过滤事件
  el.querySelector('#skill-filter-input').oninput = (e) => {
    const q = e.target.value.toLowerCase()
    el.querySelectorAll('.skill-card').forEach(card => {
      const name = card.dataset.name?.toLowerCase() || ''
      const desc = card.dataset.desc?.toLowerCase() || ''
      card.style.display = (name.includes(q) || desc.includes(q)) ? '' : 'none'
    })
  }

  // 绑定技能卡片事件
  el.querySelectorAll('.skill-card').forEach(card => {
    const name = card.dataset.name
    const status = card.dataset.status

    // 启用/禁用开关
    const toggle = card.querySelector('.skill-toggle')
    if (toggle) {
      toggle.onchange = async () => {
        try {
          await api.enableSkill(name, toggle.checked)
          toast(`技能 ${name} 已${toggle.checked ? '启用' : '禁用'}`, 'success')
          loadSkills(page)
        } catch (e) {
          toggle.checked = !toggle.checked
          toast('操作失败: ' + e, 'error')
        }
      }
    }
  })
}

function renderSkillCard(skill, status) {
  const name = esc(skill.name || '')
  const desc = esc(skill.description || skill.desc || '')
  const category = esc(skill.category || '')

  const isEnabled = skill.enabled !== false && status === 'eligible'
  const actions = `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" class="skill-toggle" ${isEnabled ? 'checked' : ''} data-name="${name}">
      <span style="font-size:var(--font-size-xs);color:${isEnabled ? 'var(--success)' : 'var(--text-tertiary)'}">${isEnabled ? '启用' : '禁用'}</span>
    </label>
  `

  return `
    <div class="skill-card" data-name="${name}" data-desc="${desc}" style="background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-md);display:flex;justify-content:space-between;align-items:center;gap:var(--space-md)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;margin-bottom:4px">${name}</div>
        <div style="font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.4">${desc || '<span style="color:var(--text-tertiary)">暂无描述</span>'}</div>
        ${category ? `<div style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px">分类: ${category}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-shrink:0">
        ${actions}
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

      if (tabName === 'store') {
        checkSkillHubSetup(page)
      }
    }
  })

  // 搜索安装
  page.querySelector('#btn-source-search').onclick = () => doSearchInstall(page)

  page.querySelector('#skill-install-search').onkeydown = (e) => {
    if (e.key === 'Enter') doSearchInstall(page)
  }

  // 源切换
  page.querySelector('#install-source-select').onchange = (e) => {
    const source = e.target.value
    const browseBtn = page.querySelector('#btn-browse-source')
    if (source === 'skillhub') {
      browseBtn.href = 'https://skillhub.tencent.com'
    } else {
      browseBtn.href = 'https://clawhub.ai/skills'
    }
  }
}

async function checkSkillHubSetup(page) {
  const statusEl = page.querySelector('#skillhub-status')
  const setupBtn = page.querySelector('#btn-skillhub-setup')

  try {
    const result = await api.skillsSkillHubCheck()
    if (result.installed) {
      statusEl.innerHTML = `<span style="color:var(--success)">✓ SkillHub CLI 已安装 (${esc(result.version || '')})</span>`
      setupBtn.style.display = 'none'
    } else {
      statusEl.innerHTML = `<span style="color:var(--warning)">SkillHub CLI 未安装</span>`
      setupBtn.style.display = ''
      setupBtn.onclick = async () => {
        setupBtn.disabled = true
        setupBtn.textContent = '安装中...'
        try {
          await api.skillsSkillHubSetup(false)
          toast('SkillHub CLI 安装成功', 'success')
          checkSkillHubSetup(page)
        } catch (e) {
          toast('安装失败: ' + e, 'error')
          setupBtn.disabled = false
          setupBtn.textContent = '安装 CLI'
        }
      }
    }
  } catch (e) {
    statusEl.innerHTML = `<span style="color:var(--error)">检查失败: ${esc(String(e))}</span>`
  }
}

async function doSearchInstall(page) {
  const source = page.querySelector('#install-source-select').value
  const query = page.querySelector('#skill-install-search').value.trim()
  const resultsEl = page.querySelector('#install-source-results')

  if (!query) {
    toast('请输入搜索关键词', 'warning')
    return
  }

  resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-tertiary)">搜索中...</div>`

  try {
    let results
    if (source === 'skillhub') {
      results = await api.skillsSkillHubSearch(query)
    } else {
      results = await api.skillsClawHubSearch(query)
    }

    if (!results || results.length === 0) {
      resultsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-tertiary)">未找到相关技能</div>`
      return
    }

    resultsEl.innerHTML = results.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-sm) 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:var(--font-size-sm)">${esc(item.slug || item.name || '')}</div>
          <div style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:2px">${esc(item.description || '')}</div>
        </div>
        <button class="btn btn-sm btn-primary install-btn" data-slug="${esc(item.slug || '')}" style="margin-left:var(--space-sm)">安装</button>
      </div>
    `).join('')

    // 绑定安装事件
    resultsEl.querySelectorAll('.install-btn').forEach(btn => {
      btn.onclick = async () => {
        const slug = btn.dataset.slug
        btn.disabled = true
        btn.textContent = '安装中...'

        try {
          if (source === 'skillhub') {
            await api.skillsSkillHubInstall(slug)
          } else {
            await api.skillsClawHubInstall(slug)
          }
          toast(`技能 "${slug}" 安装成功！`, 'success')
          btn.textContent = '已安装'
          btn.classList.remove('btn-primary')
          btn.classList.add('btn-secondary')
          btn.disabled = true
        } catch (e) {
          toast('安装失败: ' + e, 'error')
          btn.disabled = false
          btn.textContent = '安装'
        }
      }
    })
  } catch (e) {
    resultsEl.innerHTML = `<div style="padding:20px;color:var(--error)">搜索失败: ${esc(String(e))}</div>`
  }
}
