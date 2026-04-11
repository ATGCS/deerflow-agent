/**
 * 与 chat.js 对齐的历史归一、流式内容提取（供 React 聊天与单测复用）。
 * 不依赖页面级全局变量（如 _toolEventTimes）。
 */

import { formatToolDisplayTitle } from './tool-display.js'

export const CHAT_MAIN_SESSION_KEY = 'agent:main:main'

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function stripAnsi(text) {
  if (!text) return ''
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

/** 去掉模型/协作侧注入的「身份、协作阶段」等行（非 XML，仅行首匹配） */
export function stripAgentMetaLines(text) {
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

export function stripThinkingTags(text) {
  const safe = stripAnsi(text)
  const stripped = safe
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, '')
    .replace(/\[Queued messages while agent was busy\]\s*---\s*Queued #\d+\s*/gi, '')
    /* CollabPhaseMiddleware 注入，仅供模型用，不在 UI 展示 */
    .replace(/<\s*collab_phase_context\s*>[\s\S]*?<\s*\/\s*collab_phase_context\s*>/gi, '')
    .trim()
  return stripAgentMetaLines(stripped)
}

export function normalizeTime(raw) {
  if (!raw) return null
  if (raw instanceof Date) return raw.getTime()
  if (typeof raw === 'string') {
    const num = Number(raw)
    if (!Number.isNaN(num)) return normalizeTime(num)
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof raw === 'number' && raw < 1e12) return raw * 1000
  return raw
}

function resolveToolTime(_toolId, messageTimestamp) {
  return normalizeTime(messageTimestamp) || null
}

/** 将工具参数统一为对象/原始值；字符串 `"{}"` 视为空 */
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

/** 从流式/多形态 entry 上解析工具名（供 upsert 合并时写回 target.name） */
function resolveEntryToolName(entry) {
  if (!entry || typeof entry !== 'object') return null
  const n = entry.name ?? entry.tool_name ?? entry.toolName
  if (n != null && String(n).trim()) return String(n).trim()
  const fn = entry.function && typeof entry.function === 'object' ? entry.function.name : null
  if (fn != null && String(fn).trim()) return String(fn).trim()
  return null
}

/** 合并流式/多事件中的工具参数（先到的 {} 不应挡住后到的完整 args） */
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

export function upsertTool(tools, entry) {
  if (!entry) return
  const id = entry.id || entry.tool_call_id
  let target = null
  if (id) target = tools.find((t) => t.id === id || t.tool_call_id === id)
  /* 有 id 却未命中时必须是新工具，禁止按 name 合并到上一条（多段 write_file 会同名） */
  if (!target && entry.name && !id) {
    target = tools.find((t) => t.name === entry.name && !t.output)
    if (!target) target = tools.find((t) => t.name === entry.name && isEmptyToolInput(t.input))
  }
  if (target) {
    const nextName = resolveEntryToolName(entry)
    if (nextName) target.name = nextName
    if (entry.input != null) target.input = mergeToolInput(target.input, entry.input)
    if (entry.output != null) target.output = entry.output
    if (entry.status) target.status = entry.status
    if (entry.time) target.time = entry.time
    return
  }
  tools.push({ ...entry })
}

export function collectToolsFromMessage(message, tools) {
  if (!message || !tools) return
  const toolCalls = message.tool_calls || message.toolCalls || message.tools
  if (Array.isArray(toolCalls)) {
    toolCalls.forEach((call) => {
      const fn = call.function || null
      const name = call.name || call.tool || call.tool_name || fn?.name
      let input =
        call.input || call.args || call.parameters || call.arguments || fn?.arguments || null
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
    toolResults.forEach((res) => {
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

function isToolResultMessage(msg) {
  if (!msg || typeof msg !== 'object') return false
  return (
    msg.role === 'tool' ||
    msg.role === 'toolResult' ||
    msg.type === 'tool' ||
    msg.type === 'tool_message'
  )
}

export function extractContent(msg) {
  const tools = []
  collectToolsFromMessage(msg, tools)
  if (isToolResultMessage(msg)) {
    const output = typeof msg.content === 'string' ? msg.content : null
    if (!tools.length) {
      upsertTool(tools, {
        id: msg.tool_call_id || msg.toolCallId || msg.id,
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
    const texts = []
    const images = []
    const videos = []
    const audios = []
    const files = []
    for (const block of msg.content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      else if (block.type === 'image' && !block.omitted) {
        if (block.data) images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        else if (block.source?.type === 'base64' && block.source.data)
          images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        else if (block.url || block.source?.url)
          images.push({ url: block.url || block.source.url, mediaType: block.mimeType || 'image/png' })
      } else if (block.type === 'image_url' && block.image_url?.url) {
        images.push({ url: block.image_url.url, mediaType: 'image/png' })
      } else if (block.type === 'video') {
        if (block.data) videos.push({ mediaType: block.mimeType || 'video/mp4', data: block.data })
        else if (block.url) videos.push({ url: block.url, mediaType: block.mimeType || 'video/mp4' })
      } else if (block.type === 'audio' || block.type === 'voice') {
        if (block.data)
          audios.push({
            mediaType: block.mimeType || 'audio/mpeg',
            data: block.data,
            duration: block.duration,
          })
        else if (block.url)
          audios.push({ url: block.url, mediaType: block.mimeType || 'audio/mpeg', duration: block.duration })
      } else if (block.type === 'file' || block.type === 'document') {
        files.push({
          url: block.url || '',
          name: block.fileName || block.name || '文件',
          mimeType: block.mimeType || '',
          size: block.size,
          data: block.data,
        })
      } else if (
        block.type === 'tool' ||
        block.type === 'tool_use' ||
        block.type === 'tool_call' ||
        block.type === 'toolCall'
      ) {
        const callId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: callId,
          name: block.name || block.tool || block.tool_name || block.toolName || '工具',
          input: block.input || block.args || block.parameters || block.arguments || null,
          output: null,
          status: block.status || 'ok',
          time: resolveToolTime(callId, msg.timestamp),
        })
      } else if (block.type === 'tool_result' || block.type === 'toolResult') {
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
      tools.forEach((t) => {
        if (typeof t.input === 'string') t.input = stripAnsi(t.input)
        if (typeof t.output === 'string') t.output = stripAnsi(t.output)
      })
    }
    const mediaUrls = msg.mediaUrls || (msg.mediaUrl ? [msg.mediaUrl] : [])
    for (const url of mediaUrls) {
      if (!url) continue
      if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) videos.push({ url, mediaType: 'video/mp4' })
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url))
        audios.push({ url, mediaType: 'audio/mpeg' })
      else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url))
        images.push({ url, mediaType: 'image/png' })
      else files.push({ url, name: url.split('/').pop().split('?')[0] || '文件', mimeType: '' })
    }
    return {
      text: stripThinkingTags(texts.join('\n')),
      images,
      videos,
      audios,
      files,
      tools,
    }
  }
  const text = typeof msg.text === 'string' ? msg.text : typeof msg.content === 'string' ? msg.content : ''
  return { text: stripThinkingTags(text), images: [], videos: [], audios: [], files: [], tools }
}

/** LangGraph checkpoint 里部分中间件会用 HumanMessage 注入提醒（Anthropic 限制下不能插 System），刷新后若仍当 user 会占满「用户气泡」。 */
function peekRawTextForRoleHint(msg) {
  const c = msg?.content
  if (typeof c === 'string') return c.trimStart()
  /* 少数序列化形态：content 为单对象且带 text（非标准数组块） */
  if (c && typeof c === 'object' && !Array.isArray(c) && typeof c.text === 'string') return c.text.trimStart()
  if (Array.isArray(c)) {
    const texts = []
    for (const block of c) {
      if (typeof block === 'string') {
        texts.push(block)
        continue
      }
      if (!block || typeof block !== 'object') continue
      if (typeof block.text === 'string') {
        texts.push(block.text)
        continue
      }
      if (typeof block.content === 'string') {
        texts.push(block.content)
      }
    }
    return texts.join('\n').trimStart()
  }
  return ''
}

const INJECTED_HUMAN_MESSAGE_NAMES = new Set([
  'todo_reminder',
  'collab_phase_hint',
  'conversation_summary',
])

/** LangChain SummarizationMiddleware 注入的 HumanMessage（无 name 的旧 checkpoint 仍靠前缀识别） */
function isHandoffSummaryHumanContent(head) {
  const s = typeof head === 'string' ? head.trimStart().toLowerCase() : ''
  return (
    s.startsWith('here is a summary of the conversation to date') ||
    s.startsWith("here's a summary of the conversation to date")
  )
}

function isInjectedHumanUiMessage(msg) {
  if (!msg || typeof msg !== 'object') return false
  const n = msg.name != null ? String(msg.name).trim() : ''
  if (n && INJECTED_HUMAN_MESSAGE_NAMES.has(n)) return true
  const head = peekRawTextForRoleHint(msg)
  if (head.startsWith('[LOOP DETECTED]') || head.startsWith('[FORCED STOP]')) return true
  if (isHandoffSummaryHumanContent(head)) return true
  return false
}

export function normalizeHistoryRole(msg) {
  if (!msg || typeof msg !== 'object') return 'assistant'
  if (msg.role === 'tool' || msg.role === 'toolResult') return 'assistant'
  if (msg.role === 'user') return isInjectedHumanUiMessage(msg) ? 'system' : 'user'
  if (msg.role === 'assistant') return 'assistant'
  if (isInjectedHumanUiMessage(msg)) return 'system'
  const t = msg.type
  const tLower = typeof t === 'string' ? t.toLowerCase() : ''
  if (tLower === 'human' || tLower === 'humanmessage' || t === 'user') return 'user'
  if (t === 'ai' || t === 'AIMessage' || t === 'AIMessageChunk' || t === 'assistant') return 'assistant'
  if (t === 'tool' || t === 'tool_message') return 'assistant'
  if (t === 'system') return 'assistant'
  return 'assistant'
}

function toolEntryId(t) {
  return String(t.id || t.tool_call_id || '')
}

function buildInitialSegments(c, tools) {
  const segs = []
  if (c?.text) segs.push({ kind: 'text', text: c.text })
  const ids = (tools || []).map((t) => toolEntryId(t)).filter(Boolean)
  if (ids.length) segs.push({ kind: 'tools', ids })
  return segs.length ? segs : undefined
}

/** 交错 segments + 尾部流式文本 → 单行全文（元数据 / 旧逻辑用） */
export function flattenStreamDisplayText(segments, tailText) {
  const parts = []
  for (const s of segments || []) {
    if (s.kind === 'text' && s.text) parts.push(s.text)
  }
  if (tailText) parts.push(tailText)
  return parts.join('\n')
}

export function dedupeHistory(messages) {
  const deduped = []
  const seenMessageIds = new Set()
  const normalizeAssistantText = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  for (const msg of messages) {
    const msgId = msg && typeof msg === 'object' ? (msg.id || msg.message_id || msg.messageId) : null
    if (msgId) {
      const key = String(msgId)
      if (seenMessageIds.has(key)) continue
      seenMessageIds.add(key)
    }
    const role = normalizeHistoryRole(msg)
    /* 中间件注入的 human 会归一为 system；MessageRow 仍会渲染 msg-system，对用户等于「还是看到一大段」——直接不出现在列表里 */
    if (role === 'system') continue
    const c = extractContent(msg)
    if (!c.text && !c.images.length && !c.videos.length && !c.audios.length && !c.files.length && !c.tools.length)
      continue
    /* 角色判定漏网时：已抽出正文仍明显是 LangChain 摘要，不展示 */
    if (role === 'user' && isHandoffSummaryHumanContent(String(c.text || '').trimStart())) continue
    const tools = (c.tools || []).map((t) => {
      const id = t.id || t.tool_call_id
      const time = t.time || resolveToolTime(id, msg.timestamp)
      return { ...t, time, messageTimestamp: msg.timestamp }
    }).filter((t) => {
      const name = String(t?.name || '').trim()
      const status = String(t?.status || '').toLowerCase()
      const hasOutput = !(t?.output == null || t?.output === '')
      const hasInput = !(t?.input == null || t?.input === '' || (typeof t?.input === 'object' && !Array.isArray(t?.input) && Object.keys(t.input || {}).length === 0))
      // 过滤“占位型工具项”：名称是默认“工具” + running + 无输入无输出。
      // 这些通常是流式中间态，不应在历史落库里作为独立工具块展示。
      if ((name === '工具' || !name) && (status === 'running' || status === 'in_progress') && !hasInput && !hasOutput) {
        return false
      }
      return true
    })
    const last = deduped[deduped.length - 1]
    if (last && last.role === role) {
      if (role === 'user' && last.text === c.text) continue
      if (role === 'assistant') {
        if (c.text && last.text === c.text) continue
        const prevIds = new Set((last.tools || []).map((t) => toolEntryId(t)))
        const newIds = []
        for (const t of tools) {
          const id = toolEntryId(t)
          if (id && !prevIds.has(id)) {
            newIds.push(id)
            prevIds.add(id)
          }
        }
        if (c.text) {
          const prevText = String(last.text || '')
          const nextText = String(c.text || '')
          const prevNorm = normalizeAssistantText(prevText)
          const nextNorm = normalizeAssistantText(nextText)
          let textChanged = false
          // Web 工程做法：assistant 的累计快照应“覆盖更新”，而不是不断 append 造成重复。
          // - next 包含 prev：用 next 覆盖
          // - prev 包含 next：忽略更短旧快照
          // - 其他情况：才按段落追加（保留语义差异）
          if (!prevText) {
            last.text = nextText
            textChanged = Boolean(nextNorm)
          } else if (nextText && nextText.startsWith(prevText)) {
            last.text = nextText
            textChanged = Boolean(nextNorm)
            // 覆盖型更新不再重复写入 segments，避免历史回放出现“同一段话两遍”
          } else if (prevText && prevText.startsWith(nextText)) {
            // ignore
          } else if (nextNorm && prevNorm && nextNorm.includes(prevNorm)) {
            // 处理“文案有轻微空白/换行差异，但本质是 next 覆盖 prev”的情况。
            last.text = nextText
            textChanged = true
          } else if (nextNorm && prevNorm && prevNorm.includes(nextNorm)) {
            // ignore
          } else {
            last.text = [prevText, nextText].filter(Boolean).join('\n')
            textChanged = Boolean(nextNorm)
          }
          if (textChanged) {
            if (!last.segments) last.segments = []
            const prevSeg = last.segments[last.segments.length - 1]
            if (prevSeg && prevSeg.kind === 'text') {
              const prevSegNorm = normalizeAssistantText(prevSeg.text)
              if (nextNorm && prevSegNorm && nextNorm.startsWith(prevSegNorm)) {
                prevSeg.text = nextText
              } else if (nextNorm && prevSegNorm && prevSegNorm.startsWith(nextNorm)) {
                // ignore
              } else if (nextNorm && prevSegNorm && nextNorm === prevSegNorm) {
                // ignore
              } else {
                last.segments.push({ kind: 'text', text: nextText })
              }
            } else {
              last.segments.push({ kind: 'text', text: nextText })
            }
          }
        }
        for (const t of tools) {
          upsertTool(last.tools, t)
        }
        if (newIds.length) {
          if (!last.segments) last.segments = []
          last.segments.push({ kind: 'tools', ids: newIds })
        }
        last.images = [...(last.images || []), ...c.images]
        last.videos = [...(last.videos || []), ...c.videos]
        last.audios = [...(last.audios || []), ...c.audios]
        last.files = [...(last.files || []), ...c.files]
        continue
      }
    }
    deduped.push({
      role,
      text: c.text,
      images: c.images,
      videos: c.videos,
      audios: c.audios,
      files: c.files,
      tools,
      segments: buildInitialSegments(c, tools),
      timestamp: msg.timestamp,
    })
  }
  return deduped
}

export function normalizeChatToolPayloadToEntries(payload) {
  const tupleUnwrap = (x) => {
    if (!Array.isArray(x)) return x
    if (x.length === 2 && x[1] && typeof x[1] === 'object' && !Array.isArray(x[1])) return x[1]
    if (x.length === 1 && x[0] && typeof x[0] === 'object' && !Array.isArray(x[0])) return x[0]
    return x
  }
  const root = tupleUnwrap(payload)
  const msg = tupleUnwrap(payload?.message)
  const data = tupleUnwrap(payload?.data)
  const d =
    (data && typeof data === 'object' && !Array.isArray(data) && data) ||
    (msg && typeof msg === 'object' && !Array.isArray(msg) && msg) ||
    (root && typeof root === 'object' && !Array.isArray(root) && root) ||
    {}
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
          /* keep */
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
  return [
    {
      id: toolCallId || uuid(),
      name: nameHint,
      input,
      output: output !== undefined ? output : undefined,
      status,
    },
  ]
}

export function extractChatContent(message) {
  if (!message || typeof message !== 'object') return null
  const tools = []
  collectToolsFromMessage(message, tools)
  if (isToolResultMessage(message)) {
    const output = typeof message.content === 'string' ? message.content : null
    if (!tools.length) {
      tools.push({
        id: message.tool_call_id || message.toolCallId || message.id,
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
  if (typeof content === 'string')
    return { text: stripThinkingTags(content), images: [], videos: [], audios: [], files: [], tools }
  if (Array.isArray(content)) {
    const texts = []
    const images = []
    const videos = []
    const audios = []
    const files = []
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      else if (block.type === 'image' && !block.omitted) {
        if (block.data) images.push({ mediaType: block.mimeType || 'image/png', data: block.data })
        else if (block.source?.type === 'base64' && block.source.data)
          images.push({ mediaType: block.source.media_type || 'image/png', data: block.source.data })
        else if (block.url || block.source?.url)
          images.push({ url: block.url || block.source.url, mediaType: block.mimeType || 'image/png' })
      } else if (block.type === 'image_url' && block.image_url?.url) {
        images.push({ url: block.image_url.url, mediaType: 'image/png' })
      } else if (block.type === 'video') {
        if (block.data) videos.push({ mediaType: block.mimeType || 'video/mp4', data: block.data })
        else if (block.url) videos.push({ url: block.url, mediaType: block.mimeType || 'video/mp4' })
      } else if (block.type === 'audio' || block.type === 'voice') {
        if (block.data)
          audios.push({
            mediaType: block.mimeType || 'audio/mpeg',
            data: block.data,
            duration: block.duration,
          })
        else if (block.url)
          audios.push({ url: block.url, mediaType: block.mimeType || 'audio/mpeg', duration: block.duration })
      } else if (block.type === 'file' || block.type === 'document') {
        files.push({
          url: block.url || '',
          name: block.fileName || block.name || '文件',
          mimeType: block.mimeType || '',
          size: block.size,
          data: block.data,
        })
      } else if (
        block.type === 'tool' ||
        block.type === 'tool_use' ||
        block.type === 'tool_call' ||
        block.type === 'toolCall'
      ) {
        const callId = block.id || block.tool_call_id || block.toolCallId
        upsertTool(tools, {
          id: callId,
          name: block.name || block.tool || block.tool_name || block.toolName || '工具',
          input: block.input || block.args || block.parameters || block.arguments || null,
          output: null,
          status: block.status || 'ok',
          time: resolveToolTime(callId, message.timestamp),
        })
      } else if (block.type === 'tool_result' || block.type === 'toolResult') {
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
      tools.forEach((t) => {
        if (typeof t.input === 'string') t.input = stripAnsi(t.input)
        if (typeof t.output === 'string') t.output = stripAnsi(t.output)
      })
    }
    const mediaUrls = message.mediaUrls || (message.mediaUrl ? [message.mediaUrl] : [])
    for (const url of mediaUrls) {
      if (!url) continue
      if (/\.(mp4|webm|mov|mkv)(\?|$)/i.test(url)) videos.push({ url, mediaType: 'video/mp4' })
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(url))
        audios.push({ url, mediaType: 'audio/mpeg' })
      else if (/\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url))
        images.push({ url, mediaType: 'image/png' })
      else files.push({ url, name: url.split('/').pop().split('?')[0] || '文件', mimeType: '' })
    }
    const text = texts.length ? stripThinkingTags(texts.join('\n')) : ''
    return { text, images, videos, audios, files, tools }
  }
  if (typeof message.text === 'string')
    return { text: stripThinkingTags(message.text), images: [], videos: [], audios: [], files: [], tools: [] }
  return null
}

/** LangGraph 流式：单调合并展示文本（与 ws-client 一致） */
export function accumulateStreamAssistantText(prev, incoming) {
  if (incoming == null || incoming === '') return prev || ''
  const inc = typeof incoming === 'string' ? incoming : ''
  if (!inc) return prev || ''
  if (!prev) return inc
  // 有些链路会重复发送同一段增量，避免重复追加
  if (prev.endsWith(inc)) return prev
  /* 丢弃比当前更短的旧快照，避免与增量拼接成重复段落 */
  if (inc.length < prev.length && prev.startsWith(inc)) return prev
  if (inc.length >= prev.length && inc.startsWith(prev)) return inc
  return prev + inc
}

export function pickUsageObject(source) {
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
  return candidates.find((x) => x && typeof x === 'object') || null
}

export function parseUsageToStats(raw) {
  const usage = pickUsageObject(raw) || raw
  if (!usage || typeof usage !== 'object') return null
  const input =
    Number(
      usage.input_tokens ??
        usage.prompt_tokens ??
        usage.promptTokens ??
        usage.inputTokenCount ??
        0,
    ) || 0
  const output =
    Number(
      usage.output_tokens ??
        usage.completion_tokens ??
        usage.completionTokens ??
        usage.outputTokenCount ??
        0,
    ) || 0
  const total =
    Number(usage.total_tokens ?? usage.totalTokenCount ?? usage.totalTokens ?? input + output) || 0
  if (!total) return null
  return { input, output, total }
}

export function isToolRunning(tool) {
  if (!tool) return false
  const hasOutput = !(tool.output == null || tool.output === '')
  if ((tool.status === 'running' || tool.status === 'in_progress') && !hasOutput) return true
  return false
}

export function toolLabel(tool) {
  return formatToolDisplayTitle(tool)
}

export function safeStringify(value) {
  if (value == null) return ''
  const seen = new WeakSet()
  try {
    return JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === 'bigint') return val.toString()
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      },
      2,
    )
  } catch {
    try {
      return String(value)
    } catch {
      return ''
    }
  }
}

/**
 * 工具入参/出参展示：字符串若可解析为 JSON（对象/数组/合法 JSON 字面量）则格式化为缩进文本，否则原样；非字符串走 safeStringify。结果统一 stripAnsi，与原先展示行为一致。
 */
export function formatToolDisplayValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') {
    const s = stripAnsi(value)
    const t = s.trim()
    if (!t) return ''
    try {
      const parsed = JSON.parse(t)
      return stripAnsi(safeStringify(parsed))
    } catch {
      return s
    }
  }
  return stripAnsi(safeStringify(value))
}

export function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** checkpoint messages → 展示行（已去重合并） */
export function messagesToDisplayRows(rawMessages) {
  const base = dedupeHistory(rawMessages || [])
  if (!base.length) return base
  const normalizeForDedupe = (text) => {
    const t = String(text || '')
      .replace(/```[\s\S]*?```/g, ' ') // 去掉代码块
      .replace(/\|[^\n]*\|/g, ' ') // 去掉表格行（粗略）
      .replace(/\*\*([^*]+)\*\*/g, '$1') // 粗略去掉加粗
      .replace(/[`*_#>-]+/g, ' ') // 去掉常见 markdown 符号
      .replace(/\s+/g, ' ')
      .trim()
    // 只对“明显是解释段落”的长文本做指纹去重，避免把合法的短回复（如 abc/ccc）误判为重复。
    if (t.length < 80) return ''
    // 用开头片段作为指纹：相同开头的“解释型回复”保留最新一条
    return t.slice(0, 120)
  }

  // 先做一次“完全相同连续项”去重（保守）
  const compact = []
  for (const row of base) {
    const last = compact[compact.length - 1]
    if (
      last &&
      row.role === 'assistant' &&
      last.role === 'assistant' &&
      row.text &&
      last.text &&
      row.text.trim() === last.text.trim()
    ) {
      continue
    }
    compact.push(row)
  }

  // 再做一次“同类解释保留最后一次”：倒序遍历，只保留最新出现的那条
  const seen = new Set()
  const outRev = []
  for (let i = compact.length - 1; i >= 0; i--) {
    const row = compact[i]
    if (
      row.role === 'assistant' &&
      row.text &&
      (!row.tools || row.tools.length === 0) &&
      (!row.images || row.images.length === 0) &&
      (!row.videos || row.videos.length === 0) &&
      (!row.audios || row.audios.length === 0) &&
      (!row.files || row.files.length === 0)
    ) {
      const fp = normalizeForDedupe(row.text)
      if (fp && seen.has(fp)) continue
      if (fp) seen.add(fp)
    }
    outRev.push(row)
  }
  outRev.reverse()
  return outRev
}
