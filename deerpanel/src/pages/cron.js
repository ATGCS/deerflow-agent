/**
 * 定时任务 / Automation 页面
 * 现代化调度管理 UI — 对接 dev-api automation_* 路由
 * 含可视化时间选择器组件
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { showConfirm } from '../components/modal.js'

const esc = (s) => !s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot')

// ── 状态 ────────────────────────────────

let _tasks = []
let _schedulerState = 'stopped'
let _loadSeq = 0
let _pageEl = null

// ── 预设快捷 ───────────────────────────

const CRON_PRESETS = [
  { label: '每小时', freq: 'hourly' },
  { label: '每天 9:00', freq: 'daily', hour: 9 },
  { label: '每天 18:00', freq: 'daily', hour: 18 },
  { label: '工作日 9:00', freq: 'weekdays', hour: 9 },
  { label: '每周一 10:00', freq: 'weekly', dow: 1, hour: 10 },
]

const EMOJI_FOR_NAME = (name) => {
  const n = (name || '').toLowerCase()
  if (/test|测试|检查|health|check/i.test(n)) return '\u{1F9EA}'
  if (/build|构建|部署|deploy|release/i.test(n)) return '\u{1F680}'
  if (/backup|备份/i.test(n)) return '\u{1F4BE}'
  if (/report|报告|日报|周报|汇报/i.test(n)) return '\u{1F4CA}'
  if (/clean|清理|cleanup/i.test(n)) return '\u{1F9F9}'
  if (/sync|同步|拉取|fetch/i.test(n)) return '\u{1F504}'
  if (/monitor|监控|watch|guard/i.test(n)) return '\u{1F441}\u{FE0F}'
  if (/notify|通知|消息|msg/i.test(n)) return '\u{1F514}'
  if (/scan|扫描|audit|审计/i.test(n)) return '\u{1F50D}'
  return '\u{23F0}'
}

function q(sel) { return _pageEl ? _pageEl.querySelector(sel) : document.querySelector(sel) }

// ══════════════════════════════════════
// 初始化 & 渲染
// ══════════════════════════════════════

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _pageEl = page

  page.innerHTML = renderPage()
  bindPageEvents(page)
  await refresh()
  return page
}

function renderPage() {
  return `
    <div class="cron-page">
      <div class="cron-header">
        <div class="cron-title-group">
          <span class="cron-title-icon">\u23F0</span>
          <div>
            <h1 class="cron-title">定时任务</h1>
            <p class="cron-subtitle">自动化调度管理 \u2014 创建、监控和管理周期性 / 一次性任务</p>
          </div>
        </div>
        <div class="cron-toolbar">
          <button class="cron-btn primary" data-action="create">\uFF0B 新建任务</button>
          <div class="engine-switch" id="engineSwitch" data-action="toggle-engine">
            <div class="engine-track">
              <div class="engine-thumb" id="engineThumb"></div>
              <span class="engine-label" id="engineLabel">\u25B6 \u542F\u52A8\u5F15\u64CE</span>
            </div>
          </div>
        </div>
      </div>

      <div class="cron-status-bar">
        <div class="cron-status-indicator">
          <span class="cron-dot stopped" id="schedulerDot"></span>
          <span id="schedulerLabel">调度器未启动</span>
        </div>
        <div class="cron-stats">
          <span class="cron-stat"><strong id="statActive">0</strong> 活跃</span>
          <span class="cron-stat"><strong id="statPaused">0</strong> 已暂停</span>
          <span class="cron-stat"><strong id="statTotal">0</strong> 总计</span>
        </div>
      </div>

      <div class="cron-list" id="cronList"></div>
    </div>`
}

/** 页面内事件委托（仅处理页面内的 action） */
function bindPageEvents(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return

    const action = btn.dataset.action
    const taskId = btn.dataset.id

    try {
      switch (action) {
        case 'create': openCreateModal(); break
        case 'edit': openEditModal(taskId); break
        case 'delete':
          if (await showConfirm('确认删除此定时任务？')) await deleteTask(taskId)
          break
        case 'run':
          await runTask(taskId)
          toast('\u5DF2\u89E6\u53D1\u624B\u52A8\u6267\u884C', 'success')
          break
        case 'pause':
          await pauseTask(taskId)
          toast('\u5DF2\u6682\u505C', 'success')
          break
        case 'resume':
          await resumeTask(taskId)
          toast('\u5DF2\u6062\u590D', 'success')
          break
        case 'history': openHistory(taskId); break
        case 'toggle-scheduler': await toggleScheduler(btn.dataset.target); break
        case 'toggle-engine': await toggleEngineSwitch(); break
      }
    } catch (err) {
      console.error('[cron] Action error:', err)
      toast(String(err.message || err), 'error')
    }
  })
}

// ══════════════════════════════════════
// 数据加载
// ══════════════════════════════════════

async function refresh() {
  _loadSeq++
  const seq = _loadSeq
  try {
    const res = await api.automationList()
    if (_loadSeq !== seq) return
    _tasks = res.automations || []
    console.log('[cron] refresh tasks:', JSON.stringify(_tasks.map(function(t){ return {id:t.id, schedule_type:t.schedule_type, rrule:!!t.rrule, scheduled_at:t.scheduled_at} })))
    renderList()
    updateStats()
  } catch (err) {
    if (seq === _loadSeq) renderEmpty(err.message)
  }
}

async function toggleScheduler(target) {
  try {
    if (target === 'start') {
      const res = await api.automationStart()
      _schedulerState = res.state || 'running'
      toast('\u8C03\u5EA6\u5668\u5F15\u64CE\u5DF2\u542F\u52A8', 'success')
    } else {
      await api.automationStop()
      _schedulerState = 'stopped'
      toast('\u8C03\u5EA6\u5668\u5F15\u64CE\u5DF2\u505C\u6B62', 'info')
    }
    updateSchedulerUI()
  } catch (err) { toast(err.message, 'error') }
}

