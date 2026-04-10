import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')
}

let _loadSeq = 0

function channelsShellHtml(settingsModal) {
  if (settingsModal) {
    return `
      <div class="settings-modal-pane-body settings-modal-pane-body--channels">
        <div id="channels-loading" class="settings-modal-pane-loading" role="status"><span>loading...</span></div>
        <div id="channels-content" class="settings-modal-pane-fill channels-page-inner" hidden></div>
        <div id="channels-error" class="settings-modal-pane-fill settings-modal-pane-error" hidden></div>
      </div>
    `
  }
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">IM Channels</h1>
        <p class="page-desc">Manage DeerFlaw multi-channel (Feishu, Slack, Telegram, etc)</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-reload">Reload</button>
      </div>
    </div>
    <div class="page-content channels-page">
      <div id="channels-loading" class="channels-phase-loading" role="status">loading...</div>
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
    if (phase === 'loading') { loadingEl?.removeAttribute('hidden'); contentEl?.setAttribute('hidden', ''); errorEl?.setAttribute('hidden', '') }
    else if (phase === 'content') { loadingEl?.setAttribute('hidden', ''); contentEl?.removeAttribute('hidden'); errorEl?.setAttribute('hidden', '') }
    else if (phase === 'error') { loadingEl?.setAttribute('hidden', ''); contentEl?.setAttribute('hidden', ''); errorEl?.removeAttribute('hidden') }
    return
  }
  if (loadingEl) loadingEl.style.display = phase === 'loading' ? 'block' : 'none'
  if (contentEl) contentEl.style.display = phase === 'content' ? 'block' : 'none'
  if (errorEl) errorEl.style.display = phase === 'error' ? 'block' : 'none'
}

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
    if (errorEl) errorEl.textContent = 'Failed to load: ' + e
    toast('Failed: ' + e, 'error')
  }
}

const CHANNEL_ICONS = {
  feishu: '<img src="/assets/feishu-logo.png" width="20" height="20" alt="Feishu" style="border-radius:4px">',
  dingtalk: '<svg viewBox="0 0 24 24" width="20" height="20" fill="#0083FF"><path d="M10.64 2.68a1.33 1.33 0 0 1 1.72 0l6.87 5.84c.53.45.59 1.24.14 1.77L16.07 13H19a1 1 0 0 1 .89.55l2 4A1 1 0 0 1 21 19h-5.62l-3.38 2.86a1.33 1.33 0 0 1-1.72 0L3.41 16.02a1.33 1.33 0 0 1-.14-1.77L7.93 9H5a1 1 0 0 1-.89-.55l-2-4A1 1 0 0 1 3 3h5.62l3.38-2.86z"/></svg>',
  slack: '<svg role="img" viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg"><title>Slack</title><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.523 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.836a2.528 2.528 0 0 1 2.522-2.523h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.522 2.521 2.528 2.528 0 0 1-2.522-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.522 2.522v6.312zM15.166 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.522-2.522v-2.522h2.522zM15.166 17.688a2.528 2.528 0 0 1-2.522-2.522 2.528 2.528 0 0 1 2.522-2.522h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.522h-6.312z"/></svg>',
  telegram: '<svg role="img" viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg"><title>Telegram</title><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
}

const CHANNEL_LABELS = {
  feishu: '\u98de\u4e66',
  dingtalk: '\u9489\u9489',
  slack: 'Slack',
  telegram: 'Telegram',
  wecom: '\u4f01\u4e1a\u5fae\u4fe1',
  qq: 'QQ',
  yunxin: '\u4fe1\u606f',
  xiaomifeng: '\u5c0f\u8702\u8702',
  wechat: '\u5fae\u4fe1',
}

