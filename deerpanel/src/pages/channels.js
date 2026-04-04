/**
 * 消息渠道管理页面 - 管理 DeerFlaw 多渠道（飞书、Slack、Telegram 等）
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showModal } from '../components/modal.js'

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')
}

let _loadSeq = 0

function channelsShellHtml(settingsModal) {
  if (settingsModal) {
    return `
      <div class="settings-modal-pane-toolbar settings-modal-pane-toolbar--channels">
        <div class="channels-toolbar-meta">
          <span class="channels-toolbar-title">渠道状态</span>
          <span class="channels-toolbar-hint">飞书 / Slack / Telegram 等</span>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" id="btn-reload">刷新</button>
      </div>
      <div class="settings-modal-pane-body settings-modal-pane-body--channels">
        <div id="channels-loading" class="settings-modal-pane-loading" role="status"><span>加载渠道状态…</span></div>
        <div id="channels-content" class="settings-modal-pane-fill channels-page-inner" hidden></div>
        <div id="channels-error" class="settings-modal-pane-fill settings-modal-pane-error" hidden></div>
      </div>
    `
  }
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">消息渠道</h1>
        <p class="page-desc">管理 DeerFlaw 多渠道接入（飞书、Slack、Telegram 等）</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reload">刷新</button>
      </div>
    </div>
    <div class="page-content channels-page">
      <div id="channels-loading" class="channels-phase-loading" role="status">加载渠道状态…</div>
      <div id="channels-content" class="channels-page-inner" style="display:none"></div>
      <div id="channels-error" class="channels-phase-error" style="display:none"></div>
    </div>
  `
}

function setChannelsPhase(page, phase) {
  const loadingEl = page.querySelector('#channels-loading')
  const contentEl = page.querySelector('#channels-content')
  const errorEl = page.querySelector('#channels-error')
  const modal = !!page.querySelector('.settings-modal-pane-body--channels')
  if (modal) {
    if (phase === 'loading') {
      loadingEl?.removeAttribute('hidden')
      contentEl?.setAttribute('hidden', '')
      errorEl?.setAttribute('hidden', '')
    } else if (phase === 'content') {
      loadingEl?.setAttribute('hidden', '')
      contentEl?.removeAttribute('hidden')
      errorEl?.setAttribute('hidden', '')
    } else if (phase === 'error') {
      loadingEl?.setAttribute('hidden', '')
      contentEl?.setAttribute('hidden', '')
      errorEl?.removeAttribute('hidden')
    }
    return
  }
  if (loadingEl) loadingEl.style.display = phase === 'loading' ? 'block' : 'none'
  if (contentEl) contentEl.style.display = phase === 'content' ? 'block' : 'none'
  if (errorEl) errorEl.style.display = phase === 'error' ? 'block' : 'none'
}

/**
 * @param {boolean} settingsModal
 */
export function createChannelsRoot(settingsModal) {
  const root = document.createElement('div')
  root.className = settingsModal ? 'settings-modal-pane settings-modal-pane--channels' : 'page channels-page'
  root.innerHTML = channelsShellHtml(settingsModal)
  return root
}

export async function render() {
  const page = createChannelsRoot(false)
  bindEvents(page)
  loadChannels(page)
  return page
}

/** 设置弹窗：固定高度内容区 + 覆盖式加载，避免切换 Tab 时布局塌缩 */
export function mountChannelsForSettingsModal(container) {
  const root = createChannelsRoot(true)
  container.replaceChildren(root)
  bindEvents(root)
  loadChannels(root)
}