function updateSchedulerUI() {
  const dot = q('#schedulerDot')
  const label = q('#schedulerLabel')
  const sw = document.getElementById('engineSwitch')
  const thumb = document.getElementById('engineThumb')
  const elabel = document.getElementById('engineLabel')
  if (!dot) return
  const running = _schedulerState === 'running'
  dot.className = `cron-dot ${_schedulerState}`
  label.textContent = running ? '调度器运行中' : (_schedulerState === 'error' ? '调度器异常' : '调度器未启动')

  // 更新引擎开关
  if (sw && thumb && elabel) {
    if (running) {
      sw.classList.add('on')
      elabel.innerHTML = '\u{1F7E2} \u5F15\u64CE\u8FD0\u884C\u4E2D'
    } else {
      sw.classList.remove('on')
      elabel.innerHTML = '\u25B6 \u542F\u52A8\u5F15\u64CE'
    }
  }
}

async function toggleEngineSwitch() {
  try {
    if (_schedulerState === 'running') {
      await api.automationStop()
      _schedulerState = 'stopped'
      toast('\u8C03\u5EA6\u5668\u5F15\u64CE\u5DF2\u505C\u6B62', 'info')
    } else {
      const res = await api.automationStart()
      _schedulerState = res.state || 'running'
      toast('\u8C03\u5EA6\u5668\u5F15\u64CE\u5DF2\u542F\u52A8', 'success')
    }
    updateSchedulerUI()
  } catch (err) { toast(err.message, 'error') }
}

function updateStats() {
  const active = _tasks.filter(t => t.status === 'active').length
  const paused = _tasks.filter(t => t.status === 'paused').length
  setEl('statActive', active); setEl('statPaused', paused); setEl('statTotal', _tasks.length)
  if (active > 0 && _schedulerState !== 'running') { _schedulerState = 'stopped'; updateSchedulerUI() }
}
function setEl(id, val) { const el = q(`#${id}`); if (el) el.textContent = val }

// ══════════════════════════════════════
// 任务卡片列表
// ══════════════════════════════════════

function renderList() {
  const list = q('#cronList'); if (!list) return
  list.innerHTML = !_tasks.length ? renderEmpty() : _tasks.map(t => renderCard(t)).join('')
}

function renderEmpty(msg) {
  return `<div class="cron-empty"><div class="cron-empty-icon">\u23F0</div><h3>暂无定时任务</h3><p>${msg || '点击「新建任务」创建你的第一个自动化调度任务'}</p></div>`
}

function renderCard(t) {
  console.log('[cron] renderCard task:', JSON.stringify({id:t.id, schedule_type:t.schedule_type, rrule:!!t.rrule, scheduled_at:t.scheduled_at}))
  const isPaused = t.status === 'paused'
  const emoji = EMOJI_FOR_NAME(t.name)
  // 以 rrule 存在与否判断是否为一次性任务（比 schedule_type 更可靠）
  const isOnceType = !t.rrule && (t.schedule_type === 'once' || !!t.scheduled_at)
  const humanSchedule = t.rrule ? rruleToHumanLocal(t.rrule, t.schedule_type, t.scheduled_at)
    : (isOnceType && t.scheduled_at ? `\u4E00\u6B21\u6027: ${t.scheduled_at}` : t.schedule || '\u672A\u77E5')
  const cronStr = t.rrule ? rruleToCronLocal(t.rrule, t.scheduled_at) : '-'
  const badgeClass = isOnceType ? 'badge-once' : (isPaused ? 'badge-paused' : 'badge-active')
  const badgeText = isOnceType ? '\u4E00\u6B21\u6027' : (isPaused ? '\u5DF2\u6682\u505C' : '\u8FD0\u884C\u4E2D')

  return `
    <div class="cron-card ${isPaused ? 'paused' : ''}" data-task-id="${esc(t.id)}">
      <div class="cron-card-header">
        <div class="cron-card-left">
          <span class="cron-card-emoji">${emoji}</span>
          <div class="cron-card-name-wrap">
            <h3 class="cron-card-name">${esc(t.name)}</h3>
            <div class="cron-card-id">${esc(t.id)} \u00B7 ${isOnceType ? 'once' : (t.schedule_type || 'recurring')}</div>
          </div>
        </div>
        <span class="cron-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="cron-card-body">
        <div>
          <div class="cron-field-label">\u6267\u884C\u9891\u7387</div>
          <div class="cron-field-value"><span class="cron-cron-code">${esc(cronStr)}</span> \u00B7 ${esc(humanSchedule)}</div>
        </div>
        <div><div class="cron-field-label">\u72B6\u6001</div><div class="cron-field-value">${t.status || 'active'}</div></div>
      </div>
      <div style="margin-top:6px;">
        <div class="cron-field-label">\u4EFB\u52A1\u63CF\u8FF0</div>
        <div class="cron-prompt-preview">${esc(t.prompt)}</div>
      </div>
      <div class="cron-card-actions">
        ${!isPaused ? `<button class="cron-btn sm" data-action="run" data-id="${t.id}">\u25B6 \u8FD0\u884C</button>` : ''}
        ${isPaused
          ? `<button class="cron-btn sm success" data-action="resume" data-id="${t.id}">\u21BB \u6062\u590D</button>`
          : `<button class="cron-btn sm" data-action="pause" data-id="${t.id}">\u2399\u2399 \u6682\u505C</button>`}
        <button class="cron-btn sm" data-action="history" data-id="${t.id}">\u{1F4CB} \u5386\u53F2</button>
        <button class="cron-btn sm" data-action="edit" data-id="${t.id}">\u270E \u7F16\u8F91</button>
        <button class="cron-btn sm danger" data-action="delete" data-id="${t.id}">\u2715 \u5220\u9664</button>
      </div>
    </div>`
}

// ── RRULE 本地转换 ────────────────────