const CHANNEL_TIPS = {
  feishu: '<ol><li>\u524d\u5f80 <a href="https://open.feishu.cn/" target="_blank" rel="noopener">\u98de\u4e66\u5f00\u653e\u5e73\u53f0</a> \u521b\u5efa\u673a\u5668\u4eba\u5e94\u7528</li><li>\u83b7\u53d6 App ID \u548c App Secret</li><li>\u5f00\u542f\u673a\u5668\u4eba\u80fd\u529b\uff0c\u586b\u5199\u4e0b\u65b9\u914d\u7f6e</li><li>\u5f00\u542f\u5de6\u4fa7\u5f00\u5173\uff0c\u673a\u5668\u4eba\u5c06\u901a\u8fc7 Stream \u6a21\u5f0f\u8fde\u63a5</li></ol><a href="https://open.feishu.cn/document/home/introduction-to-custom-bot-development/bot-info-obtain-client-credentials" target="_blank" rel="noopener" class="im-setup-link">\u67e5\u770b\u6587\u6863</a>',
  dingtalk: '<ol><li>\u524d\u5f80 <a href="https://open-dev.dingtalk.com/" target="_blank" rel="noopener">\u9489\u9489\u5f00\u653e\u5e73\u53f0</a> \u521b\u5efa\u673a\u5668\u4eba\u5e94\u7528</li><li>\u83b7\u53d6 Client ID \u548c Client Secret</li><li>\u5f00\u542f\u673a\u5668\u4eba\u80fd\u529b\uff0c\u586b\u5199\u4e0b\u65b9\u914d\u7f6e</li><li>\u5f00\u542f\u5de6\u4fa7\u5f00\u5173\uff0c\u673a\u5668\u4eba\u5c06\u81ea\u52a8\u8fde\u63a5</li></ol><a href="https://open.dingtalk.com/document/orgapp/custom-robot-access" target="_blank" rel="noopener" class="im-setup-link">\u67e5\u770b\u6587\u6863</a>',
  default: '<ol><li>\u5728\u5bf9\u5e94\u5e73\u53f0\u521b\u5efa\u673a\u5668\u4eba\u5e94\u7528\u5e76\u83b7\u53d6\u51ed\u8bc1</li><li>\u586b\u5199\u4e0b\u65b9 Client ID \u548c Client Secret</li><li>\u5f00\u542f\u5de6\u4fa7\u5f00\u5173\u5373\u53ef\u5efa\u7acb\u8fde\u63a5</li></ol>',
}

