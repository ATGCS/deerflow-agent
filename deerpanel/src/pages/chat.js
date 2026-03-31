/**
 * 聊天页面 - 完整版，对接 DeerPanel Gateway
 * 支持：流式响应、Markdown 渲染、会话管理、Agent 选择、快捷指�? */
import { api, invalidate } from '../lib/tauri-api.js'
import { navigate } from '../router.js'
import { wsClient, uuid } from '../lib/ws-client.js'
import { renderMarkdown } from '../lib/markdown.js'
import { saveMessage, saveMessages, getLocalMessages, isStorageAvailable } from '../lib/message-db.js'
import { toast } from '../components/toast.js'
import { showModal, showConfirm } from '../components/modal.js'
import { icon as svgIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'

const RENDER_THROTTLE = 30
const STORAGE_SESSION_KEY = 'deerpanel-last-session'
const STORAGE_MODEL_KEY = 'deerpanel-chat-selected-model'
const STORAGE_SIDEBAR_KEY = 'deerpanel-chat-sidebar-open'
const STORAGE_SESSION_NAMES_KEY = 'deerpanel-chat-session-names'

const COMMANDS = [
  { title: 'chat.cmdSession', commands: [
    { cmd: '/new', desc: 'chat.cmdNewSession', action: 'exec' },
    { cmd: '/reset', desc: 'chat.cmdResetSession', action: 'exec' },
    { cmd: '/stop', desc: 'chat.cmdStopGen', action: 'exec' },
  ]},
  { title: 'chat.cmdModel', commands: [
    { cmd: '/model ', desc: 'chat.cmdSwitchModel', action: 'fill' },
    { cmd: '/model list', desc: 'chat.cmdListModels', action: 'exec' },
    { cmd: '/model status', desc: 'chat.cmdModelStatus', action: 'exec' },
  ]},
  { title: 'chat.cmdThinkMode', commands: [
    { cmd: '/think off', desc: 'chat.cmdThinkOff', action: 'exec' },
    { cmd: '/think low', desc: 'chat.cmdThinkLow', action: 'exec' },
    { cmd: '/think medium', desc: 'chat.cmdThinkMedium', action: 'exec' },
    { cmd: '/think high', desc: 'chat.cmdThinkHigh', action: 'exec' },
  ]},
  { title: 'chat.cmdFastMode', commands: [
    { cmd: '/fast', desc: 'chat.cmdFastToggle', action: 'exec' },
    { cmd: '/fast on', desc: 'chat.cmdFastOn', action: 'exec' },
    { cmd: '/fast off', desc: 'chat.cmdFastOff', action: 'exec' },
  ]},
  { title: 'chat.cmdVerbose', commands: [
    { cmd: '/verbose off', desc: 'chat.cmdVerboseOff', action: 'exec' },
    { cmd: '/verbose low', desc: 'chat.cmdVerboseLow', action: 'exec' },
    { cmd: '/verbose high', desc: 'chat.cmdVerboseHigh', action: 'exec' },
    { cmd: '/reasoning off', desc: 'chat.cmdReasoningOff', action: 'exec' },
    { cmd: '/reasoning low', desc: 'chat.cmdReasoningLow', action: 'exec' },
    { cmd: '/reasoning medium', desc: 'chat.cmdReasoningMedium', action: 'exec' },
    { cmd: '/reasoning high', desc: 'chat.cmdReasoningHigh', action: 'exec' },
  ]},
  { title: 'chat.cmdInfo', commands: [
    { cmd: '/help', desc: 'chat.cmdHelp', action: 'exec' },
    { cmd: '/status', desc: 'chat.cmdStatus', action: 'exec' },
    { cmd: '/context', desc: 'chat.cmdContext', action: 'exec' },
  ]},
]

let _sessionKey = null, _page = null, _messagesEl = null, _textarea = null
let _sendBtn = null, _statusDot = null, _typingEl = null, _scrollBtn = null
let _sessionListEl = null, _cmdPanelEl = null, _attachPreviewEl = null, _fileInputEl = null
let _modelSelectEl = null
let _currentAiBubble = null, _currentAiText = '', _currentAiImages = [], _currentAiVideos = [], _currentAiAudios = [], _currentAiFiles = [], _currentAiTools = [], _currentRunId = null
let _isStreaming = false, _isSending = false, _messageQueue = [], _streamStartTime = 0
let _lastRenderTime = 0, _renderPending = false, _lastHistoryHash = ''
let _autoScrollEnabled = true, _lastScrollTop = 0, _touchStartY = 0
let _isLoadingHistory = false
let _streamSafetyTimer = null, _unsubEvent = null, _unsubReady = null, _unsubStatus = null
let _seenRunIds = new Set()
let _pageActive = false
const _toolEventTimes = new Map()
const _toolEventData = new Map()
const _toolRunIndex = new Map()
const _toolEventSeen = new Set()
let _errorTimer = null, _lastErrorMsg = null
let _responseWatchdog = null, _postFinalCheck = null
let _attachments = []
let _hasEverConnected = false
let _availableModels = []
let _primaryModel = ''
let _selectedModel = ''
let _isApplyingModel = false

// ── 托管 Agent ──
const HOSTED_STATUS = { IDLE: 'idle', RUNNING: 'running', WAITING: 'waiting_reply', PAUSED: 'paused', ERROR: 'error' }
const HOSTED_SESSIONS_KEY = 'deerpanel-hosted-agent-sessions'
const HOSTED_SYSTEM_PROMPT = `你是一个托管调�?Agent。你的职责是：根据用户设定的目标，持续引�?DeerPanel AI Agent 完成任务�?规则�?1. 你每一轮只输出一条简洁的指令�?-3 句话），发给 DeerPanel 执行
2. 根据 DeerPanel 的回复评估进展，决定下一步指�?3. 如果任务已完成或无法继续，回复包�?完成"�?停止"来结束循�?4. 不要重复相同的指令，不要输出解释性文字，只输出下一步要执行的指令`
const HOSTED_DEFAULTS = { enabled: false, prompt: '', autoRunAfterTarget: true, stopPolicy: 'self', maxSteps: 50, stepDelayMs: 1200, retryLimit: 2, autoStopMinutes: 0 }
const HOSTED_RUNTIME_DEFAULT = { status: HOSTED_STATUS.IDLE, stepCount: 0, lastRunAt: 0, lastRunId: '', lastError: '', pending: false, errorCount: 0 }
const HOSTED_CONTEXT_MAX = 30
const HOSTED_COMPRESS_THRESHOLD = 20
let _hostedBtn = null, _hostedPanelEl = null, _hostedBadgeEl = null
let _hostedPromptEl = null, _hostedMaxStepsEl = null, _hostedStepDelayEl = null, _hostedRetryLimitEl = null
let _hostedAutoStopEl = null
let _hostedSaveBtn = null, _hostedStopBtn = null, _hostedCloseBtn = null
let _hostedDefaults = null
let _hostedSessionConfig = null
let _hostedRuntime = { ...HOSTED_RUNTIME_DEFAULT }
let _hostedBusy = false
let _hostedAbort = null
let _hostedLastTargetTs = 0
let _hostedAutoStopTimer = null
let _hostedStartTime = 0

export async function render() {
  const page = document.createElement('div')
  page.className = 'page chat-page'
  _pageActive = true
  _page = page

  page.innerHTML = `
    <div class="chat-sidebar" id="chat-sidebar">
      <div class="chat-sidebar-header">
        <span>${t('chat.sessionList')}</span>
        <div class="chat-sidebar-header-actions">
          <button class="chat-sidebar-btn" id="btn-toggle-sidebar" title="${t('chat.sessionList')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <button class="chat-sidebar-btn" id="btn-new-session" title="${t('chat.newSession')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        </div>
      </div>
      <div class="chat-session-list" id="chat-session-list"></div>
    </div>
    <div class="chat-main">
      <div class="chat-header">
        <div class="chat-status">
          <button class="chat-toggle-sidebar" id="btn-toggle-sidebar-main" title="${t('chat.sessionList')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span class="status-dot" id="chat-status-dot"></span>
          <span class="chat-title" id="chat-title">${t('chat.chatTitle')}</span>
        </div>
        <div class="chat-header-actions">
          <div class="chat-model-group">
            <select class="form-input" id="chat-model-select" style="width:200px;max-width:28vw;padding:6px 10px;font-size:var(--font-size-xs)">
              <option value="">${t('chat.loadingModels')}</option>
            </select>
            <button class="btn btn-sm btn-ghost" id="btn-refresh-models" title="${t('chat.refreshModels')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            </button>
          </div>
          <button class="btn btn-sm btn-ghost" id="btn-cmd" title="${t('chat.shortcuts')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3 3 3 0 00-3-3H6a3 3 0 00-3 3 3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3 3 3 0 003 3h12a3 3 0 003-3 3 3 0 00-3-3z"/></svg>
          </button>
          <button class="btn btn-sm btn-ghost" id="btn-reset-session" title="${t('chat.resetSession')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
          </button>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="typing-indicator" id="typing-indicator" style="display:none">
          <span></span><span></span><span></span>
          <span class="typing-hint"></span>
        </div>
      </div>
      <button class="chat-scroll-btn" id="chat-scroll-btn" style="display:none">�?/button>
      <div class="chat-cmd-panel" id="chat-cmd-panel" style="display:none"></div>
      <div class="chat-attachments-preview" id="chat-attachments-preview" style="display:none"></div>
      <div class="chat-input-area">
        <input type="file" id="chat-file-input" accept="image/*" multiple style="display:none">
        <button class="chat-attach-btn" id="chat-attach-btn" title="${t('chat.uploadImage')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <div class="chat-input-wrapper">
          <textarea id="chat-input" rows="1" placeholder="${t('chat.inputPlaceholder')}"></textarea>
        </div>
        <button class="chat-send-btn" id="chat-send-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
        <button class="chat-hosted-btn btn btn-sm btn-ghost" id="chat-hosted-btn" title="${t('chat.hostedAgent')}">
          <span class="chat-hosted-label">�?/span>
          <span class="chat-hosted-badge idle" id="chat-hosted-badge">${t('chat.hostedBadge')}</span>
        </button>
      </div>
      <div class="hosted-agent-panel" id="hosted-agent-panel" style="display:none">
        <div class="hosted-agent-header">
          <strong>${t('chat.hostedAgent')}</strong>
          <button class="hosted-agent-close" id="hosted-agent-close" title="${t('common.close')}">&times;</button>
        </div>
        <div class="hosted-agent-body">
          <div class="form-group">
            <label class="form-label" style="color:var(--accent);font-weight:600">${t('chat.taskGoal')}</label>
            <textarea class="form-input hosted-agent-prompt" id="hosted-agent-prompt" rows="3" placeholder="${t('chat.taskGoalPlaceholder')}"></textarea>
            <div class="form-hint">${t('chat.hostedHint')}</div>
          </div>
          <div class="ha-slider-group">
            <div class="ha-slider-label">${t('chat.maxReplies')} <span class="ha-slider-val" id="ha-steps-val">50</span></div>
            <input type="range" class="ha-slider" id="hosted-agent-max-steps" min="5" max="205" step="5" value="50">
            <div class="ha-slider-ticks"><span>5</span><span>50</span><span>100</span><span>200</span><span>�?/span></div>
          </div>
          <div class="ha-timer-group">
            <div class="ha-timer-header">
              <span>${t('chat.timerAutoStop')}</span>
              <label class="ha-toggle"><input type="checkbox" id="hosted-agent-timer-on"><span class="ha-toggle-track"></span></label>
            </div>
            <div class="ha-timer-body" id="ha-timer-body" style="display:none">
              <input type="range" class="ha-slider" id="hosted-agent-auto-stop" min="5" max="120" step="5" value="30">
              <div class="ha-slider-ticks"><span>5m</span><span>30m</span><span>60m</span><span>120m</span></div>
              <div class="ha-countdown" id="ha-countdown" style="display:none">
                <div class="ha-countdown-bar"><div class="ha-countdown-fill" id="ha-countdown-fill"></div></div>
                <span class="ha-countdown-text" id="ha-countdown-text">${t('chat.remaining')} --:--</span>
              </div>
            </div>
          </div>
          <input type="hidden" id="hosted-agent-step-delay" value="1200">
          <input type="hidden" id="hosted-agent-retry" value="2">
        </div>
        <div class="hosted-agent-actions">
          <button class="btn btn-primary" id="hosted-agent-save" style="flex:1">${t('chat.startHosted')}</button>
        </div>
        <div class="hosted-agent-footer" id="hosted-agent-status">${t('chat.ready')}</div>
      </div>
      <div class="chat-disconnect-bar" id="chat-disconnect-bar" style="display:none">${t('chat.disconnected')}</div>
      <div class="chat-connect-overlay" id="chat-connect-overlay" style="display:none">
        <div class="chat-connect-card">
          <div class="chat-connect-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>
          </div>
          <div class="chat-connect-title">${t('chat.gatewayNotReady')}</div>
          <div class="chat-connect-desc" id="chat-connect-desc">${t('chat.connectingGateway')}</div>
          <div class="chat-connect-actions">
            <button class="btn btn-primary btn-sm" id="btn-fix-connect">${t('chat.fixAndReconnect')}</button>
            <button class="btn btn-secondary btn-sm" id="btn-goto-gateway">${t('chat.gatewaySettings')}</button>
          </div>
          <div class="chat-connect-hint">${t('chat.firstUseHint')}</div>
        </div>
      </div>
    </div>
  `

  _messagesEl = page.querySelector('#chat-messages')
  _textarea = page.querySelector('#chat-input')
  _sendBtn = page.querySelector('#chat-send-btn')
  _statusDot = page.querySelector('#chat-status-dot')
  _typingEl = page.querySelector('#typing-indicator')
  _scrollBtn = page.querySelector('#chat-scroll-btn')
  _sessionListEl = page.querySelector('#chat-session-list')
  _cmdPanelEl = page.querySelector('#chat-cmd-panel')
  _attachPreviewEl = page.querySelector('#chat-attachments-preview')
  _fileInputEl = page.querySelector('#chat-file-input')
  _modelSelectEl = page.querySelector('#chat-model-select')
  _hostedBtn = page.querySelector('#chat-hosted-btn')
  _hostedBadgeEl = page.querySelector('#chat-hosted-badge')
  _hostedPanelEl = page.querySelector('#hosted-agent-panel')
  _hostedPromptEl = page.querySelector('#hosted-agent-prompt')
  _hostedMaxStepsEl = page.querySelector('#hosted-agent-max-steps')
  _hostedStepDelayEl = page.querySelector('#hosted-agent-step-delay')
  _hostedRetryLimitEl = page.querySelector('#hosted-agent-retry')
  _hostedAutoStopEl = page.querySelector('#hosted-agent-auto-stop')
  _hostedSaveBtn = page.querySelector('#hosted-agent-save')
  _hostedCloseBtn = page.querySelector('#hosted-agent-close')
  page.querySelector('#chat-sidebar')?.classList.toggle('open', getSidebarOpen())

  bindEvents(page)
  bindConnectOverlay(page)

  // 首次使用引导提示
  showPageGuide(_messagesEl)

  loadHostedDefaults().then(() => { loadHostedSessionConfig(); renderHostedPanel(); updateHostedBadge() })
  loadModelOptions()
  // 非阻塞：先返�?DOM，后台连�?Gateway
  connectGateway()
  return page
}

const GUIDE_KEY = 'deerpanel-guide-chat-dismissed'

function showPageGuide(container) {
  if (localStorage.getItem(GUIDE_KEY)) return
  if (!container || container.querySelector('.chat-page-guide')) return
  const guide = document.createElement('div')
  guide.className = 'chat-page-guide'
  guide.innerHTML = `
    <div class="chat-guide-inner">
      <div class="chat-guide-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
      </div>
      <div class="chat-guide-content">
        <b>${t('chat.guideTitle')}</b>
        <p>${t('chat.guideDesc')}</p>
        <p style="opacity:0.7;font-size:11px">${t('chat.guideHint')}</p>
      </div>
      <button class="chat-guide-close" title="${t('chat.guideClose')}">&times;</button>
    </div>
  `
  guide.querySelector('.chat-guide-close').onclick = () => {
    localStorage.setItem(GUIDE_KEY, '1')
    guide.remove()
  }
  container.insertBefore(guide, container.firstChild)
}

// ── 事件绑定 ──

function bindEvents(page) {
  if (_modelSelectEl) {
    _modelSelectEl.addEventListener('change', () => {
      _selectedModel = _modelSelectEl.value
      if (_selectedModel) localStorage.setItem(STORAGE_MODEL_KEY, _selectedModel)
      else localStorage.removeItem(STORAGE_MODEL_KEY)
      applySelectedModel()
    })
  }

  _textarea.addEventListener('input', () => {
    _textarea.style.height = 'auto'
    _textarea.style.height = Math.min(_textarea.scrollHeight, 150) + 'px'
    updateSendState()
    // 输入 / 时显示指令面�?    if (_textarea.value === '/') showCmdPanel()
    else if (!_textarea.value.startsWith('/')) hideCmdPanel()
  })

  _textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
    if (e.key === 'Escape') hideCmdPanel()
  })

  _sendBtn.addEventListener('click', () => {
    if (_isStreaming) stopGeneration()
    else sendMessage()
  })

  if (_hostedBtn) _hostedBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleHostedPanel() })
  if (_hostedCloseBtn) _hostedCloseBtn.addEventListener('click', () => hideHostedPanel())
  if (_hostedSaveBtn) _hostedSaveBtn.addEventListener('click', () => toggleHostedRun())
  // 滑块实时值显�?  if (_hostedMaxStepsEl) _hostedMaxStepsEl.addEventListener('input', () => {
    const valEl = page.querySelector('#ha-steps-val')
    if (valEl) valEl.textContent = parseInt(_hostedMaxStepsEl.value) >= 205 ? '�? : _hostedMaxStepsEl.value
  })
  // 定时器开�?  const timerToggle = page.querySelector('#hosted-agent-timer-on')
  const timerBody = page.querySelector('#ha-timer-body')
  if (timerToggle && timerBody) {
    timerToggle.addEventListener('change', () => { timerBody.style.display = timerToggle.checked ? '' : 'none' })
  }

  const toggleSidebar = () => {
    const sidebar = page.querySelector('#chat-sidebar')
    if (!sidebar) return
    const nextOpen = !sidebar.classList.contains('open')
    sidebar.classList.toggle('open', nextOpen)
    setSidebarOpen(nextOpen)
  }
  page.querySelector('#btn-toggle-sidebar')?.addEventListener('click', toggleSidebar)
  page.querySelector('#btn-toggle-sidebar-main')?.addEventListener('click', toggleSidebar)
  page.querySelector('#btn-new-session').addEventListener('click', () => showNewSessionDialog())
  page.querySelector('#btn-cmd').addEventListener('click', () => toggleCmdPanel())
  page.querySelector('#btn-reset-session').addEventListener('click', () => resetCurrentSession())
  page.querySelector('#btn-refresh-models')?.addEventListener('click', () => loadModelOptions(true))

  // 文件上传
  page.querySelector('#chat-attach-btn').addEventListener('click', () => _fileInputEl.click())
  _fileInputEl.addEventListener('change', handleFileSelect)
  // 粘贴图片（Ctrl+V�?  _textarea.addEventListener('paste', handlePaste)

  _messagesEl.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = _messagesEl
    _scrollBtn.style.display = (scrollHeight - scrollTop - clientHeight < 80) ? 'none' : 'flex'
    if (scrollTop < _lastScrollTop - 2) _autoScrollEnabled = false
    if (isAtBottom()) _autoScrollEnabled = true
    _lastScrollTop = scrollTop
  })
  _messagesEl.addEventListener('wheel', (e) => {
    if (e.deltaY < 0) _autoScrollEnabled = false
  }, { passive: true })
  _messagesEl.addEventListener('touchstart', (e) => {
    _touchStartY = e.touches?.[0]?.clientY || 0
  }, { passive: true })
  _messagesEl.addEventListener('touchmove', (e) => {
    const y = e.touches?.[0]?.clientY || 0
    if (y > _touchStartY + 2) _autoScrollEnabled = false
  }, { passive: true })
  _scrollBtn.addEventListener('click', () => {
    _autoScrollEnabled = true
    scrollToBottom(true)
  })
  _messagesEl.addEventListener('click', () => hideCmdPanel())
}