function rruleToCronLocal(rrule, scheduledAt) {
  if (scheduledAt) return scheduledAt
  if (!rrule) return '0 * * * *'
  try {
    const p = {}
    for (const seg of rrule.toUpperCase().split(';')) { const [k,v]=seg.split('=').map(s=>s.trim()); if(k&&v)p[k]=v }
    const freq=p.FREQ||'', h=parseInt(p.BYHOUR||'9',10), m=parseInt(p.BYMINUTE||'0',10), iv=parseInt(p.INTERVAL||'1',10)
    switch(freq){
      case'HOURLY':return`0 */${iv} * * *`
      case'DAILY':return`${m} ${h} * * *`
      case'WEEKLY':{const dn={SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};return`${m} ${h} * * ${(p.BYDAY||'').split(',').map(d=>dn[d.trim()]??'?').join(',')}`}
      default:return`${m} ${h} * * *`
    }
  }catch{return rrule}
}

function rruleToHumanLocal(rrule, stype, sat) {
  if(stype==='once'||sat)return`\u4E00\u6B21\u6027: ${sat||rrule||'?'}`
  if(!rrule)return'\u6BCF\u5206\u949F'
  try{
    const p={}
    for(const seg of rrule.toUpperCase().split(';')){const[k,v]=seg.split('=').map(s=>s.trim());if(k&&v)p[k]=v}
    const freq=p.FREQ||'',iv=parseInt(p.INTERVAL||'1',10),h=p.BYHOUR?parseInt(p.BYHOUR,10):null
    switch(freq){
      case'HOURLY':return iv>1?`\u6BCF ${iv} \u5C0F\u65F6`:'\u6BCF\u5C0F\u65F6'
      case'DAILY':{const ts=h!=null?` ${String(h).padStart(2,'0')}:00`:'';return iv>1?`\u6BCF ${iv} \u5929${ts}`:`\u6BCF\u5929${ts}`}
      case'WEEKLY':{const dc={MO:'\u5468\u4E00',TU:'\u5468\u4E8C',WE:'\u5468\u4E09',TH:'\u5468\u56DB',FR:'\u5468\u4E94',SA:'\u5468\u516D',SU:'\u5468\u65E5'};const ds=(p.BYDAY||'').split(',').map(d=>dc[d.trim()]||d).filter(Boolean);return iv>1?`\u6BCF ${iv} \u5468 (${ds.join(',')||'\u5468\u4E00'})`:`\u6BCF\u5468 (${ds.join(',')||'\u5468\u4E00'})`}
      default:return rrule
    }
  }catch{return rrule}
}

// ══════════════════════════════════════
// CRUD 操作
// ══════════════════════════════════════

async function deleteTask(id){await api.automationDelete(id);toast('\u5DF2\u5220\u9664','success');await refresh()}
async function runTask(id){await api.automationRun(id)}
async function pauseTask(id){await api.automationPause(id);await refresh()}
async function resumeTask(id){await api.automationResume(id);await refresh()}


// ════════════════════════════════════════════════════════════════════
//  专业定时调度选择器（时钟式 + 快捷预设，自包含事件）
// ════════════════════════════════════════════════════════════════════

const WEEK_DAYS = [
  { k:1,s:'一',f:'周一' },{ k:2,s:'二',f:'周二' },{ k:3,s:'三',f:'周三' },
  { k:4,s:'四',f:'周四' },{ k:5,s:'五',f:'周五' },{ k:6,s:'六',f:'周六' },{ k:0,s:'日',f:'周日' },
]

/**
 * 调度配置面板控制器
 * 返回 { html, initEvents(container), getSchedule() }
 */
