/**
 * 聊天页面 - 完整版，对接 DeerFlow 对话服务
 * 支持：流式响应、Markdown 渲染、会话管理、Agent 选择、快捷指令
 */
import { api, invalidate } from '../lib/tauri-api.js'
import { wsClient, uuid, threadStatePayloadFromValues } from '../lib/ws-client.js'
import { renderMarkdown } from '../lib/markdown.js'
import { saveMessage, saveMessages, getLocalMessages, isStorageAvailable } from '../lib/message-db.js'
import { toast } from '../components/toast.js'
import { showConfirm, showModal } from '../components/modal.js'
import { icon as svgIcon } from '../lib/icons.js'

// ========== 任务进度可视化系统集成 ==========
import { tasksAPI } from '../lib/api-client.js'
import { EventStreamManager, EventTypes } from '../lib/event-stream.js'
import { FloatingTaskPanel } from '../components/FloatingTaskPanel.js'
import { EmbeddedTaskDashboard } from '../components/EmbeddedTaskDashboard.js'
import { StateRestorationManager } from '../lib/state-persistence.js'
// ============================================

const RENDER_THROTTLE = 16
const STORAGE_SESSION_KEY = 'clawpanel-last-session'
const STORAGE_MODEL_KEY = 'clawpanel-chat-selected-model'
const STORAGE_SIDEBAR_KEY = 'clawpanel-chat-sidebar-open'
const STORAGE_SESSION_NAMES_KEY = 'clawpanel-chat-session-names'
const STORAGE_SESSION_META_KEY = 'clawpanel-chat-session-meta'
const STORAGE_SESSION_TOKEN_STATS_KEY = 'clawpanel-chat-session-token-stats'

const COMMANDS = [
  { title: '会话', commands: [
    { cmd: '/new', desc: '新建会话', action: 'exec' },
    { cmd: '/reset', desc: '重置当前会话', action: 'exec' },
    { cmd: '/stop', desc: '停止生成', action: 'exec' },
    { cmd: '/collab', desc: '进入任务协作（先规划+分配，再执行）', action: 'exec' },
    { cmd: '/collab off', desc: '退出任务协作', action: 'exec' },
  ]},
  { title: '模型', commands: [
    { cmd: '/model ', desc: '切换模型（输入模型名）', action: 'fill' },
    { cmd: '/model list', desc: '查看可用模型', action: 'exec' },
    { cmd: '/model status', desc: '当前模型状态', action: 'exec' },
  ]},
  { title: '思考模式', commands: [
    { cmd: '/think off', desc: '关闭深度思考', action: 'exec' },
    { cmd: '/think low', desc: '轻度思考', action: 'exec' },
    { cmd: '/think medium', desc: '中度思考', action: 'exec' },
    { cmd: '/think high', desc: '深度思考', action: 'exec' },
  ]},
  { title: '快速模式', commands: [
    { cmd: '/fast', desc: '切换快速模式（开/关）', action: 'exec' },
    { cmd: '/fast on', desc: '开启快速模式（低延迟）', action: 'exec' },
    { cmd: '/fast off', desc: '关闭快速模式', action: 'exec' },
  ]},
  { title: '详细/推理', commands: [
    { cmd: '/verbose off', desc: '关闭详细模式', action: 'exec' },
    { cmd: '/verbose low', desc: '低详细度', action: 'exec' },
    { cmd: '/verbose high', desc: '高详细度', action: 'exec' },
    { cmd: '/reasoning off', desc: '关闭推理模式', action: 'exec' },
    { cmd: '/reasoning low', desc: '轻度推理', action: 'exec' },
    { cmd: '/reasoning medium', desc: '中度推理', action: 'exec' },
    { cmd: '/reasoning high', desc: '深度推理', action: 'exec' },
  ]},
  { title: '信息', commands: [
    { cmd: '/help', desc: '帮助信息', action: 'exec' },
    { cmd: '/status', desc: '系统状态', action: 'exec' },
    { cmd: '/context', desc: '上下文信息', action: 'exec' },
  ]},
]

const SESSION_MODES = [
  { value: 'flash', label: '闪速', command: '/fast on' },
  { value: 'thinking', label: '思考', command: '/think low' },
  { value: 'pro', label: 'Pro', command: '/think medium' },
  { value: 'ultra', label: 'Ultra', command: '/think high' },
]

let _sessionKey = null, _page = null, _messagesEl = null, _textarea = null
let _sendBtn = null, _statusDot = null, _typingEl = null, _scrollBtn = null
let _sessionListEl = null, _cmdPanelEl = null, _attachPreviewEl = null, _fileInputEl = null
let _modelSelectEl = null
let _followupsEl = null, _followupsAbort = null, _lastSuggestionRunId = null
let _suggestionRecent = []
let _quickPromptsEl = null
let _currentAiBubble = null, _currentAiText = '', _currentAiImages = [], _currentAiVideos = [], _currentAiAudios = [], _currentAiFiles = [], _currentAiTools = [], _currentRunId = null
let _isStreaming = false, _isSending = false, _messageQueue = [], _streamStartTime = 0
let _lastRenderTime = 0, _renderPending = false, _lastHistoryHash = ''
let _autoScrollEnabled = true, _lastScrollTop = 0, _touchStartY = 0
let _isLoadingHistory = false
let _streamSafetyTimer = null, _unsubEvent = null, _unsubReady = null, _unsubStatus = null
let _activeRunWatchTimer = null, _activeRunWatchSession = null, _activeRunWatchLastRunId = null
let _lastRemoteHistoryPoll = 0
let _seenRunIds = new Set()
let _pageActive = false
/** @type {((e: KeyboardEvent) => void) | null} */
let _collabModalEscapeHandler = null
const _toolEventTimes = new Map()
const _toolEventData = new Map()
const _toolRunIndex = new Map()
const _toolEventSeen = new Set()
let _errorTimer = null, _lastErrorMsg = null
let _attachments = []
let _hasEverConnected = false
let _availableModels = []
let _primaryModel = ''
let _selectedModel = ''
let _isApplyingModel = false
let _modelCapabilities = {}