async function loadModelOptions(showToast = false) {
  if (!_modelSelectEl) return
  // 显示加载状�?  _modelSelectEl.innerHTML = `<option value="">${t('chat.loadingModels')}</option>`
  _modelSelectEl.disabled = true
  try {
    invalidate('read_deerpanel_config')
    const configPromise = api.readOpenclawConfig()
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout(8s)')), 8000))
    const config = await Promise.race([configPromise, timeoutPromise])
    const providers = config?.models?.providers || {}
    _primaryModel = config?.agents?.defaults?.model?.primary || ''
    const models = []
    const seen = new Set()
    if (_primaryModel) {
      seen.add(_primaryModel)
      models.push(_primaryModel)
    }
    for (const [providerKey, provider] of Object.entries(providers)) {
      for (const item of (provider?.models || [])) {
        const modelId = typeof item === 'string' ? item : item?.id
        if (!modelId) continue
        const full = `${providerKey}/${modelId}`
        if (seen.has(full)) continue
        seen.add(full)
        models.push(full)
      }
    }
    _availableModels = models
    const saved = localStorage.getItem(STORAGE_MODEL_KEY) || ''
    _selectedModel = models.includes(saved) ? saved : (_primaryModel || models[0] || '')
    renderModelSelect()
    if (showToast) toast(`${t('chat.refreshModels')} (${models.length})`, 'success')
  } catch (e) {
    _availableModels = []
    _primaryModel = ''
    _selectedModel = ''
    renderModelSelect(`${t('common.loadFailed')}: ${e.message || e}`)
    if (showToast) toast(`${t('common.loadFailed')}: ${e.message || e}`, 'error')
  }
}

function renderModelSelect(errorText = '') {
  if (!_modelSelectEl) return
  if (!_availableModels.length) {
    _modelSelectEl.innerHTML = `<option value="">${escapeAttr(errorText || t('chat.loadingModels'))}</option>`
    _modelSelectEl.disabled = true
    _modelSelectEl.title = errorText || ''
    return
  }
  _modelSelectEl.disabled = _isApplyingModel
  _modelSelectEl.innerHTML = _availableModels.map(full => {
    const suffix = full === _primaryModel ? ` ${t('chat.defaultSuffix')}` : ''
    return `<option value="${escapeAttr(full)}" ${full === _selectedModel ? 'selected' : ''}>${full}${suffix}</option>`
  }).join('')
  _modelSelectEl.title = _selectedModel || ''
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 本地会话别名缓存 */
function getSessionNames() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_NAMES_KEY) || '{}') } catch { return {} }
}
function setSessionName(key, name) {
  const names = getSessionNames()
  if (name) names[key] = name
  else delete names[key]
  localStorage.setItem(STORAGE_SESSION_NAMES_KEY, JSON.stringify(names))
}
function getDisplayLabel(key) {
  const custom = getSessionNames()[key]
  return custom || parseSessionLabel(key)
}

function getSidebarOpen() {
  return localStorage.getItem(STORAGE_SIDEBAR_KEY) === '1'
}

function setSidebarOpen(open) {
  localStorage.setItem(STORAGE_SIDEBAR_KEY, open ? '1' : '0')
}

async function applySelectedModel() {
  if (!_selectedModel) {
    toast(t('chat.loadingModels'), 'warning')
    return
  }
  if (!wsClient.gatewayReady || !_sessionKey) {
    toast(t('chat.gatewayNotReadySend'), 'warning')
    return
  }
  _isApplyingModel = true
  renderModelSelect()
  try {
    await wsClient.chatSend(_sessionKey, `/model ${_selectedModel}`)
    toast(`${_selectedModel}`, 'success')
  } catch (e) {
    toast(`${t('chat.sendFailed')}${e.message || e}`, 'error')
  } finally {
    _isApplyingModel = false
    renderModelSelect()
  }
}

// ── 连接引导遮罩 ──

function bindConnectOverlay(page) {
  const fixBtn = page.querySelector('#btn-fix-connect')
  const gwBtn = page.querySelector('#btn-goto-gateway')

  if (fixBtn) {
    fixBtn.addEventListener('click', async () => {
      fixBtn.disabled = true
      fixBtn.textContent = t('chat.fixing')
      const desc = document.getElementById('chat-connect-desc')
      try {
        if (desc) desc.textContent = t('chat.writingConfig')
        await api.autoPairDevice()
        await api.reloadGateway()
        if (desc) desc.textContent = t('chat.fixDoneReconnecting')
        // 断开旧连接，重新发起
        wsClient.disconnect()
        setTimeout(() => connectGateway(), 3000)
      } catch (e) {
        if (desc) desc.textContent = `${t('chat.fixFailed')}${e.message || e}`
      } finally {
        fixBtn.disabled = false
        fixBtn.textContent = t('chat.fixAndReconnect')
      }
    })
  }

  if (gwBtn) {
    gwBtn.addEventListener('click', () => navigate('/gateway'))
  }
}

// ── 文件上传 ──

async function handleFileSelect(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      toast(t('chat.imageOnly'), 'warning')
      continue
    }
    if (file.size > 5 * 1024 * 1024) {
      toast(`${file.name} > 5MB`, 'warning')
      continue
    }

    try {
      const base64 = await fileToBase64(file)
      _attachments.push({
        type: 'image',
        mimeType: file.type,
        fileName: file.name,
        content: base64,
      })
      renderAttachments()
    } catch (e) {
      toast(`${t('chat.readFileFailed')} ${file.name}`, 'error')
    }
  }
  _fileInputEl.value = ''
}