function createSchedulePanel(initialFreq, initialHour, initialMinute, initialDow) {
  let freq = initialFreq || 'daily'
  let h = initialHour ?? 9
  let m = initialMinute ?? 0
  let days = initialDow?.length ? [...initialDow] : [1,2,3,4,5]
  let ampm = h >= 12 ? 'PM' : 'AM'
  let displayH = ((h % 12) || 12)

  /* ── 渲染面板 HTML（不含动态子组件） ── */

  function render() {
    const showTime = freq !== 'custom'
    const showDays = freq === 'weekly' || freq === 'weekdays'
    const needClock = !['hourly','once','custom'].includes(freq)

    return `
    <div class="sched-panel">
      <div class="sched-tabs">
        <button type="button" class="sched-tab ${freq==='hourly'?'on':''}" data-sf="hourly">每小时</button>
        <button type="button" class="sched-tab ${freq==='daily'?'on':''}" data-sf="daily">每天</button>
        <button type="button" class="sched-tab ${freq==='weekdays'?'on':''}" data-sf="weekdays">工作日</button>
        <button type="button" class="sched-tab ${freq==='weekly'?'on':''}" data-sf="weekly">每周</button>
        <button type="button" class="sched-tab ${freq==='once'?'on':''}" data-sf="once">一次性</button>
        <button type="button" class="sched-tab ${freq==='custom'?'on':''}" data-sf="custom">自定义 Cron</button>
      </div>

      <div class="sched-body" id="schedBody" style="${showTime?'':'display:none'}">
        ${freq==='hourly'?`
          <div class="sched-row"><span class="sched-label">触发分钟</span></div>
          <div class="minute-rings" id="minRings">${buildMinRings(m)}</div>
          <div class="sched-hint" id="schedHint">每小时第 <b>${String(m).padStart(2,'0')}</b> 分触发</div>
        `:freq==='once'?'<div class="sched-once-area">'+buildOnceHTMLInner()+'</div>':needClock?`
          <div class="sched-clock-area">
            <div class="sched-clock" id="schedClock">${buildClockSVG(displayH,m)}</div>
            <div class="sched-time-display">
              <div class="sched-digit-group">
                <input type="text" class="sched-digit" id="clockHour" inputmode="numeric" maxlength="2" value="${String(displayH)}" />
                <span class="sched-colon">:</span>
                <input type="text" class="sched-digit" id="clockMin" inputmode="numeric" maxlength="2" value="${String(m).padStart(2,'0')}" />
              </div>
              <div class="sched-ampm-toggle" id="ampmToggle">
                <button type="button" class="ampm-btn ${ampm==='AM'?'on':''}" data-p="AM">AM</button>
                <button type="button" class="ampm-btn ${ampm==='PM'?'on':''}" data-p="PM">PM</button>
              </div>
            </div>
          </div>
        `:''}
        ${showDays && freq!=='hourly' ? `
          <div class="sched-row" id="dayRow" style="margin-top:14px;">
            <span class="sched-label">星期</span>
            <div class="day-chips" id="dayChips">${renderDayChips()}</div>
          </div>` : ''}
      </div>

      <div class="sched-custom" id="schedCustom" style="${freq==='custom'?'':'display:none'}">
        <div class="sched-row">
          <span class="sched-label">Cron 表达式</span>
          <input class="cron-input" id="fCustomCron"
                 placeholder='例：0 9 * * 1-5 或 */30 9-17 * * 1-5'
                 value="${freq==='custom'?(initialHour??''):''}" />
        </div>
        <div class="sched-help-text">格式：分 时 日 月 星期 &nbsp;|&nbsp; 例：0 9 * * 1-5（工作日 9:00）</div>
      </div>

      <div class="sched-summary-card" id="schedSummary">${buildSummary()}</div>
    </div>`
  }

  function formatDTLocal(hr, mn) {
    const d=new Date(); d.setHours(hr,mn,0,0); return d.toISOString().slice(0,16)
  }
  function renderDayChips() {
    return WEEK_DAYS.map(d =>
      `<button type="button" class="day-chip ${days.includes(d.k)?'on':''}" data-dk="${d.k}" title="${d.f}">${d.s}</button>`
    ).join('')
  }
  function buildSummary() {
    var dn={1:'一',2:'二',3:'三',4:'四',5:'五',6:'六',0:'日'}
    switch(freq){
      case 'hourly': return '<span class="ss-icon">\u26A1</span> 每 <b>1 小时</b> 第 <b>'+m+'</b> 分钟触发'
      case 'daily': return '<span class="ss-icon">\u{1F553}</span> 每天 <b>'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+'</b> 执行'
      case 'weekdays': return '<span class="ss-icon">\u{1F4BC}</span> 每 <b>'+days.map(function(d){return dn[d]}).join('/')+'</b> <b>'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+'</b>'
      case 'weekly': return '<span class="ss-icon">\u{1F5D3}</span> 每周 <b>'+days.map(d=>dn[d]).join('/')+'</b> <b>'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+'</b>'
      case 'once': {
        var dtEl = document.getElementById('schedDatetime')
        var val2 = dtEl ? dtEl.value : formatDTLocal(h,m)
        if (!val2) return '<span class="ss-icon">\u{1F4C5}</span> 一次性执行（请选择时间）'
        try { var d=new Date(val2); val2=d.toLocaleString('zh-CN',{month:'short',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}) } catch(e){}
        return '<span class="ss-icon">\u{1F4C5}</span> 一次性: <strong style="color:#d97706">'+val2+'</strong>'
      }
      case 'custom': return '<span class="ss-icon">\u2699</span> 自定义 Cron 表达式'
      default: return ''
    }
  }

  /* ── SVG 时钟表盘 ── */
  function buildClockSVG(sh, sm) {
    const cx=72,cy=72,R=58,r=44
    let hm='',mm=''
    for(let i=1;i<=12;i++){
      const a=(i*30-90)*Math.PI/180
      const x1=cx+Math.cos(a)*(R-6),y1=cy+Math.sin(a)*(R-6)
      const x2=cx+Math.cos(a)*R,y2=cy+Math.sin(a)*R
      const tx=cx+Math.cos(a)*(R-16),ty=cy+Math.sin(a)*(R-16)+4
      const active=((i%12)||12)===sh
      hm+='<g class="clk-hr-mark '+((active?'active':''))+'" data-hv="'+i+'">'
        +'<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke-width="2"/>'
        +'<text x="'+tx+'" y="'+ty+'" text-anchor="middle" font-size="11" font-weight="'+(active?700:500)+'" fill="'+(active?'#fff':'var(--text-tertiary)')+'">'+i+'</text>'
        +'<circle cx="'+(cx+Math.cos(a)*(R-28))+'" cy="'+(cy+Math.sin(a)*(R-28))+'" r="13"'
        +' fill="'+(active?'rgba(99,102,241,.25)':'transparent')+'" class="clk-hr-hit" data-hv="'+i+'"/>'
        +'</g>'
    }
    for(let i=0;i<60;i+=5){
      const a=(i*6-90)*Math.PI/180
      const x1=cx+Math.cos(a)*(r-3),y1=cy+Math.sin(a)*(r-3)
      const x2=cx+Math.cos(a)*r,y2=cy+Math.sin(a)*r
      const active=i===sm
      mm+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+(active?'var(--accent)':'var(--border-secondary)')+'" stroke-width="'+(active?2.5:1)+'"/>'
      if(i%15===0){mm+='<circle cx="'+(cx+Math.cos(a)*(r-8))+'" cy="'+(cy+Math.sin(a)*(r-8))+'" r="10" fill="transparent" class="clk-min-hit" data-mv="'+i+'"/>'}
      else if(i%5===0){mm+='<circle cx="'+(cx+Math.cos(a)*(r-6))+'" cy="'+(cy+Math.sin(a)*(r-6))+'" r="7" fill="transparent" class="clk-min-hit" data-mv="'+i+'"/>'}
    }
    const hA=((sh%12)*30+sm*0.5-90)*Math.PI/180,mA=(sm*6-90)*Math.PI/180
    return '<svg viewBox="0 0 144 144" class="clock-svg">'
      +'<defs><filter id="ckSh"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity=".2"/></filter></defs>'
      +'<circle cx="'+cx+'" cy="'+cy+'" r="'+(R+4)+'" fill="var(--bg-secondary)" stroke="var(--border-primary)" stroke-width="1"/>'
      +'<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="var(--bg-primary)" stroke="var(--border-secondary)" stroke-width=".5"/>'
      +hm+mm
      +'<circle cx="'+cx+'" cy="'+cy+'" r="4" fill="var(--accent)" filter="url(#ckSh)"/>'
      +'<line x1="'+cx+'" y1="'+cy+'" x2="'+(cx+Math.cos(hA)*32)+'" y2="'+(cy+Math.sin(hA)*32)+'" stroke="var(--text-primary)" stroke-width="3" stroke-linecap="round" opacity=".85"/>'
      +'<line x1="'+cx+'" y1="'+cy+'" x2="'+(cx+Math.cos(mA)*42)+'" y2="'+(cy+Math.sin(mA)*42)+'" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" filter="url(#ckSh)"/>'
      +'</svg>'
  }

  /* ── 分钟环形选择器 ── */
  function buildMinRings(sm) {
    const quicks=[0,15,30,45].map(v=>
      '<button type="button" class="min-quick-btn '+(sm===v?'on':'')+'" data-mv="'+v+'">'+String(v).padStart(2,'0')+'分</button>'
    ).join('')
    let cells=''
    for(let i=0;i<60;i++)cells+='<button type="button" class="min-ring-cell '+(i===sm?'on':'')+'" data-mv="'+i+'" title="'+i+'分">'+i+'</button>'
    return '<div class="min-quicks">'+quicks+'</div><div class="min-ring-grid">'+cells+'</div>'
  }

  /* ── 一次性模式（美化版日期时间选择）── */
  function buildOnceHTMLInner() {
    const dtVal = formatDTLocal(h, m)
    return '\n        <div class="sched-datetime-wrap">\n'
      + '          <span class="sched-datetime-label">执行日期时间</span>\n'
      + '          <input type="datetime-local" class="sched-datetime" id="schedDatetime"\n'
      + '                 value="' + dtVal + '" />\n'
      + '          <div class="sched-once-preview" id="oncePreview">' + buildOncePreview(dtVal) + '</div>\n'
      + '        </div>\n'
      + '        <div class="sched-once-quicks">\n'
      + '          <span class="sched-once-quick-label">快捷</span>'
      + buildOnceQuicks()
      + '        </div>\n'
  }

  function buildOnceHTML() { return buildOnceHTMLInner() }

  var ONCE_PRESETS = [
    { label:'现在', offset:0 },
    { label:'+1小时', offset:60 },
    { label:'明早 9:00', fn:function(){var d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);return d.toISOString().slice(0,16)} },
    { label:'今晚 22:00', fn:function(){var d=new Date();d.setHours(22,0,0,0);if(d<=new Date())d.setDate(d.getDate()+1);return d.toISOString().slice(0,16)} },
  ]

  function buildOnceQuicks() {
    return ONCE_PRESETS.map(function(p){
      return '<button type="button" class="sched-once-quick-btn" data-once-preset="'+p.label+'">'+p.label+'</button>'
    }).join('')
  }

  function buildOncePreview(dtVal) {
    if (!dtVal) return '<span class="sched-once-preview-icon">\u{1F4C5}</span><span class="sched-once-preview-text">请选择执行时间</span>'
    try {
      var d = new Date(dtVal)
      var fmt = d.toLocaleString('zh-CN', { month:'short', day:'numeric', weekday:'short', hour:'2-digit', minute:'2-digit' })
      return '<span class="sched-once-preview-icon">\u{1F4C5}</span>'
        + '<span class="sched-once-preview-text">将在 <strong>' + fmt + '</strong> 执行 <span class="sched-once-preview-time">'+dtVal.replace('T',' ')+'</span></span>'
    } catch(e) {
      return '<span class="sched-once-preview-icon">\u{1F4C5}</span><span class="sched-once-preview-text">请选择执行时间</span>'
    }
  }

  function bindOnceEvents() {
    var dtEl = document.getElementById('schedDatetime')
    if (dtEl) dtEl.onchange = function() { updateOncePreview(); updateSummary() }
    // 快捷按钮
    document.querySelectorAll('.sched-once-quick-btn').forEach(function(btn){
      btn.onclick = function(){
        // 移除其他 on
        document.querySelectorAll('.sched-once-quick-btn').forEach(function(b){ b.classList.remove('on') })
        btn.classList.add('on')
        var preset = ONCE_PRESETS.find(function(p){return p.label===btn.dataset.oncePreset})
        if (preset) {
          var dt
          if (preset.fn) dt = preset.fn()
          else { var nd = new Date(); nd.setTime(nd.getTime()+preset.offset*60000); dt = nd.toISOString().slice(0,16) }
          var el = document.getElementById('schedDatetime')
          if (el) { el.value = dt; el.dispatchEvent(new Event('change')) }
        }
      }
    })
  }

  function updateOncePreview() {
    var el = document.getElementById('schedDatetime')
    var pv = document.getElementById('oncePreview')
    if (el && pv) pv.innerHTML = buildOncePreview(el.value)
  }

  /* ── 辅助 ── */
  function setH12(v){displayH=v;syncDisp()}
  function syncDisp(){let v=displayH;if(ampm==='PM'&&v!==12)v+=12;if(ampm==='AM'&&v===12)v=0;h=v}
  function syncHM(){displayH=((h%12)||12);ampm=h>=12?'PM':'AM'}

  /* ── 旧事件绑定（已被 switchFreq + rebuildSubArea 替代，保留兼容）── */
  function bind(root){
    // 使用新的切换逻辑
    var tabs = root.querySelectorAll ? root.querySelectorAll('.sched-tab') : document.querySelectorAll('.sched-tab')
    tabs.forEach(function(t){t.onclick=function(){switchFreq(t.dataset.sf)}})
    // 初始化当前模式的子事件
    if(freq==='hourly')bindMinRingEvents()
    else if(!['custom','once','hourly'].includes(freq))bindClockEvents()
    bindDayChipEvents()
    var dt=document.getElementById('schedDatetime');if(dt)dt.onchange=updateSummary
  }

  // ════════════════════════════
  //  Tab 切换：show/hide，不重建整个弹窗DOM
  // ════════════════════════════

  var $c = null // 缓存正确的 scheduleContainer 引用

  function switchFreq(newFreq) {
    freq = newFreq
    var body = document.getElementById('schedBody')
    var custom = document.getElementById('schedCustom')

    if (body) body.style.display = (freq !== 'custom') ? '' : 'none'
    if (custom) custom.style.display = (freq === 'custom') ? '' : 'none'

    // 根据频率重建子区域内容（只重建 schedBody 内部，不动弹窗）
    if (freq === 'hourly') {
      rebuildSubArea('\n        <div class="sched-row"><span class="sched-label">触发分钟</span></div>\n'
        + '        <div class="minute-rings" id="minRings">' + buildMinRings(m) + '</div>\n'
        + '        <div class="sched-hint" id="schedHint">每小时第 <b>' + String(m).padStart(2,'0') + '</b> 分触发</div>')
      bindMinRingEvents()
    } else if (freq === 'once') {
      rebuildSubArea(buildOnceHTML())
      bindOnceEvents()
    } else if (!['custom','once','hourly'].includes(freq)) {
      rebuildSubArea('\n        <div class="sched-clock-area">\n'
        + '          <div class="sched-clock" id="schedClock">' + buildClockSVG(displayH,m) + '</div>\n'
        + '          <div class="sched-time-display">\n'
        + '            <div class="sched-digit-group">\n'
        + '              <input type="text" class="sched-digit" id="clockHour" inputmode="numeric" maxlength="2" value="' + String(displayH) + '" />\n'
        + '              <span class="sched-colon">:</span>\n'
        + '              <input type="text" class="sched-digit" id="clockMin" inputmode="numeric" maxlength="2" value="' + String(m).padStart(2,'0') + '" />\n'
        + '            </div>\n'
        + '            <div class="sched-ampm-toggle" id="ampmToggle">\n'
        + '              <button type="button" class="ampm-btn '+(ampm==='AM'?'on':'')+'" data-p="AM">AM</button>\n'
        + '              <button type="button" class="ampm-btn '+(ampm==='PM'?'on':'')+'" data-p="PM">PM</button>\n'
        + '            </div>\n'
        + '          </div>\n'
        + '        </div>')
      bindClockEvents()
    }

    // 星期选择器显隐
    var dayRow = document.getElementById('dayRow')
    if (dayRow) dayRow.style.display = ((freq==='weekly'||freq==='weekdays')) ? '' : 'none'

    updateSummary()
    document.querySelectorAll('.sched-tab').forEach(function(t){t.classList.toggle('on',t.dataset.sf===freq)})
  }

  function rebuildSubArea(html) {
    var body = document.getElementById('schedBody')
    if (!body) return
    body.innerHTML = html
    // 重新挂载星期行（如果有）
    var showDays = (freq==='weekly'||freq==='weekdays')
    if (showDays && freq!=='hourly') {
      var dRow = document.createElement('div')
      dRow.className = 'sched-row'; dRow.id = 'dayRow'; dRow.style.marginTop='14px'
      dRow.innerHTML = '<span class="sched-label">星期</span><div class="day-chips" id="dayChips">' + renderDayChips() + '</div>'
      body.appendChild(dRow)
      bindDayChipEvents()
    }
  }

  function bindMinRingEvents() {
    var mr = document.getElementById('minRings')
    if (!mr) return
    mr.onclick = function(e) {
      var b = e.target.closest('[data-mv]')
      if (b) { m = parseInt(b.dataset.mv,10); mr.innerHTML = buildMinRings(m)
        var ht = document.getElementById('schedHint')
        if (ht) ht.innerHTML = '每小时第 <b>' + String(m).padStart(2,'0') + '</b> 分触发'
        updateSummary()
      }
    }
  }

  function bindClockEvents() {
    var clk = document.getElementById('schedClock')
    if (clk) clk.onclick = function(e) {
      var hr = e.target.closest('[data-hv]'), mn = e.target.closest('[data-mv]')
      if (hr) { setH12(parseInt(hr.dataset.hv,10)); refreshClockUI() }
      else if (mn) { m = parseInt(mn.dataset.mv,10); syncHM(); refreshClockUI(); updateSummary() }
    }
    var hI = document.getElementById('clockHour')
    if (hI) hI.onchange = function(){var v=parseInt(this.value,10);if(!isNaN(v)&&v>=1&&v<=12){displayH=v;syncDisp();refreshClockUI();updateSummary()}this.value=String(displayH)}
    var mI = document.getElementById('clockMin')
    if (mI) mI.onchange = function(){var v=parseInt(this.value,10);if(!isNaN(v)&&v>=0&&v<=59){m=v;syncHM();refreshClockUI();updateSummary()}this.value=String(m).padStart(2,'0')}
    var ap = document.getElementById('ampmToggle')
    if (ap) ap.onclick = function(e){var b=e.target.closest('.ampm-btn[data-p]');if(b){ampm=b.dataset.p;syncDisp();refreshClockUI();updateSummary();ap.querySelectorAll('.ampm-btn').forEach(function(x){x.classList.toggle('on',x.dataset.p===ampm)})}}
  }

  function bindDayChipEvents() {
    var dc = document.getElementById('dayChips')
    if (!dc) return
    dc.onclick = function(e){
      var c = e.target.closest('.day-chip[data-dk]')
      if(c){var dk=parseInt(c.dataset.dk,10),idx=days.indexOf(dk)
        if(idx>=0){days.splice(idx,1);if(!days.length)days=[dk];c.classList.remove('on')}
        else{days.push(dk);c.classList.add('on')}
        updateSummary()
      }
    }
  }

  function refreshClockUI(){
    var c=document.getElementById('schedClock');if(c)c.innerHTML=buildClockSVG(displayH,m)
    var h=document.getElementById('clockHour');if(h)h.value=String(displayH)
    var mi=document.getElementById('clockMin');if(mi)mi.value=String(m).padStart(2,'0')
    var ap=document.getElementById('ampmToggle');if(ap)ap.querySelectorAll('.ampm-btn').forEach(function(b){b.classList.toggle('on',b.dataset.p===ampm)})
  }
  function updateSummary(){var s=document.getElementById('schedSummary');if(s)s.innerHTML=buildSummary()}

  /* ── 公开 API ── */
  return {
    html: render(),
    initEvents: function(containerEl) {
      $c = containerEl
      document.querySelectorAll('.sched-tab').forEach(function(t){t.onclick=function(){switchFreq(t.dataset.sf)}})
      if (freq==='hourly') bindMinRingEvents()
      else if (freq==='once') bindOnceEvents()
      else if (!['custom','once','hourly'].includes(freq)) bindClockEvents()
      bindDayChipEvents()
    },
    getSchedule: function() {
      if(freq==='custom')return{freq:'custom',cronExpr:(document.getElementById('fCustomCron')&&document.getElementById('fCustomCron').value||'').trim(),rrule:''}
      if(freq==='once')return{freq:'once',scheduledAt:document.getElementById('schedDatetime')&&document.getElementById('schedDatetime').value||'',cronExpr:'',rrule:''}
      if(freq==='hourly')return{freq:'hourly',cronExpr:m+' * * * *',rrule:'FREQ=HOURLY;INTERVAL=1'}
      if(freq==='daily')return{freq:'daily',cronExpr:m+' '+h+' * * *',rrule:'FREQ=DAILY;INTERVAL=1;BYHOUR='+h+';BYMINUTE='+m}
      if(freq==='weekdays')return{freq:'weekdays',cronExpr:m+' '+h+' * * '+days.join(','),rrule:'FREQ=WEEKLY;INTERVAL=1;BYDAY='+days.map(function(d){return{1:'MO',2:'TU',3:'WE',4:'TH',5:'FR',6:'SA',0:'SU'}[d]}).filter(Boolean).join(',')+';BYHOUR='+h+';BYMINUTE='+m,days:[].concat(days)}
      if(freq==='weekly'){var DR={1:'MO',2:'TU',3:'WE',4:'TH',5:'FR',6:'SA',0:'SU'},rd=days.map(function(d){return DR[d]}).filter(Boolean).join(',')
        return{freq:'weekly',cronExpr:m+' '+h+' * * '+days.join(','),rrule:'FREQ=WEEKLY;INTERVAL=1;BYDAY='+rd+';BYHOUR='+h+';BYMINUTE='+m,days:[].concat(days)}}
      return{freq:'daily',cronExpr:'0 9 * * *',rrule:'FREQ=DAILY;INTERVAL=1;BYHOUR=9'}
    },
  }
}