// ── 托管 Agent ──
const HOSTED_STATUS = { IDLE: 'idle', RUNNING: 'running', WAITING: 'waiting_reply', PAUSED: 'paused', ERROR: 'error' }
const HOSTED_SESSIONS_KEY = 'clawpanel-hosted-agent-sessions'
const HOSTED_SYSTEM_PROMPT = `你是一个托管调度 Agent。你的职责是：根据用户设定的目标，持续引导 DeerFlow AI Agent 完成任务。
规则：
1. 你每一轮只输出一条简洁的指令（1-3 句话），发给 DeerFlow 执行
2. 根据 DeerFlow 的回复评估进展，决定下一步指令
3. 如果任务已完成或无法继续，回复包含"完成"或"停止"来结束循环
4. 不要重复相同的指令，不要输出解释性文字，只输出下一步要执行的指令`
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
  // ========== 调试日志 START ==========
  console.log('%c====== [Chat] render() 被调用 ======', 'color: #00ff00; font-size: 16px; font-weight: bold;')
  console.log('%c[Chat] 开始创建页面元素...', 'color: #00ffff; font-size: 14px')
  console.log('[Chat] 当前时间:', new Date().toLocaleTimeString())
  console.log('[Chat] 页面路径:', window.location.pathname)
  // ========== 调试日志 END ==========
  
  const page = document.createElement('div')
  page.className = 'page chat-page'
  _pageActive = true
  _page = page

  page.innerHTML = `
    <div class="chat-sidebar" id="chat-sidebar">
      <div class="chat-sidebar-header">
        <span>会话列表</span>
        <div class="chat-sidebar-header-actions">
          <button class="chat-sidebar-btn" id="btn-toggle-sidebar" title="会话列表">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <button class="chat-sidebar-btn" id="btn-new-session" title="新建会话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        </div>
      </div>
      <div class="chat-session-list" id="chat-session-list"></div>
    </div>
    <div class="chat-main">
      <div class="chat-header">
        <div class="chat-status">
          <button class="chat-toggle-sidebar" id="btn-toggle-sidebar-main" title="会话列表">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span class="chat-title" id="chat-title">聊天</span>
        </div>
        <div class="chat-header-actions">
          <div class="chat-agent-group" style="margin-right:12px">
            <button class="btn btn-sm btn-secondary" id="btn-new-agent" title="新建智能体">+ 智能体</button>
            <button class="btn btn-sm btn-secondary" id="btn-switch-agent" title="切换智能体">切换智能体</button>
          </div>
          <div class="chat-token-stats" id="chat-token-stats" title="当前会话累计 Token 消耗">↑0 ↓0 · Σ0</div>
          <button type="button" class="btn btn-sm btn-secondary" id="btn-open-collab-modal" title="任务协作">任务协作</button>
          <div class="chat-model-group">
            <select class="form-input" id="chat-model-select" title="切换当前会话模型" style="width:200px;max-width:28vw;padding:6px 10px;font-size:var(--font-size-xs)">
              <option value="">加载模型中...</option>
            </select>
          </div>
        </div>
      </div>
      <div class="chat-workspace">
        <div class="chat-messages-wrap">
          <div class="chat-messages" id="chat-messages">
            <div class="typing-indicator" id="typing-indicator" style="display:none">
              <span></span><span></span><span></span>
            </div>
          </div>
          <button class="chat-scroll-btn" id="chat-scroll-btn" style="display:none">↓</button>
        </div>
        <aside class="chat-collab-drawer" id="chat-collab-drawer" aria-label="任务协作" aria-hidden="true" hidden>
          <div class="chat-collab-drawer-header">
            <div class="chat-collab-drawer-title">任务协作</div>
            <button type="button" class="chat-collab-drawer-collapse" id="btn-collapse-collab-drawer" title="隐藏面板">«</button>
          </div>
          <div class="chat-collab-drawer-content">
            <p class="chat-collab-modal-hint">适合需要多步拆解、边聊边跟进的任务。打开本面板后即启用协作与任务规划；下方对话即可开始触发并推进。</p>
            <div class="chat-collab-bound-task-wrap">
              <span class="chat-collab-bound-task-label">当前关联任务</span>
              <div class="chat-collab-bound-task" id="chat-collab-bound-task">—</div>
            </div>
            <button type="button" class="btn btn-secondary btn-block chat-collab-open-task" id="btn-open-task-monitor" title="查看结构化进度与记录">
              任务进度监控
            </button>
          </div>
        </aside>
      </div>
      <div class="chat-compose-stack">
      <div class="chat-thread-panel" id="chat-thread-panel" hidden>
        <div class="chat-sidebar-thread-title" id="chat-sidebar-title" hidden></div>
        <div class="chat-sidebar-section">
          <div class="chat-sidebar-section-label">进行状态</div>
          <div class="chat-sidebar-activity" id="chat-sidebar-activity">—</div>
        </div>
        <div class="chat-sidebar-section" id="chat-sidebar-reasoning-wrap" hidden>
          <div class="chat-sidebar-section-label">思考</div>
          <pre class="chat-sidebar-reasoning" id="chat-sidebar-reasoning"></pre>
        </div>
        <div class="chat-sidebar-section" id="chat-sidebar-clarify-wrap" hidden>
          <div class="chat-sidebar-section-label">待确认</div>
          <div class="chat-sidebar-clarify" id="chat-sidebar-clarify"></div>
        </div>
        <div class="chat-sidebar-section" id="chat-sidebar-todos-wrap" hidden>
          <div class="chat-sidebar-section-label">任务进度</div>
          <ul class="chat-sidebar-todos" id="chat-sidebar-todos"></ul>
        </div>
      </div>
      <div class="chat-cmd-panel" id="chat-cmd-panel" style="display:none"></div>
      <div class="chat-followups" id="chat-followups" hidden></div>
      <div class="chat-quick-prompts" id="chat-quick-prompts">
        <div class="chat-quick-prompts-title">快捷开始</div>
        <div class="chat-quick-prompts-row">
          <button class="chat-quick-prompt" data-prompt="给我一个小惊喜吧">小惊喜</button>
          <button class="chat-quick-prompt" data-prompt="撰写一篇关于[主题]的博客文章">写作</button>
          <button class="chat-quick-prompt" data-prompt="深入浅出的研究一下[主题]，并总结发现。">研究</button>
          <button class="chat-quick-prompt" data-prompt="从[来源]收集数据并创建报告。">收集</button>
          <button class="chat-quick-prompt" data-prompt="帮我学习[主题]：先给学习路线，再出练习题并批改。">学习</button>
          <button class="chat-quick-prompt" data-prompt="创建一个[类型]的作品：给方案、步骤和可交付物。">创建</button>
        </div>
      </div>
      <div class="chat-attachments-preview" id="chat-attachments-preview" style="display:none"></div>
      <div class="chat-input-area">
        <input type="file" id="chat-file-input" accept="image/*" multiple style="display:none">
        <button class="chat-attach-btn" id="chat-attach-btn" title="上传图片">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <div class="chat-mode-wrap">
          <button class="chat-mode-btn" id="chat-mode-btn" title="模式">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" aria-hidden="true"><path d="M12 2l2.4 6.2L21 9l-5 4 1.6 6.8L12 16.8 6.4 19.8 8 13.1 3 9l6.6-.8L12 2z"/></svg>
            <span class="chat-mode-label" id="chat-mode-label">模式: Pro</span>
            <span class="chat-mode-caret" aria-hidden="true">▾</span>
          </button>
          <div class="chat-mode-menu" id="chat-mode-menu" hidden>
            <button class="chat-mode-item" data-mode="flash">闪速</button>
            <button class="chat-mode-item" data-mode="thinking">思考</button>
            <button class="chat-mode-item" data-mode="pro">Pro</button>
            <button class="chat-mode-item" data-mode="ultra">Ultra</button>
          </div>
        </div>
        <div class="chat-input-wrapper">
          <textarea id="chat-input" rows="1" placeholder="输入消息，Enter 发送，/ 打开指令"></textarea>
        </div>
        <button class="chat-send-btn" id="chat-send-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
        <button class="chat-hosted-btn btn btn-sm btn-ghost" id="chat-hosted-btn" title="托管 Agent">
          <span class="chat-hosted-label">⊕</span>
          <span class="chat-hosted-badge idle" id="chat-hosted-badge">托管</span>
        </button>
      </div>
      </div>
      <div class="hosted-agent-panel" id="hosted-agent-panel" style="display:none">
        <div class="hosted-agent-header">
          <strong>托管 Agent</strong>
          <button class="hosted-agent-close" id="hosted-agent-close" title="关闭">&times;</button>
        </div>
        <div class="hosted-agent-body">
          <div class="form-group">
            <label class="form-label" style="color:var(--accent);font-weight:600">任务目标</label>
            <textarea class="form-input hosted-agent-prompt" id="hosted-agent-prompt" rows="3" placeholder="例如：持续优化此仓库代码质量，直到没有可改进的地方"></textarea>
            <div class="form-hint">托管 Agent 会持续引导 DeerFlow 完成此目标。模型使用 <a href="#/assistant" class="hosted-agent-link">AI 助手</a> 的配置。</div>
          </div>
          <div class="ha-slider-group">
            <div class="ha-slider-label">最大回复次数 <span class="ha-slider-val" id="ha-steps-val">50</span></div>
            <input type="range" class="ha-slider" id="hosted-agent-max-steps" min="5" max="205" step="5" value="50">
            <div class="ha-slider-ticks"><span>5</span><span>50</span><span>100</span><span>200</span><span>∞</span></div>
          </div>
          <div class="ha-timer-group">
            <div class="ha-timer-header">
              <span>定时自动停止</span>
              <label class="ha-toggle"><input type="checkbox" id="hosted-agent-timer-on"><span class="ha-toggle-track"></span></label>
            </div>
            <div class="ha-timer-body" id="ha-timer-body" style="display:none">
              <input type="range" class="ha-slider" id="hosted-agent-auto-stop" min="5" max="120" step="5" value="30">
              <div class="ha-slider-ticks"><span>5分</span><span>30分</span><span>60分</span><span>120分</span></div>
              <div class="ha-countdown" id="ha-countdown" style="display:none">
                <div class="ha-countdown-bar"><div class="ha-countdown-fill" id="ha-countdown-fill"></div></div>
                <span class="ha-countdown-text" id="ha-countdown-text">剩余 --:--</span>
              </div>
            </div>
          </div>
          <input type="hidden" id="hosted-agent-step-delay" value="1200">
          <input type="hidden" id="hosted-agent-retry" value="2">
        </div>
        <div class="hosted-agent-actions">
          <button class="btn btn-primary" id="hosted-agent-save" style="flex:1">▶ 启动托管</button>
        </div>
        <div class="hosted-agent-footer" id="hosted-agent-status">就绪</div>
      </div>
      <!-- 任务进度可视化仪表板容器 -->
      <div id="embedded-task-dashboard" class="embedded-task-dashboard"></div>
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
  _followupsEl = page.querySelector('#chat-followups')
  _quickPromptsEl = page.querySelector('#chat-quick-prompts')
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
  // 首次使用引导提示
  showPageGuide(_messagesEl)

  const initHosted = (window.__TAURI_INTERNALS__ ? loadHostedDefaults() : Promise.resolve())
  initHosted.then(() => { loadHostedSessionConfig(); renderHostedPanel(); updateHostedBadge() })
  // 处理 URL 参数中的 agent
  const hash = window.location.hash
  const urlParams = new URLSearchParams(hash.split('?')[1] || '')
  const agentParam = urlParams.get('agent')
  if (agentParam) {
    // 创建新会话时指定 agent
    const defaultAgent = agentParam
    const keyTail = `new-${Date.now().toString(36)}`
    const newKey = `agent:${defaultAgent}:${keyTail}`
    const currentMode = getSessionMode(_sessionKey)
    setSessionMode(newKey, 'flash') // 使用 flash 模式，与 web 版一致
    setSessionName(newKey, '')
    _sessionKey = newKey
    localStorage.setItem(STORAGE_SESSION_KEY, newKey)
    
    // 主动发送初始化消息，与 web 版一致
    setTimeout(async () => {
      try {
        // 先确保 Gateway 连接
        if (!wsClient.connected || !wsClient.gatewayReady) {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('连接超时')), 10000)
            const unsub = wsClient.onReady(() => {
              clearTimeout(timeout)
              unsub()
              resolve()
            })
            wsClient.connect(location.host, '')
          })
        }
        
        // 发送初始化消息
        await api.chatSend(_sessionKey, `新智能体的名称是 ${defaultAgent}，现在开始为它生成 **SOUL**。`, {
          mode: 'flash',
          is_bootstrap: true,
          thinking_enabled: false
        })
      } catch (e) {
        console.warn('[Chat] 发送初始化消息失败:', e)
        // 即使发送失败，也继续流程
      }
    }, 500)
  }

  loadModelOptions()
  // 非阻塞：先返回 DOM，后台连接 Gateway
  connectGateway()
  if (!_sessionKey) {
    _sessionKey = localStorage.getItem(STORAGE_SESSION_KEY) || 'agent:main:main'
  }
  renderModeControl()
  renderCollabControl()
  void reconcileCollabWithContext(_sessionKey)
  syncCollabHeaderButton()
  renderTokenStats()
  syncQuickPromptsVisibility()
  
  // ========== 任务进度可视化系统初始化 ==========
  initTaskVisualization(page)
  // ============================================
  
  return page
}

const GUIDE_KEY = 'clawpanel-guide-chat-dismissed'

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
        <b>需要通用问答或代码助手时，可切换到左侧「AI 助手」。</b>
      </div>
      <button class="chat-guide-close" title="知道了">&times;</button>
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
      renderModeControl()
      renderReasoningControl()
      applySelectedModel()
    })
  }

  page.querySelector('#btn-open-collab-modal')?.addEventListener('click', async () => {
    if (!_sessionKey) return
    const drawer = page.querySelector('#chat-collab-drawer')
    const isOn = getSessionCollabMode(_sessionKey)
    const isDrawerOpen = !!(drawer && !drawer.hidden)

    // 协作已开启：面板已展开 → 点击退出；面板已收起 → 点击仅展开面板
    if (isOn && isDrawerOpen) {
      await exitCollabFromModal()
      return
    }
    await openCollabModal()
  })
  page.querySelector('#btn-collapse-collab-drawer')?.addEventListener('click', () => closeCollabModal())

  _collabModalEscapeHandler = (e) => {
    if (e.key !== 'Escape' || !_pageActive) return
    const d = _page?.querySelector('#chat-collab-drawer')
    if (d && !d.hidden) {
      e.preventDefault()
      closeCollabModal()
    }
  }
  document.addEventListener('keydown', _collabModalEscapeHandler)

  page.querySelector('#btn-open-task-monitor')?.addEventListener('click', async () => {
    const tid = await resolveBoundTaskIdForSession(_sessionKey)
    if (tid) window.location.hash = '#/task/' + encodeURIComponent(tid)
    else toast('还没有关联到具体任务，可先创建任务或继续对话', 'warning')
  })

  _textarea.addEventListener('input', () => {
    _textarea.style.height = 'auto'
    _textarea.style.height = Math.min(_textarea.scrollHeight, 150) + 'px'
    updateSendState()
    // 输入 / 时显示指令面板
    if (_textarea.value === '/') showCmdPanel()
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
  // 滑块实时值显示
  if (_hostedMaxStepsEl) _hostedMaxStepsEl.addEventListener('input', () => {
    const valEl = page.querySelector('#ha-steps-val')
    if (valEl) valEl.textContent = parseInt(_hostedMaxStepsEl.value) >= 205 ? '∞' : _hostedMaxStepsEl.value
  })
  // 定时器开关
  const timerToggle = page.querySelector('#hosted-agent-timer-on')
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
  page.querySelector('#btn-new-session').addEventListener('click', () => createNewSessionQuick())
  
  // 新建智能体按钮
  page.querySelector('#btn-new-agent')?.addEventListener('click', () => {
    // 直接在当前页面弹出创建智能体对话框
    showModal({
      title: '新建 Agent',
      fields: [
        { name: 'name', label: 'Agent 名称', value: '', placeholder: '例如：translator（字母、数字、连字符）' },
      ],
      onConfirm: async (result) => {
        const name = (result.name || '').trim().toLowerCase()
        if (!name) { toast('请输入 Agent 名称', 'warning'); return }
        if (!/^[a-z0-9-]+$/.test(name)) { toast('Agent 名称只能包含小写字母、数字和连字符', 'warning'); return }

        // 检查名称是否可用
        try {
          const result = await api.checkAgentName(name)
          if (!result.available) {
            toast('Agent 名称已存在', 'warning')
            return
          }
        } catch (e) {
          console.warn('[Agent创建] 检查名称失败:', e)
          // 继续创建，忽略检查失败
        }

        // 创建智能体
          try {
            await api.createAgent({
              name,
              description: '',
              model: null,
              tool_groups: null,
              soul: '',
            })
            toast('Agent 已创建', 'success')

            // 创建新会话
            const keyTail = `new-${Date.now().toString(36)}`
            const newKey = `agent:${name}:${keyTail}`
            setSessionMode(newKey, 'flash') // 使用 flash 模式，与 web 版一致
            setSessionName(newKey, '')
            
            // 切换到新会话
            await switchSession(newKey)
            
            // 重新加载历史
            loadHistory()
            
            // 主动发送初始化消息，与 web 版一致
            try {
              // 先确保 Gateway 连接
              if (!wsClient.connected || !wsClient.gatewayReady) {
                await new Promise((resolve, reject) => {
                  const timeout = setTimeout(() => reject(new Error('连接超时')), 10000)
                  const unsub = wsClient.onReady(() => {
                    clearTimeout(timeout)
                    unsub()
                    resolve()
                  })
                  wsClient.connect(location.host, '')
                })
              }
              
              // 发送初始化消息
              await api.chatSend(_sessionKey, `新智能体的名称是 ${name}，现在开始为它生成 **SOUL**。`, {
                mode: 'flash',
                is_bootstrap: true,
                thinking_enabled: false
              })
            } catch (e) {
              console.warn('[Chat] 发送初始化消息失败:', e)
              // 即使发送失败，也继续流程
            }
          } catch (e) {
            toast('创建失败: ' + e, 'error')
          }
      }
    })
  })
  
  // 切换智能体按钮
  page.querySelector('#btn-switch-agent')?.addEventListener('click', async () => {
    try {
      const agents = await api.listAgents()
      if (!agents.length) {
        toast('暂无智能体，请先创建', 'warning')
        return
      }
      
      // 显示智能体选择对话框
      const options = agents.map(agent => ({
        label: agent.name,
        value: agent.name
      }))
      
      showModal({
        title: '切换智能体',
        fields: [
          {
            name: 'agent',
            label: '选择智能体',
            type: 'select',
            options: options
          }
        ],
        onConfirm: async (result) => {
          const agentName = result.agent
          if (!agentName) return
          
          // 创建新会话并切换到选定的智能体
          const keyTail = `new-${Date.now().toString(36)}`
          const newKey = `agent:${agentName}:${keyTail}`
          setSessionMode(newKey, 'flash') // 使用 flash 模式，与 web 版一致
          setSessionName(newKey, '')
          
          // 切换到新会话
          await switchSession(newKey)
          
          // 标记需要发送初始化消息
          window._needsBootstrapMessage = true
          window._bootstrapAgentName = agentName
          
          // 重新加载历史
          loadHistory()
        }
      })
    } catch (e) {
      toast('加载智能体列表失败: ' + e, 'error')
    }
  })
  page.querySelector('#chat-quick-prompts')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prompt]')
    if (!btn) return
    const p = (btn.dataset.prompt || '').trim()
    if (!p) return
    _textarea.value = p
    _textarea.focus()
    _textarea.dispatchEvent(new Event('input'))
  })
  page.querySelector('#chat-mode-btn')?.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleModeMenu()
  })
  page.querySelector('#chat-mode-btn')?.addEventListener('keydown', (e) => {
    if (!['Enter', ' ', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const menu = page.querySelector('#chat-mode-menu')
    if (!menu) return
    menu.hidden = false
    const items = Array.from(menu.querySelectorAll('.chat-mode-item:not([hidden])'))
    const active = menu.querySelector('.chat-mode-item.active:not([hidden])')
    const target = active || items[0]
    target?.focus()
  })
  page.querySelector('#chat-mode-menu')?.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const item = e.target.closest('[data-mode]')
    if (!item) return
    applyModeOption(item.dataset.mode)
  })
  page.querySelector('#chat-mode-menu')?.addEventListener('keydown', (e) => {
    const menu = page.querySelector('#chat-mode-menu')
    if (!menu || menu.hidden) return
    const items = Array.from(menu.querySelectorAll('.chat-mode-item:not([hidden])'))
    if (!items.length) return
    const currentIndex = items.findIndex((it) => it === document.activeElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      menu.hidden = true
      page.querySelector('#chat-mode-btn')?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + items.length) % items.length
      items[nextIndex]?.focus()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const focused = document.activeElement?.closest?.('.chat-mode-item')
      if (focused?.dataset?.mode) applyModeOption(focused.dataset.mode)
    }
  })
  page.addEventListener('click', (e) => {
    const modeWrap = page.querySelector('.chat-mode-wrap')
    if (modeWrap && modeWrap.contains(e.target)) return
    const modeMenu = page.querySelector('#chat-mode-menu')
    if (modeMenu) modeMenu.hidden = true
  })

  // 文件上传
  page.querySelector('#chat-attach-btn').addEventListener('click', () => _fileInputEl.click())
  _fileInputEl.addEventListener('change', handleFileSelect)
  // 粘贴图片（Ctrl+V）
  _textarea.addEventListener('paste', handlePaste)

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

function syncQuickPromptsVisibility() {
  if (!_quickPromptsEl || !_messagesEl) return
  // 仅当出现真实对话（user/assistant）时隐藏；系统提示/压缩提示不影响“新对话快捷开始”
  const hasMsg = !!_messagesEl.querySelector('.msg-user, .msg-ai')
  _quickPromptsEl.hidden = hasMsg
}

async function loadModelOptions(showToast = false) {
  if (!_modelSelectEl) return
  // 显示加载状态
  _modelSelectEl.innerHTML = '<option value="">加载模型中...</option>'
  _modelSelectEl.disabled = true
  try {
    const modelsRespPromise = fetch('/api/models', { method: 'GET' })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        return resp.json()
      })
    const data = await modelsRespPromise
    const rows = Array.isArray(data?.models) ? data.models : []
    const models = []
    const capabilities = {}
    const seen = new Set()
    for (const item of rows) {
      const name = (item?.name && typeof item.name === 'string') ? item.name : ''
      if (!name || seen.has(name)) continue
      seen.add(name)
      models.push(name)
      capabilities[name] = {
        supportsThinking: item?.supports_thinking !== false,
        supportsReasoningEffort: item?.supports_reasoning_effort !== false,
      }
    }
    _primaryModel = ''
    // 老版本体验：优先用当前会话上下文模型
    const ctxModel = wsClient.getSessionContext(_sessionKey)?.model_name
    if (ctxModel && typeof ctxModel === 'string' && !seen.has(ctxModel)) {
      seen.add(ctxModel)
      models.unshift(ctxModel)
    }
    const saved = localStorage.getItem(STORAGE_MODEL_KEY) || ''
    if (saved && !seen.has(saved)) {
      seen.add(saved)
      models.push(saved)
    }
    _availableModels = models
    _modelCapabilities = capabilities
    _selectedModel = models.includes(ctxModel) ? ctxModel : (models.includes(saved) ? saved : (models[0] || ''))
    renderModelSelect()
    renderModeControl()
    renderReasoningControl()
    if (showToast) toast(`已刷新，共 ${models.length} 个模型`, 'success')
  } catch (e) {
    _availableModels = []
    _primaryModel = ''
    _selectedModel = ''
    _modelCapabilities = {}
    renderModelSelect(`模型接口不可用: ${e.message || e}`)
    renderModeControl()
    renderReasoningControl()
    if (showToast) toast('加载模型失败: ' + (e.message || e), 'error')
  }
}

function renderModelSelect(errorText = '') {
  if (!_modelSelectEl) return
  if (!_availableModels.length) {
    const ctxModel = wsClient.getSessionContext(_sessionKey)?.model_name
    const fallback = (typeof ctxModel === 'string' && ctxModel.trim())
      ? ctxModel.trim()
      : (_selectedModel || '')
    if (fallback) {
      _selectedModel = fallback
      _modelSelectEl.innerHTML = `<option value="${escapeAttr(fallback)}" selected>${escapeHtml(fallback)}（当前）</option>`
      _modelSelectEl.disabled = false
      _modelSelectEl.title = `切换当前会话模型：${fallback}`
      return
    }
    _modelSelectEl.innerHTML = `<option value="">${escapeAttr(errorText || '模型读取中…')}</option>`
    _modelSelectEl.disabled = true
    _modelSelectEl.title = errorText || '模型列表暂不可用'
    return
  }
  _modelSelectEl.disabled = _isApplyingModel
  _modelSelectEl.innerHTML = _availableModels.map(full => {
    const suffix = full === _primaryModel ? '（主模型）' : ''
    return `<option value="${escapeAttr(full)}" ${full === _selectedModel ? 'selected' : ''}>${full}${suffix}</option>`
  }).join('')
  _modelSelectEl.title = _selectedModel ? `切换当前会话模型：${_selectedModel}` : '切换当前会话模型'
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

function titleFromFirstUserInput(text) {
  const t = (text || '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length > 18 ? `${t.slice(0, 18)}…` : t
}

function getSessionMetaMap() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_META_KEY) || '{}') } catch { return {} }
}

function setSessionMode(key, mode) {
  if (!key) return
  const map = getSessionMetaMap()
  const cur = map[key] || {}
  if (mode && mode !== 'pro') {
    map[key] = { ...cur, mode }
  } else {
    const next = { ...cur }
    delete next.mode
    if (Object.keys(next).length) map[key] = next
    else delete map[key]
  }
  localStorage.setItem(STORAGE_SESSION_META_KEY, JSON.stringify(map))
}

function getSessionMode(key) {
  const raw = getSessionMetaMap()[key]?.mode
  if (raw === 'normal') return 'pro'
  if (raw === 'fast') return 'flash'
  if (raw === 'think') return 'thinking'
  if (raw === 'deep') return 'ultra'
  return raw || 'pro'
}

function getTokenStatsMap() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SESSION_TOKEN_STATS_KEY) || '{}') } catch { return {} }
}

function getSessionTokenStats(key) {
  if (!key) return null
  const map = getTokenStatsMap()
  const s = map[key]
  if (!s || typeof s !== 'object') return null
  return {
    input: Number(s.input) || 0,
    output: Number(s.output) || 0,
    total: Number(s.total) || 0,
  }
}

function setSessionTokenStats(key, stats) {
  if (!key) return
  const map = getTokenStatsMap()
  if (!stats || !stats.total) {
    delete map[key]
  } else {
    map[key] = {
      input: Number(stats.input) || 0,
      output: Number(stats.output) || 0,
      total: Number(stats.total) || 0,
    }
  }
  localStorage.setItem(STORAGE_SESSION_TOKEN_STATS_KEY, JSON.stringify(map))
}

function renderTokenStats() {
  const el = _page?.querySelector('#chat-token-stats')
  if (!el) return
  const s = getSessionTokenStats(_sessionKey)
  if (!s) {
    el.textContent = '↑0 ↓0 · Σ0'
    el.title = '当前会话累计 Token 消耗'
    return
  }
  el.textContent = `↑${s.input} ↓${s.output} · Σ${s.total}`
  el.title = `当前会话累计 Token 消耗（输入 ${s.input}，输出 ${s.output}）`
}

function getSelectedModelCapability() {
  const cap = _modelCapabilities?.[_selectedModel]
  return {
    supportsThinking: cap?.supportsThinking !== false,
    supportsReasoningEffort: cap?.supportsReasoningEffort !== false,
  }
}

function getResolvedMode(mode, supportsThinking) {
  if (!supportsThinking && mode !== 'flash') return 'flash'
  return mode || (supportsThinking ? 'pro' : 'flash')
}

function setSessionThinkLevel(key, level) {
  if (!key) return
  const map = getSessionMetaMap()
  const cur = map[key] || {}
  if (level && level !== 'medium') {
    map[key] = { ...cur, thinkLevel: level }
  } else {
    // 'medium' 作为默认值，不落库
    const next = { ...cur }
    delete next.thinkLevel
    if (Object.keys(next).length) map[key] = next
    else delete map[key]
  }
  localStorage.setItem(STORAGE_SESSION_META_KEY, JSON.stringify(map))
}

function getSessionThinkLevel(key) {
  return getSessionMetaMap()[key]?.thinkLevel || 'medium'
}

function setSessionReasoningEffort(key, effort) {
  if (!key) return
  const map = getSessionMetaMap()
  const cur = map[key] || {}
  if (effort && effort !== 'off') {
    map[key] = { ...cur, reasoningEffort: effort }
  } else {
    // 'off' 作为默认值，不落库
    const next = { ...cur }
    delete next.reasoningEffort
    if (Object.keys(next).length) map[key] = next
    else delete map[key]
  }
  localStorage.setItem(STORAGE_SESSION_META_KEY, JSON.stringify(map))
}

function getSessionReasoningEffort(key) {
  return getSessionMetaMap()[key]?.reasoningEffort || 'off'
}

/** 任务协作开关（按会话持久化在 STORAGE_SESSION_META_KEY） */
function getSessionCollabMode(key) {
  return !!getSessionMetaMap()[key]?.collabMode
}

function setSessionCollabMode(key, on) {
  if (!key) return
  const map = getSessionMetaMap()
  const cur = map[key] || {}
  if (on) {
    map[key] = { ...cur, collabMode: true }
  } else {
    const next = { ...cur }
    delete next.collabMode
    if (Object.keys(next).length) map[key] = next
    else delete map[key]
  }
  localStorage.setItem(STORAGE_SESSION_META_KEY, JSON.stringify(map))
}

/** 与 E-01 同存储：写服务端 ``collab_phase``（可抛错，供 /collab 反馈）。主任务绑定由服务端维护 bound_task_id。 */
async function applyCollabServerPatch(sessionKey, on) {
  if (on) {
    const threadId = await wsClient.ensureChatThread(sessionKey)
    // 进入规划阶段：让模型优先用 supervisor 搭建任务/子任务并分配智能体
    await wsClient.putThreadCollabState(threadId, { collab_phase: 'planning' })
  } else {
    const threadId = wsClient.getSessionThreadId(sessionKey)
    if (threadId) {
      await wsClient.putThreadCollabState(threadId, {
        collab_phase: 'idle',
        bound_task_id: null,
        bound_project_id: null,
      })
    }
  }
}

async function persistCollabToggleToServer(sessionKey, on) {
  try {
    await applyCollabServerPatch(sessionKey, on)
  } catch (e) {
    console.warn('[collab] server sync failed', e)
  }
}

async function reconcileCollabWithContext(sessionKey) {
  if (!sessionKey) return
  if (getSessionCollabMode(sessionKey)) {
    await api.chatUpdateContext(sessionKey, {
      subagent_enabled: true,
      is_plan_mode: true,
      collab_task_id: null,
    })
  } else {
    await api.chatUpdateContext(sessionKey, { collab_task_id: null })
  }
}

async function openCollabModal() {
  if (!_page || !_sessionKey) return
  const drawer = _page.querySelector('#chat-collab-drawer')
  if (!drawer) return
  if (!getSessionCollabMode(_sessionKey)) {
    setSessionCollabMode(_sessionKey, true)
    await reconcileCollabWithContext(_sessionKey)
    await persistCollabToggleToServer(_sessionKey, true)
  }
  drawer.hidden = false
  drawer.setAttribute('aria-hidden', 'false')
  void refreshCollabBoundTaskDisplay(_sessionKey)
  applyCollabSidePanelPlaceholder()
  syncCollabHeaderButton()
}

function closeCollabModal() {
  const drawer = _page?.querySelector('#chat-collab-drawer')
  if (drawer) {
    drawer.hidden = true
    drawer.setAttribute('aria-hidden', 'true')
  }
  syncCollabHeaderButton()
}

async function exitCollabFromModal() {
  if (!_sessionKey) return
  setSessionCollabMode(_sessionKey, false)
  const mode = getSessionMode(_sessionKey)
  applySessionModePreset(_sessionKey, mode)
  api.chatUpdateContext(_sessionKey, { collab_task_id: null })
  await persistCollabToggleToServer(_sessionKey, false)
  closeCollabModal()
  renderCollabControl()
  toast('已退出任务协作', 'success')
}

function syncCollabHeaderButton() {
  const btn = _page?.querySelector('#btn-open-collab-modal')
  if (!btn) return
  const on = _sessionKey ? getSessionCollabMode(_sessionKey) : false
  const drawer = _page?.querySelector('#chat-collab-drawer')
  const modalOpen = !!(drawer && !drawer.hidden)
  btn.classList.toggle('chat-collab-header-on', on)
  if (modalOpen) {
    btn.title = '退出任务协作'
    btn.setAttribute('aria-expanded', 'true')
  } else {
    btn.title = on ? '任务协作（点此展开面板）' : '任务协作'
    btn.setAttribute('aria-expanded', 'false')
  }
}

async function resolveBoundTaskIdForSession(sessionKey) {
  const threadId = wsClient.getSessionThreadId(sessionKey)
  if (!threadId) return null
  try {
    const s = await wsClient.getThreadCollabState(threadId)
    const bid = (s?.bound_task_id ?? '').toString().trim()
    return bid || null
  } catch {
    return null
  }
}

async function refreshCollabBoundTaskDisplay(sessionKey) {
  const el = _page?.querySelector('#chat-collab-bound-task')
  if (!el) return
  el.classList.remove('chat-collab-bound-task--start')
  if (!sessionKey) {
    el.textContent = '—'
    return
  }
  const threadId = wsClient.getSessionThreadId(sessionKey)
  if (!threadId) {
    el.textContent = '无会话线程'
    return
  }
  el.textContent = '读取中…'
  try {
    const s = await wsClient.getThreadCollabState(threadId)
    const bid = (s?.bound_task_id ?? '').toString().trim()
    if (bid) {
      el.textContent = bid
      return
    }
    if (getSessionCollabMode(sessionKey)) {
      el.textContent = '任务协作已就绪：在下方输入框发第一条消息即可触发主任务生成。'
      el.classList.add('chat-collab-bound-task--start')
      return
    } else {
      el.textContent = '—'
    }
  } catch {
    el.textContent = '无法读取协作状态'
  }
}

/** 任务协作已开启且尚无流式状态时，右侧「进行状态」展示引导，避免只显示「—」或空白。 */
function applyCollabSidePanelPlaceholder() {
  if (!_page || !_sessionKey) return
  if (!getSessionCollabMode(_sessionKey)) return
  const activityEl = _page.querySelector('#chat-sidebar-activity')
  if (!activityEl) return
  const raw = (activityEl.textContent || '').trim()
  const isOurHint = activityEl.dataset.collabHint === '1'
  const looksIdle = raw === '—' || raw === '' || isOurHint
  if (!looksIdle) return
  activityEl.replaceChildren()
  const span = document.createElement('span')
  span.className = 'chat-sidebar-act-icon'
  span.textContent = '📋'
  activityEl.appendChild(span)
  activityEl.appendChild(
    document.createTextNode(' 任务协作已就绪：在下方输入框发消息即可。')
  )
  activityEl.dataset.collabHint = '1'
  syncThreadPanelVisibility()
}

function renderCollabControl() {
  if (!_page || !_sessionKey) return
  if (!getSessionCollabMode(_sessionKey)) {
    const activityEl = _page.querySelector('#chat-sidebar-activity')
    if (activityEl?.dataset.collabHint === '1') {
      activityEl.textContent = '—'
      delete activityEl.dataset.collabHint
      syncThreadPanelVisibility()
    }
  } else {
    applyCollabSidePanelPlaceholder()
  }
  void refreshCollabBoundTaskDisplay(_sessionKey)
  updateCollabPlaceholder()
  syncCollabHeaderButton()
}

function updateCollabPlaceholder() {
  if (!_textarea) return
  if (_sessionKey && getSessionCollabMode(_sessionKey)) {
    _textarea.placeholder = '描述多步骤目标；将先对齐需求再规划…'
  } else {
    _textarea.placeholder = '输入消息，Enter 发送，/ 打开指令'
  }
}

function getSidebarOpen() {
  return localStorage.getItem(STORAGE_SIDEBAR_KEY) === '1'
}

function setSidebarOpen(open) {
  localStorage.setItem(STORAGE_SIDEBAR_KEY, open ? '1' : '0')
}

function thinkingLabelFromContext(ctx) {
  if (!ctx?.thinking_enabled) return '关'
  return '中'
}

function reasoningLabelFromSessionMeta(sessionKey) {
  const v = getSessionReasoningEffort(sessionKey)
  return v === 'off' ? '关' : '开'
}

function modeLabelFromSessionMeta(sessionKey) {
  const v = getSessionMode(sessionKey)
  if (v === 'flash') return '闪速'
  if (v === 'thinking') return '思考'
  if (v === 'ultra') return 'Ultra'
  return 'Pro'
}

function renderThinkingControl() {
  if (!_page || !_sessionKey) return
  const btn = _page.querySelector('#chat-think-btn')
  const labelEl = _page.querySelector('#chat-think-label')
  if (!btn || !labelEl) return
  const ctx = wsClient.getSessionContext(_sessionKey)
  const selected = getSessionThinkLevel(_sessionKey)
  const map = { off: '关', low: '低', medium: '中', high: '高' }
  const lv = map[selected] || thinkingLabelFromContext(ctx)
  labelEl.textContent = `思考: ${lv}`
  btn.classList.toggle('active', lv !== '关')
  renderThinkingMenu()
}

function renderThinkingMenu() {
  if (!_page || !_sessionKey) return
  const menu = _page.querySelector('#chat-think-menu')
  if (!menu) return
  const selected = getSessionThinkLevel(_sessionKey)
  menu.querySelectorAll('[data-think]').forEach((item) => {
    const v = item.dataset.think || 'medium'
    const active = v === selected
    item.classList.toggle('active', active)
    item.setAttribute('aria-checked', active ? 'true' : 'false')
  })
}

function renderModeControl() {
  if (!_page || !_sessionKey) return
  const { supportsThinking } = getSelectedModelCapability()
  const currentMode = getSessionMode(_sessionKey)
  const selectedMode = getResolvedMode(currentMode, supportsThinking)
  if (selectedMode !== currentMode) {
    setSessionMode(_sessionKey, selectedMode)
    applySessionModePreset(_sessionKey, selectedMode)
  }
  const btn = _page.querySelector('#chat-mode-btn')
  const labelEl = _page.querySelector('#chat-mode-label')
  const menu = _page.querySelector('#chat-mode-menu')
  if (!btn || !labelEl || !menu) return
  const lv = modeLabelFromSessionMeta(_sessionKey)
  labelEl.textContent = `模式: ${lv}`
  btn.classList.toggle('active', lv !== 'Pro')
  menu.querySelectorAll('.chat-mode-item').forEach((item) => {
    const mode = item.dataset.mode || 'pro'
    const visible = supportsThinking || mode === 'flash'
    item.hidden = !visible
    item.tabIndex = visible ? 0 : -1
    const active = mode === selectedMode
    item.classList.toggle('active', active)
    item.setAttribute('aria-checked', active ? 'true' : 'false')
  })
}

function renderReasoningControl() {
  if (!_page || !_sessionKey) return
  const btn = _page.querySelector('#chat-reasoning-btn')
  const labelEl = _page.querySelector('#chat-reasoning-label')
  if (!btn || !labelEl) return
  const { supportsReasoningEffort } = getSelectedModelCapability()
  const mode = getSessionMode(_sessionKey)
  const visible = !!supportsReasoningEffort && mode !== 'flash'
  const wrap = btn.closest('.chat-reasoning-wrap')
  if (wrap) wrap.hidden = !visible
  if (!visible) return
  const selected = getSessionReasoningEffort(_sessionKey)
  const menu = _page.querySelector('#chat-reasoning-menu')
  const lv = reasoningLabelFromSessionMeta(_sessionKey)
  labelEl.textContent = `推理: ${lv}`
  btn.classList.toggle('active', lv !== '关')
  if (menu) {
    menu.querySelectorAll('.chat-reasoning-item[data-reasoning]').forEach((item) => {
      const v = item.dataset.reasoning || 'off'
      const active = v === selected
      item.classList.toggle('active', active)
      item.setAttribute('aria-checked', active ? 'true' : 'false')
    })
  }
}

function toggleThinkingMenu() {
  if (!_page) return
  const menu = _page.querySelector('#chat-think-menu')
  if (!menu) return
  menu.hidden = !menu.hidden
}

function toggleModeMenu() {
  if (!_page) return
  const menu = _page.querySelector('#chat-mode-menu')
  if (!menu) return
  menu.hidden = !menu.hidden
}

function toggleReasoningMenu() {
  if (!_page) return
  const menu = _page.querySelector('#chat-reasoning-menu')
  if (!menu) return
  menu.hidden = !menu.hidden
}

function applyThinkingLevel(level) {
  if (!_sessionKey) return
  const menu = _page?.querySelector('#chat-think-menu')
  if (menu) menu.hidden = true
  let contextUpdate = null
  let tip = ''
  if (level === 'off') {
    contextUpdate = { thinking_enabled: false }
    tip = '已关闭思考'
    setSessionThinkLevel(_sessionKey, 'off')
  } else if (level === 'low') {
    contextUpdate = { thinking_enabled: true }
    tip = '已设置为低思考'
    setSessionThinkLevel(_sessionKey, 'low')
  } else if (level === 'medium') {
    contextUpdate = { thinking_enabled: true }
    tip = '已设置为中思考'
    setSessionThinkLevel(_sessionKey, 'medium')
  } else if (level === 'high') {
    contextUpdate = { thinking_enabled: true }
    tip = '已设置为高思考'
    setSessionThinkLevel(_sessionKey, 'high')
  }
  if (!contextUpdate) return
  api.chatUpdateContext(_sessionKey, contextUpdate)
  renderThinkingControl()
  renderThinkingMenu()
  toast(tip, 'success')
}

function applyModeOption(mode) {
  if (!_sessionKey) return
  const menu = _page?.querySelector('#chat-mode-menu')
  if (menu) menu.hidden = true
  const { supportsThinking } = getSelectedModelCapability()
  const nextMode = ['flash', 'thinking', 'pro', 'ultra'].includes(mode) ? mode : 'pro'
  const resolvedMode = getResolvedMode(nextMode, supportsThinking)
  setSessionMode(_sessionKey, resolvedMode)
  applySessionModePreset(_sessionKey, resolvedMode)
  renderModeControl()
  renderReasoningControl()
  toast(`已切换为：${modeLabelFromSessionMeta(_sessionKey)}`, 'success')
}

function applyReasoningOption(level) {
  if (!_sessionKey) return
  const menu = _page?.querySelector('#chat-reasoning-menu')
  if (menu) menu.hidden = true
  const next = ['off', 'medium'].includes(level) ? level : 'off'
  setSessionReasoningEffort(_sessionKey, next)
  const contextUpdate = (next === 'off') ? { reasoning_effort: undefined } : { reasoning_effort: next }
  api.chatUpdateContext(_sessionKey, contextUpdate)
  renderReasoningControl()
  toast(`已设置推理：${reasoningLabelFromSessionMeta(_sessionKey)}`, 'success')
}

async function applySelectedModel() {
  if (!_selectedModel) {
    toast('请先选择模型', 'warning')
    return
  }
  if (!wsClient.gatewayReady || !_sessionKey) return
  _isApplyingModel = true
  renderModelSelect()
  try {
    await api.chatSend(_sessionKey, `/model ${_selectedModel}`)
    toast(`已切换当前会话模型为 ${_selectedModel}`, 'success')
  } catch (e) {
    toast('切换模型失败: ' + (e.message || e), 'error')
  } finally {
    _isApplyingModel = false
    renderModelSelect()
  }
}

// ── 文件上传 ──

async function handleFileSelect(e) {
  const files = Array.from(e.target.files || [])
  if (!files.length) return

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      toast('仅支持图片文件', 'warning')
      continue
    }
    if (file.size > 5 * 1024 * 1024) {
      toast(`${file.name} 超过 5MB 限制`, 'warning')
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
      toast(`读取 ${file.name} 失败`, 'error')
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
    if (file.size > 5 * 1024 * 1024) { toast('粘贴的图片超过 5MB 限制', 'warning'); continue }
    try {
      const base64 = await fileToBase64(file)
      _attachments.push({ type: 'image', mimeType: file.type || 'image/png', fileName: `paste-${Date.now()}.png`, content: base64 })
      renderAttachments()
    } catch (_) { toast('读取粘贴图片失败', 'error') }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl)
      if (!match) { reject(new Error('无效的数据 URL')); return }
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
    // 清理旧的订阅，避免重复监听
    if (_unsubStatus) { _unsubStatus(); _unsubStatus = null }
    if (_unsubReady) { _unsubReady(); _unsubReady = null }
    if (_unsubEvent) { _unsubEvent(); _unsubEvent = null }

    // 订阅状态变化（订阅式，返回 unsub）
    _unsubStatus = wsClient.onStatusChange((status) => {
      if (!_pageActive) return
      updateStatusDot(status)
      if (status === 'ready' || status === 'connected') {
        _hasEverConnected = true
      }
    })

    _unsubReady = wsClient.onReady(async (hello, sessionKey, err) => {
      if (!_pageActive) return
      if (err?.error) {
        return
      }
      showTyping(false)  // Gateway 就绪后关闭加载动画
      if (!_sessionKey) {
        const saved = localStorage.getItem(STORAGE_SESSION_KEY)
        _sessionKey = saved || sessionKey
        updateSessionTitle()
      }
      renderModeControl()
      renderCollabControl()
      await reconcileCollabWithContext(_sessionKey)
      // 先与 Web 端一致从 LangGraph threads/search 拉回映射，再加载历史，避免刷新后本地映射空导致列表/消息全丢
      await refreshSessionList()
      loadHistory()
      
      // 发送初始化消息，与 web 版一致
      if (window._needsBootstrapMessage && window._bootstrapAgentName) {
        const agentName = window._bootstrapAgentName
        window._needsBootstrapMessage = false
        window._bootstrapAgentName = null
        
        try {
          // 发送初始化消息
          await api.chatSend(_sessionKey, `新智能体的名称是 ${agentName}，现在开始为它生成 **SOUL**。`, {
            mode: 'flash',
            is_bootstrap: true,
            thinking_enabled: false
          })
        } catch (e) {
          console.warn('[Chat] 发送初始化消息失败:', e)
        }
      }
    })

    _unsubEvent = wsClient.onEvent((msg) => {
      if (!_pageActive) return
      handleEvent(msg)
    })

    // 如果已连接且 Gateway 就绪，直接复用
    if (wsClient.connected && wsClient.gatewayReady) {
      const saved = localStorage.getItem(STORAGE_SESSION_KEY)
      _sessionKey = saved || wsClient.sessionKey
      updateStatusDot('ready')
      showTyping(false)  // 确保关闭加载动画
      updateSessionTitle()
      renderModeControl()
      renderCollabControl()
      await reconcileCollabWithContext(_sessionKey)
      await refreshSessionList()
      loadHistory()
      
      // 发送初始化消息，与 web 版一致
      if (window._needsBootstrapMessage && window._bootstrapAgentName) {
        const agentName = window._bootstrapAgentName
        window._needsBootstrapMessage = false
        window._bootstrapAgentName = null
        
        try {
          // 发送初始化消息
          await api.chatSend(_sessionKey, `新智能体的名称是 ${agentName}，现在开始为它生成 **SOUL**。`, {
            mode: 'flash',
            is_bootstrap: true,
            thinking_enabled: false
          })
        } catch (e) {
          console.warn('[Chat] 发送初始化消息失败:', e)
        }
      }
      return
    }

    // 如果正在连接中（重连等），等待 onReady 回调即可
    if (wsClient.connected || wsClient.connecting || wsClient.gatewayReady) return

    // 未连接，直接按当前站点地址发起连接（deerflow 模式）
    wsClient.connect(location.host, '')
  } catch (e) {
    console.warn('[chat] connectGateway failed:', e)
  }
}

// ── 会话管理 ──

async function refreshSessionList() {
  if (!_sessionListEl) return
  try {
    const result = await api.chatSessionsList(50)
    const sessions = result?.sessions || result || []
    renderSessionList(sessions)
  } catch (e) {
    console.error('[chat] refreshSessionList error:', e)
  }
}

function renderSessionList(sessions) {
  if (!_sessionListEl) return
  if (!sessions.length) {
    _sessionListEl.innerHTML = '<div class="chat-session-empty">暂无会话</div>'
    return
  }
  const prevScroll = _sessionListEl.scrollTop
  const prevSig = sessions.map(s => String(s.sessionKey || s.key || '')).sort().join('|')
  const sorted = [...sessions].sort((a, b) => {
    const da = (b.updatedAt || b.lastActivity || 0) - (a.updatedAt || a.lastActivity || 0)
    if (da !== 0) return da
    const ka = String(a.sessionKey || a.key || '')
    const kb = String(b.sessionKey || b.key || '')
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
  _sessionListEl.innerHTML = sorted.map(s => {
    const key = s.sessionKey || s.key || ''
    const active = key === _sessionKey ? ' active' : ''
    const label = parseSessionLabel(key)
    const ts = s.updatedAt || s.lastActivity || s.createdAt || 0
    const timeStr = ts ? formatSessionTime(ts) : ''
    const msgCount = s.messageCount || s.messages || 0
    const agentId = parseSessionAgent(key)
    const displayLabel = getDisplayLabel(key) || label
    const mode = getSessionMode(key)
    const modeInfo = SESSION_MODES.find(m => m.value === mode)
    return `<div class="chat-session-card${active}" data-key="${escapeAttr(key)}">
      <div class="chat-session-card-header">
        <span class="chat-session-label" title="双击重命名">${escapeAttr(displayLabel)}</span>
        <button class="chat-session-del" data-del="${escapeAttr(key)}" title="删除">×</button>
      </div>
      <div class="chat-session-card-meta">
        ${modeInfo && modeInfo.value !== 'normal' ? `<span class="chat-session-agent">${escapeAttr(modeInfo.label)}</span>` : ''}
        ${agentId && agentId !== 'main' ? `<span class="chat-session-agent">${escapeAttr(agentId)}</span>` : ''}
        ${msgCount > 0 ? `<span>${msgCount} 条消息</span>` : ''}
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

  const nextSig = sorted.map(s => String(s.sessionKey || s.key || '')).sort().join('|')
  requestAnimationFrame(() => {
    if (nextSig === prevSig) {
      const max = Math.max(0, _sessionListEl.scrollHeight - _sessionListEl.clientHeight)
      _sessionListEl.scrollTop = Math.min(prevScroll, max)
    }
    const activeEl = _sessionListEl.querySelector('.chat-session-card.active')
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

function formatSessionTime(ts) {
  const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 60000) return '刚刚'
  if (diffMs < 3600000) return Math.floor(diffMs / 60000) + ' 分钟前'
  if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + ' 小时前'
  if (diffMs < 604800000) return Math.floor(diffMs / 86400000) + ' 天前'
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`
}

function parseSessionAgent(key) {
  const parts = (key || '').split(':')
  return parts.length >= 2 ? parts[1] : ''
}

function parseSessionLabel(key) {
  const k = key || ''
  if (k.startsWith('thread:')) {
    const id = k.slice(7)
    if (!id) return '会话'
    return id.length <= 14 ? `会话 · ${id}` : `会话 · ${id.slice(0, 12)}…`
  }
  const parts = k.split(':')
  if (parts.length < 3) return key || '未知'
  const agent = parts[1] || 'main'
  const channel = parts.slice(2).join(':')
  if (agent === 'main' && channel === 'main') return '主会话'
  if (agent === 'main') return channel
  return `${agent} / ${channel}`
}

async function switchSession(newKey) {
  if (newKey === _sessionKey) return
  stopActiveRunWatch()
  _sessionKey = newKey
  localStorage.setItem(STORAGE_SESSION_KEY, newKey)
  _lastHistoryHash = ''
  resetStreamState()
  updateSessionTitle()
  renderModeControl()
  renderCollabControl()
  await reconcileCollabWithContext(_sessionKey)
  renderTokenStats()
  clearMessages()
  hideFollowups()
  _suggestionRecent = []
  clearThreadSidebar()
  try {
    await refreshSessionList()
    await loadHistory()
    syncActiveRunWatch(_sessionKey)
  } catch (e) {
    console.warn('[chat] switchSession:', e)
  }
}

function pickUsageObject(source) {
  if (!source || typeof source !== 'object') return null
  const candidates = [
    source.usage,
    source.usage_metadata,
    source.token_usage,
    source.response_metadata?.usage,
    source.response_metadata?.usage_metadata,
    source.response_metadata?.token_usage,
    source.additional_kwargs?.usage,
    source.additional_kwargs?.usage_metadata,
    source.additional_kwargs?.token_usage,
    source.message?.usage,
    source.message?.usage_metadata,
    source.message?.token_usage,
    source.message?.response_metadata?.usage,
    source.message?.response_metadata?.usage_metadata,
    source.message?.response_metadata?.token_usage,
  ]
  return candidates.find(x => x && typeof x === 'object') || null
}

function parseUsageToStats(raw) {
  const usage = pickUsageObject(raw) || raw
  if (!usage || typeof usage !== 'object') return null
  const input = Number(
    usage.input_tokens ??
    usage.prompt_tokens ??
    usage.promptTokens ??
    usage.inputTokenCount ??
    0,
  ) || 0
  const output = Number(
    usage.output_tokens ??
    usage.completion_tokens ??
    usage.completionTokens ??
    usage.outputTokenCount ??
    0,
  ) || 0
  const total = Number(
    usage.total_tokens ??
    usage.totalTokenCount ??
    usage.totalTokens ??
    (input + output),
  ) || 0
  if (!total) return null
  return { input, output, total }
}

async function createNewSessionQuick() {
  const defaultAgent = wsClient.snapshot?.sessionDefaults?.defaultAgentId || 'main'
  const keyTail = `new-${Date.now().toString(36)}`
  const newKey = `agent:${defaultAgent}:${keyTail}`
  const currentMode = getSessionMode(_sessionKey)
  setSessionMode(newKey, currentMode || 'pro')
  setSessionName(newKey, '')
  await switchSession(newKey)
  await applySessionModePreset(newKey, currentMode || 'pro')
  appendSystemMessage('已创建新对话，开始输入吧')
}

async function applySessionModePreset(sessionKey, mode) {
  const preset = SESSION_MODES.find(m => m.value === mode)
  if (!preset) return
  if (!sessionKey) return
  try {
    let contextUpdate = null
    if (mode === 'ultra') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: 'high',
        is_plan_mode: true,
        subagent_enabled: true,
      }
    } else if (mode === 'pro') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: 'medium',
        is_plan_mode: true,
        subagent_enabled: false,
      }
    } else if (mode === 'thinking') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: 'low',
        is_plan_mode: false,
        subagent_enabled: false,
      }
    } else if (mode === 'flash') {
      contextUpdate = {
        thinking_enabled: false,
        reasoning_effort: 'minimal',
        is_plan_mode: false,
        subagent_enabled: false,
      }
    }
    if (contextUpdate) {
      await api.chatUpdateContext(sessionKey, contextUpdate)
      if (sessionKey === _sessionKey) {
        appendSystemMessage(`已应用会话类型：${preset.label}`)
      }
    }
    await reconcileCollabWithContext(sessionKey)
  } catch (e) {
    console.warn('[chat] applySessionModePreset failed:', e)
  }
}

async function deleteSession(key) {
  const mainKey = wsClient.snapshot?.sessionDefaults?.mainSessionKey || 'agent:main:main'
  if (key === mainKey) { toast('主会话不能删除', 'warning'); return }
  const label = parseSessionLabel(key)
  const yes = await showConfirm(`确定删除会话「${label}」？`)
  if (!yes) return
  try {
    await api.chatSessionsDelete(key)
    toast('会话已删除', 'success')
    if (key === _sessionKey) switchSession(mainKey)
    else refreshSessionList()
  } catch (e) {
    toast('删除失败: ' + e.message, 'error')
  }
}

async function resetCurrentSession() {
  if (!_sessionKey) return
  const label = getDisplayLabel(_sessionKey)
  const yes = await showConfirm(`确定要重置会话「${label}」吗？\n\n重置后将清空该会话的所有聊天记录，此操作不可撤销。`)
  if (!yes) return
  try {
    await api.chatSessionsReset(_sessionKey)
    clearMessages()
    clearThreadSidebar()
    _lastHistoryHash = ''
    appendSystemMessage('会话已重置')
    toast('会话已重置', 'success')
  } catch (e) {
    toast('重置失败: ' + e.message, 'error')
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
      toast('会话已重命名', 'success')
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
    html += `<div class="cmd-group-title">${group.title}</div>`
    for (const c of group.commands) {
      html += `<div class="cmd-item" data-cmd="${c.cmd}" data-action="${c.action}">
        <span class="cmd-name">${c.cmd}</span>
        <span class="cmd-desc">${c.desc}</span>
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

function hideFollowups() {
  if (_followupsAbort) {
    try { _followupsAbort.abort() } catch {}
    _followupsAbort = null
  }
  if (_followupsEl) {
    _followupsEl.hidden = true
    _followupsEl.innerHTML = ''
    _followupsEl.onclick = null
  }
}

function pushSuggestionRecent(role, content) {
  const text = (content || '').trim()
  if (!text) return
  _suggestionRecent.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text })
  if (_suggestionRecent.length > 12) _suggestionRecent = _suggestionRecent.slice(-12)
}