async function handlePaste(e) {
  const items = Array.from(e.clipboardData?.items || [])
  const imageItems = items.filter(item => item.type.startsWith('image/'))
  if (!imageItems.length) return
  e.preventDefault()
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    if (file.size > 5 * 1024 * 1024) { toast(t('chat.imageSizeLimit'), 'warning'); continue }
    try {
      const base64 = await fileToBase64(file)
      _attachments.push({ type: 'image', mimeType: file.type || 'image/png', fileName: `paste-${Date.now()}.png`, content: base64 })
      renderAttachments()
    } catch (_) { toast(t('chat.readFileFailed'), 'error') }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl)
      if (!match) { reject(new Error('invalid data URL')); return }
      resolve(match[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function renderAttachments() {
  if (!_attachPreviewEl) return
  if (!_attachments.length) {
    _attachPreviewEl.style.display = 'none'
    return
  }
  _attachPreviewEl.style.display = 'flex'
  _attachPreviewEl.innerHTML = _attachments.map((att, idx) => `
    <div class="chat-attachment-item">
      <img src="data:${att.mimeType};base64,${att.content}" alt="${att.fileName}">
      <button class="chat-attachment-del" data-idx="${idx}">×</button>
    </div>
  `).join('')

  _attachPreviewEl.querySelectorAll('.chat-attachment-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx)
      _attachments.splice(idx, 1)
      renderAttachments()
    })
  })
  updateSendState()
}

// ── Gateway 连接 ──

async function connectGateway() {
  try {
    // 清理旧的订阅，避免重复监�?    if (_unsubStatus) { _unsubStatus(); _unsubStatus = null }
    if (_unsubReady) { _unsubReady(); _unsubReady = null }
    if (_unsubEvent) { _unsubEvent(); _unsubEvent = null }

    // 订阅状态变化（订阅式，返回 unsub�?    _unsubStatus = wsClient.onStatusChange((status, errorMsg) => {
      if (!_pageActive) return
      updateStatusDot(status)
      const bar = document.getElementById('chat-disconnect-bar')
      const overlay = document.getElementById('chat-connect-overlay')
      const desc = document.getElementById('chat-connect-desc')
      if (status === 'ready' || status === 'connected') {
        _hasEverConnected = true
        if (bar) bar.style.display = 'none'
        if (overlay) overlay.style.display = 'none'
        // WS 已连接，主动刷新 Gateway 状态以消除顶部横条延迟
        import('../lib/app-state.js').then(m => m.refreshGatewayStatus()).catch(() => {})
      } else if (status === 'error') {
        // 连接错误：显示引导遮罩而非底部�?        if (bar) bar.style.display = 'none'
        if (overlay) {
          overlay.style.display = 'flex'
          if (desc) desc.textContent = errorMsg || t('chat.connectFailed')
        }
      } else if (status === 'reconnecting' || status === 'disconnected') {
        // 首次连接或多次重连失败时，显示引导遮罩而非底部小条
        if (!_hasEverConnected) {
          if (overlay) { overlay.style.display = 'flex'; if (desc) desc.textContent = t('chat.connectingGateway') }
        } else {
          if (bar) { bar.textContent = t('chat.disconnected'); bar.style.display = 'flex' }
        }
      } else {
        if (bar) bar.style.display = 'none'
      }
    })

    _unsubReady = wsClient.onReady((hello, sessionKey, err) => {
      if (!_pageActive) return
      const overlay = document.getElementById('chat-connect-overlay')
      if (err?.error) {
        if (overlay) {
          overlay.style.display = 'flex'
          const desc = document.getElementById('chat-connect-desc')
          if (desc) desc.textContent = err.message || t('chat.connectFailed')
        }
        return
      }
      if (overlay) overlay.style.display = 'none'
      showTyping(false)  // Gateway 就绪后关闭加载动�?      // 重连后恢复：保留当前 sessionKey，不重复加载历史
      if (!_sessionKey) {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY)
        _sessionKey = saved || sessionKey
        updateSessionTitle()
        loadHistory()
      }
      // 始终刷新会话列表（无论是否有 sessionKey�?      refreshSessionList()
    })

    _unsubEvent = wsClient.onEvent((msg) => {
      if (!_pageActive) return
      handleEvent(msg)
    })

    // 如果已连接且 Gateway 就绪，直接复�?    if (wsClient.connected && wsClient.gatewayReady) {
      const saved = localStorage.getItem(STORAGE_SESSION_KEY)
      _sessionKey = saved || wsClient.sessionKey
      updateStatusDot('ready')
      showTyping(false)  // 确保关闭加载动画
      updateSessionTitle()
      loadHistory()
      refreshSessionList()
      return
    }

    // 如果正在连接中（重连等），等�?onReady 回调即可
    if (wsClient.connected || wsClient.connecting || wsClient.gatewayReady) return

    // 未连接，发起新连�?    const config = await api.readOpenclawConfig()
    const gw = config?.gateway || {}
    const host = window.__TAURI_INTERNALS__ ? `127.0.0.1:${gw.port || 18789}` : location.host
    const token = gw.auth?.token || gw.authToken || ''
    wsClient.connect(host, token)
  } catch (e) {
    toast(`${t('common.loadFailed')}: ${e.message}`, 'error')
  }
}

// ── 会话管理 ──

async function refreshSessionList() {
  if (!_sessionListEl || !wsClient.gatewayReady) return
  try {
    const result = await wsClient.sessionsList(50)
    const sessions = result?.sessions || result || []
    renderSessionList(sessions)
  } catch (e) {
    console.error('[chat] refreshSessionList error:', e)
  }
}

function renderSessionList(sessions) {
  if (!_sessionListEl) return
  if (!sessions.length) {
    _sessionListEl.innerHTML = `<div class="chat-session-empty">${t('chat.noSessions')}</div>`
    return
  }
  sessions.sort((a, b) => (b.updatedAt || b.lastActivity || 0) - (a.updatedAt || a.lastActivity || 0))
  _sessionListEl.innerHTML = sessions.map(s => {
    const key = s.sessionKey || s.key || ''
    const active = key === _sessionKey ? ' active' : ''
    const label = parseSessionLabel(key)
    const ts = s.updatedAt || s.lastActivity || s.createdAt || 0
    const timeStr = ts ? formatSessionTime(ts) : ''
    const msgCount = s.messageCount || s.messages || 0
    const agentId = parseSessionAgent(key)
    const displayLabel = getDisplayLabel(key) || label
    return `<div class="chat-session-card${active}" data-key="${escapeAttr(key)}">
      <div class="chat-session-card-header">
        <span class="chat-session-label" title="${t('chat.doubleClickRename')}">${escapeAttr(displayLabel)}</span>
        <button class="chat-session-del" data-del="${escapeAttr(key)}" title="${t('common.delete')}">×</button>
      </div>
      <div class="chat-session-card-meta">
        ${agentId && agentId !== 'main' ? `<span class="chat-session-agent">${escapeAttr(agentId)}</span>` : ''}
        ${msgCount > 0 ? `<span>${msgCount} msgs</span>` : ''}
        ${timeStr ? `<span>${timeStr}</span>` : ''}
      </div>
    </div>`
  }).join('')

  _sessionListEl.onclick = (e) => {
    const delBtn = e.target.closest('[data-del]')
    if (delBtn) { e.stopPropagation(); deleteSession(delBtn.dataset.del); return }
    const item = e.target.closest('[data-key]')
    if (item) switchSession(item.dataset.key)
  }
  _sessionListEl.ondblclick = (e) => {
    const labelEl = e.target.closest('.chat-session-label')
    if (!labelEl) return
    const card = labelEl.closest('[data-key]')
    if (!card) return
    e.stopPropagation()
    renameSession(card.dataset.key, labelEl)
  }
}

function formatSessionTime(ts) {
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 60000) return t('chat.justNow')
  if (diffMs < 3600000) return t('chat.minutesAgo', { n: Math.floor(diffMs / 60000) })
  if (diffMs < 86400000) return t('chat.hoursAgo', { n: Math.floor(diffMs / 3600000) })
  if (diffMs < 604800000) return t('chat.daysAgo', { n: Math.floor(diffMs / 86400000) })
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}

function parseSessionAgent(key) {
  const parts = (key || '').split(':')
  return parts.length >= 2 ? parts[1] : ''
}

function parseSessionLabel(key) {
  const parts = (key || '').split(':')
  if (parts.length < 3) return key || t('common.unknown')
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return t('chat.mainSession')
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

function switchSession(newKey) {
  if (newKey === _sessionKey) return
  _sessionKey = newKey
  localStorage.setItem(STORAGE_SESSION_KEY, newKey)
  _lastHistoryHash = ''
  resetStreamState()
  updateSessionTitle()
  clearMessages()
  loadHistory()
  refreshSessionList()
}

async function showNewSessionDialog() {
  const defaultAgent = wsClient.snapshot?.sessionDefaults?.defaultAgentId || 'main'

  // 先用默认选项立即显示弹窗
  const initialOptions = [
    { value: 'main', label: `main ${t('chat.defaultSuffix')}` },
    { value: '__new__', label: `+ ${t('chat.newAgent')}` }
  ]

  showModal({
    title: t('chat.newSession'),
    fields: [
      { name: 'name', label: t('chat.sessionName'), value: '', placeholder: t('chat.sessionNamePlaceholder') },
      { name: 'agent', label: 'Agent', type: 'select', value: defaultAgent, options: initialOptions },
    ],
    onConfirm: (result) => {
      const name = (result.name || '').trim()
      if (!name) { toast(t('chat.enterSessionName'), 'warning'); return }
      const agent = result.agent || defaultAgent
      if (agent === '__new__') {
        navigate('/agents')
        toast(t('chat.createAgentHint'), 'info')
        return
      }
      switchSession(`agent:${agent}:${name}`)
      toast(t('chat.sessionCreated'), 'success')
    }
  })

  // 异步加载完整 Agent 列表并更新下拉框
  try {
    const agents = await api.listAgents()
    const agentOptions = agents.map(a => ({
      value: a.id,
      label: `${a.id}${a.isDefault ? ` ${t('chat.defaultSuffix')}` : ''}${a.identityName ? ' �?' + a.identityName.split(',')[0] : ''}`
    }))
    agentOptions.push({ value: '__new__', label: `+ ${t('chat.newAgent')}` })

    // 更新弹窗中的下拉框选项
    const selectEl = document.querySelector('.modal-overlay [data-name="agent"]')
    if (selectEl) {
      const currentValue = selectEl.value
      selectEl.innerHTML = agentOptions.map(o =>
        `<option value="${o.value}" ${o.value === currentValue ? 'selected' : ''}>${o.label}</option>`
      ).join('')
    }
  } catch (e) {
    console.warn('[chat] 加载 Agent 列表失败:', e)
  }
}

async function deleteSession(key) {
  const mainKey = wsClient.snapshot?.sessionDefaults?.mainSessionKey || 'agent:main:main'
  if (key === mainKey) { toast(t('chat.cannotDeleteMain'), 'warning'); return }
  const label = parseSessionLabel(key)
  const yes = await showConfirm(t('chat.confirmDeleteSession', { label }))
  if (!yes) return
  try {
    await wsClient.sessionsDelete(key)
    toast(t('chat.sessionDeleted'), 'success')
    if (key === _sessionKey) switchSession(mainKey)
    else refreshSessionList()
  } catch (e) {
    toast(`${t('common.operationFailed')}: ${e.message}`, 'error')
  }
}

async function resetCurrentSession() {
  if (!_sessionKey) return
  const label = getDisplayLabel(_sessionKey)
  const yes = await showConfirm(t('chat.confirmResetSession', { label }))
  if (!yes) return
  try {
    await wsClient.sessionsReset(_sessionKey)
    clearMessages()
    _lastHistoryHash = ''
    appendSystemMessage(t('chat.sessionResetDone'))
    toast(t('chat.sessionResetDone'), 'success')
  } catch (e) {
    toast(`${t('common.operationFailed')}: ${e.message}`, 'error')
  }
}

function updateSessionTitle() {
  const el = _page?.querySelector('#chat-title')
  if (el) el.textContent = getDisplayLabel(_sessionKey)
}

function renameSession(key, labelEl) {
  const current = getDisplayLabel(key)
  const input = document.createElement('input')
  input.type = 'text'
  input.value = current
  input.className = 'chat-session-rename-input'
  input.style.cssText = 'width:100%;padding:2px 6px;border:1px solid var(--accent);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);font-size:12px;outline:none'
  const originalText = labelEl.textContent
  labelEl.textContent = ''
  labelEl.appendChild(input)
  input.focus()
  input.select()

  let done = false
  const finish = () => {
    if (done) return
    done = true
    const newName = input.value.trim()
    if (newName && newName !== parseSessionLabel(key)) {
      setSessionName(key, newName)
      toast(t('chat.sessionRenamed'), 'success')
    } else if (!newName || newName === parseSessionLabel(key)) {
      setSessionName(key, '') // clear custom name
    }
    labelEl.textContent = getDisplayLabel(key)
    // 如果是当前会话，同步更新顶部标题
    if (key === _sessionKey) updateSessionTitle()
  }
  input.addEventListener('blur', finish)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur() }
    if (e.key === 'Escape') { input.value = originalText; input.blur() }
  })
}