// ══════════════════════════════════════
//  创建 / 编辑 Modal（自包含事件）
// ══════════════════════════════════════

let _modalRoot = null
let _editingId = null
let _scheduleCtrl = null // ScheduleController

function openCreateModal() {
  _editingId = null; _scheduleCtrl = createSchedulePanel('daily', 9, 0)
  showModalForm('\u65B0\u5EFA\u5B9A\u65F6\u4EFB\u52A1')
}

function openEditModal(id) {
  const task = _tasks.find(t => t.id === id)
  if (!task) { toast('\u4EFB\u52A1\u4E0D\u5B58\u5728', 'error'); return }
  _editingId = id

  // 从已有数据反推频率设置
  let freq = 'daily', h = 9, m = 0, dow = [1,2,3,4,5], cronStr = ''
  if (task.rrule) {
    try {
      const p = {}
      for (const s of task.rrule.toUpperCase().split(';')) { const [k,v]=s.split('='); if(k)p[k.trim()]=v }
      const f = p.FREQ||''
      h = parseInt(p.BYHOUR||'9',10); m = parseInt(p.BYMINUTE||'0',10)
      if (f==='HOURLY') { freq='hourly' }
      else if (f==='DAILY') { freq='daily' }
      else if (f==='WEEKLY' && p.BYDAY) {
        const dm={'MO':1,'TU':2,'WE':3,'TH':4,'FR':5,'SA':6,'SU':0}
        dow = p.BYDAY.split(',').map(d=>dm[d.trim()]).filter(x=>x!=null).length
          ? p.BYDAY.split(',').map(d=>dm[d.trim()]).filter(x=>x!=null) : [1,2,3,4,5]
        freq = dow.length >= 5 ? 'weekdays' : 'weekly'
      }
    } catch {}
  } else if (task.scheduled_at) {
    freq = 'once'
  }
  _scheduleCtrl = createSchedulePanel(freq, h, m, dow)
  showModalForm('\u7F16\u8F91\u5B9A\u65F6\u4EFB\u52A1', task)
}

