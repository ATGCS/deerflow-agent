/** 会话列表项（与 Gateway / tauri-api 返回对齐） */
export interface ChatSessionRow {
  sessionKey: string
  messageCount?: number
  /** 与旧版 chat.js 对齐的排序/展示字段（可能由 backend 返回） */
  updatedAt?: number
  lastActivity?: number
  createdAt?: number
  /** 旧版兼容字段名 */
  messages?: number
}

/** 与工具交错展示：先文本再工具再文本…（刷新历史与流式一致） */
export type MessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tools'; ids: string[] }

/** 消息区一行（含流式伪行 _stream） */
export interface DisplayRow {
  role: 'user' | 'assistant' | 'system' | '_stream'
  text?: string
  /** 存在时优先按此顺序渲染正文与工具，避免「全文在上、工具全在下」 */
  segments?: MessageSegment[]
  tools?: unknown[]
  images?: unknown[]
  videos?: unknown[]
  audios?: unknown[]
  files?: unknown[]
  timestamp?: number
  durationStr?: string
  tokenStr?: string
}

export interface TokenTotals {
  input: number
  output: number
  total: number
}

/** 与 ChatApp streamRef 一致 */
export interface StreamState {
  runId: string | null
  /** 已封存的文本 / 工具块（当前轮内交错顺序） */
  segments: MessageSegment[]
  /** 当前段落后缀（流式正文，尚未封存到 segments） */
  text: string
  tools: unknown[]
  images: unknown[]
  videos: unknown[]
  audios: unknown[]
  files: unknown[]
  startTs: number | null
}

export interface ChatWsPayload {
  sessionKey?: string
  state?: string
  runId?: string
  message?: unknown
  durationMs?: number
  errorMessage?: string
  error?: { message?: string }
}

export interface ChatAttachment {
  mimeType: string
  content: string
}

export interface ThreadTodo {
  content?: unknown
  status?: string
}

export interface ThreadClarification {
  toolCallId?: string
  preview?: string
}

export interface ThreadPanelState {
  title: string | null
  todos: ThreadTodo[]
  activityKind: string
  activityDetail: string
  reasoningPreview: string | null
  clarification: ThreadClarification | null
}
