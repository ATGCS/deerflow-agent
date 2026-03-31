/**
 * 服务管理页面
 * 服务启停 + 更新检�?+ 配置备份管理
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm, showUpgradeModal } from '../components/modal.js'
import { isMacPlatform, isInDocker, setUpgrading, setUserStopped, resetAutoRestart } from '../lib/app-state.js'
import { diagnoseInstallError } from '../lib/error-diagnosis.js'
import { icon, statusIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'

// HTML 转义，防�?XSS
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
      <h1 class="page-title">${t('services.title')}</h1>
      <p class="page-desc">${t('services.desc')}</p>
    </div>
    <div id="version-bar"><div class="stat-card loading-placeholder" style="height:80px;margin-bottom:var(--space-lg)"></div></div>
    <div id="services-list"><div class="stat-card loading-placeholder" style="height:64px"></div></div>
    <div class="config-section" id="config-editor-section" style="display:none">
      <div class="config-section-title">${t('services.configEditor')}</div>
      <div class="form-hint" style="margin-bottom:var(--space-sm)">${t('services.configEditorHint')}</div>
      <div style="display:flex;gap:8px;margin-bottom:var(--space-sm)">
        <button class="btn btn-primary btn-sm" data-action="save-config" disabled>${t('services.saveAndRestart')}</button>
        <button class="btn btn-secondary btn-sm" data-action="save-config-only" disabled>${t('services.saveOnly')}</button>
        <button class="btn btn-secondary btn-sm" data-action="reload-config">${t('services.reloadConfig')}</button>
      </div>
      <div id="config-editor-status" style="font-size:var(--font-size-xs);margin-bottom:6px;min-height:18px"></div>
      <textarea id="config-editor-area" class="form-input" style="font-family:var(--font-mono);font-size:12px;min-height:320px;resize:vertical;tab-size:2;white-space:pre;overflow-x:auto" spellcheck="false" disabled></textarea>
    </div>
    <div class="config-section" id="backup-section">
      <div class="config-section-title">${t('services.configBackup')}</div>
      <div class="form-hint" style="margin-bottom:var(--space-sm)">${t('services.configBackupHint')}</div>
      <div id="backup-actions" style="margin-bottom:var(--space-md)">
        <button class="btn btn-primary btn-sm" data-action="create-backup">${t('services.createBackup')}</button>
      </div>
      <div id="backup-list"><div class="stat-card loading-placeholder" style="height:48px"></div></div>
    </div>
  `

  bindEvents(page)
  loadAll(page)
  return page
}

async function loadAll(page) {
  const tasks = [loadVersion(page), loadServices(page), loadBackups(page), loadConfigEditor(page)]
  await Promise.all(tasks)
}

// ===== 版本检�?=====

// 后端检测到的当前安装源
let detectedSource = 'chinese'
let lastVersionInfo = null

async function loadVersion(page) {
  const bar = page.querySelector('#version-bar')
  try {
    const info = await api.getVersionInfo()
    lastVersionInfo = info
    detectedSource = info.source || 'chinese'
    const ver = info.current || t('common.unknown')
    const hasRecommended = !!info.recommended
    const aheadOfRecommended = !!info.current && hasRecommended && !!info.ahead_of_recommended
    const driftFromRecommended = !!info.current && hasRecommended && !info.is_recommended && !aheadOfRecommended
    const isChinese = detectedSource === 'chinese'
    const sourceTag = isChinese ? t('services.chineseEdition') : t('services.officialEdition')
    const switchLabel = isChinese ? t('services.switchToOfficial') : t('services.switchToChinese')
    const switchTarget = isChinese ? 'official' : 'chinese'
    const policyNote = aheadOfRecommended
      ? t('services.policyAhead', { ver, recommended: info.recommended })
      : t('services.policyDefault')

    if (isInDocker()) {
      bar.innerHTML = `
        <div class="stat-cards" style="margin-bottom:var(--space-lg)">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">${t('services.currentVersion')} · <span style="color:var(--accent)">${t('services.dockerDeploy')}</span></span>
            </div>
            <div class="stat-card-value">${ver}</div>
            <div class="stat-card-meta">${info.latest_update_available ? t('services.latestUpstream', { version: info.latest }) + '�? + t('services.pullNewImage') + '�? : t('services.currentImageVer')}</div>
            ${info.latest_update_available ? `<div style="margin-top:var(--space-sm)">
              <code style="font-size:var(--font-size-xs);background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;user-select:all">docker pull ghcr.io/qingchencloud/deerpanel:latest</code>
            </div>` : ''}
          </div>
        </div>
      `
    } else {
      bar.innerHTML = `
        <div class="stat-cards" style="margin-bottom:var(--space-lg)">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-card-label">${t('services.currentVersion')} · <span style="color:var(--accent)">${sourceTag}</span></span>
            </div>
            <div class="stat-card-value">${ver}</div>
            <div class="stat-card-meta">
              ${hasRecommended
                ? (aheadOfRecommended ? t('services.aheadOfRecommended', { version: info.recommended }) : driftFromRecommended ? t('services.recommendedStable', { version: info.recommended }) : t('services.alignedRecommended', { version: info.recommended }))
                : t('services.noRecommended')}
              ${info.latest_update_available && info.latest ? ' · ' + t('services.latestUpstream', { version: info.latest }) : ''}
            </div>
            <div style="display:flex;gap:var(--space-sm);margin-top:var(--space-sm);flex-wrap:wrap">
              ${aheadOfRecommended ? `<button class="btn btn-primary btn-sm" data-action="upgrade">${t('services.rollbackToRecommended')}</button>` : driftFromRecommended ? `<button class="btn btn-primary btn-sm" data-action="upgrade">${t('services.switchToRecommended')}</button>` : ''}
              <button class="btn btn-secondary btn-sm" data-action="switch-source" data-source="${switchTarget}">${switchLabel}</button>
            </div>
            <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.6">
              ${policyNote}
            </div>
          </div>
        </div>
      `
    }
  } catch (e) {
    bar.innerHTML = `<div class="stat-card" style="margin-bottom:var(--space-lg)"><div class="stat-card-label">${t('services.versionLoadFailed')}</div></div>`
  }
}

// ===== 服务列表 =====

async function loadServices(page) {
  const container = page.querySelector('#services-list')
  try {
    const services = await api.getServicesStatus()
    renderServices(container, services)
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error)">${t('services.serviceLoadFailed')}: ${escapeHtml(String(e))}</div>`
  }
}

function renderServices(container, services) {
  const gw = services.find(s => s.label === 'ai.deerpanel.gateway')

  let html = ''
  if (gw) {
    // 检�?CLI 是否安装
    const cliMissing = gw.cli_installed === false

    html += `
    <div class="service-card" data-label="${gw.label}">
      <div class="service-info">
        <span class="status-dot ${cliMissing ? 'stopped' : gw.running ? 'running' : 'stopped'}"></span>
        <div>
          <div class="service-name">${gw.label}</div>
          <div class="service-desc">${cliMissing
            ? t('services.cliNotInstalled')
            : (gw.description || '') + (gw.pid ? ' (PID: ' + gw.pid + ')' : '')
          }</div>
        </div>
      </div>
      <div class="service-actions">
        ${cliMissing
          ? `<div style="display:flex;flex-direction:column;gap:var(--space-xs);align-items:flex-end">
               <div style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('services.installCliHint')}</div>
               <code style="font-size:var(--font-size-xs);background:var(--bg-tertiary);padding:2px 8px;border-radius:4px;user-select:all">npm install -g @qingchencloud/deerpanel-zh</code>
               <button class="btn btn-secondary btn-sm" data-action="refresh-services" style="margin-top:4px">${t('services.refreshStatus')}</button>
             </div>`
          : gw.running
            ? `<button class="btn btn-secondary btn-sm" data-action="restart" data-label="${gw.label}">${t('services.restart')}</button>
               <button class="btn btn-danger btn-sm" data-action="stop" data-label="${gw.label}">${t('services.stop')}</button>
               ${isMacPlatform() ? `<button class="btn btn-danger btn-sm" data-action="uninstall-gateway">${t('services.uninstall')}</button>` : ''}`
            : `<button class="btn btn-primary btn-sm" data-action="start" data-label="${gw.label}">${t('services.start')}</button>
               ${isMacPlatform() ? `<button class="btn btn-primary btn-sm" data-action="install-gateway">${t('services.install')}</button><button class="btn btn-danger btn-sm" data-action="uninstall-gateway">${t('services.uninstall')}</button>` : ''}`
        }
      </div>
    </div>`
  } else {
    html += `
    <div class="service-card">
      <div class="service-info">
        <span class="status-dot stopped"></span>
        <div>
          <div class="service-name">ai.deerpanel.gateway</div>
          <div class="service-desc">${t('services.gwNotInstalled')}</div>
        </div>
      </div>
      <div class="service-actions">
        <button class="btn btn-primary btn-sm" data-action="install-gateway">${t('services.install')}</button>
      </div>
    </div>`
  }

  container.innerHTML = html
}

// ===== 备份管理 =====

async function loadBackups(page) {
  const list = page.querySelector('#backup-list')
  try {
    const backups = await api.listBackups()
    renderBackups(list, backups)
  } catch (e) {
    list.innerHTML = `<div style="color:var(--error)">${t('services.backupLoadFailed')}: ${e}</div>`
  }
}

function renderBackups(container, backups) {
  if (!backups || !backups.length) {
    container.innerHTML = `<div style="color:var(--text-tertiary);padding:var(--space-md) 0">${t('services.noBackup')}</div>`
    return
  }
  container.innerHTML = backups.map(b => {
    const date = b.created_at ? new Date(b.created_at * 1000).toLocaleString() : t('common.unknown')
    const size = b.size ? (b.size / 1024).toFixed(1) + ' KB' : ''
    return `
      <div class="service-card" data-backup="${b.name}">
        <div class="service-info">
          <div>
            <div class="service-name">${b.name}</div>
            <div class="service-desc">${date}${size ? ' · ' + size : ''}</div>
          </div>
        </div>
        <div class="service-actions">
          <button class="btn btn-primary btn-sm" data-action="restore-backup" data-name="${b.name}">${t('services.restore')}</button>
          <button class="btn btn-danger btn-sm" data-action="delete-backup" data-name="${b.name}">${t('common.delete')}</button>
        </div>
      </div>`
  }).join('')
}

// ===== 事件绑定（事件委托） =====

function bindEvents(page) {
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    btn.disabled = true

    try {
      switch (action) {
        case 'start':
        case 'stop':
        case 'restart':
          await handleServiceAction(action, btn.dataset.label, page)
          break
        case 'save-config':
          await handleSaveConfig(page, true)
          break
        case 'save-config-only':
          await handleSaveConfig(page, false)
          break
        case 'reload-config':
          await loadConfigEditor(page)
          break
        case 'create-backup':
          await handleCreateBackup(page)
          break
        case 'restore-backup':
          await handleRestoreBackup(btn.dataset.name, page)
          break
        case 'delete-backup':
          await handleDeleteBackup(btn.dataset.name, page)
          break
        case 'upgrade':
          await handleUpgrade(btn, page)
          break
        case 'switch-source':
          await handleSwitchSource(btn.dataset.source, page)
          break
        case 'install-gateway':
          await handleInstallGateway(btn, page)
          break
        case 'uninstall-gateway':
          await handleUninstallGateway(btn, page)
          break
        case 'refresh-services':
          await loadServices(page)
          break
      }
    } catch (e) {
      toast(e.toString(), 'error')
    } finally {
      btn.disabled = false
    }
  })
}

// ===== 服务操作 =====

const ACTION_LABELS = { start: t('services.start'), stop: t('services.stop'), restart: t('services.restart') }
const POLL_INTERVAL = 1500  // 轮询间隔 ms
const POLL_TIMEOUT = 30000  // 最长等�?30s

async function handleServiceAction(action, label, page) {
  const fn = { start: api.startService, stop: api.stopService, restart: api.restartService }[action]
  const actionLabel = ACTION_LABELS[action]
  const expectRunning = action !== 'stop'

  // 通知守护模块：用户主动操�?  if (action === 'stop') setUserStopped(true)
  if (action === 'start') resetAutoRestart()

  // 找到触发按钮所在的 service-card，替换按钮区域为加载状�?  const card = page.querySelector(`.service-card[data-label="${label}"]`)
  const actionsEl = card?.querySelector('.service-actions')
  const origHtml = actionsEl?.innerHTML || ''

  let cancelled = false
  if (actionsEl) {
    actionsEl.innerHTML = `
      <div class="service-loading">
        <div class="service-spinner"></div>
        <span class="service-loading-text">${t('services.actionProgress', { action: actionLabel })}</span>
        <button class="btn btn-sm btn-ghost service-cancel-btn" style="display:none">${t('services.cancelWait')}</button>
      </div>`
    const cancelBtn = actionsEl.querySelector('.service-cancel-btn')
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => { cancelled = true })
    }
  }

  // 更新状态点为加载中
  const dot = card?.querySelector('.status-dot')
  if (dot) { dot.className = 'status-dot loading' }

  try {
    await fn(label)
  } catch (e) {
    toast(t('services.actionCmdFailed', { action: actionLabel, error: e.message || e }), 'error')
    if (actionsEl) actionsEl.innerHTML = origHtml
    if (dot) dot.className = 'status-dot stopped'
    return
  }

  // 轮询等待实际状态变�?  const startTime = Date.now()
  let showedCancel = false
  const loadingText = actionsEl?.querySelector('.service-loading-text')
  const cancelBtn = actionsEl?.querySelector('.service-cancel-btn')

  while (!cancelled) {
    const elapsed = Date.now() - startTime

    // 5 秒后显示取消按钮
    if (!showedCancel && elapsed > 5000 && cancelBtn) {
      cancelBtn.style.display = ''
      showedCancel = true
    }

    // 更新等待时间
    if (loadingText) {
      const sec = Math.floor(elapsed / 1000)
      loadingText.textContent = t('services.actionProgressSec', { action: actionLabel, sec })
    }

    // 超时
    if (elapsed > POLL_TIMEOUT) {
      toast(t('services.actionTimeout', { action: actionLabel }), 'warning')
      break
    }

    // 检查实际状�?    try {
      const services = await api.getServicesStatus()
      const svc = services?.find?.(s => s.label === label) || services?.[0]
      if (svc && svc.running === expectRunning) {
        toast(t('services.actionDone', { label, action: actionLabel }) + (svc.pid ? ' (PID: ' + svc.pid + ')' : ''), 'success')
        await loadServices(page)
        return
      }
    } catch {}

    await new Promise(r => setTimeout(r, POLL_INTERVAL))
  }

  if (cancelled) {
    toast(t('services.cancelled'), 'info')
  }
  await loadServices(page)
}

// ===== 备份操作 =====

async function handleCreateBackup(page) {
  const result = await api.createBackup()
  toast(t('services.backupCreated', { name: result.name }), 'success')
  await loadBackups(page)
}

async function handleRestoreBackup(name, page) {
  const yes = await showConfirm(t('services.restoreConfirm', { name }))
  if (!yes) return
  await api.restoreBackup(name)
  toast(t('services.restored'), 'success')
  await loadBackups(page)
}

async function handleDeleteBackup(name, page) {
  const yes = await showConfirm(t('services.deleteConfirm', { name }))
  if (!yes) return
  await api.deleteBackup(name)
  toast(t('services.backupDeleted'), 'success')
  await loadBackups(page)
}

// ===== 配置文件编辑�?=====

let _configOriginal = ''

async function loadConfigEditor(page) {
  const section = page.querySelector('#config-editor-section')
  const area = page.querySelector('#config-editor-area')
  const status = page.querySelector('#config-editor-status')
  const btnSave = page.querySelector('[data-action="save-config"]')
  const btnSaveOnly = page.querySelector('[data-action="save-config-only"]')

  try {
    const config = await api.readOpenclawConfig()
    const json = JSON.stringify(config, null, 2)
    _configOriginal = json
    area.value = json
    area.disabled = false
    btnSave.disabled = false
    btnSaveOnly.disabled = false
    section.style.display = ''
    status.innerHTML = `<span style="color:var(--text-tertiary)">${t('services.configLoaded')} · ${(json.length / 1024).toFixed(1)} KB</span>`

    // 实时检�?JSON 语法
    area.oninput = () => {
      try {
        JSON.parse(area.value)
        const changed = area.value !== _configOriginal
        status.innerHTML = changed
          ? `<span style="color:var(--warning)">�?${t('services.configUnsaved')}</span>`
          : `<span style="color:var(--text-tertiary)">${t('services.configNoChange')}</span>`
        btnSave.disabled = !changed
        btnSaveOnly.disabled = !changed
      } catch (e) {
        status.innerHTML = `<span style="color:var(--error)">${t('services.configJsonError')}: ${e.message.split(' at ')[0]}</span>`
        btnSave.disabled = true
        btnSaveOnly.disabled = true
      }
    }
  } catch {
    // deerpanel.json 不存在，隐藏编辑�?    section.style.display = 'none'
  }
}

async function handleSaveConfig(page, restart) {
  const area = page.querySelector('#config-editor-area')
  const status = page.querySelector('#config-editor-status')

  let config
  try {
    config = JSON.parse(area.value)
  } catch (e) {
    toast(t('services.configSaveJsonError'), 'error')
    return
  }

  status.innerHTML = `<span style="color:var(--text-tertiary)">${t('services.autoBackingUp')}</span>`

  try {
    // 保存前自动备�?    await api.createBackup()
  } catch (e) {
    const yes = await showConfirm(t('services.autoBackupFailed') + ': ' + e + '\n\n' + t('services.continueWithoutBackup'))
    if (!yes) return
  }

  status.innerHTML = `<span style="color:var(--text-tertiary)">${t('services.saving')}</span>`

  try {
    await api.writeOpenclawConfig(config)
    _configOriginal = area.value
    toast(restart ? t('services.configSavedRestarting') : t('services.configSaved'), 'success')
    status.innerHTML = `<span style="color:var(--success)">${t('services.configSaved')}</span>`

    page.querySelector('[data-action="save-config"]').disabled = true
    page.querySelector('[data-action="save-config-only"]').disabled = true

    if (restart) {
      try {
        await api.restartGateway()
        toast(t('services.gwRestarted'), 'success')
      } catch (e) {
        toast(t('services.configSavedGwFailed') + ': ' + e, 'warning')
      }
      await loadServices(page)
    }

    await loadBackups(page)
  } catch (e) {
    toast(t('common.saveFailed') + ': ' + e, 'error')
    status.innerHTML = `<span style="color:var(--error)">${t('common.saveFailed')}: ${e}</span>`
  }
}

// ===== 升级操作 =====

async function doUpgradeWithModal(source, page, version = null, method = 'auto') {
  const modal = showUpgradeModal(t('services.upgradeTitle'))
  let unlistenLog, unlistenProgress, unlistenDone, unlistenError
  setUpgrading(true)

  // 清理所有监�?  const cleanup = () => {
    setUpgrading(false)
    unlistenLog?.()
    unlistenProgress?.()
    unlistenDone?.()
    unlistenError?.()
  }

  try {
    if (window.__TAURI_INTERNALS__) {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
      unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

      // 后台任务完成事件
      unlistenDone = await listen('upgrade-done', (e) => {
        cleanup()
        modal.setDone(typeof e.payload === 'string' ? e.payload : t('services.taskDone'))
        loadVersion(page)
      })

      // 后台任务失败事件
      unlistenError = await listen('upgrade-error', (e) => {
        cleanup()
        const errStr = String(e.payload || t('common.error'))
        modal.appendLog(errStr)
        const fullLog = modal.getLogText() + '\n' + errStr
        const diagnosis = diagnoseInstallError(fullLog)
        modal.setError(diagnosis.title)
        if (diagnosis.hint) modal.appendLog('')
        if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
        if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
        if (window.__openAIDrawerWithError) {
          window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('services.upgradeScene'), hint: diagnosis.hint })
        }
      })

      // 发起后台任务（立即返回）
      await api.upgradeOpenclaw(source, version, method)
      modal.appendLog(t('services.taskStarted'))
    } else {
      // Web 模式：仍然同步等待（dev-api 后端没有 spawn�?      modal.appendLog(t('services.webModeNoLog'))
      const msg = await api.upgradeOpenclaw(source, version, method)
      modal.setDone(typeof msg === 'string' ? msg : (msg?.message || t('services.upgradeDone')))
      await loadVersion(page)
      cleanup()
    }
  } catch (e) {
    cleanup()
    const errStr = String(e)
    modal.appendLog(errStr)
    const fullLog = modal.getLogText() + '\n' + errStr
    const diagnosis = diagnoseInstallError(fullLog)
    modal.setError(diagnosis.title)
  }
}

async function handleUpgrade(btn, page) {
  const sourceLabel = detectedSource === 'official' ? t('services.officialEdition') : t('services.chineseEdition')
  const recommended = lastVersionInfo?.recommended
  const yes = await showConfirm(t('services.upgradeConfirm', { source: sourceLabel, version: recommended ? `�?{recommended}）` : '' }))
  if (!yes) return
  await doUpgradeWithModal(detectedSource, page, recommended || null)
}

async function handleSwitchSource(target, page) {
  const targetLabel = target === 'official' ? t('services.officialEdition') : t('services.chineseEdition')
  const recommended = target === 'official'
    ? (lastVersionInfo?.source === 'official' ? lastVersionInfo?.recommended : null)
    : (lastVersionInfo?.source === 'chinese' ? lastVersionInfo?.recommended : null)
  const yes = await showConfirm(t('services.switchSourceConfirm', { target: targetLabel, version: recommended ? `�?{recommended}）` : '' }))
  if (!yes) return
  await doUpgradeWithModal(target, page, null)
}

// ===== Gateway 安装/卸载 =====

async function handleInstallGateway(btn, page) {
  btn.classList.add('btn-loading')
  btn.textContent = t('services.installing')
  try {
    await api.installGateway()
    toast(t('services.gwInstalled'), 'success')
    await loadServices(page)
  } catch (e) {
    toast(t('services.installFailed') + ': ' + e, 'error')
    btn.classList.remove('btn-loading')
    btn.textContent = t('services.install')
  }
}

async function handleUninstallGateway(btn, page) {
  const yes = await showConfirm(t('services.uninstallConfirm'))
  if (!yes) return
  btn.classList.add('btn-loading')
  btn.textContent = t('services.uninstalling')
  try {
    await api.uninstallGateway()
    toast(t('services.gwUninstalled'), 'success')
    await loadServices(page)
  } catch (e) {
    toast(t('services.uninstallFailed') + ': ' + e, 'error')
    btn.classList.remove('btn-loading')
    btn.textContent = t('services.uninstall')
  }
}