async function fetchFollowups(runId) {
  if (!_followupsEl || !_sessionKey) return
  if (_lastSuggestionRunId === runId) return
  _lastSuggestionRunId = runId
  hideFollowups()
  const controller = new AbortController()
  _followupsAbort = controller
  // 后台静默生成：请求进行中不展示任何占位
  _followupsEl.hidden = true
  _followupsEl.innerHTML = ''
  try {
    const ctx = wsClient.getSessionContext(_sessionKey)
    // 与 Web 对齐：仅传 thread context 的 model_name，避免面板选择值与后端模型名格式不一致导致 suggestions 为空
    const modelName = ctx?.model_name || undefined
    const recent = _suggestionRecent.slice(-6)
    const res = await Promise.race([
      api.chatSuggestions(_sessionKey, 3, modelName, recent),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 120000)),
    ])
    if (controller.signal.aborted) return
    const raw = Array.isArray(res?.suggestions) ? res.suggestions : []
    const suggestions = raw
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      // 过滤“标签/分类词”类建议（如：小惊喜/写作/研究…），只保留更像问题的条目
      .filter(s => s.length >= 6 || /[?？]/.test(s))
      .slice(0, 6)

    if (!suggestions.length) {
      // 为空时保持隐藏，不打扰输入区
      _followupsEl.hidden = true
      _followupsEl.innerHTML = ''
      _followupsEl.onclick = null
      return
    }
    _followupsEl.innerHTML = suggestions.map((s, i) =>
      `<button class="chat-followup-chip" data-sidx="${i}" title="${escapeAttr(s)}">${escapeHtml(s)}</button>`
    ).join('')
    _followupsEl.hidden = false
    _followupsEl.onclick = (e) => {
      const btn = e.target.closest('[data-sidx]')
      if (!btn) return
      const idx = parseInt(btn.dataset.sidx, 10)
      const text = suggestions[idx] || ''
      if (!text) return
      _textarea.value = text
      _textarea.style.height = 'auto'
      _textarea.style.height = Math.min(_textarea.scrollHeight, 150) + 'px'
      updateSendState()
      sendMessage()
    }
  } catch {
    _followupsEl.hidden = false
    _followupsEl.innerHTML = '<span class="chat-followup-loading">后续问题生成失败</span><button class="chat-followup-retry" data-retry="1">重试</button>'
    _followupsEl.onclick = (e) => {
      const btn = e.target.closest('[data-retry]')
      if (!btn) return
      fetchFollowups(runId)
    }
  } finally {
    if (_followupsAbort === controller) _followupsAbort = null
  }
}