function renderChannels(page, data) {
  const contentEl = page.querySelector('#channels-content')
  const channels = data?.channels || {}
  const channelList = Object.entries(channels)

  if (!channelList.length) {
    contentEl.innerHTML = `<div class="channels-empty"><p class="channels-empty-title">No channels</p><p class="channels-empty-desc">Add channels in config.</p></div>`
    return
  }

  const firstChannel = channelList[0][0]

  let html = '<div class="im-split-layout">'
  // Sidebar
  html += '<aside class="im-sidebar"><nav class="im-channel-list" id="im-channel-list">'

  for (const [name, status] of channelList) {
    const label = CHANNEL_LABELS[name] || name
    const icon = CHANNEL_ICONS[name] || ''
    const enabled = status.enabled
    const running = status.running
    const isSelected = name === firstChannel

    html += '<div class="im-channel-item' + (isSelected ? ' im-channel-item--active' : '') + '" data-channel="' + esc(name) + '">'
    html += '<div class="im-item-left"><span class="im-item-icon">' + icon + '</span>'
    html += '<span class="im-item-name">' + esc(label) + '</span></div>'
    html += '<label class="im-toggle"><input type="checkbox" class="channel-toggle im-toggle-input" data-channel="' + esc(name) + '"' + (enabled ? ' checked' : '') + '>'
    html += '<span class="im-toggle-track" aria-hidden="true"></span></label>'
    if (running) html += '<span class="im-item-status im-item-status--on" title="Running"></span>'
    html += '</div>'
  }

  html += '</nav></aside>'

  // Main panel
  const selName = firstChannel
  const selLabel = CHANNEL_LABELS[selName] || selName
  const selIcon = CHANNEL_ICONS[selName] || ''
  const selStatus = channelList.find(([n]) => n === selName)?.[1]
  const selRunning = selStatus?.running || false

  html += '<main class="im-main" id="im-main-panel">'
  // Title bar
  html += '<div class="im-title-bar">'
  html += '<span class="im-title-icon">' + selIcon + '</span>'
  html += '<strong>' + esc(selLabel) + '\u8bbe\u7f6e</strong>'
  html += '<span class="im-title-status' + (selRunning ? '' : ' im-title-status--off') + '">' + (selRunning ? '\u5df2\u8fde\u63a5' : '\u672a\u8fde\u63a5') + '</span>'
  html += '</div>'

  // Tips
  const tips = CHANNEL_TIPS[selName] || CHANNEL_TIPS.default
  html += '<div class="im-tips">' + tips + '</div>'

  // Form
  html += '<form class="im-form" id="im-config-form" data-channel="' + esc(selName) + '">'
  html += '<div class="im-field-group"><label class="im-label" for="im-app-id">App ID</label>'
  html += '<input class="im-input" id="im-app-id" name="app_id" type="text" placeholder="cli_xxxxxxxx"></div>'
  html += '<div class="im-field-group"><label class="im-label" for="im-app-secret">App Secret</label>'
  html += '<div class="im-secret-wrap"><input class="im-input" id="im-app-secret" name="app_secret" type="password">'
  html += '<button type="button" class="im-eye-btn" aria-label="toggle visibility">\uD83D\uDC41\uFE0F</button></div></div>'
  html += '<details class="im-advanced"><summary>\u9ad8\u7ea7\u8bbe\u7f6e</summary>'
  html += '<div class="im-advanced-body">'
  html += '<button type="button" class="btn btn-sm btn-outline" id="im-test-btn"><span class="im-signal-icon">\uD83D\uDCE1</span> \u6d4b\u8bd5\u8fde\u901a\u6027</button>'
  html += '</div></details>'
  html += '</form></main></div>'

  contentEl.innerHTML = html
  loadChannelConfig(selName)

  // Channel selection
  contentEl.querySelectorAll('.im-channel-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.im-toggle')) return
      contentEl.querySelectorAll('.im-channel-item').forEach(i => i.classList.remove('im-channel-item--active'))
      item.classList.add('im-channel-item--active')
      const ch = item.dataset.channel
      updateRightPanel(ch, CHANNEL_LABELS[ch], CHANNEL_ICONS[ch] || '', channelList.find(([n]) => n === ch)?.[1])
      loadChannelConfig(ch)
    })
  })

  // Toggle enable/disable
  contentEl.querySelectorAll('.channel-toggle').forEach(checkbox => {
    checkbox.onchange = async () => {
      const name = checkbox.dataset.channel
      const enabled = checkbox.checked
      try {
        const result = await api.enableChannel(name, enabled)
        if (result.success) {
          toast('Channel ' + name + (enabled ? ' enabled' : ' disabled'), 'success')
          loadChannels(page)
        } else {
          toast(result.message || 'Failed', 'error')
          checkbox.checked = !enabled
        }
      } catch (e) {
        toast('Error: ' + e, 'error')
        checkbox.checked = !enabled
      }
    }
  })

  // Eye toggle
  const eyeBtn = contentEl.querySelector('#im-app-secret')?.parentElement?.querySelector('.im-eye-btn')
  if (eyeBtn) {
    eyeBtn.onclick = () => {
      const input = contentEl.querySelector('#im-app-secret')
      input.type = input.type === 'password' ? 'text' : 'password'
    }
  }

  // Auto-save on input blur
  const configForm = contentEl.querySelector('#im-config-form')
  let _saveTimer = null
  async function autoSave() {
    const ch = configForm.dataset.channel
    const appId = configForm.querySelector('[name="app_id"]').value.trim()
    const secret = configForm.querySelector('[name="app_secret"]').value.trim()
    const newConfig = {}
    if (appId) newConfig.app_id = appId
    if (secret) newConfig.app_secret = secret
    try {
      const result = await api.updateChannelConfig(ch, newConfig)
      if (result.success) {
        toast('\u5df2\u4fdd\u5b58', 'success')
      } else {
        toast(result.message || '\u4fdd\u5b58\u5931\u8d25', 'error')
      }
    } catch (ex) {
      toast('\u4fdd\u5b58\u9519\u8bef: ' + ex, 'error')
    }
  }
  configForm.querySelectorAll('.im-input').forEach(input => {
    input.addEventListener('blur', () => { if (_saveTimer) clearTimeout(_saveTimer); _saveTimer = setTimeout(autoSave, 300) })
  })

  // Test connectivity
  const testBtn = contentEl.querySelector('#im-test-btn')
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const ch = configForm.dataset.channel
      const appId = configForm.querySelector('[name="app_id"]').value.trim()
      const secret = configForm.querySelector('[name="app_secret"]').value.trim()
      if (!appId || !secret) {
        toast('\u8bf7\u5148\u586b\u5199 App ID \u548c App Secret', 'warning')
        return
      }
      testBtn.disabled = true
      const origText = testBtn.innerHTML
      testBtn.innerHTML = '<span class="im-signal-icon">\uD83D\uDCE1</span> \u6d4b\u8bd5\u4e2d...'
      try {
        await api.updateChannelConfig(ch, { app_id: appId, app_secret: secret })
        toast('\u914d\u7f6e\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u5c1d\u8bd5\u8fde\u63a5...', 'info')
        const result = await api.restartChannel(ch)
        if (result.success) {
          toast('\u2705 ' + (result.message || '\u8fde\u901a\u6210\u529f'), 'success')
          setTimeout(() => loadChannels(page), 1000)
        } else {
          toast('\u274C ' + (result.message || '\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u51ed\u8bc1'), 'error')
        }
      } catch (ex) {
        toast('\u274C \u6d4b\u8bd5\u5931\u8d25: ' + ex, 'error')
      } finally {
        testBtn.disabled = false
        testBtn.innerHTML = origText
      }
    })
  }
}