// ── 快捷指令面板 ──

function showCmdPanel() {
  if (!_cmdPanelEl) return
  let html = ''
  for (const group of COMMANDS) {
    html += `<div class="cmd-group-title">${t(group.title)}</div>`
    for (const c of group.commands) {
      html += `<div class="cmd-item" data-cmd="${c.cmd}" data-action="${c.action}">
        <span class="cmd-name">${c.cmd}</span>
        <span class="cmd-desc">${t(c.desc)}</span>
      </div>`
    }
  }
  _cmdPanelEl.innerHTML = html
  _cmdPanelEl.style.display = 'block'
  _cmdPanelEl.onclick = (e) => {
    const item = e.target.closest('.cmd-item')
    if (!item) return
    hideCmdPanel()
    if (item.dataset.action === 'fill') {
      _textarea.value = item.dataset.cmd
      _textarea.focus()
      updateSendState()
    } else {
      _textarea.value = item.dataset.cmd
      sendMessage()
    }
  }
}

function hideCmdPanel() {
  if (_cmdPanelEl) _cmdPanelEl.style.display = 'none'
}

function toggleCmdPanel() {
  if (_cmdPanelEl?.style.display === 'block') hideCmdPanel()
  else { _textarea.value = '/'; showCmdPanel(); _textarea.focus() }
}

// ── 消息发�?──

function sendMessage() {
  const text = _textarea.value.trim()
  if (!text && !_attachments.length) return
  if (!wsClient.gatewayReady || !_sessionKey) {
    toast(t('chat.gatewayNotReadySend'), 'warning')
    return
  }
  hideCmdPanel()
  _textarea.value = ''
  _textarea.style.height = 'auto'
  updateSendState()
  const attachments = [..._attachments]
  _attachments = []
  renderAttachments()
  if (_isSending || _isStreaming) { _messageQueue.push({ text, attachments }); return }
  doSend(text, attachments)
}

async function doSend(text, attachments = []) {
  if (!wsClient.gatewayReady || !_sessionKey) {
    toast(t('chat.gatewayNotReadySend'), 'warning')
    return
  }
  appendUserMessage(text, attachments)
  saveMessage({
    id: uuid(), sessionKey: _sessionKey, role: 'user', content: text, timestamp: Date.now(),
    attachments: attachments?.length ? attachments.map(a => ({ category: a.category || 'image', mimeType: a.mimeType || '', content: a.content || '', url: a.url || '' })) : undefined
  })
  showTyping(true)
  _isSending = true
  _startResponseWatchdog()
  try {
    await wsClient.chatSend(_sessionKey, text, attachments.length ? attachments : undefined)
  } catch (err) {
    showTyping(false)
    _cancelResponseWatchdog()
    appendSystemMessage(`${t('chat.sendFailed')}${err.message}`)
  } finally {
    _isSending = false
    updateSendState()
  }
}

function processMessageQueue() {
  if (_messageQueue.length === 0 || _isSending || _isStreaming) return
  const msg = _messageQueue.shift()
  if (typeof msg === 'string') doSend(msg, [])
  else doSend(msg.text, msg.attachments || [])
}

function stopGeneration() {
  if (_currentRunId) wsClient.chatAbort(_sessionKey, _currentRunId).catch(() => {})
}

// ── 事件处理（参�?clawapp 实现�?──

function handleEvent(msg) {
  const { event, payload } = msg
  if (!payload) return

  if (event === 'agent' && payload?.stream === 'tool' && payload?.data?.toolCallId) {
    const ts = payload.ts
    const toolCallId = payload.data.toolCallId
    const runKey = `${payload.runId}:${toolCallId}`
    if (_toolEventSeen.has(runKey)) return
    _toolEventSeen.add(runKey)
    if (ts) _toolEventTimes.set(toolCallId, ts)
    const current = _toolEventData.get(toolCallId) || {}
    if (payload.data?.args && current.input == null) current.input = payload.data.args
    if (payload.data?.meta && current.output == null) current.output = payload.data.meta
    if (typeof payload.data?.isError === 'boolean' && current.status == null) current.status = payload.data.isError ? 'error' : 'ok'
    if (current.time == null) current.time = ts || null
    _toolEventData.set(toolCallId, current)
    if (payload.runId) {
      const list = _toolRunIndex.get(payload.runId) || []
      if (!list.includes(toolCallId)) list.push(toolCallId)
      _toolRunIndex.set(payload.runId, list)
    }
    // 工具执行反馈：更�?typing 提示文字
    const toolName = payload.data?.name || payload.data?.toolName || ''
    if (toolName && !_isStreaming) {
      showTyping(true, t('chat.usingTool', { name: toolName }))
    }
  }

  if (event === 'chat') handleChatEvent(payload)

  // Compaction 状态指示：上游 2026.3.12 新增 status_reaction 事件
  if (event === 'chat.status_reaction' || event === 'status_reaction') {
    const reaction = payload.reaction || payload.emoji || ''
    if (reaction.includes('compact') || reaction === '🗜�? || reaction === '📦') {
      showCompactionHint(true)
    } else if (!reaction || reaction === 'thinking' || reaction === '💭') {
      showCompactionHint(false)
    }
  }
}

function handleChatEvent(payload) {
  // sessionKey 过滤
  if (payload.sessionKey && payload.sessionKey !== _sessionKey && _sessionKey) return

  const { state } = payload
  const runId = payload.runId

  // 重复 run 过滤：跳过已完成�?runId 的后续事件（Gateway 可能对同一消息触发多个 run�?  if (runId && state === 'final' && _seenRunIds.has(runId)) {
    console.log('[chat] 跳过重复 final, runId:', runId)
    return
  }
  if (runId && state === 'delta' && _seenRunIds.has(runId) && !_isStreaming) {
    console.log('[chat] 跳过已完�?run �?delta, runId:', runId)
    return
  }

  if (state === 'delta') {
    _cancelResponseWatchdog()
    const c = extractChatContent(payload.message)
    if (c?.images?.length) _currentAiImages = c.images
    if (c?.videos?.length) _currentAiVideos = c.videos
    if (c?.audios?.length) _currentAiAudios = c.audios
    if (c?.files?.length) _currentAiFiles = c.files
    if (c?.tools?.length) _currentAiTools = c.tools
    if (c?.text && c.text.length > _currentAiText.length) {
      showTyping(false)
      if (!_currentAiBubble) {
        _currentAiBubble = createStreamBubble()
        _currentRunId = payload.runId
        _isStreaming = true
        _streamStartTime = Date.now()
        updateSendState()
      }
      _currentAiText = c.text
      // 每次收到 delta 重置安全超时�?0s 无新 delta 则强制结束）
      clearTimeout(_streamSafetyTimer)
      _streamSafetyTimer = setTimeout(() => {
        if (_isStreaming) {
          console.warn('[chat] 流式输出超时�?0s 无新数据），强制结束')
          if (_currentAiBubble && _currentAiText) {
            _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
          }
          appendSystemMessage(t('chat.streamTimeout'))
          resetStreamState()
          processMessageQueue()
        }
      }, 90000)
      throttledRender()
    }
    return
  }

  if (state === 'final') {
    _cancelResponseWatchdog()
    const c = extractChatContent(payload.message)
    const finalText = c?.text || ''
    const finalImages = c?.images || []
    const finalVideos = c?.videos || []
    const finalAudios = c?.audios || []
    const finalFiles = c?.files || []
    let finalTools = c?.tools || []
    if (!finalTools.length && runId) {
      const ids = _toolRunIndex.get(runId) || []
      finalTools = ids.map(id => mergeToolEventData({ id, name: 'tool' })).filter(Boolean)
    }
    if (finalImages.length) _currentAiImages = finalImages
    if (finalVideos.length) _currentAiVideos = finalVideos
    if (finalAudios.length) _currentAiAudios = finalAudios
    if (finalFiles.length) _currentAiFiles = finalFiles
    if (finalTools.length) _currentAiTools = finalTools
    const hasContent = finalText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length || _currentAiTools.length
    // 忽略�?final（Gateway 会为一条消息触发多�?run，部分是�?final�?    if (!_currentAiBubble && !hasContent) return
    // 标记 runId 为已处理，防止重�?    if (runId) {
      _seenRunIds.add(runId)
      if (_seenRunIds.size > 200) {
        const first = _seenRunIds.values().next().value
        _seenRunIds.delete(first)
      }
    }
    showTyping(false)
    // 如果流式阶段没有创建 bubble，从 final message 中提�?    if (!_currentAiBubble && hasContent) {
      _currentAiBubble = createStreamBubble()
      _currentAiText = finalText
    }
    if (_currentAiBubble) {
      if (_currentAiText) _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
      appendImagesToEl(_currentAiBubble, _currentAiImages)
      appendVideosToEl(_currentAiBubble, _currentAiVideos)
      appendAudiosToEl(_currentAiBubble, _currentAiAudios)
      appendFilesToEl(_currentAiBubble, _currentAiFiles)
      appendToolsToEl(_currentAiBubble, finalTools.length ? finalTools : _currentAiTools)
    }
    // 添加时间�?+ 耗时 + token 消�?    const wrapper = _currentAiBubble?.parentElement
    if (wrapper) {
      const meta = document.createElement('div')
      meta.className = 'msg-meta'
      let parts = [`<span class="msg-time">${formatTime(new Date())}</span>`]
      // 计算响应耗时
      let durStr = ''
      if (payload.durationMs) {
        durStr = (payload.durationMs / 1000).toFixed(1) + 's'
      } else if (_streamStartTime) {
        durStr = ((Date.now() - _streamStartTime) / 1000).toFixed(1) + 's'
      }
      if (durStr) parts.push(`<span class="meta-sep">·</span><span class="msg-duration">�?${durStr}</span>`)
      // token 消耗（�?payload.usage �?payload.message.usage 提取�?      const usage = payload.usage || payload.message?.usage || null
      if (usage) {
        const inp = usage.input_tokens || usage.prompt_tokens || 0
        const out = usage.output_tokens || usage.completion_tokens || 0
        const total = usage.total_tokens || (inp + out)
        if (total > 0) {
          let tokenStr = `${total} tokens`
          if (inp && out) tokenStr = `�?{inp} �?{out}`
          parts.push(`<span class="meta-sep">·</span><span class="msg-tokens">${tokenStr}</span>`)
        }
      }
      meta.innerHTML = parts.join('')
      wrapper.appendChild(meta)
    }
    if (_currentAiText || _currentAiImages.length) {
      saveMessage({
        id: payload.runId || uuid(), sessionKey: _sessionKey, role: 'assistant',
        content: _currentAiText, timestamp: Date.now(),
        attachments: _currentAiImages.map(i => ({ category: 'image', mimeType: i.mediaType || 'image/png', url: i.url, content: i.data })).filter(a => a.url || a.content)
      })
    }
    // 托管 Agent：捕�?AI 回复，检测停止信号，决定是否继续
    if (shouldCaptureHostedTarget(payload)) {
      const capturedText = finalText || _currentAiText || ''
      if (capturedText) {
        appendHostedTarget(capturedText)
        if (detectStopFromText(capturedText)) {
          appendHostedOutput(t('chat.hostedAutoStopSignal'))
          stopHostedAgent()
        } else {
          maybeTriggerHostedRun()
        }
      }
    }
    resetStreamState()
    _schedulePostFinalCheck()
    processMessageQueue()
    return
  }

  if (state === 'aborted') {
    showTyping(false)
    if (_currentAiBubble && _currentAiText) {
      _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    }
    appendSystemMessage(t('chat.generationStopped'))
    resetStreamState()
    processMessageQueue()
    return
  }

  if (state === 'error') {
    const errMsg = payload.errorMessage || payload.error?.message || t('common.error')

    // 连接级错误（origin/pairing/auth）拦截，不作为聊天消息显�?    if (/origin not allowed|NOT_PAIRED|PAIRING_REQUIRED|auth.*fail/i.test(errMsg)) {
      console.warn('[chat] 拦截连接级错误，不显示为聊天消息:', errMsg)
      const overlay = document.getElementById('chat-connect-overlay')
      if (overlay) {
        overlay.style.display = 'flex'
        const desc = document.getElementById('chat-connect-desc')
        if (desc) desc.textContent = t('chat.connectionRejected')
      }
      return
    }

    // 防抖：如果是相同错误且在 2 秒内，忽略（避免重复显示�?    const now = Date.now()
    if (_lastErrorMsg === errMsg && _errorTimer && (now - _errorTimer < 2000)) {
      console.warn('[chat] 忽略重复错误:', errMsg)
      return
    }
    _lastErrorMsg = errMsg
    _errorTimer = now

    // 如果正在流式输出，说明消息已经部分成功，不显示错�?    if (_isStreaming || _currentAiBubble) {
      console.warn('[chat] 流式中收到错误，但消息已部分成功，忽略错误提�?', errMsg)
      return
    }

    showTyping(false)
    appendSystemMessage(`${t('chat.errorPrefix')}${errMsg}`)
    resetStreamState()
    processMessageQueue()
    return
  }
}

