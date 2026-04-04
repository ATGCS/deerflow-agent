/** 设置中心：左侧导航图标与 Tab 元信息 */

export const NAV_ICONS = {
  general:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
  models:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
  im: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  memory:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
}

/** 左侧导航短标题（右侧标题区仍用 TAB_META.title） */
export const NAV_LABELS = {
  general: '通用',
  models: '模型',
  im: 'IM 通信',
  mail: '邮箱',
  memory: '记忆',
}

export const TAB_META = {
  general: { title: '通用', desc: '浅色 / 深色 / 跟随系统。' },
  models: { title: '模型配置', desc: '服务商、API Key、模型列表与主模型。' },
  im: { title: '消息渠道', desc: '飞书、Slack、Telegram 等 IM 对接。' },
  mail: { title: '邮箱 / SMTP', desc: '发信参数，保存至本机配置。' },
  memory: { title: '记忆管理', desc: '智能体记忆文件与持久化上下文。' },
}

export const ALLOWED_TABS = Object.keys(TAB_META)

export function parseTabFromLocation() {
  const h = window.location.hash.slice(1) || ''
  const path = h.split('?')[0]
  if (path !== '/settings') return 'general'
  const q = h.includes('?') ? h.split('?')[1] : ''
  const tab = new URLSearchParams(q).get('tab')
  return tab && ALLOWED_TABS.includes(tab) ? tab : 'general'
}