function toggleCmdPanel() {
  if (_cmdPanelEl?.style.display === 'block') hideCmdPanel()
  else { _textarea.value = '/'; showCmdPanel(); _textarea.focus() }
}

// ── 消息发送 ──

function sendMessage() {
  const text = _textarea.value.trim()
  if (!text && !_attachments.length) return
  if (!_sessionKey) _sessionKey = localStorage.getItem(STORAGE_SESSION_KEY) || 'agent:main:main'
  if (!wsClient.connected || !wsClient.gatewayReady) {
    connectGateway()
    toast('正在连接对话服务，请稍后重试', 'warning')
    return
  }
  hideCmdPanel()
  hideFollowups()
  _textarea.value = ''
  _textarea.style.height = 'auto'
  updateSendState()

  if (handleCommand(text)) {
    return
  }

  const attachments = [..._attachments]
  _attachments = []
  renderAttachments()
  if (_isSending || _isStreaming) { _messageQueue.push({ text, attachments }); return }
  doSend(text, attachments)
}

function handleCommand(text) {
  const trimmed = text.trim().toLowerCase()
  let contextUpdate = null
  let message = ''

  if (trimmed.startsWith('/think ')) {
    const level = trimmed.split(' ')[1]
    if (level === 'off') {
      contextUpdate = { thinking_enabled: false }
      message = '已关闭深度思考'
      setSessionThinkLevel(_sessionKey, 'off')
    } else if (level === 'low') {
      contextUpdate = { thinking_enabled: true }
      message = '已设置为轻度思考'
      setSessionThinkLevel(_sessionKey, 'low')
    } else if (level === 'medium') {
      contextUpdate = { thinking_enabled: true }
      message = '已设置为中度思考'
      setSessionThinkLevel(_sessionKey, 'medium')
    } else if (level === 'high') {
      contextUpdate = { thinking_enabled: true }
      message = '已设置为深度思考'
      setSessionThinkLevel(_sessionKey, 'high')
    }
  } else if (trimmed.startsWith('/reasoning ')) {
    const level = trimmed.split(' ')[1]
    if (level === 'off') {
      contextUpdate = { reasoning_effort: undefined }
      message = '已关闭推理模式'
    } else if (level === 'low') {
      contextUpdate = { reasoning_effort: 'low' }
      message = '已设置为轻度推理'
    } else if (level === 'medium') {
      contextUpdate = { reasoning_effort: 'medium' }
      message = '已设置为中度推理'
    } else if (level === 'high') {
      contextUpdate = { reasoning_effort: 'high' }
      message = '已设置为深度推理'
    }
  } else if (trimmed === '/fast' || trimmed === '/fast on' || trimmed === '/fast off') {
    if (trimmed === '/fast') {
      const current = wsClient.getSessionContext(_sessionKey)
      const fastEnabled = !(current.thinking_enabled && current.reasoning_effort !== 'minimal')
      contextUpdate = {
        thinking_enabled: !fastEnabled,
        reasoning_effort: fastEnabled ? undefined : 'minimal',
      }
      message = fastEnabled ? '已开启快速模式' : '已关闭快速模式'
    } else if (trimmed === '/fast on') {
      contextUpdate = {
        thinking_enabled: false,
        reasoning_effort: 'minimal',
      }
      message = '已开启快速模式'
    } else if (trimmed === '/fast off') {
      contextUpdate = {
        thinking_enabled: true,
        reasoning_effort: undefined,
      }
      message = '已关闭快速模式'
    }
  }

  if (trimmed === '/context') {
    const current = wsClient.getSessionContext(_sessionKey)
    let info = '当前会话上下文配置:\n'
    info += `- thinking_enabled: ${current.thinking_enabled}\n`
    info += `- is_plan_mode: ${current.is_plan_mode}\n`
    info += `- subagent_enabled: ${current.subagent_enabled}\n`
    info += `- reasoning_effort: ${current.reasoning_effort || 'default'}\n`
    info += `- 任务协作开关(本地): ${getSessionCollabMode(_sessionKey) ? '开' : '关'}\n`
    info += `- collab_task_id(发往模型): ${current.collab_task_id || '(未设置)'}`
    appendSystemMessage(info)
    const tid = wsClient.getSessionThreadId(_sessionKey)
    if (tid) {
      void wsClient.getThreadCollabState(tid).then((s) => {
        if (!s || typeof s !== 'object') return
        const line =
          `\n服务端协作状态 (GET /api/collab):\n` +
          `- collab_phase: ${s.collab_phase ?? '(unknown)'}\n` +
          `- bound_task_id: ${s.bound_task_id || '(无)'}\n` +
          `- bound_project_id: ${s.bound_project_id || '(无)'}`
        appendSystemMessage(line)
      }).catch(() => {})
    }
    toast('已显示上下文配置', 'success')
    return true
  }

  if (trimmed === '/collab' || trimmed === '/复杂任务' || trimmed === '/任务协作') {
    if (!_sessionKey) return false
    renderCollabControl()
    void (async () => {
      await openCollabModal()
      appendSystemMessage(
        '已进入任务协作：你可以在下方输入框继续说明目标。'
      )
      toast('已开启任务协作（/collab）', 'success')
    })()
    return true
  }

  if (trimmed === '/collab off') {
    if (!_sessionKey) return false
    setSessionCollabMode(_sessionKey, false)
    const mode = getSessionMode(_sessionKey)
    applySessionModePreset(_sessionKey, mode)
    api.chatUpdateContext(_sessionKey, { collab_task_id: null })
    closeCollabModal()
    renderCollabControl()
    void (async () => {
      try {
        await applyCollabServerPatch(_sessionKey, false)
        appendSystemMessage('已退出任务协作。')
        toast('已关闭任务协作（/collab off）', 'success')
      } catch (e) {
        console.warn('[collab] /collab off server sync failed', e)
        appendSystemMessage('已本地关闭任务协作；服务端置 idle 失败，可稍后重试。')
        toast('服务端同步失败', 'warning')
      }
    })()
    return true
  }

  if (contextUpdate) {
    api.chatUpdateContext(_sessionKey, contextUpdate)
    renderThinkingControl()
    appendSystemMessage(message)
    toast(message, 'success')
    return true
  }

  return false
}

