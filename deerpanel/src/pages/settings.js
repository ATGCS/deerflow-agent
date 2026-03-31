/**
 * 面板设置页面
 * 统一管理 DeerPanel 的网络代理、npm 源、模型代理等配置
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'
import { t, getLang, setLang, getAvailableLangs, onLangChange } from '../lib/i18n.js'
import { renderSidebar } from '../components/sidebar.js'

const isTauri = !!window.__TAURI_INTERNALS__

function escapeHtml(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const REGISTRIES = [
  { label: () => t('settings.registryTaobao'), value: 'https://registry.npmmirror.com' },
  { label: () => t('settings.registryNpm'), value: 'https://registry.npmjs.org' },
  { label: () => t('settings.registryHuawei'), value: 'https://repo.huaweicloud.com/repository/npm/' },
]

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('settings.title')}</h1>
      <p class="page-desc">${t('settings.desc')}</p>
    </div>

    <div class="config-section" id="proxy-section">
      <div class="config-section-title">${t('settings.networkProxy')}</div>
      <div id="proxy-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="model-proxy-section">
      <div class="config-section-title">${t('settings.modelProxy')}</div>
      <div id="model-proxy-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="registry-section">
      <div class="config-section-title">${t('settings.npmRegistry')}</div>
      <div id="registry-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="deerpanel-dir-section">
      <div class="config-section-title">${t('settings.deerpanelDir')}</div>
      <div id="deerpanel-dir-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="cli-binding-section">
      <div class="config-section-title">${t('settings.deerpanelCli')}</div>
      <div id="cli-binding-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>

    <div class="config-section" id="language-section">
      <div class="config-section-title">${t('settings.language')}</div>
      <div id="language-bar"></div>
    </div>

    ${window.__TAURI_INTERNALS__ ? `<div class="config-section" id="autostart-section">
      <div class="config-section-title">${t('settings.autostart') || '开机自�?}</div>
      <div id="autostart-bar"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>` : ''}

  `

  bindEvents(page)
  loadAll(page)
  return page
}

async function loadAll(page) {
  const tasks = [loadProxyConfig(page), loadModelProxyConfig(page), loadOpenclawDir(page), loadCliBinding(page)]
  tasks.push(loadRegistry(page))
  if (window.__TAURI_INTERNALS__) tasks.push(loadAutostart(page))
  await Promise.all(tasks)
  loadLanguageSwitcher(page)
}

// ===== 网络代理 =====

async function loadProxyConfig(page) {
  const bar = page.querySelector('#proxy-bar')
  if (!bar) return
  try {
    const cfg = await api.readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url || ''
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <input class="form-input" data-name="proxy-url" placeholder="http://127.0.0.1:7897" value="${escapeHtml(proxyUrl)}" style="max-width:360px">
        <button class="btn btn-primary btn-sm" data-action="save-proxy">${t('common.save')}</button>
        <button class="btn btn-secondary btn-sm" data-action="test-proxy" ${proxyUrl ? '' : 'disabled'}>${t('settings.testProxy')}</button>
        <button class="btn btn-secondary btn-sm" data-action="clear-proxy" ${proxyUrl ? '' : 'disabled'}>${t('settings.clearProxy')}</button>
      </div>
      <div id="proxy-test-result" style="margin-top:var(--space-xs);font-size:var(--font-size-xs);min-height:20px"></div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        ${t('settings.proxyHint')}
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">${t('common.loadFailed')}: ${escapeHtml(String(e))}</div>`
  }
}

// ===== 模型请求代理 =====

async function loadModelProxyConfig(page) {
  const bar = page.querySelector('#model-proxy-bar')
  if (!bar) return
  try {
    const cfg = await api.readPanelConfig()
    const proxyUrl = cfg?.networkProxy?.url || ''
    const modelProxy = !!cfg?.networkProxy?.proxyModelRequests
    const hasProxy = !!proxyUrl

    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer">
          <input type="checkbox" data-name="model-proxy-toggle" ${modelProxy ? 'checked' : ''} ${hasProxy ? '' : 'disabled'}>
          ${t('settings.modelProxyToggle')}
        </label>
        <button class="btn btn-primary btn-sm" data-action="save-model-proxy">${t('common.save')}</button>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        ${hasProxy
          ? t('settings.modelProxyHint')
          : t('settings.modelProxyNoProxy')
        }
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">${t('common.loadFailed')}: ${escapeHtml(String(e))}</div>`
  }
}

// ===== npm 源设�?=====

async function loadRegistry(page) {
  const bar = page.querySelector('#registry-bar')
  try {
    const current = await api.getNpmRegistry()
    const isPreset = REGISTRIES.some(r => r.value === current)
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <select class="form-input" data-name="registry" style="max-width:320px">
          ${REGISTRIES.map(r => `<option value="${r.value}" ${r.value === current ? 'selected' : ''}>${typeof r.label === 'function' ? r.label() : r.label}</option>`).join('')}
          <option value="custom" ${!isPreset ? 'selected' : ''}>${t('settings.registryCustom')}</option>
        </select>
        <input class="form-input" data-name="custom-registry" placeholder="https://..." value="${isPreset ? '' : escapeHtml(current)}" style="max-width:320px;${isPreset ? 'display:none' : ''}">
        <button class="btn btn-primary btn-sm" data-action="save-registry">${t('common.save')}</button>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">${t('settings.registryHint')}</div>
    `
    const select = bar.querySelector('[data-name="registry"]')
    const customInput = bar.querySelector('[data-name="custom-registry"]')
    select.onchange = () => {
      customInput.style.display = select.value === 'custom' ? '' : 'none'
    }
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">${t('common.loadFailed')}: ${escapeHtml(String(e))}</div>`
  }
}

// ===== DeerPanel 安装路径 =====

async function loadOpenclawDir(page) {
  const bar = page.querySelector('#deerpanel-dir-bar')
  if (!bar) return
  try {
    const info = isTauri ? await api.getOpenclawDir() : { path: '~/.deerpanel', isCustom: false, configExists: true }
    const cfg = await api.readPanelConfig()
    const customValue = cfg?.deerpanelDir || ''
    const statusText = info.configExists
      ? `<span style="color:var(--success)">${t('settings.configExists')}</span>`
      : `<span style="color:var(--warning)">${t('settings.configMissing')}</span>`
    bar.innerHTML = `
      <div style="margin-bottom:var(--space-xs)">
        <span class="form-hint">${t('settings.currentPath')}:</span>
        <strong style="font-size:var(--font-size-sm)">${escapeHtml(info.path)}</strong>
        <span style="margin-left:var(--space-xs);font-size:var(--font-size-xs)">${statusText}</span>
        ${info.isCustom ? `<span class="clawhub-badge" style="margin-left:var(--space-xs);background:rgba(99,102,241,0.14);color:#6366f1;font-size:var(--font-size-xs)">${t('settings.customBadge')}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
        <input class="form-input" data-name="deerpanel-dir" placeholder="${t('settings.dirPlaceholder')}" value="${escapeHtml(customValue)}" style="max-width:420px">
        <button class="btn btn-primary btn-sm" data-action="save-deerpanel-dir">${t('common.save')}</button>
        ${info.isCustom ? `<button class="btn btn-secondary btn-sm" data-action="reset-deerpanel-dir">${t('settings.resetDefault')}</button>` : ''}
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        ${t('settings.dirHint')}
      </div>
    `
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">${t('common.loadFailed')}: ${escapeHtml(String(e))}</div>`
  }
}

async function handleSaveOpenclawDir(page) {
  const input = page.querySelector('[data-name="deerpanel-dir"]')
  const value = (input?.value || '').trim()
  const cfg = await api.readPanelConfig()
  if (value) {
    cfg.deerpanelDir = value
  } else {
    delete cfg.deerpanelDir
  }
  await api.writePanelConfig(cfg)
  await loadOpenclawDir(page)
  await promptRestart(value ? t('settings.customPathSaved') : t('settings.defaultRestored'))
}

async function handleResetOpenclawDir(page) {
  const cfg = await api.readPanelConfig()
  delete cfg.deerpanelDir
  await api.writePanelConfig(cfg)
  await loadOpenclawDir(page)
  await promptRestart(t('settings.defaultRestored'))
}

async function promptRestart(msg) {
  if (!isTauri) { toast(msg, 'success'); return }
  const ok = await showConfirm(`${msg}\n\n${t('settings.restartConfirm')}`)
  if (ok) {
    toast(t('settings.restarting'), 'info')
    try { await api.relaunchApp() } catch { toast(t('settings.restartFailed'), 'warning') }
  } else {
    toast(`${msg}, ${t('settings.effectNextLaunch')}`, 'success')
  }
}

// ===== 事件绑定 =====

function bindEvents(page) {
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    btn.disabled = true
    try {
      switch (action) {
        case 'save-proxy':
          await handleSaveProxy(page)
          break
        case 'test-proxy':
          await handleTestProxy(page)
          break
        case 'clear-proxy':
          await handleClearProxy(page)
          break
        case 'save-model-proxy':
          await handleSaveModelProxy(page)
          break
        case 'save-registry':
          await handleSaveRegistry(page)
          break
        case 'save-deerpanel-dir':
          await handleSaveOpenclawDir(page)
          break
        case 'reset-deerpanel-dir':
          await handleResetOpenclawDir(page)
          break
        case 'bind-cli':
          await handleBindCli(page, btn.dataset.path)
          break
        case 'unbind-cli':
          await handleUnbindCli(page)
          break
      }
    } catch (e) {
      toast(e.toString(), 'error')
    } finally {
      btn.disabled = false
    }
  })

}

function normalizeProxyUrl(value) {
  const url = String(value || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(t('settings.proxyUrlInvalid'))
  }
  return url
}

async function handleTestProxy(page) {
  const resultEl = page.querySelector('#proxy-test-result')
  if (resultEl) resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('settings.testingProxy')}</span>`
  try {
    const r = await api.testProxy()
    if (resultEl) {
      resultEl.innerHTML = r.ok
        ? `<span style="color:var(--success)">�?${t('settings.proxyOk', { status: r.status, ms: r.elapsed_ms, target: escapeHtml(r.target) })}</span>`
        : `<span style="color:var(--warning)">�?${t('settings.proxyWarn', { status: r.status, ms: r.elapsed_ms })}</span>`
    }
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--error)">�?${escapeHtml(String(e))}</span>`
  }
}

async function handleSaveProxy(page) {
  const input = page.querySelector('[data-name="proxy-url"]')
  const proxyUrl = normalizeProxyUrl(input?.value || '')
  if (!proxyUrl) {
    toast(t('settings.proxyUrlEmpty'), 'error')
    return
  }
  const cfg = await api.readPanelConfig()
  if (!cfg.networkProxy || typeof cfg.networkProxy !== 'object') {
    cfg.networkProxy = {}
  }
  cfg.networkProxy.url = proxyUrl
  await api.writePanelConfig(cfg)
  toast(t('settings.proxySaved'), 'success')
  await loadProxyConfig(page)
  await loadModelProxyConfig(page)
}

async function handleClearProxy(page) {
  const cfg = await api.readPanelConfig()
  delete cfg.networkProxy
  await api.writePanelConfig(cfg)
  toast(t('settings.proxyCleared'), 'success')
  await loadProxyConfig(page)
  await loadModelProxyConfig(page)
}

async function handleSaveModelProxy(page) {
  const toggle = page.querySelector('[data-name="model-proxy-toggle"]')
  const checked = toggle?.checked || false
  const cfg = await api.readPanelConfig()
  if (!cfg.networkProxy || typeof cfg.networkProxy !== 'object') {
    cfg.networkProxy = {}
  }
  cfg.networkProxy.proxyModelRequests = checked
  await api.writePanelConfig(cfg)
  toast(checked ? t('settings.modelProxyOn') : t('settings.modelProxyOff'), 'success')
}

async function handleSaveRegistry(page) {
  const select = page.querySelector('[data-name="registry"]')
  const customInput = page.querySelector('[data-name="custom-registry"]')
  const registry = select.value === 'custom' ? customInput.value.trim() : select.value
  if (!registry) { toast(t('settings.registryEmpty'), 'error'); return }
  await api.setNpmRegistry(registry)
  toast(t('settings.registrySaved'), 'success')
}

// ===== CLI 绑定 =====

async function loadCliBinding(page) {
  const bar = page.querySelector('#cli-binding-bar')
  if (!bar) return
  try {
    const version = await api.getVersionInfo()
    const cfg = await api.readPanelConfig()
    const boundPath = cfg?.deerpanelCliPath || ''
    const installations = version.all_installations || []
    const currentPath = version.cli_path || ''

    const sourceLabel = (src) => ({
      standalone: t('dashboard.cliSourceStandalone'),
      'npm-zh': t('dashboard.cliSourceNpmZh'),
      'npm-official': t('dashboard.cliSourceNpmOfficial'),
      'npm-global': t('dashboard.cliSourceNpmGlobal'),
    })[src] || t('dashboard.cliSourceUnknown')

    let html = `<div class="form-hint" style="margin-bottom:var(--space-sm)">${t('settings.cliBindHint')}</div>`

    if (currentPath) {
      html += `<div style="margin-bottom:var(--space-sm);font-size:var(--font-size-sm)">
        <span style="color:var(--text-secondary)">${t('settings.cliCurrent')}:</span>
        <code style="font-size:var(--font-size-xs)">${escapeHtml(currentPath)}</code>
        ${boundPath ? `<span class="clawhub-badge" style="margin-left:var(--space-xs);background:rgba(99,102,241,0.14);color:#6366f1;font-size:var(--font-size-xs)">${t('settings.cliBound')}</span>` : ''}
      </div>`
    }

    if (installations.length > 0) {
      html += '<div style="display:flex;flex-direction:column;gap:var(--space-xs)">'
      // Auto-detect option
      html += `<div style="display:flex;align-items:center;gap:var(--space-sm);padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);${!boundPath ? 'background:var(--bg-active);border-color:var(--accent)' : ''}">
        <span style="flex:1;font-size:var(--font-size-sm)">${t('settings.cliAutoDetect')}</span>
        ${boundPath ? '<button class="btn btn-secondary btn-xs" data-action="unbind-cli">' + t('common.reset') + '</button>' : '<span style="color:var(--success);font-size:var(--font-size-xs)">�?' + t('settings.cliActive') + '</span>'}
      </div>`
      for (const inst of installations) {
        const isActive = inst.active
        const isBound = boundPath && inst.path === boundPath
        html += `<div style="display:flex;align-items:center;gap:var(--space-sm);padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);${isBound ? 'background:var(--bg-active);border-color:var(--accent)' : ''}">
          <div style="flex:1;min-width:0">
            <div style="font-size:var(--font-size-xs);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(inst.path)}">${escapeHtml(inst.path)}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">${sourceLabel(inst.source)}${inst.version ? ' · v' + inst.version : ''}</div>
          </div>
          ${isBound ? '<span style="color:var(--success);font-size:var(--font-size-xs)">�?' + t('settings.cliBound') + '</span>' : `<button class="btn btn-secondary btn-xs" data-action="bind-cli" data-path="${escapeHtml(inst.path)}">${t('common.confirm')}</button>`}
        </div>`
      }
      html += '</div>'
    } else {
      html += `<div style="color:var(--text-tertiary);font-size:var(--font-size-sm)">${t('common.noData')}</div>`
    }

    bar.innerHTML = html
  } catch (e) {
    bar.innerHTML = `<div style="color:var(--error)">${t('common.loadFailed')}: ${escapeHtml(String(e))}</div>`
  }
}

async function handleBindCli(page, path) {
  if (!path) return
  const ok = await showConfirm(t('settings.cliSwitchConfirm'))
  if (!ok) return
  const cfg = await api.readPanelConfig()
  cfg.deerpanelCliPath = path
  await api.writePanelConfig(cfg)
  toast(t('common.saveSuccess'), 'success')
  await loadCliBinding(page)
}

async function handleUnbindCli(page) {
  const cfg = await api.readPanelConfig()
  delete cfg.deerpanelCliPath
  await api.writePanelConfig(cfg)
  toast(t('common.saveSuccess'), 'success')
  await loadCliBinding(page)
}

// ===== 语言切换 =====

function loadLanguageSwitcher(page) {
  const bar = page.querySelector('#language-bar')
  if (!bar) return
  const langs = getAvailableLangs()
  const current = getLang()
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-sm);flex-wrap:wrap">
      <select class="form-input" id="lang-select" style="max-width:200px">
        ${langs.map(l => `<option value="${l.code}" ${l.code === current ? 'selected' : ''}>${l.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-hint" style="margin-top:var(--space-xs)">${t('settings.languageHint')}</div>
  `
  const select = bar.querySelector('#lang-select')
  select.onchange = () => {
    setLang(select.value)
    // Re-render sidebar + current page
    const sidebarEl = document.getElementById('sidebar')
    if (sidebarEl) renderSidebar(sidebarEl)
    // Re-render settings page
    const pageEl = page.closest('.page') || page
    render().then(newPage => {
      pageEl.replaceWith(newPage)
    }).catch(() => {})
  }
}

// ===== 开机自�?=====

async function loadAutostart(page) {
  const bar = page.querySelector('#autostart-bar')
  if (!bar) return
  try {
    const { isEnabled, enable, disable } = await import('@tauri-apps/plugin-autostart')
    const enabled = await isEnabled()
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-sm)">
        <label style="display:flex;align-items:center;gap:6px;font-size:var(--font-size-sm);cursor:pointer">
          <input type="checkbox" id="autostart-toggle" ${enabled ? 'checked' : ''}>
          ${t('settings.autostartToggle') || '系统启动时自动运�?DeerPanel'}
        </label>
      </div>
      <div class="form-hint" style="margin-top:var(--space-xs)">
        ${t('settings.autostartHint') || '开启后，电脑重启时 DeerPanel 会自动启动并检�?Gateway 状�?}
      </div>
    `
    bar.querySelector('#autostart-toggle')?.addEventListener('change', async (e) => {
      try {
        if (e.target.checked) {
          await enable()
          toast(t('settings.autostartEnabled') || '已开启开机自�?, 'success')
        } else {
          await disable()
          toast(t('settings.autostartDisabled') || '已关闭开机自�?, 'success')
        }
      } catch (err) {
        e.target.checked = !e.target.checked
        toast((t('settings.autostartFailed') || '设置失败') + ': ' + err, 'error')
      }
    })
  } catch {
    bar.innerHTML = `<div style="color:var(--text-tertiary);font-size:var(--font-size-sm)">${t('settings.autostartUnavailable') || '当前环境不支持开机自�?}</div>`
  }
}