function showModalForm(title, existing = null) {
  const name = existing?.name || '', prompt = existing?.prompt || ''
  const workspace = existing?.workspace || '', maxDur = existing?.max_duration_minutes || 30
  const isOnce = existing?.schedule_type === 'once'
  const schedAt = existing?.scheduled_at || ''

  _modalRoot = document.createElement('div')
  _modalRoot.className = 'cron-modal-overlay'
  _modalRoot.innerHTML = `
    <div class="cron-modal">
      <div class="cron-modal-header">
        <h2 class="cron-modal-title">${esc(title)}</h2>
        <button class="cron-modal-close" id="modalCloseBtn">\u2715</button>
      </div>

      <div class="cron-form-group">
        <label class="cron-label">\u4EFB\u52A1\u540D\u79F0 *</label>
        <input class="cron-input" id="fName" value="${esc(name)}" placeholder="\u4F8B\uFF1A\u6BCF\u65E5\u5065\u5EB7\u68C0\u67E5" />
      </div>

      <div class="cron-form-group">
        <label class="cron-label">\u4EFB\u52A1\u63CF\u8FF0 (Prompt) *</label>
        <textarea class="cron-textarea" id="fPrompt" placeholder="\u63CF\u8FF0\u6BCF\u6B21\u6267\u884C\u65F6\u9700\u8981\u505A\u4EC0\u4E48...">${esc(prompt)}</textarea>
      </div>

      <div class="cron-form-group">
        <label class="cron-label">\u8C03\u5EA6\u8BBE\u7F6E</label>
        <div id="scheduleContainer">${_scheduleCtrl.html}</div>
      </div>

      <div class="cron-form-row">
        <div class="cron-form-group">
          <label class="cron-label">\u5DE5\u4F5C\u76EE\u5F55</label>
          <input class="cron-input" id="fWorkspace" value="${esc(workspace)}" placeholder="(\u53EF\u9009)" />
        </div>
        <div class="cron-form-group">
          <label class="cron-label">\u8D85\u65F6(\u5206\u949F)</label>
          <input class="cron-input" id="fMaxDuration" type="number" value="${maxDur}" min="1" max="1440" />
        </div>
      </div>

      <div class="cron-modal-footer">
        <button class="cron-btn" id="modalCancelBtn">\u53D6\u6D88</button>
        <button class="cron-btn primary" id="modalSaveBtn">${existing ? '\u4FDD\u5B58\u4FEE\u6539' : '\u521B\u5EFA\u4EFB\u52A1'}</button>
      </div>
    </div>
  `

  document.body.appendChild(_modalRoot)

  // 自包含事件绑定 —— 不依赖页面委托！
  _scheduleCtrl.initEvents(_modalRoot)

  // 关闭按钮
  _modalRoot.querySelector('#modalCloseBtn').onclick = () => closeModals()
  _modalRoot.querySelector('#modalCancelBtn').onclick = () => closeModals()

  // 保存按钮
  _modalRoot.querySelector('#modalSaveBtn').onclick = async () => await saveFromForm()

  // 点击遮罩关闭
  _modalRoot.addEventListener('click', e => {
    if (e.target === _modalRoot) closeModals()
  })

  // ESC 关闭
  const escHandler = (e) => { if (e.key === 'Escape') { closeModals(); document.removeEventListener('keydown', escHandler) } }
  document.addEventListener('keydown', escHandler)
}