async function doSend(text, attachments = []) {
  if (!_sessionKey) _sessionKey = localStorage.getItem(STORAGE_SESSION_KEY) || 'agent:main:main'
  const names = getSessionNames()
  if (!names[_sessionKey]) {
    const autoTitle = titleFromFirstUserInput(text)
    if (autoTitle) {
      setSessionName(_sessionKey, autoTitle)
      updateSessionTitle()
      refreshSessionList()
    }
  }
  pushSuggestionRecent('user', text)
  appendUserMessage(text, attachments)
  syncQuickPromptsVisibility()
  saveMessage({
    id: uuid(), sessionKey: _sessionKey, role: 'user', content: text, timestamp: Date.now(),
    attachments: attachments?.length ? attachments.map(a => ({ category: a.category || 'image', mimeType: a.mimeType || '', content: a.content || '', url: a.url || '' })) : undefined
  })
  showTyping(true)
  _isSending = true
  try {
    await api.chatSend(_sessionKey, text, attachments.length ? attachments : undefined)
  } catch (err) {
    showTyping(false)
    appendSystemMessage('发送失败: ' + err.message)
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
  if (_currentRunId) api.chatAbort(_sessionKey, _currentRunId).catch(() => {})
  api.chatCancelActiveRuns(_sessionKey).catch(() => {})
}

// ── 底部输入框上方的线程状态（对齐 Web：TodoList 叠在 InputBox 上） ──

function syncThreadPanelVisibility() {
  if (!_page) return
  const panel = _page.querySelector('#chat-thread-panel')
  if (!panel) return
  const titleEl = _page.querySelector('#chat-sidebar-title')
  const hasTitle = !!(titleEl && !titleEl.hidden && (titleEl.textContent || '').trim())
  const reasoningWrap = _page.querySelector('#chat-sidebar-reasoning-wrap')
  const clarifyWrap = _page.querySelector('#chat-sidebar-clarify-wrap')
  const todosWrap = _page.querySelector('#chat-sidebar-todos-wrap')
  const hasExtra =
    !!(reasoningWrap && !reasoningWrap.hidden) ||
    !!(clarifyWrap && !clarifyWrap.hidden) ||
    !!(todosWrap && !todosWrap.hidden)
  const activityEl = _page.querySelector('#chat-sidebar-activity')
  const raw = (activityEl?.textContent || '').trim()
  const hasBusyActivity = raw.length > 0 && raw !== '—'
  panel.hidden = !hasTitle && !hasExtra && !hasBusyActivity
}

function clearThreadSidebar() {
  if (!_page) return
  const titleEl = _page.querySelector('#chat-sidebar-title')
  const activityEl = _page.querySelector('#chat-sidebar-activity')
  const reasoningWrap = _page.querySelector('#chat-sidebar-reasoning-wrap')
  const reasoningEl = _page.querySelector('#chat-sidebar-reasoning')
  const clarifyWrap = _page.querySelector('#chat-sidebar-clarify-wrap')
  const clarifyEl = _page.querySelector('#chat-sidebar-clarify')
  const todosWrap = _page.querySelector('#chat-sidebar-todos-wrap')
  const todosEl = _page.querySelector('#chat-sidebar-todos')
  if (titleEl) { titleEl.textContent = ''; titleEl.hidden = true }
  if (activityEl) {
    activityEl.replaceChildren()
    activityEl.textContent = '—'
  }
  if (reasoningWrap) reasoningWrap.hidden = true
  if (reasoningEl) reasoningEl.textContent = ''
  if (clarifyWrap) clarifyWrap.hidden = true
  if (clarifyEl) clarifyEl.textContent = ''
  if (todosWrap) todosWrap.hidden = true
  if (todosEl) todosEl.innerHTML = ''
  const panel = _page.querySelector('#chat-thread-panel')
  if (panel) panel.hidden = true
}

function handleThreadState(payload) {
  if (!_pageActive || !payload || typeof payload !== 'object') return
  if (payload.sessionKey && payload.sessionKey !== _sessionKey && _sessionKey) return

  const titleEl = _page.querySelector('#chat-sidebar-title')
  const activityEl = _page.querySelector('#chat-sidebar-activity')
  const reasoningWrap = _page.querySelector('#chat-sidebar-reasoning-wrap')
  const reasoningEl = _page.querySelector('#chat-sidebar-reasoning')
  const clarifyWrap = _page.querySelector('#chat-sidebar-clarify-wrap')
  const clarifyEl = _page.querySelector('#chat-sidebar-clarify')
  const todosWrap = _page.querySelector('#chat-sidebar-todos-wrap')
  const todosEl = _page.querySelector('#chat-sidebar-todos')

  if (payload.partial) {
    if (payload.clarification?.preview != null && clarifyWrap && clarifyEl) {
      clarifyWrap.hidden = false
      clarifyEl.textContent = payload.clarification.preview
    }
    syncThreadPanelVisibility()
    return
  }

  if (titleEl) {
    if (payload.title) {
      titleEl.textContent = payload.title
      titleEl.hidden = false
      const names = getSessionNames()
      if (_sessionKey && !names[_sessionKey]) {
        setSessionName(_sessionKey, payload.title)
        updateSessionTitle()
        refreshSessionList()
      }
    } else {
      titleEl.textContent = ''
      titleEl.hidden = true
    }
  }

  if (activityEl) {
    delete activityEl.dataset.collabHint
    const kind = payload.activityKind || 'idle'
    const icons = { idle: '—', thinking: '💭', tools: '🔧', clarification: '❓' }
    activityEl.replaceChildren()
    const span = document.createElement('span')
    span.className = 'chat-sidebar-act-icon'
    span.textContent = icons[kind] || '—'
    activityEl.appendChild(span)
    activityEl.appendChild(document.createTextNode(` ${payload.activityDetail || ''}`))
  }

  if (reasoningWrap && reasoningEl) {
    if (payload.reasoningPreview) {
      reasoningEl.textContent = payload.reasoningPreview
      reasoningWrap.hidden = false
    } else {
      reasoningEl.textContent = ''
      reasoningWrap.hidden = true
    }
  }

  if (clarifyWrap && clarifyEl) {
    if (payload.clarification?.preview) {
      clarifyEl.textContent = payload.clarification.preview
      clarifyWrap.hidden = false
    } else {
      clarifyEl.textContent = ''
      clarifyWrap.hidden = true
    }
  }

  if (todosWrap && todosEl) {
    const todos = Array.isArray(payload.todos) ? payload.todos : []
    if (todos.length) {
      todosEl.innerHTML = todos.map(todo => {
        const c = escapeHtml((todo && todo.content) ? String(todo.content) : '')
        const st = (todo && todo.status) ? todo.status : 'pending'
        const mark = st === 'completed' ? '✓' : st === 'in_progress' ? '▶' : '○'
        return `<li class="chat-sidebar-todo chat-sidebar-todo--${st}"><span class="chat-sidebar-todo-mark">${mark}</span><span>${c}</span></li>`
      }).join('')
      todosWrap.hidden = false
    } else {
      todosEl.innerHTML = ''
      todosWrap.hidden = true
    }
  }

  syncThreadPanelVisibility()
}

// ── 事件处理（参照 clawapp 实现） ──

/** 将 LangGraph / ws-client 的 tool 事件规范为可 upsert 的条目（含 tool_calls 与 tool 结果消息） */
function normalizeChatToolPayloadToEntries(payload) {
  const d = payload?.data || {}
  const nameHint = payload?.name || d.name || d.tool_name || '工具'
  const toolCalls = d.tool_calls || d.toolCalls
  if (Array.isArray(toolCalls) && toolCalls.length) {
    return toolCalls.map((tc) => {
      const id = tc.id || tc.tool_call_id
      const nm = tc.name || tc.tool_name || (tc.function && tc.function.name) || nameHint
      let input = tc.args ?? tc.input ?? tc.parameters
      if (input == null && tc.function && typeof tc.function.arguments === 'string') {
        try {
          input = JSON.parse(tc.function.arguments)
        } catch {
          input = tc.function.arguments
        }
      }
      return {
        id: id || uuid(),
        name: nm || '工具',
        input: input ?? null,
        output: null,
        status: 'running',
      }
    })
  }
  const toolCallId = payload?.toolCallId || d.tool_call_id || d.id
  const isToolNode = d.type === 'tool' || d.role === 'tool'
  let output
  if (isToolNode && d.content != null) {
    output = d.content
    if (typeof output === 'string') {
      const t = output.trim()
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try {
          output = JSON.parse(t)
        } catch {
          /* 保留原文 */
        }
      }
    }
  }
  let input = d.args ?? d.input ?? d.arguments ?? null
  let status = 'running'
  if (output != null && output !== '') {
    status = d.status === 'error' ? 'error' : 'ok'
  } else if (isToolNode && (d.status === 'error' || d.isError === true)) {
    status = 'error'
  }
  return [{
    id: toolCallId || uuid(),
    name: nameHint,
    input,
    output: output !== undefined ? output : undefined,
    status,
  }]
}