/** �?Gateway message 对象提取文本和所有媒体（参照 clawapp extractContent�?*/
function extractChatContent(message) {
  if (!message || typeof message !== 'object') return null
  const tools = []
  collectToolsFromMessage(message, tools)
  if (message.role === 'tool' || message.role === 'toolResult') {
    const output = typeof message.content === 'string' ? message.content : null
    if (!tools.length) {
      tools.push({
        name: message.name || message.tool || message.tool_name || 'tool',
        input: message.input || message.args || message.parameters || null,
        output: output || message.output || message.result || null,
        status: message.status || 'ok',
      })
    } else if (output && !tools[0].output) {
      tools[0].output = output
    }
    return { text: '', images: [], videos: [], audios: [], files: [], tools }
  }
  const content = message.content
  if (typeof content === 'string') return { text: stripThinkingTags(content), images: [], videos: [], audios: [], files: [], tools }
  if (Array.isArray(content)) {
    const texts = [], images = [], videos = [], audios = [], files = []
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      else if (block.type === 'image' && !block.omitted) {
        if (block.data) images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        else if (block.source?.type === 'base64' && block.source.data) images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        else if (block.url || block.source?.url) images.push({ url: block.url || block.source.url, mediaType: block.mimeType || 'image/png' })
      }
      else if (block.type === 'image_url' && block.image_url?.url) images.push({ url: block.image_url.url, mediaType: 'image/png' })
      else if (block.type === 'video') {
        if (block.data) videos.push({ mediaType: block.mimeType || 'video/mp4', data: block.data })
        else if (block.url) videos.push({ url: block.url, mediaType: block.mimeType || 'video/mp4' })
      }
      else if (block.type === 'audio' || block.type === 'voice') {
        if (block.data) audios.push({ mediaType: block.mimeType || 'audio/mpeg', data: block.data, duration: block.duration })
        else if (block.url) audios.push({ url: block.url, mediaType: block.mimeType || 'audio/mpeg', duration: block.duration })
      }
      else if (block.type === 'file' || block.type === 'document') {
        files.push({ url: block.url || '', name: block.fileName || block.name || 'file', mimeType: block.mimeType || '', size: block.size, data: block.data })
      }
      else if (block.type === 'tool' || block.type === 'tool_use' || block.type === 'tool_call' || block.type === 'toolCall') {
        const callId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: callId,
          name: block.name || block.tool || block.tool_name || block.toolName || 'tool',
          input: block.input || block.args || block.parameters || block.arguments || null,
          output: null,
          status: block.status || 'ok',
          time: resolveToolTime(callId, message.timestamp),
        })
      }
      else if (block.type === 'tool_result' || block.type === 'toolResult') {
        const resId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: resId,
          name: block.name || block.tool || block.tool_name || block.toolName || 'tool',
          input: block.input || block.args || null,
          output: block.output || block.result || block.content || null,
          status: block.status || 'ok',
          time: resolveToolTime(resId, message.timestamp),
        })
      }
    }
    if (tools.length) {
      tools.forEach(t => {
        if (typeof t.input === 'string') t.input = stripAnsi(t.input)
        if (typeof t.output === 'string') t.output = stripAnsi(t.output)
      })
    }
    // �?mediaUrl/mediaUrls 提取
    const mediaUrls = message.mediaUrls || (message.mediaUrl ? [message.mediaUrl] : [])
    for (const url of mediaUrls) {
      if (!url) continue
      if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) videos.push({ url, mediaType: 'video/mp4' })
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url)) audios.push({ url, mediaType: 'audio/mpeg' })
      else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url)) images.push({ url, mediaType: 'image/png' })
      else files.push({ url, name: url.split('/').pop().split('?')[0] || 'file', mimeType: '' })
    }
    const text = texts.length ? stripThinkingTags(texts.join('\n')) : ''
    return { text, images, videos, audios, files, tools }
  }
  if (typeof message.text === 'string') return { text: stripThinkingTags(message.text), images: [], videos: [], audios: [], files: [], tools: [] }
  return null
}

function stripAnsi(text) {
  if (!text) return ''
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function stripThinkingTags(text) {
  const safe = stripAnsi(text)
  return safe
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .replace(/\[Queued messages while agent was busy\]\s*---\s*Queued #\d+\s*/gi, '')
    .trim()
}

function normalizeTime(raw) {
  if (!raw) return null
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw === 'string') {
    const num = Number(raw)
    if (!Number.isNaN(num)) raw = num
    else {
      const parsed = Date.parse(raw)
      return Number.isNaN(parsed) ? null : parsed
    }
  }
  if (typeof raw === 'number' && raw < 1e12) return raw * 1000
  return raw
}

function resolveToolTime(toolId, messageTimestamp) {
  const eventTs = toolId ? _toolEventTimes.get(toolId) : null
  return normalizeTime(eventTs) || normalizeTime(messageTimestamp) || null
}

function getToolTime(tool) {
  const raw = tool?.end_time || tool?.endTime || tool?.timestamp || tool?.time || tool?.started_at || tool?.startedAt || null
  return normalizeTime(raw)
}

function safeStringify(value) {
  if (value == null) return ''
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (key, val) => {
      if (typeof val === 'bigint') return val.toString()
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    }, 2)
  } catch {
    try { return String(value) } catch { return '' }
  }
}