async function saveFromForm() {
  const name = document.getElementById('fName').value.trim()
  const prompt = document.getElementById('fPrompt').value.trim()
  if (!name) { toast('\u8BF7\u8F93\u5165\u4EFB\u52A1\u540D\u79F0', 'warn'); return }
  if (!prompt) { toast('\u8BF7\u8F93\u5165\u4EFB\u52A1\u63CF\u8FF0', 'warn'); return }

  const workspace = document.getElementById('fWorkspace').value.trim() || null
  const maxDuration = parseInt(document.getElementById('fMaxDuration').value, 10) || 30
  const sched = _scheduleCtrl.getSchedule()
  console.log('[cron] getSchedule result:', JSON.stringify(sched))

  // 将内部 freq 映射为 API 需要的 schedule_type
  var apiData = {
    id: _editingId || undefined,
    name: name,
    prompt: prompt,
    workspace: workspace,
    max_duration_minutes: maxDuration,
    schedule_type: (sched.freq === 'once') ? 'once' : 'recurring',
    rrule: sched.rrule || '',
    schedule: sched.cronExpr || '',
    days: sched.days || undefined,
  }
  // 一次性模式用 scheduled_at 字段；非一次性必须清空，防止旧值残留
  if (sched.freq === 'once' && sched.scheduledAt) {
    apiData.scheduled_at = sched.scheduledAt
  } else {
    apiData.scheduled_at = null
  }

  console.log('[cron] sending apiData:', JSON.stringify(apiData))

  try {
    if (_editingId) {
      const updateRes = await api.automationUpdate(apiData)
      console.log('[cron] automationUpdate response:', JSON.stringify(updateRes))
      toast('\u5DF2\u66F4\u65B0', 'success')
    } else {
      await api.automationCreate(apiData); toast('\u521B\u5EFA\u6210\u529F', 'success')
    }
    closeModals(); await refresh()
  } catch (err) { toast(`\u4FDD\u5B58\u5931\u8D25: ${err.message}`, 'error') }
}