function updateRightPanel(name, label, icon, status) {
  const main = document.getElementById('im-main-panel')
  if (!main) return
  const running = status?.running || false
  main.querySelector('.im-title-bar strong').textContent = label + '\u8bbe\u7f6e'
  main.querySelector('.im-title-icon').innerHTML = icon
  const st = main.querySelector('.im-title-status')
  st.textContent = running ? '\u5df2\u8fde\u63a5' : '\u672a\u8fde\u63a5'
  st.classList.toggle('im-title-status--off', !running)
  main.querySelector('#im-config-form').dataset.channel = name

  const tipsMap = {
    feishu: CHANNEL_TIPS.feishu,
    dingtalk: CHANNEL_TIPS.dingtalk,
  }
  const tipsEl = main.querySelector('.im-tips')
  if (tipsEl && (tipsMap[name])) {
    tipsEl.innerHTML = tipsMap[name]
  }
  main.querySelector('#im-app-id').value = ''
  main.querySelector('#im-app-secret').value = ''
}

async function loadChannelConfig(name) {
  const main = document.getElementById('im-main-panel')
  if (!main) return
  try {
    const configData = await api.getChannelConfig(name)
    const config = configData.config || {}
    const idInput = main.querySelector('#im-app-id')
    const secInput = main.querySelector('#im-app-secret')
    if (idInput) idInput.value = config.app_id || ''
    if (secInput) secInput.value = config.app_secret || ''
  } catch (e) {
    // silent
  }
}

function bindEvents(page) {
  const btn = page.querySelector('#btn-reload')
  if (btn) btn.onclick = () => loadChannels(page)
}