function formatTime(date) {
  const now = new Date()
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (isToday) return `${h}:${m}`
  const mon = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${mon}-${day} ${h}:${m}`
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/** 创建流式 AI 气泡 */
function createStreamBubble() {
  if (!_messagesEl || !_typingEl) return null
  showTyping(false)
  const wrap = document.createElement('div')
  wrap.className = 'msg msg-ai'
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'
  bubble.innerHTML = '<span class="stream-cursor"></span>'
  wrap.appendChild(bubble)
  _messagesEl.insertBefore(wrap, _typingEl)
  scrollToBottom()
  return bubble
}

// ── 流式渲染（节流） ──

function throttledRender() {
  if (_renderPending) return
  const now = performance.now()
  if (now - _lastRenderTime >= RENDER_THROTTLE) {
    doRender()
  } else {
    _renderPending = true
    requestAnimationFrame(() => { _renderPending = false; doRender() })
  }
}

function doRender() {
  _lastRenderTime = performance.now()
  if (_currentAiBubble && _currentAiText) {
    _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    scrollToBottom()
  }
}

// ── 响应看门狗：防止页面卡在等待状�?──

function _startResponseWatchdog() {
  _cancelResponseWatchdog()
  _responseWatchdog = setTimeout(async () => {
    _responseWatchdog = null
    // 如果还在等待（未开始流式），强制刷新历�?    if (!_isStreaming && _sessionKey && _messagesEl && _pageActive) {
      console.log('[chat] 响应看门狗触发：15s �?delta，刷新历�?)
      const oldHash = _lastHistoryHash
      _lastHistoryHash = ''
      await loadHistory()
      // 如果历史有更新，关闭 typing 指示�?      if (_lastHistoryHash && _lastHistoryHash !== oldHash) {
        showTyping(false)
      } else {
        // 历史没更新，继续等待，再设一轮看门狗
        _startResponseWatchdog()
      }
    }
  }, 15000)
}

function _cancelResponseWatchdog() {
  clearTimeout(_responseWatchdog)
  _responseWatchdog = null
}

function _schedulePostFinalCheck() {
  clearTimeout(_postFinalCheck)
  _postFinalCheck = setTimeout(async () => {
    _postFinalCheck = null
    if (_sessionKey && _messagesEl && _pageActive && !_isStreaming && !_isSending) {
      _lastHistoryHash = ''
      await loadHistory()
    }
  }, 2000)
}

// ensureAiBubble 已被 createStreamBubble 替代

function resetStreamState() {
  clearTimeout(_streamSafetyTimer)
  if (_currentAiBubble && (_currentAiText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length || _currentAiTools.length)) {
    _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    appendImagesToEl(_currentAiBubble, _currentAiImages)
    appendVideosToEl(_currentAiBubble, _currentAiVideos)
    appendAudiosToEl(_currentAiBubble, _currentAiAudios)
    appendFilesToEl(_currentAiBubble, _currentAiFiles)
    appendToolsToEl(_currentAiBubble, _currentAiTools)
  }
  _renderPending = false
  _lastRenderTime = 0
  _currentAiBubble = null
  _currentAiText = ''
  _currentAiImages = []
  _currentAiVideos = []
  _currentAiAudios = []
  _currentAiFiles = []
  _currentAiTools = []
  _currentRunId = null
  _isStreaming = false
  _streamStartTime = 0
  _lastErrorMsg = null
  _errorTimer = null
  showTyping(false)
  updateSendState()
}

// ── 历史消息加载 ──

async function loadHistory() {
  if (!_sessionKey || !_messagesEl) return
  _isLoadingHistory = true
  const hasExisting = _messagesEl.querySelector('.msg')
  if (!hasExisting && isStorageAvailable()) {
    const local = await getLocalMessages(_sessionKey, 200)
    if (local.length) {
      clearMessages()
      local.forEach(msg => {
        if (!msg.content && !msg.attachments?.length) return
        const msgTime = msg.timestamp ? new Date(msg.timestamp) : new Date()
        if (msg.role === 'user') appendUserMessage(msg.content || '', msg.attachments || null, msgTime)
        else if (msg.role === 'assistant') {
          const images = (msg.attachments || []).filter(a => a.category === 'image').map(a => ({ mediaType: a.mimeType, data: a.content, url: a.url }))
          appendAiMessage(msg.content || '', msgTime, images, [], [], [], [])
        }
      })
      scrollToBottom()
    }
  }
  if (!wsClient.gatewayReady) { _isLoadingHistory = false; return }
  try {
    const result = await wsClient.chatHistory(_sessionKey, 200)
    if (!result?.messages?.length) {
      if (_messagesEl && !_messagesEl.querySelector('.msg')) appendSystemMessage(t('chat.noMessages'))
      return
    }
    const deduped = dedupeHistory(result.messages)
    const hash = deduped.map(m => `${m.role}:${(m.text || '').length}`).join('|')
    if (hash === _lastHistoryHash && hasExisting) return
    _lastHistoryHash = hash

    // 正在发�?流式输出时不全量重绘，避免覆盖本地乐观渲�?    if (hasExisting && (_isSending || _isStreaming || _messageQueue.length > 0)) {
      saveMessages(result.messages.map(m => {
        const c = extractContent(m)
        const role = (m.role === 'tool' || m.role === 'toolResult') ? 'assistant' : m.role
        return { id: m.id || uuid(), sessionKey: _sessionKey, role, content: c?.text || '', timestamp: m.timestamp || Date.now() }
      }))
      _isLoadingHistory = false
      return
    }

    clearMessages()
    let hasOmittedImages = false
    deduped.forEach(msg => {
      if (!msg.text && !msg.images?.length && !msg.videos?.length && !msg.audios?.length && !msg.files?.length && !msg.tools?.length) return
      const msgTime = msg.timestamp ? new Date(msg.timestamp) : new Date()
      if (msg.role === 'user') {
        const userAtts = msg.images?.length ? msg.images.map(i => ({
          mimeType: i.mediaType || i.media_type || 'image/png',
          content: i.data || i.source?.data || '',
          category: 'image',
        })).filter(a => a.content) : []
        if (msg.images?.length && !userAtts.length) hasOmittedImages = true
        appendUserMessage(msg.text, userAtts, msgTime)
      } else if (msg.role === 'assistant') {
        appendAiMessage(msg.text, msgTime, msg.images, msg.videos, msg.audios, msg.files, msg.tools)
      }
    })
    if (hasOmittedImages) {
      appendSystemMessage(t('chat.imageHistoryHint'))
    }
    saveMessages(result.messages.map(m => {
      const c = extractContent(m)
      const role = (m.role === 'tool' || m.role === 'toolResult') ? 'assistant' : m.role
      return { id: m.id || uuid(), sessionKey: _sessionKey, role, content: c?.text || '', timestamp: m.timestamp || Date.now() }
    }))
    scrollToBottom()
  } catch (e) {
    console.error('[chat] loadHistory error:', e)
    if (_messagesEl && !_messagesEl.querySelector('.msg')) appendSystemMessage(`${t('common.loadFailed')}: ${e.message}`)
  } finally {
    _isLoadingHistory = false
  }
}

function dedupeHistory(messages) {
  const deduped = []
  for (const msg of messages) {
    const role = (msg.role === 'tool' || msg.role === 'toolResult') ? 'assistant' : msg.role
    const c = extractContent(msg)
    if (!c.text && !c.images.length && !c.videos.length && !c.audios.length && !c.files.length && !c.tools.length) continue
    const tools = (c.tools || []).map(t => {
      const id = t.id || t.tool_call_id
      const time = t.time || resolveToolTime(id, msg.timestamp)
      return { ...t, time, messageTimestamp: msg.timestamp }
    })
    const last = deduped[deduped.length - 1]
    if (last && last.role === role) {
      if (role === 'user' && last.text === c.text) continue
      if (role === 'assistant') {
        // 同文本去重（Gateway 重试产生的重复回复）
        if (c.text && last.text === c.text) continue
        // 不同文本则合�?        last.text = [last.text, c.text].filter(Boolean).join('\n')
        last.images = [...(last.images || []), ...c.images]
        last.videos = [...(last.videos || []), ...c.videos]
        last.audios = [...(last.audios || []), ...c.audios]
        last.files = [...(last.files || []), ...c.files]
        tools.forEach(t => upsertTool(last.tools, t))
        continue
      }
    }
    deduped.push({ role, text: c.text, images: c.images, videos: c.videos, audios: c.audios, files: c.files, tools, timestamp: msg.timestamp })
  }
  return deduped
}

function extractContent(msg) {
  const tools = []
  collectToolsFromMessage(msg, tools)
  if (msg.role === 'tool' || msg.role === 'toolResult') {
    const output = typeof msg.content === 'string' ? msg.content : null
    if (!tools.length) {
      upsertTool(tools, {
        id: msg.id || msg.tool_call_id || msg.toolCallId,
        name: msg.name || msg.tool || msg.tool_name || 'tool',
        input: msg.input || msg.args || msg.parameters || null,
        output: output || msg.output || msg.result || null,
        status: msg.status || 'ok',
        time: resolveToolTime(msg.tool_call_id || msg.toolCallId || msg.id, msg.timestamp),
      })
    } else if (output && !tools[0].output) {
      tools[0].output = output
    }
    return { text: '', images: [], videos: [], audios: [], files: [], tools }
  }
  if (Array.isArray(msg.content)) {
    const texts = [], images = [], videos = [], audios = [], files = []
    for (const block of msg.content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      else if (block.type === 'image' && !block.omitted) {
        if (block.data) images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        else if (block.source?.type === 'base64' && block.source.data) images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        else if (block.url || block.source?.url) images.push({ url: block.url || block.source.url, mediaType: block.mimeType || 'image/png' })
      }
      else if (block.type === 'image_url' && block.image_url?.url) images.push({ url: block.image_url.url, mediaType: 'image/png' })
      else if (block.type === 'video') {
        if (block.data) videos.push({ mediaType: block.mimeType || 'video/mp4', data: block.data })
        else if (block.url) videos.push({ url: block.url, mediaType: block.mimeType || 'video/mp4' })
      }
      else if (block.type === 'audio' || block.type === 'voice') {
        if (block.data) audios.push({ mediaType: block.mimeType || 'audio/mpeg', data: block.data, duration: block.duration })
        else if (block.url) audios.push({ url: block.url, mediaType: block.mimeType || 'audio/mpeg', duration: block.duration })
      }
      else if (block.type === 'file' || block.type === 'document') {
        files.push({ url: block.url || '', name: block.fileName || block.name || 'file', mimeType: block.mimeType || '', size: block.size, data: block.data })
      }
      else if (block.type === 'tool' || block.type === 'tool_use' || block.type === 'tool_call' || block.type === 'toolCall') {
        const callId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: callId,
          name: block.name || block.tool || block.tool_name || block.toolName || 'tool',
          input: block.input || block.args || block.parameters || block.arguments || null,
          output: null,
          status: block.status || 'ok',
          time: resolveToolTime(callId, msg.timestamp),
        })
      }
      else if (block.type === 'tool_result' || block.type === 'toolResult') {
        const resId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: resId,
          name: block.name || block.tool || block.tool_name || block.toolName || 'tool',
          input: block.input || block.args || null,
          output: block.output || block.result || block.content || null,
          status: block.status || 'ok',
          time: resolveToolTime(resId, msg.timestamp),
        })
      }
    }
    if (tools.length) {
      tools.forEach(t => {
        if (typeof t.input === 'string') t.input = stripAnsi(t.input)
        if (typeof t.output === 'string') t.output = stripAnsi(t.output)
      })
    }
    const mediaUrls = msg.mediaUrls || (msg.mediaUrl ? [msg.mediaUrl] : [])
    for (const url of mediaUrls) {
      if (!url) continue
      if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) videos.push({ url, mediaType: 'video/mp4' })
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url)) audios.push({ url, mediaType: 'audio/mpeg' })
      else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url)) images.push({ url, mediaType: 'image/png' })
      else files.push({ url, name: url.split('/').pop().split('?')[0] || 'file', mimeType: '' })
    }
    return { text: stripThinkingTags(texts.join('\n')), images, videos, audios, files, tools }
  }
  const text = typeof msg.text === 'string' ? msg.text : (typeof msg.content === 'string' ? msg.content : '')
  return { text: stripThinkingTags(text), images: [], videos: [], audios: [], files: [], tools }
}

// ── DOM 操作 ──

function appendUserMessage(text, attachments = [], msgTime) {
  const wrap = document.createElement('div')
  wrap.className = 'msg msg-user'
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'

  if (attachments && attachments.length > 0) {
    const mediaContainer = document.createElement('div')
    mediaContainer.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap'
    attachments.forEach(att => {
      const cat = att.category || att.type || 'image'
      const src = att.data ? `data:${att.mimeType || att.mediaType || 'image/png'};base64,${att.data}`
        : att.content ? `data:${att.mimeType || 'image/png'};base64,${att.content}`
        : att.url || ''
      if (cat === 'image' && src) {
        const img = document.createElement('img')
        img.src = src
        img.className = 'msg-img'
        img.onclick = () => showLightbox(img.src)
        mediaContainer.appendChild(img)
      } else if (cat === 'video' && src) {
        const video = document.createElement('video')
        video.src = src
        video.className = 'msg-video'
        video.controls = true
        video.preload = 'metadata'
        video.playsInline = true
        mediaContainer.appendChild(video)
      } else if (cat === 'audio' && src) {
        const audio = document.createElement('audio')
        audio.src = src
        audio.className = 'msg-audio'
        audio.controls = true
        audio.preload = 'metadata'
        mediaContainer.appendChild(audio)
      } else if (att.fileName || att.name) {
        const card = document.createElement('div')
        card.className = 'msg-file-card'
        card.innerHTML = `<span class="msg-file-icon">${svgIcon('paperclip', 16)}</span><span class="msg-file-name">${att.fileName || att.name}</span>`
        mediaContainer.appendChild(card)
      }
    })
    if (mediaContainer.children.length) bubble.appendChild(mediaContainer)
  }

  if (text) {
    const textNode = document.createElement('div')
    textNode.textContent = text
    bubble.appendChild(textNode)
  }

  const meta = document.createElement('div')
  meta.className = 'msg-meta'
  meta.innerHTML = `<span class="msg-time">${formatTime(msgTime || new Date())}</span>`

  wrap.appendChild(bubble)
  wrap.appendChild(meta)
  _messagesEl.insertBefore(wrap, _typingEl)
  scrollToBottom()
}

function appendAiMessage(text, msgTime, images, videos, audios, files, tools) {
  const wrap = document.createElement('div')
  wrap.className = 'msg msg-ai'
  const bubble = document.createElement('div')
  bubble.className = 'msg-bubble'
  appendToolsToEl(bubble, tools)
  const textEl = document.createElement('div')
  textEl.className = 'msg-text'
  textEl.innerHTML = renderMarkdown(text || '')
  bubble.appendChild(textEl)
  appendImagesToEl(bubble, images)
  appendVideosToEl(bubble, videos)
  appendAudiosToEl(bubble, audios)
  appendFilesToEl(bubble, files)
  // 图片点击灯箱
  bubble.querySelectorAll('img').forEach(img => { if (!img.onclick) img.onclick = () => showLightbox(img.src) })

  const meta = document.createElement('div')
  meta.className = 'msg-meta'
  meta.innerHTML = `<span class="msg-time">${formatTime(msgTime || new Date())}</span>`

  wrap.appendChild(bubble)
  wrap.appendChild(meta)
  _messagesEl.insertBefore(wrap, _typingEl)
  scrollToBottom()
}

/** 渲染图片到消息气泡（支持 Anthropic/OpenAI/直接格式�?*/
function appendImagesToEl(el, images) {
  if (!images?.length) return
  const container = document.createElement('div')
  container.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap'
  images.forEach(img => {
    const imgEl = document.createElement('img')
    // Anthropic 格式: { type: 'image', source: { data, media_type } }
    if (img.source?.data) {
      imgEl.src = `data:${img.source.media_type || 'image/png'};base64,${img.source.data}`
    // 直接格式: { data, mediaType }
    } else if (img.data) {
      imgEl.src = `data:${img.mediaType || img.media_type || 'image/png'};base64,${img.data}`
    // OpenAI 格式: { type: 'image_url', image_url: { url } }
    } else if (img.image_url?.url) {
      imgEl.src = img.image_url.url
    // URL 格式
    } else if (img.url) {
      imgEl.src = img.url
    } else {
      return
    }
    imgEl.style.cssText = 'max-width:300px;max-height:300px;border-radius:6px;cursor:pointer'
    imgEl.onclick = () => showLightbox(imgEl.src)
    container.appendChild(imgEl)
  })
  if (container.children.length) el.appendChild(container)
}

/** 渲染视频到消息气�?*/
function appendVideosToEl(el, videos) {
  if (!videos?.length) return
  videos.forEach(vid => {
    const videoEl = document.createElement('video')
    videoEl.className = 'msg-video'
    videoEl.controls = true
    videoEl.preload = 'metadata'
    videoEl.playsInline = true
    if (vid.data) videoEl.src = `data:${vid.mediaType};base64,${vid.data}`
    else if (vid.url) videoEl.src = vid.url
    el.appendChild(videoEl)
  })
}

/** 渲染音频到消息气�?*/
function appendAudiosToEl(el, audios) {
  if (!audios?.length) return
  audios.forEach(aud => {
    const audioEl = document.createElement('audio')
    audioEl.className = 'msg-audio'
    audioEl.controls = true
    audioEl.preload = 'metadata'
    if (aud.data) audioEl.src = `data:${aud.mediaType};base64,${aud.data}`
    else if (aud.url) audioEl.src = aud.url
    el.appendChild(audioEl)
  })
}

/** 渲染文件卡片到消息气�?*/
function appendFilesToEl(el, files) {
  if (!files?.length) return
  files.forEach(f => {
    const card = document.createElement('div')
    card.className = 'msg-file-card'
    const ext = (f.name || '').split('.').pop().toLowerCase()
    const fileIconMap = { pdf: 'file', doc: 'file-text', docx: 'file-text', txt: 'file-plain', md: 'file-plain', json: 'clipboard', csv: 'bar-chart', zip: 'package', rar: 'package' }
    const fileIcon = svgIcon(fileIconMap[ext] || 'paperclip', 16)
    const size = f.size ? formatFileSize(f.size) : ''
    card.innerHTML = `<span class="msg-file-icon">${fileIcon}</span><div class="msg-file-info"><span class="msg-file-name">${f.name || 'file'}</span>${size ? `<span class="msg-file-size">${size}</span>` : ''}</div>`
    if (f.url) {
      card.style.cursor = 'pointer'
      card.onclick = () => window.open(f.url, '_blank')
    } else if (f.data) {
      card.style.cursor = 'pointer'
      card.onclick = () => {
        const a = document.createElement('a')
        a.href = `data:${f.mimeType || 'application/octet-stream'};base64,${f.data}`
        a.download = f.name || 'file'
        a.click()
      }
    }
    el.appendChild(card)
  })
}

function mergeToolEventData(entry) {
  const id = entry?.id || entry?.tool_call_id
  if (!id) return entry
  const extra = _toolEventData.get(id)
  if (!extra) return entry
  if (entry.input == null && extra.input != null) entry.input = extra.input
  if (entry.output == null && extra.output != null) entry.output = extra.output
  if (entry.status == null && extra.status != null) entry.status = extra.status
  if (entry.time == null) entry.time = extra.time || _toolEventTimes.get(id) || null
  return entry
}

function upsertTool(tools, entry) {
  if (!entry) return
  const id = entry.id || entry.tool_call_id
  let target = null
  if (id) target = tools.find(t => t.id === id || t.tool_call_id === id)
  if (!target && entry.name) target = tools.find(t => t.name === entry.name && !t.output)
  if (target) {
    if (entry.input != null && target.input == null) target.input = entry.input
    if (entry.output != null && target.output == null) target.output = entry.output
    if (entry.status && target.status == null) target.status = entry.status
    if (entry.time && target.time == null) target.time = entry.time
    return
  }
  tools.push(mergeToolEventData(entry))
}

function collectToolsFromMessage(message, tools) {
  if (!message || !tools) return
  const toolCalls = message.tool_calls || message.toolCalls || message.tools
  if (Array.isArray(toolCalls)) {
    toolCalls.forEach(call => {
      const fn = call.function || null
      const name = call.name || call.tool || call.tool_name || fn?.name
      const input = call.input || call.args || call.parameters || call.arguments || fn?.arguments || null
      const callId = call.id || call.tool_call_id
      upsertTool(tools, {
        id: callId,
        name: name || 'tool',
        input,
        output: null,
        status: call.status || 'ok',
        time: resolveToolTime(callId, message?.timestamp),
      })
    })
  }
  const toolResults = message.tool_results || message.toolResults
  if (Array.isArray(toolResults)) {
    toolResults.forEach(res => {
      const resId = res.id || res.tool_call_id
      upsertTool(tools, {
        id: resId,
        name: res.name || res.tool || res.tool_name || 'tool',
        input: res.input || res.args || null,
        output: res.output || res.result || res.content || null,
        status: res.status || 'ok',
        time: resolveToolTime(resId, message?.timestamp),
      })
    })
  }
}

/** 渲染工具调用到消息气�?*/
function appendToolsToEl(el, tools) {
  if (!el) return
  const existing = el.querySelector?.('.msg-tool')
  if (!tools?.length) {
    if (existing) existing.remove()
    return
  }
  const container = document.createElement('div')
  container.className = 'msg-tool'
  tools.forEach(tool => {
    const details = document.createElement('details')
    details.className = 'msg-tool-item'
    const summary = document.createElement('summary')
    const status = tool.status === 'error' ? t('chat.toolFailed') : t('chat.toolSuccess')
    const timeValue = getToolTime(tool) || resolveToolTime(tool.id || tool.tool_call_id, tool.messageTimestamp)
    const timeText = timeValue ? formatTime(new Date(timeValue)) : ''
    summary.innerHTML = `${escapeHtml(tool.name || 'tool')} · ${status}${timeText ? ' · ' + timeText : ''}`
    const body = document.createElement('div')
    body.className = 'msg-tool-body'
    const inputJson = stripAnsi(safeStringify(tool.input))
    const outputJson = stripAnsi(safeStringify(tool.output))
    body.innerHTML = `<div class="msg-tool-block"><div class="msg-tool-title">${t('chat.toolParams')}</div><pre>${escapeHtml(inputJson || '-')}</pre></div>`
      + `<div class="msg-tool-block"><div class="msg-tool-title">${t('chat.toolResult')}</div><pre>${escapeHtml(outputJson || '-')}</pre></div>`
    details.appendChild(summary)
    details.appendChild(body)
    container.appendChild(details)
  })
  if (existing) existing.remove()
  el.insertBefore(container, el.firstChild)
}

/** 图片灯箱查看 */
function showLightbox(src) {
  const existing = document.querySelector('.chat-lightbox')
  if (existing) existing.remove()
  const lb = document.createElement('div')
  lb.className = 'chat-lightbox'
  lb.innerHTML = `<img src="${src}" class="chat-lightbox-img" />`
  lb.onclick = (e) => { if (e.target === lb || e.target.tagName !== 'IMG') lb.remove() }
  document.body.appendChild(lb)
  // ESC 关闭
  const onKey = (e) => { if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', onKey) } }
  document.addEventListener('keydown', onKey)
}

function appendSystemMessage(text) {
  const wrap = document.createElement('div')
  wrap.className = 'msg msg-system'
  wrap.textContent = text
  _messagesEl.insertBefore(wrap, _typingEl)
  scrollToBottom()
}

function clearMessages() {
  _messagesEl.querySelectorAll('.msg').forEach(m => m.remove())
  _autoScrollEnabled = true
  _lastScrollTop = 0
}

function showTyping(show, hint) {
  if (_typingEl) {
    _typingEl.style.display = show ? 'flex' : 'none'
    // 更新提示文字（如工具调用状态）
    const hintEl = _typingEl.querySelector('.typing-hint')
    if (hintEl) hintEl.textContent = hint || ''
  }
  if (show) scrollToBottom()
}

function showCompactionHint(show) {
  let hint = _page?.querySelector('#compaction-hint')
  if (show && !hint && _messagesEl) {
    hint = document.createElement('div')
    hint.id = 'compaction-hint'
    hint.className = 'msg msg-system compaction-hint'
    hint.innerHTML = `🗜�?${t('chat.compacting')}`
    _messagesEl.insertBefore(hint, _typingEl)
    scrollToBottom()
  } else if (!show && hint) {
    hint.remove()
  }
}

function scrollToBottom(force = false) {
  if (!_messagesEl) return
  if (!force && !_autoScrollEnabled) return
  requestAnimationFrame(() => { _messagesEl.scrollTop = _messagesEl.scrollHeight })
}

function isAtBottom() {
  if (!_messagesEl) return true
  return _messagesEl.scrollHeight - _messagesEl.scrollTop - _messagesEl.clientHeight < 80
}

function updateSendState() {
  if (!_sendBtn || !_textarea) return
  if (_isStreaming) {
    _sendBtn.disabled = false
    _sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    _sendBtn.title = t('chat.cmdStopGen')
  } else {
    _sendBtn.disabled = !_textarea.value.trim() && !_attachments.length
    _sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
    _sendBtn.title = t('chat.send')
  }
}

function updateStatusDot(status) {
  if (!_statusDot) return
  _statusDot.className = 'status-dot'
  if (status === 'ready' || status === 'connected') _statusDot.classList.add('online')
  else if (status === 'connecting' || status === 'reconnecting') _statusDot.classList.add('connecting')
  else _statusDot.classList.add('offline')
}

// ── 托管 Agent 核心逻辑 ──

function toggleHostedPanel() {
  if (!_hostedPanelEl) return
  const next = _hostedPanelEl.style.display !== 'block'
  _hostedPanelEl.style.display = next ? 'block' : 'none'
  if (next) renderHostedPanel()
}

function hideHostedPanel() {
  if (_hostedPanelEl) _hostedPanelEl.style.display = 'none'
}

function getHostedSessionKey() {
  return _sessionKey || localStorage.getItem(STORAGE_SESSION_KEY) || 'agent:main:main'
}

async function loadHostedDefaults() {
  try {
    const panel = await api.readPanelConfig()
    _hostedDefaults = panel?.hostedAgent?.default || null
  } catch { _hostedDefaults = null }
}

function loadHostedSessionConfig() {
  let data = {}
  try { data = JSON.parse(localStorage.getItem(HOSTED_SESSIONS_KEY) || '{}') } catch { data = {} }
  const key = getHostedSessionKey()
  const current = data[key] || {}
  _hostedSessionConfig = { ...HOSTED_DEFAULTS, ..._hostedDefaults, ...current }
  if (!_hostedSessionConfig.state) _hostedSessionConfig.state = { ...HOSTED_RUNTIME_DEFAULT }
  if (!_hostedSessionConfig.history) _hostedSessionConfig.history = []
  _hostedRuntime = { ...HOSTED_RUNTIME_DEFAULT, ..._hostedSessionConfig.state }
  updateHostedBadge()
}

function saveHostedSessionConfig(nextConfig) {
  let data = {}
  try { data = JSON.parse(localStorage.getItem(HOSTED_SESSIONS_KEY) || '{}') } catch { data = {} }
  data[getHostedSessionKey()] = nextConfig
  localStorage.setItem(HOSTED_SESSIONS_KEY, JSON.stringify(data))
}

function persistHostedRuntime() {
  if (!_hostedSessionConfig) return
  _hostedSessionConfig.state = { ..._hostedRuntime }
  saveHostedSessionConfig(_hostedSessionConfig)
}

function updateHostedBadge() {
  if (!_hostedBadgeEl || !_hostedSessionConfig) return
  const status = _hostedRuntime.status || HOSTED_STATUS.IDLE
  const enabled = _hostedSessionConfig.enabled
  let text = t('chat.hostedNotEnabled'), cls = 'chat-hosted-badge'
  if (!enabled) { text = t('chat.hostedNotEnabled'); cls += ' idle' }
  else if (status === HOSTED_STATUS.RUNNING) { text = t('chat.hostedRunning'); cls += ' running' }
  else if (status === HOSTED_STATUS.WAITING) { text = t('chat.hostedWaiting'); cls += ' waiting' }
  else if (status === HOSTED_STATUS.PAUSED) { text = t('chat.hostedPaused'); cls += ' paused' }
  else if (status === HOSTED_STATUS.ERROR) { text = t('chat.hostedErrorStatus'); cls += ' error' }
  else { text = t('chat.hostedStandby'); cls += ' idle' }
  _hostedBadgeEl.className = cls
  _hostedBadgeEl.textContent = text
}

let _countdownInterval = null

function renderHostedPanel() {
  if (!_hostedPanelEl || !_hostedSessionConfig) return
  const isRunning = _hostedSessionConfig.enabled && _hostedRuntime.status !== HOSTED_STATUS.IDLE
  if (_hostedPromptEl) { _hostedPromptEl.value = _hostedSessionConfig.prompt || ''; _hostedPromptEl.disabled = isRunning }
  if (_hostedMaxStepsEl) {
    _hostedMaxStepsEl.value = _hostedSessionConfig.maxSteps || HOSTED_DEFAULTS.maxSteps
    _hostedMaxStepsEl.disabled = isRunning
    const valEl = _hostedPanelEl.querySelector('#ha-steps-val')
    if (valEl) valEl.textContent = _hostedMaxStepsEl.value
  }
  if (_hostedAutoStopEl) { _hostedAutoStopEl.value = _hostedSessionConfig.autoStopMinutes || 30; _hostedAutoStopEl.disabled = isRunning }
  const timerToggle = _hostedPanelEl.querySelector('#hosted-agent-timer-on')
  const timerBody = _hostedPanelEl.querySelector('#ha-timer-body')
  if (timerToggle) { timerToggle.checked = (_hostedSessionConfig.autoStopMinutes || 0) > 0; timerToggle.disabled = isRunning }
  if (timerBody) timerBody.style.display = timerToggle?.checked ? '' : 'none'
  if (_hostedSaveBtn) {
    _hostedSaveBtn.textContent = isRunning ? `�?${t('chat.stopHosted')}` : `�?${t('chat.startHosted')}`
    _hostedSaveBtn.className = isRunning ? 'btn btn-ghost' : 'btn btn-primary'
    _hostedSaveBtn.style.flex = '1'
  }
  // 主按钮同时作为停止按钮，无需额外 stop btn
  // 状态栏
  const statusEl = _hostedPanelEl.querySelector('#hosted-agent-status')
  if (statusEl) {
    let msg = t('chat.ready')
    if (_hostedRuntime.lastError) msg = `${t('chat.errorPrefix')}${_hostedRuntime.lastError}`
    else if (isRunning) {
      const remaining = Math.max(0, _hostedSessionConfig.maxSteps - _hostedRuntime.stepCount)
      msg = `${t('chat.hostedRunning')} · ${t('chat.remaining')} ${remaining}`
    }
    statusEl.textContent = msg
  }
  // 倒计�?  updateCountdown()
}

function updateCountdown() {
  const cdEl = _hostedPanelEl?.querySelector('#ha-countdown')
  const fillEl = _hostedPanelEl?.querySelector('#ha-countdown-fill')
  const textEl = _hostedPanelEl?.querySelector('#ha-countdown-text')
  if (!cdEl || !fillEl || !textEl) return
  if (!_hostedAutoStopTimer || !_hostedStartTime || !_hostedSessionConfig?.autoStopMinutes) {
    cdEl.style.display = 'none'
    clearInterval(_countdownInterval); _countdownInterval = null
    return
  }
  cdEl.style.display = ''
  const totalMs = _hostedSessionConfig.autoStopMinutes * 60000
  const elapsed = Date.now() - _hostedStartTime
  const remaining = Math.max(0, totalMs - elapsed)
  const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100))
  fillEl.style.width = pct + '%'
  const mins = Math.floor(remaining / 60000)
  const secs = Math.floor((remaining % 60000) / 1000)
  textEl.textContent = `${t('chat.remaining')} ${mins}:${secs.toString().padStart(2, '0')}`
  if (!_countdownInterval) {
    _countdownInterval = setInterval(() => updateCountdown(), 1000)
  }
  if (remaining <= 0) { clearInterval(_countdownInterval); _countdownInterval = null }
}

function toggleHostedRun() {
  if (!_hostedSessionConfig) return
  if (_hostedSessionConfig.enabled && _hostedRuntime.status !== HOSTED_STATUS.IDLE) {
    stopHostedAgent()
  } else {
    startHostedAgent()
  }
}

async function startHostedAgent() {
  if (!_hostedSessionConfig) return
  const prompt = (_hostedPromptEl?.value || '').trim()
  if (!prompt) { toast(t('chat.enterTaskGoal'), 'warning'); return }
  const rawSteps = parseInt(_hostedMaxStepsEl?.value || HOSTED_DEFAULTS.maxSteps, 10)
  const maxSteps = rawSteps >= 205 ? 999999 : Math.max(1, rawSteps)
  const stepDelayMs = Math.max(200, parseInt(_hostedStepDelayEl?.value || HOSTED_DEFAULTS.stepDelayMs, 10))
  const retryLimit = Math.max(0, parseInt(_hostedRetryLimitEl?.value || HOSTED_DEFAULTS.retryLimit, 10))
  const timerOn = _page?.querySelector('#hosted-agent-timer-on')?.checked
  const autoStopMinutes = timerOn ? Math.max(0, parseInt(_hostedAutoStopEl?.value || 0, 10)) : 0
  _hostedSessionConfig = { ..._hostedSessionConfig, prompt, enabled: true, maxSteps, stepDelayMs, retryLimit, autoStopMinutes }
  const sysContent = HOSTED_SYSTEM_PROMPT + '\n\nUser goal: ' + prompt
  if (!_hostedSessionConfig.history?.length) _hostedSessionConfig.history = [{ role: 'system', content: sysContent }]
  else if (_hostedSessionConfig.history[0]?.role === 'system') _hostedSessionConfig.history[0].content = sysContent
  else _hostedSessionConfig.history.unshift({ role: 'system', content: sysContent })
  _hostedRuntime = { ...HOSTED_RUNTIME_DEFAULT, status: HOSTED_STATUS.RUNNING }
  _hostedStartTime = Date.now()
  persistHostedRuntime()
  renderHostedPanel()
  updateHostedBadge()
  // 启动定时停止
  clearTimeout(_hostedAutoStopTimer)
  if (autoStopMinutes > 0) {
    _hostedAutoStopTimer = setTimeout(() => {
      appendHostedOutput(t('chat.hostedTimerExpired', { min: autoStopMinutes }))
      stopHostedAgent()
    }, autoStopMinutes * 60000)
  }
  if (!wsClient.gatewayReady || !_sessionKey) { toast(t('chat.gatewayNotReadySend'), 'warning'); return }
  toast(t('chat.hostedStarted'), 'success')
  runHostedAgentStep()
}

function stopHostedAgent() {
  if (!_hostedSessionConfig) return
  if (_hostedAbort) { _hostedAbort.abort(); _hostedAbort = null }
  clearTimeout(_hostedAutoStopTimer); _hostedAutoStopTimer = null
  clearInterval(_countdownInterval); _countdownInterval = null
  _hostedBusy = false
  _hostedSessionConfig.enabled = false
  _hostedRuntime.status = HOSTED_STATUS.IDLE
  _hostedRuntime.pending = false
  _hostedRuntime.stepCount = 0
  _hostedRuntime.lastError = ''
  _hostedRuntime.errorCount = 0
  _hostedStartTime = 0
  persistHostedRuntime()
  renderHostedPanel()
  updateHostedBadge()
  toast(t('chat.hostedStopped'), 'info')
}

function shouldCaptureHostedTarget(payload) {
  if (!_hostedSessionConfig?.enabled) return false
  if (_hostedRuntime.status === HOSTED_STATUS.PAUSED || _hostedRuntime.status === HOSTED_STATUS.ERROR || _hostedRuntime.status === HOSTED_STATUS.IDLE) return false
  if (payload?.message?.role && payload.message.role !== 'assistant') return false
  const ts = payload?.timestamp || Date.now()
  if (ts && ts === _hostedLastTargetTs) return false
  _hostedLastTargetTs = ts
  return true
}

function appendHostedTarget(text) {
  if (!_hostedSessionConfig) return
  if (!_hostedSessionConfig.history) _hostedSessionConfig.history = []
  _hostedSessionConfig.history.push({ role: 'target', content: text, ts: Date.now() })
  persistHostedRuntime()
}

function maybeTriggerHostedRun() {
  if (!_hostedSessionConfig?.enabled) return
  if (_hostedRuntime.status === HOSTED_STATUS.IDLE || _hostedRuntime.status === HOSTED_STATUS.PAUSED || _hostedRuntime.status === HOSTED_STATUS.ERROR) return
  if (_hostedRuntime.pending || _hostedBusy) return
  if (!wsClient.gatewayReady) { _hostedRuntime.status = HOSTED_STATUS.PAUSED; persistHostedRuntime(); updateHostedBadge(); renderHostedPanel(); return }
  _hostedRuntime.status = HOSTED_STATUS.IDLE
  runHostedAgentStep()
}

function compressHostedContext() {
  if (!_hostedSessionConfig?.history) return
  const history = _hostedSessionConfig.history
  if (history.length <= HOSTED_COMPRESS_THRESHOLD) return
  const sysEntry = history[0]?.role === 'system' ? history[0] : null
  const recent = history.slice(-8)
  const older = history.slice(sysEntry ? 1 : 0, -8)
  const summary = older.map(h => `[${h.role}] ${(h.content || '').slice(0, 80)}`).join('\n')
  const compressed = []
  if (sysEntry) compressed.push(sysEntry)
  compressed.push({ role: 'user', content: `[Context summary - compressed ${older.length} entries]\n${summary}`, ts: Date.now() })
  compressed.push(...recent)
  _hostedSessionConfig.history = compressed
  persistHostedRuntime()
}

function buildHostedMessages() {
  compressHostedContext()
  const history = _hostedSessionConfig?.history || []
  const mapped = history.slice(-HOSTED_CONTEXT_MAX).map(item => {
    if (item.role === 'system') return { role: 'system', content: item.content }
    if (item.role === 'assistant') return { role: 'assistant', content: item.content }
    return { role: 'user', content: item.content }
  })
  const hasUserMsg = mapped.some(m => m.role === 'user' || m.role === 'assistant')
  if (!hasUserMsg && _hostedSessionConfig?.prompt) {
    mapped.push({ role: 'user', content: _hostedSessionConfig.prompt })
  }
  return mapped
}

function detectStopFromText(text) {
  if (!text) return false
  return /\b(完成|无需继续|结束|停止|done|stop|final)\b/i.test(text)
}

async function runHostedAgentStep() {
  if (_hostedBusy || !_hostedSessionConfig?.enabled) return
  const prompt = (_hostedSessionConfig.prompt || '').trim()
  if (!prompt) return
  if (!wsClient.gatewayReady || !_sessionKey) {
    _hostedRuntime.status = HOSTED_STATUS.PAUSED
    _hostedRuntime.lastError = 'Gateway not ready'
    persistHostedRuntime(); updateHostedBadge()
    appendHostedOutput(t('chat.hostedNeedIntervention'))
    return
  }
  if (_hostedRuntime.errorCount >= _hostedSessionConfig.retryLimit) {
    _hostedRuntime.status = HOSTED_STATUS.ERROR
    persistHostedRuntime(); updateHostedBadge()
    appendHostedOutput(t('chat.hostedErrorThreshold'))
    return
  }
  if (_hostedRuntime.stepCount >= _hostedSessionConfig.maxSteps) {
    _hostedRuntime.status = HOSTED_STATUS.IDLE
    persistHostedRuntime(); updateHostedBadge()
    return
  }
  _hostedBusy = true
  _hostedRuntime.pending = true
  _hostedRuntime.status = HOSTED_STATUS.RUNNING
  _hostedRuntime.lastRunAt = Date.now()
  _hostedRuntime.lastRunId = uuid()
  persistHostedRuntime(); updateHostedBadge()

  const delay = _hostedSessionConfig.stepDelayMs || HOSTED_DEFAULTS.stepDelayMs
  if (delay > 0) await new Promise(r => setTimeout(r, delay))

  try {
    const messages = buildHostedMessages()
    let resultText = ''
    await callHostedAI(messages, (chunk) => { resultText += chunk })

    _hostedRuntime.stepCount += 1
    _hostedRuntime.errorCount = 0
    _hostedRuntime.lastError = ''

    _hostedSessionConfig.history.push({ role: 'assistant', content: resultText, ts: Date.now() })
    persistHostedRuntime()
    appendHostedOutput(resultText + ` | step=${_hostedRuntime.stepCount}`)

    // 如果 AI 回复中有「执行命令」类内容，通过 Gateway 发送给 Agent
    const instruction = resultText.trim()
    if (instruction && !detectStopFromText(instruction)) {
      _hostedRuntime.status = HOSTED_STATUS.WAITING
      _hostedRuntime.pending = false
      persistHostedRuntime(); updateHostedBadge()
      // 将指令发�?Gateway Agent
      try { await wsClient.chatSend(_sessionKey, instruction) } catch {}
    } else {
      _hostedRuntime.status = HOSTED_STATUS.IDLE
      _hostedRuntime.pending = false
      persistHostedRuntime(); updateHostedBadge()
    }
  } catch (e) {
    _hostedRuntime.errorCount = (_hostedRuntime.errorCount || 0) + 1
    _hostedRuntime.lastError = e.message || String(e)
    _hostedRuntime.pending = false
    if (_hostedRuntime.errorCount >= _hostedSessionConfig.retryLimit) {
      _hostedRuntime.status = HOSTED_STATUS.ERROR
      persistHostedRuntime(); updateHostedBadge()
      appendHostedOutput(t('chat.hostedNeedIntervention', { reason: _hostedRuntime.lastError }))
      return
    }
    persistHostedRuntime(); updateHostedBadge()
    setTimeout(() => { _hostedBusy = false; runHostedAgentStep() }, delay)
    return
  } finally {
    _hostedBusy = false
  }
}

async function callHostedAI(messages, onChunk) {
  let config
  try {
    const raw = localStorage.getItem('deerpanel-assistant')
    const stored = raw ? JSON.parse(raw) : {}
    config = { baseUrl: stored.baseUrl || '', apiKey: stored.apiKey || '', model: stored.model || '', temperature: stored.temperature || 0.7, apiType: stored.apiType || 'openai-completions' }
  } catch { config = { baseUrl: '', apiKey: '', model: '', temperature: 0.7, apiType: 'openai-completions' } }

  if (!config.baseUrl || !config.model) throw new Error(t('chat.hostedModelNotConfigured'))

  let base = config.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions\/?$/, '').replace(/\/completions\/?$/, '').replace(/\/messages\/?$/, '').replace(/\/models\/?$/, '')
  if (_hostedAbort) { _hostedAbort.abort(); _hostedAbort = null }
  _hostedAbort = new AbortController()
  const signal = _hostedAbort.signal
  const timeout = setTimeout(() => { if (_hostedAbort) _hostedAbort.abort() }, 120000)

  try {
    const headers = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`
    const body = { model: config.model, messages, stream: true, temperature: config.temperature || 0.7 }
    const resp = await fetch(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      let errMsg = `API error ${resp.status}`
      try { errMsg = JSON.parse(errText).error?.message || errMsg } catch {}
      throw new Error(errMsg)
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return
        try { const json = JSON.parse(data); if (json.choices?.[0]?.delta?.content) onChunk(json.choices[0].delta.content) } catch {}
      }
    }
  } finally {
    clearTimeout(timeout)
    _hostedAbort = null
  }
}