function closeModals() { if (_modalRoot) { _modalRoot.remove(); _modalRoot = null; _scheduleCtrl = null } }


// ══════════════════════════════════════
//  History Panel（自包含事件）
// ══════════════════════════════════════

let _historyRoot = null

async function openHistory(id) {
  const task = _tasks.find(t => t.id === id); if (!task) return
  let runs = []
  try { const res = await api.automationHistory(id, 50); runs = res.runs || [] } catch {}

  const STATUS_COLOR = { success: 'var(--success)', fail: 'var(--error)', timeout: 'var(--warning)' }

  _historyRoot = document.createElement('div')
  _historyRoot.className = 'cron-history-overlay'
  _historyRoot.innerHTML = `
    <div class="cron-history-panel">
      <div class="cron-modal-header">
        <div>
          <h2 class="cron-modal-title">\u6267\u884C\u5386\u53F2 \u2014 ${esc(task.name)}</h2>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px;">ID: ${id} \u00B7 \u5171 ${runs.length} \u6761\u8BB0\u5F55</div>
        </div>
        <button class="cron-modal-close" id="histCloseBtn">\u2715</button>
      </div>
      ${runs.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--text-tertiary);">
             <div style="font-size:36px;margin-bottom:10px;">\u{1F4ED}</div>
             \u6682\u65E0\u6267\u884C\u8BB0\u5F55
           </div>`
        : `<div style="margin-top:12px;">${runs.map(r => {
              const ic = r.status === 'success' ? 'ok' : (r.status === 'timeout' ? 'timeout' : 'fail')
              const tm = r.started_at ? new Date(r.started_at).toLocaleString('zh-CN') : '-'
              const out = r.output || '(\u65E0\u8F93\u51FA)'
              const err = r.error ? `\n\u274C Error: ${r.error}` : ''
              return `
                <div class="cron-history-item">
                  <span class="cron-history-status ${ic}"></span>
                  <div>
                    <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:4px;">
                      <span class="cron-history-time">${tm}</span>
                      <span style="font-size:11.5px;font-weight:600;text-transform:uppercase;color:${STATUS_COLOR[r.status]||STATUS_COLOR.fail}">${r.status}</span>
                    </div>
                    <div class="cron-history-output">${esc(out)}${esc(err)}</div>
                    <div style="font-size:11px;color:var(--text-tertiary);margin-top:3px;">
                      \u89E6\u53D1\u65B9\u5F0F: ${r.trigger_type||'-'} \u00B7 \u8017\u65F6: ${r.duration_seconds||0}s
                    </div>
                  </div>
                </div>`
            }).join('')}</div>`}
    </div>
  `
  document.body.appendChild(_historyRoot)
  _historyRoot.querySelector('#histCloseBtn').onclick = () => closeHistory()
  _historyRoot.addEventListener('click', e => { if (e.target === _historyRoot) closeHistory() })
}

function closeHistory() { if (_historyRoot) { _historyRoot.remove(); _historyRoot = null } }