async function loadChannels(page) {
  const errorEl = page.querySelector('#channels-error')

  setChannelsPhase(page, 'loading')

  const seq = ++_loadSeq

  try {
    const data = await api.getChannelsStatus()
    if (seq !== _loadSeq) return

    setChannelsPhase(page, 'content')
    renderChannels(page, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    setChannelsPhase(page, 'error')
    if (errorEl) errorEl.textContent = '加载失败: ' + e
    toast('加载渠道状态失败: ' + e, 'error')
  }
}

function renderChannels(page, data) {
  const contentEl = page.querySelector('#channels-content')
  const serviceRunning = data?.service_running || false
  const channels = data?.channels || {}

  const channelList = Object.entries(channels)
  const runningCount = channelList.filter(([, c]) => c.running).length
  const enabledCount = channelList.filter(([, c]) => c.enabled).length

  const svcClass = serviceRunning ? 'is-up' : 'is-down'
  let html = `
    <section class="channels-summary" aria-label="渠道服务概览">
      <div class="channels-summary-main">
        <span class="channels-summary-label">渠道服务</span>
        <span class="channels-summary-service ${svcClass}">
          <span class="channels-status-dot" aria-hidden="true"></span>
          ${serviceRunning ? '运行中' : '未运行'}
        </span>
      </div>
      <p class="channels-summary-meta">
        共 <strong>${channelList.length}</strong> 个渠道 ·
        <span class="channels-stat-on">${enabledCount} 已启用</span>
        ·
        <span class="channels-stat-run">${runningCount} 进程运行中</span>
      </p>
    </section>
  `

  if (!channelList.length) {
    html += `
      <div class="channels-empty">
        <p class="channels-empty-title">暂无渠道</p>
        <p class="channels-empty-desc">请在配置文件的 <code>channels</code> 段添加渠道后刷新本页。</p>
      </div>
    `
    contentEl.innerHTML = html
    return
  }

  html += `<div class="channels-grid" role="list">`

  const channelIcons = {
    feishu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M12 8v8"/></svg>',
    slack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/><path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/><path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/><path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"/><path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>',
  }

  const channelLabels = {
    feishu: '飞书',
    slack: 'Slack',
    telegram: 'Telegram',
  }

  for (const [name, status] of channelList) {
    const label = channelLabels[name] || name
    const icon = channelIcons[name] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 6v6l4 2"/></svg>'
    const enabled = status.enabled
    const running = status.running

    const runClass = running ? 'channels-runtime--on' : 'channels-runtime--off'
    html += `
      <article class="channels-card" role="listitem">
        <div class="channels-card-head">
          <div class="channels-card-brand">
            <div class="channels-card-icon" aria-hidden="true">${icon}</div>
            <div class="channels-card-titles">
              <div class="channels-card-name">${esc(label)}</div>
              <div class="channels-card-id"><code>${esc(name)}</code></div>
            </div>
          </div>
          <label class="channels-enable">
            <input type="checkbox" class="channel-toggle channels-enable-input" data-channel="${esc(name)}" ${enabled ? 'checked' : ''}>
            <span class="channels-enable-track" aria-hidden="true"></span>
            <span class="channels-toggle-label ${enabled ? 'is-on' : ''}">${enabled ? '已启用' : '已禁用'}</span>
          </label>
        </div>
        <div class="channels-card-foot">
          <span class="channels-runtime ${runClass}">
            <span class="channels-status-dot" aria-hidden="true"></span>
            ${running ? '运行中' : '已停止'}
          </span>
          <div class="channels-card-btns">
            <button type="button" class="btn btn-sm btn-secondary" data-action="restart" data-channel="${esc(name)}" ${!running ? '' : 'disabled'}>重启</button>
            <button type="button" class="btn btn-sm btn-secondary" data-action="config" data-channel="${esc(name)}">配置</button>
          </div>
        </div>
      </article>
    `
  }

  html += '</div>'
  contentEl.innerHTML = html

  // 绑定启用/禁用事件
  contentEl.querySelectorAll('.channel-toggle').forEach(checkbox => {
    checkbox.onchange = async () => {
      const name = checkbox.dataset.channel
      const enabled = checkbox.checked
      const label = checkbox.closest('.channels-enable')?.querySelector('.channels-toggle-label')

      try {
        const result = await api.enableChannel(name, enabled)
        if (result.success) {
          toast(`渠道 ${name} 已${enabled ? '启用' : '禁用'}`, 'success')
          if (label) {
            label.textContent = enabled ? '已启用' : '已禁用'
            label.classList.toggle('is-on', enabled)
          }
          loadChannels(page)
        } else {
          toast(result.message || '操作失败', 'error')
          checkbox.checked = !enabled
        }
      } catch (e) {
        toast('操作失败: ' + e, 'error')
        checkbox.checked = !enabled
      }
    }
  })

  // 绑定重启事件
  contentEl.querySelectorAll('[data-action="restart"]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.channel
      btn.disabled = true
      btn.textContent = '重启中...'

      try {
        const result = await api.restartChannel(name)
        if (result.success) {
          toast(`渠道 ${name} 重启成功`, 'success')
        } else {
          toast(result.message || '重启失败', 'error')
        }
      } catch (e) {
        toast('重启失败: ' + e, 'error')
      } finally {
        btn.disabled = false
        btn.textContent = '重启'
      }
    }
  })

  // 绑定配置事件
  contentEl.querySelectorAll('[data-action="config"]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.channel
      try {
        const configData = await api.getChannelConfig(name)
        showChannelConfigDialog(page, name, configData)
      } catch (e) {
        toast('获取配置失败: ' + e, 'error')
      }
    }
  })
}

function showChannelConfigDialog(page, name, configData) {
  const config = configData.config || {}
  const label = { feishu: '飞书', slack: 'Slack', telegram: 'Telegram' }[name] || name

  showModal({
    title: `${label} 配置`,
    fields: [
      { name: 'app_id', label: 'App ID', value: config.app_id || '', placeholder: '请输入 App ID' },
      { name: 'app_secret', label: 'App Secret', value: config.app_secret || '', placeholder: '请输入 App Secret' },
      { name: 'bot_name', label: 'Bot 名称', value: config.bot_name || '', placeholder: '请输入 Bot 名称' },
    ],
    onConfirm: async (result) => {
      const newConfig = {}
      if (result.app_id) newConfig.app_id = result.app_id
      if (result.app_secret) newConfig.app_secret = result.app_secret
      if (result.bot_name) newConfig.bot_name = result.bot_name

      try {
        const updateResult = await api.updateChannelConfig(name, newConfig)
        if (updateResult.success) {
          toast(`渠道 ${name} 配置已更新`, 'success')
          loadChannels(page)
        } else {
          toast(updateResult.message || '更新失败', 'error')
        }
      } catch (e) {
        toast('更新失败: ' + e, 'error')
      }
    }
  })
}

function bindEvents(page) {
  page.querySelector('#btn-reload').onclick = () => loadChannels(page)
}