function appendHostedOutput(text) {
  if (!text || !_messagesEl) return
  const wrap = document.createElement('div')
  wrap.className = 'msg msg-system msg-hosted'
  wrap.textContent = `[${t('chat.hostedAgent')}] ${text}`
  _messagesEl.insertBefore(wrap, _typingEl)
  scrollToBottom()
}

// ── 页面离开清理 ──

export function cleanup() {
  _pageActive = false
  if (_unsubEvent) { _unsubEvent(); _unsubEvent = null }
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
  if (_unsubStatus) { _unsubStatus(); _unsubStatus = null }
  clearTimeout(_streamSafetyTimer)
  _cancelResponseWatchdog()
  clearTimeout(_postFinalCheck)
  _postFinalCheck = null
  if (_hostedAbort) { _hostedAbort.abort(); _hostedAbort = null }
  _sessionKey = null
  _page = null
  _messagesEl = null
  _textarea = null
  _sendBtn = null
  _statusDot = null
  _typingEl = null
  _scrollBtn = null
  _sessionListEl = null
  _cmdPanelEl = null
  _currentAiBubble = null
  _currentAiText = ''
  _currentAiImages = []
  _currentAiVideos = []
  _currentAiAudios = []
  _currentAiFiles = []
  _currentAiTools = []
  _currentRunId = null
  _isStreaming = false
  _isSending = false
  _messageQueue = []
  _lastHistoryHash = ''
  _hostedBtn = null
  _hostedPanelEl = null
  _hostedBadgeEl = null
  _hostedPromptEl = null
  _hostedEnableEl = null
  _hostedMaxStepsEl = null
  _hostedStepDelayEl = null
  _hostedRetryLimitEl = null
  _hostedSaveBtn = null
  _hostedPauseBtn = null
  _hostedStopBtn = null
  _hostedCloseBtn = null
  _hostedGlobalSyncEl = null
  _hostedSessionConfig = null
  _hostedDefaults = null
  _hostedRuntime = { ...HOSTED_RUNTIME_DEFAULT }
  _hostedBusy = false
}