function armStreamSafetyTimeout() {
  clearTimeout(_streamSafetyTimer)
  _streamSafetyTimer = setTimeout(() => {
    if (_isStreaming) {
      console.warn('[chat] 流式输出超时（90s 无新数据），强制结束')
      if (_currentAiBubble && _currentAiText) {
        _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
      }
      appendSystemMessage('输出超时，已自动结束')
      resetStreamState()
      processMessageQueue()
    }
  }, 90000)
}

function handleEvent(msg) {
  const { event, payload } = msg
  if (event === 'thread_state') {
    handleThreadState(payload)
    return
  }
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
  }

  if (event === 'chat') handleChatEvent(payload)

  // Compaction 状态指示：上游 2026.3.12 新增 status_reaction 事件
  if (event === 'chat.status_reaction' || event === 'status_reaction') {
    const reaction = payload.reaction || payload.emoji || ''
    if (reaction.includes('compact') || reaction === '🗜️' || reaction === '📦') {
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

  // 重复 run 过滤：跳过已完成的 runId 的后续事件（Gateway 可能对同一消息触发多个 run）
  if (runId && state === 'final' && _seenRunIds.has(runId)) {
    console.log('[chat] 跳过重复 final, runId:', runId)
    return
  }
  if (runId && state === 'delta' && _seenRunIds.has(runId) && !_isStreaming) {
    console.log('[chat] 跳过已完成 run 的 delta, runId:', runId)
    return
  }

  // LangGraph SSE：messages-tuple 中的 tool / tool_calls（此前未处理，导致流式阶段看不到工具）
  if (state === 'tool') {
    const entries = normalizeChatToolPayloadToEntries(payload)
    if (!entries.length) return
    showTyping(false)
    if (!_currentAiBubble) {
      _currentAiBubble = createStreamBubble()
      _currentRunId = payload.runId
      _isStreaming = true
      _streamStartTime = Date.now()
      updateSendState()
    }
    for (const e of entries) {
      upsertTool(_currentAiTools, { ...e })
      const tid = e.id
      if (tid) {
        const cur = _toolEventData.get(tid) || {}
        if (e.input != null) cur.input = e.input
        if (e.output != null) cur.output = e.output
        if (e.status) cur.status = e.status
        cur.time = cur.time || Date.now()
        _toolEventData.set(tid, cur)
        if (runId) {
          const list = _toolRunIndex.get(runId) || []
          if (!list.includes(tid)) list.push(tid)
          _toolRunIndex.set(runId, list)
        }
      }
    }
    armStreamSafetyTimeout()
    throttledRender()
    return
  }

  if (state === 'delta') {
    const c = extractChatContent(payload.message)
    if (c?.images?.length) _currentAiImages = c.images
    if (c?.videos?.length) _currentAiVideos = c.videos
    if (c?.audios?.length) _currentAiAudios = c.audios
    if (c?.files?.length) _currentAiFiles = c.files
    if (c?.tools?.length) {
      for (const t of c.tools) upsertTool(_currentAiTools, t)
    }
    if ((c?.text && c.text.length >= _currentAiText.length) || c?.tools?.length) {
      showTyping(false)
      if (!_currentAiBubble) {
        _currentAiBubble = createStreamBubble()
        _currentRunId = payload.runId
        _isStreaming = true
        _streamStartTime = Date.now()
        updateSendState()
      }
      if (c?.text && c.text.length >= _currentAiText.length) _currentAiText = c.text
      armStreamSafetyTimeout()
      throttledRender()
    }
    return
  }

  if (state === 'final') {
    const c = extractChatContent(payload.message)
    const finalText = c?.text || ''
    const finalImages = c?.images || []
    const finalVideos = c?.videos || []
    const finalAudios = c?.audios || []
    const finalFiles = c?.files || []
    let finalTools = c?.tools || []
    if (!finalTools.length && runId) {
      const ids = _toolRunIndex.get(runId) || []
      finalTools = ids.map(id => mergeToolEventData({ id, name: '工具' })).filter(Boolean)
    }
    if (finalImages.length) _currentAiImages = finalImages
    if (finalVideos.length) _currentAiVideos = finalVideos
    if (finalAudios.length) _currentAiAudios = finalAudios
    if (finalFiles.length) _currentAiFiles = finalFiles
    if (finalTools.length) _currentAiTools = finalTools
    const hasContent = finalText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length || _currentAiTools.length
    // 忽略空 final（Gateway 会偶发空结束帧）；必须结束加载态，否则转圈不停
    if (!_currentAiBubble && !hasContent) {
      showTyping(false)
      resetStreamState()
      if (!_isSending) processMessageQueue()
      return
    }
    // 标记 runId 为已处理，防止重复
    if (runId) {
      _seenRunIds.add(runId)
      if (_seenRunIds.size > 200) {
        const first = _seenRunIds.values().next().value
        _seenRunIds.delete(first)
      }
    }
    showTyping(false)
    // 如果流式阶段没有创建 bubble，从 final message 中提取
    if (!_currentAiBubble && hasContent) {
      _currentAiBubble = createStreamBubble()
      _currentAiText = finalText
    }
    if (_currentAiBubble) {
      if (_currentAiText) _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
      appendToolsToEl(_currentAiBubble, finalTools.length ? finalTools : _currentAiTools)
      appendImagesToEl(_currentAiBubble, _currentAiImages)
      appendVideosToEl(_currentAiBubble, _currentAiVideos)
      appendAudiosToEl(_currentAiBubble, _currentAiAudios)
      appendFilesToEl(_currentAiBubble, _currentAiFiles)
    }
    // 添加时间戳 + 耗时 + token 消耗
    const wrapper = _currentAiBubble?.parentElement
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
      if (durStr) parts.push(`<span class="meta-sep">·</span><span class="msg-duration">⏱ ${durStr}</span>`)
      // token 消耗（从 payload.usage 或 payload.message.usage 提取）
      const usageStats = parseUsageToStats(payload)
      if (usageStats) {
        const inp = usageStats.input
        const out = usageStats.output
        const total = usageStats.total
        if (total > 0) {
          let tokenStr = `${total} tokens`
          if (inp && out) tokenStr = `↑${inp} ↓${out}`
          parts.push(`<span class="meta-sep">·</span><span class="msg-tokens">${tokenStr}</span>`)
          const prev = getSessionTokenStats(_sessionKey) || { input: 0, output: 0, total: 0 }
          setSessionTokenStats(_sessionKey, {
            input: prev.input + inp,
            output: prev.output + out,
            total: prev.total + total,
          })
          renderTokenStats()
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
    pushSuggestionRecent('assistant', finalText || _currentAiText || '')
    // 托管 Agent：捕获 AI 回复，检测停止信号，决定是否继续
    if (shouldCaptureHostedTarget(payload)) {
      const capturedText = finalText || _currentAiText || ''
      if (capturedText) {
        appendHostedTarget(capturedText)
        if (detectStopFromText(capturedText)) {
          appendHostedOutput('DeerFlow 回复包含完成信号，自动停止')
          stopHostedAgent()
        } else {
          maybeTriggerHostedRun()
        }
      }
    }
    resetStreamState()
    fetchFollowups(runId)
    if (!_isSending) {
      processMessageQueue()
    }
    return
  }

  if (state === 'aborted') {
    showTyping(false)
    if (_currentAiBubble && _currentAiText) {
      _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    }
    appendSystemMessage('生成已停止')
    resetStreamState()
    processMessageQueue()
    return
  }

  if (state === 'error') {
    const errMsg = payload.errorMessage || payload.error?.message || '未知错误'

    // 连接级错误（origin/pairing/auth）拦截，不作为聊天消息显示
    if (/origin not allowed|NOT_PAIRED|PAIRING_REQUIRED|auth.*fail/i.test(errMsg)) {
      console.warn('[chat] 拦截连接级错误，不显示为聊天消息:', errMsg)
      return
    }

    // 防抖：如果是相同错误且在 2 秒内，忽略（避免重复显示）
    const now = Date.now()
    if (_lastErrorMsg === errMsg && _errorTimer && (now - _errorTimer < 2000)) {
      console.warn('[chat] 忽略重复错误:', errMsg)
      return
    }
    _lastErrorMsg = errMsg
    _errorTimer = now

    // 如果正在流式输出，说明消息已经部分成功，不显示错误
    if (_isStreaming || _currentAiBubble) {
      console.warn('[chat] 流式中收到错误，但消息已部分成功，忽略错误提示:', errMsg)
      return
    }

    showTyping(false)
    appendSystemMessage('错误: ' + errMsg)
    resetStreamState()
    processMessageQueue()
    return
  }
}

/** 从 Gateway message 对象提取文本和所有媒体（参照 clawapp extractContent） */
function extractChatContent(message) {
  if (!message || typeof message !== 'object') return null
  const tools = []
  collectToolsFromMessage(message, tools)
  if (message.role === 'tool' || message.role === 'toolResult') {
    const output = typeof message.content === 'string' ? message.content : null
    if (!tools.length) {
      tools.push({
        name: message.name || message.tool || message.tool_name || '工具',
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
        files.push({ url: block.url || '', name: block.fileName || block.name || '文件', mimeType: block.mimeType || '', size: block.size, data: block.data })
      }
      else if (block.type === 'tool' || block.type === 'tool_use' || block.type === 'tool_call' || block.type === 'toolCall') {
        const callId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: callId,
          name: block.name || block.tool || block.tool_name || block.toolName || '工具',
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
          name: block.name || block.tool || block.tool_name || block.toolName || '工具',
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
    // 从 mediaUrl/mediaUrls 提取
    const mediaUrls = message.mediaUrls || (message.mediaUrl ? [message.mediaUrl] : [])
    for (const url of mediaUrls) {
      if (!url) continue
      if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) videos.push({ url, mediaType: 'video/mp4' })
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url)) audios.push({ url, mediaType: 'audio/mpeg' })
      else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url)) images.push({ url, mediaType: 'image/png' })
      else files.push({ url, name: url.split('/').pop().split('?')[0] || '文件', mimeType: '' })
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

function stripAgentMetaLines(text) {
  if (!text) return ''
  const lines = text.split('\n')
  const out = []
  for (const line of lines) {
    const s = line.trim()
    if (s && /^(身份|核心任务|工作模式|协作阶段|技能|近期操作)[:：]/.test(s)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
function stripThinkingTags(text) {
  const safe = stripAnsi(text)
  const stripped = safe
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .replace(/\[Queued messages while agent was busy\]\s*---\s*Queued #\d+\s*/gi, '')
    .replace(/<\s*collab_phase_context\s*>[\s\S]*?<\s*\/\s*collab_phase_context\s*>/gi, '')
    .trim()
  return stripAgentMetaLines(stripped)
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
  if (!_currentAiBubble) return
  _currentAiBubble.innerHTML = _currentAiText ? renderMarkdown(_currentAiText) : ''
  appendToolsToEl(_currentAiBubble, _currentAiTools)
  if (_isStreaming) {
    const cur = document.createElement('span')
    cur.className = 'stream-cursor'
    _currentAiBubble.appendChild(cur)
  }
  scrollToBottom()
}

// ensureAiBubble 已被 createStreamBubble 替代

function resetStreamState() {
  clearTimeout(_streamSafetyTimer)
  if (_currentAiBubble && (_currentAiText || _currentAiImages.length || _currentAiVideos.length || _currentAiAudios.length || _currentAiFiles.length || _currentAiTools.length)) {
    _currentAiBubble.innerHTML = renderMarkdown(_currentAiText)
    appendToolsToEl(_currentAiBubble, _currentAiTools)
    appendImagesToEl(_currentAiBubble, _currentAiImages)
    appendVideosToEl(_currentAiBubble, _currentAiVideos)
    appendAudiosToEl(_currentAiBubble, _currentAiAudios)
    appendFilesToEl(_currentAiBubble, _currentAiFiles)
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

/** LangGraph checkpoint 常为 type: human/ai，无 role；未归一则渲染阶段会跳过，出现「闪一下再空白」 */
function normalizeHistoryRole(msg) {
  if (!msg || typeof msg !== 'object') return 'assistant'
  if (msg.role === 'tool' || msg.role === 'toolResult') return 'assistant'
  if (msg.role === 'user' || msg.role === 'assistant') return msg.role
  const t = msg.type
  if (t === 'human' || t === 'user') return 'user'
  if (t === 'ai' || t === 'AIMessage' || t === 'AIMessageChunk' || t === 'assistant') return 'assistant'
  if (t === 'tool' || t === 'tool_message') return 'assistant'
  if (t === 'system') return 'assistant'
  return 'assistant'
}

async function loadHistory() {
  const key = _sessionKey
  if (!key || !_messagesEl) return
  _isLoadingHistory = true
  const hasExisting = _messagesEl.querySelector('.msg')
  try {
    if (!hasExisting && isStorageAvailable()) {
      const local = await getLocalMessages(key, 200)
      if (key !== _sessionKey) return
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
    // chatHistory 直连 LangGraph /state，不依赖 Gateway WebSocket；避免 Gateway 尚未 ready 时无法刷新 checkpoint
    const result = await api.chatHistory(key, 200)
    if (key !== _sessionKey) return
    if (!result?.messages?.length) {
      if (result.valuesSnapshot) {
        const p = threadStatePayloadFromValues(key, result.valuesSnapshot)
        if (p) handleThreadState(p)
      }
      if (_messagesEl && !_messagesEl.querySelector('.msg')) appendSystemMessage('还没有消息，开始聊天吧')
      return
    }
    const deduped = dedupeHistory(result.messages)
    const usageTotals = (result.messages || []).reduce((acc, m) => {
      const u = parseUsageToStats(m)
      if (!u) return acc
      acc.input += u.input
      acc.output += u.output
      acc.total += u.total
      return acc
    }, { input: 0, output: 0, total: 0 })
    setSessionTokenStats(key, usageTotals.total ? usageTotals : null)
    renderTokenStats()
    _suggestionRecent = deduped
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && (m.text || '').trim())
      .map(m => ({ role: m.role, content: (m.text || '').trim() }))
      .slice(-12)
    const hash = deduped.map(m => `${m.role}:${(m.text || '').length}`).join('|')
    if (hash === _lastHistoryHash && hasExisting) return
    _lastHistoryHash = hash

    // 正在发送/流式输出时不全量重绘，避免覆盖本地乐观渲染
    if (hasExisting && (_isSending || _isStreaming || _messageQueue.length > 0)) {
      saveMessages(result.messages.map(m => {
        const c = extractContent(m)
        const role = normalizeHistoryRole(m)
        return { id: m.id || uuid(), sessionKey: key, role, content: c?.text || '', timestamp: m.timestamp || Date.now() }
      }))
      if (result.valuesSnapshot) {
        const p = threadStatePayloadFromValues(key, result.valuesSnapshot)
        if (p) handleThreadState(p)
      }
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
      appendSystemMessage('部分历史图片无法显示（Gateway 不保留图片原始数据，仅当前会话内可见）')
    }
    saveMessages(result.messages.map(m => {
      const c = extractContent(m)
      const role = normalizeHistoryRole(m)
      return { id: m.id || uuid(), sessionKey: key, role, content: c?.text || '', timestamp: m.timestamp || Date.now() }
    }))
    scrollToBottom()
    if (result.valuesSnapshot) {
      const p = threadStatePayloadFromValues(key, result.valuesSnapshot)
      if (p) handleThreadState(p)
    }
  } catch (e) {
    console.error('[chat] loadHistory error:', e)
    if (_messagesEl && !_messagesEl.querySelector('.msg')) appendSystemMessage('加载历史失败: ' + e.message)
  } finally {
    _isLoadingHistory = false
    if (key === _sessionKey) {
      syncActiveRunWatch(key)
    }
  }
}

function stopActiveRunWatch() {
  if (_activeRunWatchTimer) {
    clearTimeout(_activeRunWatchTimer)
    _activeRunWatchTimer = null
  }
  _activeRunWatchSession = null
  _activeRunWatchLastRunId = null
  _lastRemoteHistoryPoll = 0
}

function syncActiveRunWatch(sessionKey) {
  const key = sessionKey || _sessionKey
  if (!key || !_pageActive) return
  _activeRunWatchSession = key
  if (_activeRunWatchTimer) return

  const tick = async () => {
    if (!_pageActive || _activeRunWatchSession !== _sessionKey) {
      stopActiveRunWatch()
      return
    }
    let busy = false
    try {
      const stat = await api.chatGetRunStatus(_activeRunWatchSession)
      const runId = stat?.runId || null
      const status = (stat?.status || 'idle').toLowerCase()
      busy = status === 'pending' || status === 'running'

      if (busy && !_isStreaming && !_isSending) {
        _currentRunId = runId || _currentRunId
        showTyping(true)
        // 刷新后 SSE 已断：轮询 checkpoint，尽量展示已落盘的中间输出
        const now = Date.now()
        if (now - _lastRemoteHistoryPoll > 5500) {
          _lastRemoteHistoryPoll = now
          loadHistory().catch(() => {})
        }
      } else {
        _lastRemoteHistoryPoll = 0
      }
      if (!busy && _activeRunWatchLastRunId) {
        showTyping(false)
        // Stream got lost due to refresh/tab switch; reload from backend snapshot.
        await loadHistory()
      }
      _activeRunWatchLastRunId = busy ? runId : null
    } catch {
      // Best-effort watcher; ignore transient errors.
    } finally {
      if (_pageActive && _activeRunWatchSession === _sessionKey) {
        _activeRunWatchTimer = setTimeout(tick, busy ? 2000 : 3000)
      } else {
        stopActiveRunWatch()
      }
    }
  }
  _activeRunWatchTimer = setTimeout(tick, 100)
}

function dedupeHistory(messages) {
  const deduped = []
  for (const msg of messages) {
    const role = normalizeHistoryRole(msg)
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
        // 不同文本则合并
        last.text = [last.text, c.text].filter(Boolean).join('\n')
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
        name: msg.name || msg.tool || msg.tool_name || '工具',
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
        files.push({ url: block.url || '', name: block.fileName || block.name || '文件', mimeType: block.mimeType || '', size: block.size, data: block.data })
      }
      else if (block.type === 'tool' || block.type === 'tool_use' || block.type === 'tool_call' || block.type === 'toolCall') {
        const callId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: callId,
          name: block.name || block.tool || block.tool_name || block.toolName || '工具',
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
          name: block.name || block.tool || block.tool_name || block.toolName || '工具',
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
      else files.push({ url, name: url.split('/').pop().split('?')[0] || '文件', mimeType: '' })
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
  const textEl = document.createElement('div')
  textEl.className = 'msg-text'
  textEl.innerHTML = renderMarkdown(text || '')
  bubble.appendChild(textEl)
  appendToolsToEl(bubble, tools)
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

/** 渲染图片到消息气泡（支持 Anthropic/OpenAI/直接格式） */
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

/** 渲染视频到消息气泡 */
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

/** 渲染音频到消息气泡 */
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

/** 渲染文件卡片到消息气泡 */
function appendFilesToEl(el, files) {
  if (!files?.length) return
  files.forEach(f => {
    const card = document.createElement('div')
    card.className = 'msg-file-card'
    const ext = (f.name || '').split('.').pop().toLowerCase()
    const fileIconMap = { pdf: 'file', doc: 'file-text', docx: 'file-text', txt: 'file-plain', md: 'file-plain', json: 'clipboard', csv: 'bar-chart', zip: 'package', rar: 'package' }
    const fileIcon = svgIcon(fileIconMap[ext] || 'paperclip', 16)
    const size = f.size ? formatFileSize(f.size) : ''
    card.innerHTML = `<span class="msg-file-icon">${fileIcon}</span><div class="msg-file-info"><span class="msg-file-name">${f.name || '文件'}</span>${size ? `<span class="msg-file-size">${size}</span>` : ''}</div>`
    if (f.url) {
      card.style.cursor = 'pointer'
      card.onclick = () => window.open(f.url, '_blank')
    } else if (f.data) {
      card.style.cursor = 'pointer'
      card.onclick = () => {
        const a = document.createElement('a')
        a.href = `data:${f.mimeType || 'application/octet-stream'};base64,${f.data}`
        a.download = f.name || '文件'
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

function parseToolInputValue(x) {
  if (x == null) return null
  if (typeof x === 'string') {
    const t = x.trim()
    if (t === '' || t === '{}' || t === '[]') return null
    try {
      const p = JSON.parse(t)
      if (typeof p === 'object' && p !== null) return p
      return x
    } catch {
      return x
    }
  }
  return x
}
function isEmptyToolInput(x) {
  const v = parseToolInputValue(x)
  if (v == null) return true
  if (Array.isArray(v) && v.length === 0) return true
  if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true
  return false
}
function mergeToolInput(prev, next) {
  const p = parseToolInputValue(prev)
  const n = parseToolInputValue(next)
  if (n == null) return p
  if (p == null || isEmptyToolInput(p)) return n
  if (isEmptyToolInput(n)) return p
  if (typeof p === 'object' && typeof n === 'object' && !Array.isArray(p) && !Array.isArray(n)) {
    return { ...p, ...n }
  }
  return n != null ? n : p
}
function upsertTool(tools, entry) {
  if (!entry) return
  const id = entry.id || entry.tool_call_id
  let target = null
  if (id) target = tools.find(t => t.id === id || t.tool_call_id === id)
  if (!target && entry.name && !id) {
    target = tools.find(t => t.name === entry.name && !t.output)
    if (!target) target = tools.find(t => t.name === entry.name && isEmptyToolInput(t.input))
  }
  if (target) {
    if (entry.input != null) target.input = mergeToolInput(target.input, entry.input)
    if (entry.output != null) target.output = entry.output
    if (entry.status) target.status = entry.status
    if (entry.time) target.time = entry.time
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
      let input = call.input || call.args || call.parameters || call.arguments || fn?.arguments || null
      if (typeof input === 'string') {
        const t = input.trim()
        if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
          try {
            input = JSON.parse(input)
          } catch {
            /* keep */
          }
        }
      }
      const callId = call.id || call.tool_call_id
      upsertTool(tools, {
        id: callId,
        name: name || '工具',
        input,
        output: null,
        status: call.status || 'running',
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
        name: res.name || res.tool || res.tool_name || '工具',
        input: res.input || res.args || null,
        output: res.output || res.result || res.content || null,
        status: res.status || 'ok',
        time: resolveToolTime(resId, message?.timestamp),
      })
    })
  }
}

/** 渲染工具调用到消息气泡 */
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
    const running = isToolRunning(tool)
    if (running) details.classList.add('msg-tool-item--running')
    const status = running ? '进行中' : (tool.status === 'error' ? '失败' : '完成')
    const statusCls = running ? 'running' : (tool.status === 'error' ? 'error' : 'ok')
    const timeValue = getToolTime(tool) || resolveToolTime(tool.id || tool.tool_call_id, tool.messageTimestamp)
    const timeText = timeValue ? formatTime(new Date(timeValue)) : ''
    summary.innerHTML =
      `<span class="msg-tool-name">${escapeHtml(toolLabel(tool))}</span>` +
      `<span class="msg-tool-status msg-tool-status--${statusCls}">${status}</span>` +
      (timeText ? `<span class="msg-tool-time">${timeText}</span>` : '')
    if (running) details.open = true
    const body = document.createElement('div')
    body.className = 'msg-tool-body'
    const inputJson = stripAnsi(safeStringify(tool.input))
    const outputJson = stripAnsi(safeStringify(tool.output))
    body.innerHTML = `<div class="msg-tool-block"><div class="msg-tool-title">参数</div><pre>${escapeHtml(inputJson || '无参数')}</pre></div>`
      + `<div class="msg-tool-block"><div class="msg-tool-title">结果</div><pre>${escapeHtml(outputJson || '无结果')}</pre></div>`
    details.appendChild(summary)
    details.appendChild(body)
    container.appendChild(details)
  })
  if (existing) existing.remove()
  /* 工具块接在正文之后，不再 insertBefore(firstChild) 顶在气泡最上 */
  el.appendChild(container)
}

function isToolRunning(tool) {
  if (!tool) return false
  if (tool.status === 'running' || tool.status === 'in_progress') return true
  return tool.output == null || tool.output === ''
}

function toolLabel(tool) {
  const name = String(tool?.name || 'tool')
  const args = tool?.input && typeof tool.input === 'object' ? tool.input : null
  if (name === 'web_search') return `网络搜索${args?.query ? `: ${args.query}` : ''}`
  if (name === 'web_fetch') return `网页读取${args?.url ? `: ${args.url}` : ''}`
  if (name === 'read_file') return `读取文件${args?.path ? `: ${args.path}` : ''}`
  if (name === 'write_file' || name === 'str_replace') return `修改文件${args?.path ? `: ${args.path}` : ''}`
  if (name === 'bash') return `执行命令${args?.command ? `: ${args.command}` : ''}`
  if (name === 'write_todos') return '更新待办'
  if (name === 'ask_clarification') return '等待确认'
  return name
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
  syncQuickPromptsVisibility()
}

function clearMessages() {
  _messagesEl.querySelectorAll('.msg').forEach(m => m.remove())
  _autoScrollEnabled = true
  _lastScrollTop = 0
  syncQuickPromptsVisibility()
}

function showTyping(show) {
  if (_typingEl) _typingEl.style.display = show ? 'flex' : 'none'
  if (show) scrollToBottom()
}

function showCompactionHint(show) {
  let hint = _page?.querySelector('#compaction-hint')
  if (show && !hint && _messagesEl) {
    hint = document.createElement('div')
    hint.id = 'compaction-hint'
    hint.className = 'msg msg-system compaction-hint'
    hint.innerHTML = '🗜️ 正在整理上下文（Compaction）…'
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
    _sendBtn.title = '停止生成'
  } else {
    _sendBtn.disabled = !_textarea.value.trim() && !_attachments.length
    _sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
    _sendBtn.title = '发送'
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
  let text = '未启用', cls = 'chat-hosted-badge'
  if (!enabled) { text = '未启用'; cls += ' idle' }
  else if (status === HOSTED_STATUS.RUNNING) { text = '运行中'; cls += ' running' }
  else if (status === HOSTED_STATUS.WAITING) { text = '等待回复'; cls += ' waiting' }
  else if (status === HOSTED_STATUS.PAUSED) { text = '已暂停'; cls += ' paused' }
  else if (status === HOSTED_STATUS.ERROR) { text = '异常'; cls += ' error' }
  else { text = '待命'; cls += ' idle' }
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
    _hostedSaveBtn.textContent = isRunning ? '⏹ 停止托管' : '▶ 启动托管'
    _hostedSaveBtn.className = isRunning ? 'btn btn-ghost' : 'btn btn-primary'
    _hostedSaveBtn.style.flex = '1'
  }
  // 主按钮同时作为停止按钮，无需额外 stop btn
  // 状态栏
  const statusEl = _hostedPanelEl.querySelector('#hosted-agent-status')
  if (statusEl) {
    let msg = '就绪'
    if (_hostedRuntime.lastError) msg = `错误: ${_hostedRuntime.lastError}`
    else if (isRunning) {
      const remaining = Math.max(0, _hostedSessionConfig.maxSteps - _hostedRuntime.stepCount)
      msg = `运行中 · 剩余 ${remaining} 步`
    }
    statusEl.textContent = msg
  }
  // 倒计时
  updateCountdown()
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
  textEl.textContent = `剩余 ${mins}:${secs.toString().padStart(2, '0')}`
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
  if (!prompt) { toast('请输入任务目标', 'warning'); return }
  const rawSteps = parseInt(_hostedMaxStepsEl?.value || HOSTED_DEFAULTS.maxSteps, 10)
  const maxSteps = rawSteps >= 205 ? 999999 : Math.max(1, rawSteps)
  const stepDelayMs = Math.max(200, parseInt(_hostedStepDelayEl?.value || HOSTED_DEFAULTS.stepDelayMs, 10))
  const retryLimit = Math.max(0, parseInt(_hostedRetryLimitEl?.value || HOSTED_DEFAULTS.retryLimit, 10))
  const timerOn = _page?.querySelector('#hosted-agent-timer-on')?.checked
  const autoStopMinutes = timerOn ? Math.max(0, parseInt(_hostedAutoStopEl?.value || 0, 10)) : 0
  _hostedSessionConfig = { ..._hostedSessionConfig, prompt, enabled: true, maxSteps, stepDelayMs, retryLimit, autoStopMinutes }
  const sysContent = HOSTED_SYSTEM_PROMPT + '\n\n用户目标: ' + prompt
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
      appendHostedOutput(`定时 ${autoStopMinutes} 分钟已到，自动停止`)
      stopHostedAgent()
    }, autoStopMinutes * 60000)
  }
  if (!wsClient.gatewayReady || !_sessionKey) return
  toast('托管 Agent 已启动', 'success')
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
  toast('托管 Agent 已停止', 'info')
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
  compressed.push({ role: 'user', content: `[上下文摘要 - 已压缩 ${older.length} 条历史]\n${summary}`, ts: Date.now() })
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
    _hostedRuntime.lastError = ''
    persistHostedRuntime(); updateHostedBadge()
    return
  }
  if (_hostedRuntime.errorCount >= _hostedSessionConfig.retryLimit) {
    _hostedRuntime.status = HOSTED_STATUS.ERROR
    persistHostedRuntime(); updateHostedBadge()
    appendHostedOutput('需要人工介入: 连续错误超过阈值')
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
      // 将指令发给 Gateway Agent
      try { await api.chatSend(_sessionKey, instruction) } catch {}
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
      appendHostedOutput('需要人工介入: ' + _hostedRuntime.lastError)
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
    const raw = localStorage.getItem('clawpanel-assistant')
    const stored = raw ? JSON.parse(raw) : {}
    config = { baseUrl: stored.baseUrl || '', apiKey: stored.apiKey || '', model: stored.model || '', temperature: stored.temperature || 0.7, apiType: stored.apiType || 'openai-completions' }
  } catch { config = { baseUrl: '', apiKey: '', model: '', temperature: 0.7, apiType: 'openai-completions' } }

  if (!config.baseUrl || !config.model) throw new Error('托管 Agent 未配置模型（请在 AI 助手页面配置）')

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
      let errMsg = `API 错误 ${resp.status}`
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
  wrap.textContent = `[托管 Agent] ${text}`
  _messagesEl.insertBefore(wrap, _typingEl)
  scrollToBottom()
}

// ── 任务进度可视化系统初始化 ──

/**
 * 初始化任务进度可视化系统
 * @param {HTMLElement} page - 页面元素
 */
async function initTaskVisualization(page) {
  // ========== 调试日志 START ==========
  console.log('%c====== [任务系统] 开始初始化 ======', 'color: #ff00ff; font-size: 16px; font-weight: bold; background: #000')
  console.log('%c[任务系统] 🚀 初始化启动...', 'color: #ffff00; font-size: 14px')
  console.log('[任务系统] 时间:', new Date().toLocaleTimeString())
  console.log('[任务系统] 页面 URL:', window.location.href)
  console.log('[任务系统] page 参数:', page ? '✅ 存在' : '❌ 不存在')
  console.log('[任务系统] page 类型:', typeof page)
  console.log('[任务系统] page className:', page?.className)
  // ========== 调试日志 END ==========
  
  try {
    // 1. 初始化嵌入式任务仪表板
    console.log('%c[任务系统] 正在查找仪表板容器 #embedded-task-dashboard...', 'color: #00ffff; font-size: 13px')
    const dashboardContainer = page.querySelector('#embedded-task-dashboard')
    console.log('[任务系统] 查找结果:', dashboardContainer ? '✅ 找到' : '❌ 未找到')
    console.log('[任务系统] 容器类型:', dashboardContainer ? dashboardContainer.tagName : 'N/A')
    
    if (dashboardContainer) {
      console.log('%c[任务系统] 正在创建 EmbeddedTaskDashboard...', 'color: #00ffff; font-size: 13px')
      window.__embeddedTaskDashboard = new EmbeddedTaskDashboard(dashboardContainer)
      console.log('%c[任务系统] ✅ 仪表板已初始化', 'color: #00ff00; font-size: 14px; font-weight: bold')
      console.log('[任务系统] 仪表板对象:', window.__embeddedTaskDashboard)
    } else {
      console.error('%c[任务系统] ❌ 未找到仪表板容器', 'color: #ff0000; font-size: 14px; font-weight: bold')
      console.error('[任务系统] 页面中可用的 ID:', Array.from(page.querySelectorAll('[id]')).map(el => el.id))
    }
    
    // 2. 初始化浮动任务面板
    console.log('%c[任务系统] 正在创建 FloatingTaskPanel...', 'color: #00ffff; font-size: 13px')
    window.__floatingPanel = new FloatingTaskPanel()
    console.log('%c[任务系统] ✅ 浮动面板已初始化', 'color: #00ff00; font-size: 14px; font-weight: bold')
    console.log('[任务系统] 浮动面板对象:', window.__floatingPanel)
    
    // 3. 获取或创建项目事件流
    console.log('%c[任务系统] 正在获取 EventStreamManager 单例...', 'color: #00ffff; font-size: 13px')
    const eventStreamManager = EventStreamManager.getInstance()
    console.log('[任务系统] EventStreamManager:', eventStreamManager ? '✅ 获取成功' : '❌ 获取失败')
    console.log('[任务系统] EventStreamManager 类型:', typeof eventStreamManager)
    
    const projectId = 'main'
    console.log('[任务系统] 项目 ID:', projectId)
    
    console.log('%c[任务系统] 正在获取 TaskEventStream...', 'color: #00ffff; font-size: 13px')
    const taskEventStream = eventStreamManager.getStream(projectId)
    console.log('%c[任务系统] ✅ 事件流已获取', 'color: #00ff00; font-size: 14px; font-weight: bold')
    console.log('[任务系统] TaskEventStream 对象:', taskEventStream)
    console.log('[任务系统] TaskEventStream 类型:', typeof taskEventStream)
    console.log('[任务系统] 连接状态:', taskEventStream?.isConnected)
    console.log('[任务系统] 事件源状态:', taskEventStream?.eventSource?.readyState)
    
    // 添加事件监听器 - TASK_CREATED
    console.log('%c[任务系统] 正在注册 TASK_CREATED 监听器...', 'color: #00ffff; font-size: 13px')
    taskEventStream.on(EventTypes.TASK_CREATED, async (data) => {
      console.log('%c====== [任务系统] 收到 TASK_CREATED 事件 ======', 'color: #ff0000; font-size: 16px; font-weight: bold; background: #ffff00')
      console.log('[任务系统] 🔔 事件触发！')
      console.log('[任务系统] 原始数据:', JSON.stringify(data, null, 2))
      console.log('[任务系统] 数据类型:', typeof data)
      console.log('[任务系统] 数据键:', Object.keys(data || {}))
      console.log('[任务系统] 时间:', new Date().toLocaleTimeString())
      
      const taskId = data?.taskId || data?.id || data?.task?.id || data?.data?.taskId || data?.data?.id
      console.log('[任务系统] 提取的 taskId:', taskId)
      
      if (taskId) {
        console.log('%c[任务系统] 正在获取任务详情...', 'color: #00ffff; font-size: 13px')
        setTimeout(async () => {
          try {
            console.log('[任务系统] 调用 tasksAPI.getTask(', taskId, ')')
            const task = await tasksAPI.getTask(taskId)
            console.log('[任务系统] 任务获取结果:', task ? '✅ 成功' : '❌ 失败')
            console.log('[任务系统] 任务对象:', task)
            
            if (task && window.__embeddedTaskDashboard) {
              console.log('%c[任务系统] 调用 dashboard.showTask(', 'color: #00ffff; font-size: 13px', taskId, ')')
              window.__embeddedTaskDashboard.showTask(task)
              console.log('%c[任务系统] ✅✅✅ 任务已显示在仪表板！', 'color: #00ff00; font-size: 16px; font-weight: bold')
            } else {
              console.warn('%c[任务系统] ❌ 显示失败', 'color: #ff0000; font-size: 14px; font-weight: bold')
              console.warn('[任务系统] - task 存在:', !!task)
              console.warn('[任务系统] - dashboard 存在:', !!window.__embeddedTaskDashboard)
            }
          } catch (err) {
            console.error('%c[任务系统] ❌ 获取任务失败', 'color: #ff0000; font-size: 14px; font-weight: bold')
            console.error('[任务系统] 错误:', err.message)
            console.error('[任务系统] 堆栈:', err.stack)
          }
        }, 500)
      } else {
        console.error('%c[任务系统] ❌ 无法提取 taskId', 'color: #ff0000; font-size: 14px; font-weight: bold')
      }
      console.log('%c====== [任务系统] TASK_CREATED 事件处理结束 ======', 'color: #ff0000; font-size: 16px; font-weight: bold; background: #ffff00')
    })
    console.log('%c[任务系统] ✅ TASK_CREATED 监听器已注册', 'color: #00ff00; font-size: 14px; font-weight: bold')
    
    // 添加事件监听器 - TASK_PROGRESS
    console.log('%c[任务系统] 正在注册 TASK_PROGRESS 监听器...', 'color: #00ffff; font-size: 13px')
    taskEventStream.on(EventTypes.TASK_PROGRESS, (data) => {
      console.log('[任务系统] 📊 收到进度更新:', data)
      if (window.__embeddedTaskDashboard) {
        window.__embeddedTaskDashboard.handleEvent({
          type: EventTypes.TASK_PROGRESS,
          data: data
        })
      }
      if (window.__floatingPanel) {
        window.__floatingPanel.handleEvent({
          type: EventTypes.TASK_PROGRESS,
          data: data
        })
      }
    })
    console.log('%c[任务系统] ✅ TASK_PROGRESS 监听器已注册', 'color: #00ff00; font-size: 14px; font-weight: bold')
    
    // 添加事件监听器 - TASK_COMPLETED
    console.log('%c[任务系统] 正在注册 TASK_COMPLETED 监听器...', 'color: #00ffff; font-size: 13px')
    taskEventStream.on(EventTypes.TASK_COMPLETED, (data) => {
      console.log('[任务系统] 🎉 任务完成:', data)
      if (window.__embeddedTaskDashboard) {
        window.__embeddedTaskDashboard.handleEvent({
          type: EventTypes.TASK_COMPLETED,
          data: data
        })
      }
      if (window.__floatingPanel) {
        window.__floatingPanel.handleEvent({
          type: EventTypes.TASK_COMPLETED,
          data: data
        })
      }
    })
    console.log('%c[任务系统] ✅ TASK_COMPLETED 监听器已注册', 'color: #00ff00; font-size: 14px; font-weight: bold')
    
    // 连接事件流
    console.log('%c[任务系统] 正在连接 SSE...', 'color: #00ffff; font-size: 13px')
    console.log('[任务系统] 连接前状态:', taskEventStream?.isConnected)
    taskEventStream.connect()
    console.log('%c[任务系统] ✅ SSE 已连接', 'color: #00ff00; font-size: 14px; font-weight: bold')
    console.log('[任务系统] 连接后状态:', taskEventStream?.isConnected)
    console.log('[任务系统] 事件源 readyState:', taskEventStream?.eventSource?.readyState)
    console.log('[任务系统] 事件源 URL:', taskEventStream?.eventSource?.url)
    
    // 4. 状态恢复
    console.log('%c[任务系统] 正在恢复活动任务...', 'color: #00ffff; font-size: 13px')
    const restorationManager = new StateRestorationManager()
    const activeTask = await restorationManager.restoreActiveTask()
    console.log('[任务系统] 恢复的活动任务:', activeTask ? activeTask.id : '无')
    
    if (activeTask && window.__embeddedTaskDashboard) {
      console.log('%c[任务系统] 显示恢复的任务:', 'color: #00ffff; font-size: 13px', activeTask.id)
      window.__embeddedTaskDashboard.showTask(activeTask)
      console.log('%c[任务系统] ✅ 已恢复活动任务', 'color: #00ff00; font-size: 14px; font-weight: bold')
    }
    
    console.log('%c====== [任务系统] 初始化完成 ======', 'color: #00ff00; font-size: 16px; font-weight: bold; background: #000')
    console.log('%c[任务系统] 🎉 全局状态:', 'color: #ffff00; font-size: 14px')
    console.log('  - dashboard:', !!window.__embeddedTaskDashboard ? '✅' : '❌')
    console.log('  - floatingPanel:', !!window.__floatingPanel ? '✅' : '❌')
    console.log('  - eventStream:', !!taskEventStream ? '✅' : '❌')
    console.log('  - eventStream.connected:', taskEventStream?.isConnected)
    console.log('%c====== [任务系统] 初始化结束 ======', 'color: #00ff00; font-size: 16px; font-weight: bold; background: #000')
  } catch (err) {
    console.error('%c====== [任务系统] 初始化失败 ======', 'color: #ff0000; font-size: 16px; font-weight: bold; background: #000')
    console.error('%c[任务系统] ❌ 错误:', 'color: #ff0000; font-size: 14px; font-weight: bold', err.message)
    console.error('[任务系统] 堆栈:', err.stack)
    console.error('[任务系统] 错误名称:', err.name)
    console.error('[任务系统] 时间:', new Date().toLocaleTimeString())
  }
}

// ── 页面离开清理 ──

export function cleanup() {
  _pageActive = false
  stopActiveRunWatch()
  if (_collabModalEscapeHandler) {
    document.removeEventListener('keydown', _collabModalEscapeHandler)
    _collabModalEscapeHandler = null
  }
  if (_unsubEvent) { _unsubEvent(); _unsubEvent = null }
  if (_unsubReady) { _unsubReady(); _unsubReady = null }
  if (_unsubStatus) { _unsubStatus(); _unsubStatus = null }
  clearTimeout(_streamSafetyTimer)
  if (_hostedAbort) { _hostedAbort.abort(); _hostedAbort = null }
  
  // 清理任务系统
  const eventStreamManager = EventStreamManager.getInstance()
  eventStreamManager.disconnectStream('main')
  if (window.__floatingPanel) {
    window.__floatingPanel.destroy()
    window.__floatingPanel = null
  }
  if (window.__embeddedTaskDashboard) {
    window.__embeddedTaskDashboard.destroy()
    window.__embeddedTaskDashboard = null
  }
  
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
