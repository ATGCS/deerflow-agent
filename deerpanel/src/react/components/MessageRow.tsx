import { MarkdownHtml } from './MarkdownHtml.js'
import { ToolCallList } from './ToolCallList.js'
import { MessageMedia } from './MessageMedia.js'
import { SubagentInlineCards } from './SubagentLiveDock.js'
import type { DisplayRow, MessageSegment } from '../chat-types.js'

function formatTime(ts?: number) {
  const d = ts ? new Date(ts) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) return `${h}:${m}`
  const mon = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${mon}-${day} ${h}:${m}`
}

export function MessageRow({ row, isStreaming }: { row: DisplayRow; isStreaming?: boolean }) {
  if (row.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="msg-bubble">
          <MessageMedia images={row.images} videos={row.videos} audios={row.audios} files={row.files} />
          {row.text ? <div>{row.text}</div> : null}
        </div>
        <div className="msg-meta">
          <span className="msg-time">{formatTime(row.timestamp)}</span>
        </div>
      </div>
    )
  }

  if (row.role === 'assistant' || row.role === '_stream') {
    return (
      <div className={`msg msg-ai${isStreaming ? ' msg-ai-streaming' : ''}`}>
        <div className="msg-bubble">
          <AssistantBody row={row} isStreaming={isStreaming} />
          <MessageMedia images={row.images} videos={row.videos} audios={row.audios} files={row.files} />
        </div>
        {!isStreaming && (
          <div className="msg-meta">
            <span className="msg-time">{formatTime(row.timestamp)}</span>
            {row.durationStr ? (
              <>
                <span className="meta-sep">·</span>
                <span className="msg-duration">⏱ {row.durationStr}</span>
              </>
            ) : null}
            {row.tokenStr ? (
              <>
                <span className="meta-sep">·</span>
                <span className="msg-tokens">{row.tokenStr}</span>
              </>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="msg msg-system">
      <div className="msg-bubble">{row.text}</div>
    </div>
  )
}

function SubagentInlineBlock({
  tasks,
}: {
  tasks: NonNullable<DisplayRow['subagentTasks']>
}) {
  if (!tasks || !Object.keys(tasks).length) return null
  return (
    <div className="react-chat-subagent-inline" aria-label="子智能体并行输出">
      <p className="react-chat-subagent-inline__caption">子智能体 · 并行输出 · {Object.keys(tasks).length} 个任务</p>
      <SubagentInlineCards tasks={tasks} />
    </div>
  )
}

function AssistantBody({ row, isStreaming }: { row: DisplayRow; isStreaming?: boolean }) {
  const tools = row.tools || []
  const segments = row.segments as MessageSegment[] | undefined
  const text = row.text || ''
  const subTasks = row.subagentTasks

  if (segments?.length) {
    const segmentToolIds = new Set(
      segments.filter((s): s is MessageSegment & { kind: 'tools'; ids: string[] } => s.kind === 'tools').flatMap((s) => s.ids || []),
    )
    const orphanTools =
      isStreaming && tools.length
        ? tools.filter((t) => {
            const id = String((t as Record<string, unknown>).id || (t as Record<string, unknown>).tool_call_id || '')
            return !id || !segmentToolIds.has(id)
          })
        : []

    return (
      <>
        {segments.map((seg, i) => {
          if (seg.kind === 'text') {
            return <MarkdownHtml key={`seg-t-${i}`} text={seg.text} />
          }
          return <ToolCallList key={`seg-k-${i}`} tools={tools} filterIds={seg.ids} />
        })}
        {orphanTools.length > 0 ? <ToolCallList key="stream-tools-tail" tools={orphanTools} /> : null}
        {subTasks ? <SubagentInlineBlock tasks={subTasks} /> : null}
        {isStreaming ? <span className="stream-cursor" aria-hidden /> : null}
        {/* 历史消息：如果 segments 中没有 text 但 row.text 有内容，也要显示 */}
        {!isStreaming && text && !segments.some(s => s.kind === 'text') && (
          <MarkdownHtml text={text} />
        )}
      </>
    )
  }

  return (
    <>
      {(text || isStreaming) && (
        <>
          <MarkdownHtml text={text || ''} />
          {isStreaming && <span className="stream-cursor" aria-hidden />}
        </>
      )}
      {tools.length > 0 ? <ToolCallList tools={tools} /> : null}
      {subTasks ? <SubagentInlineBlock tasks={subTasks} /> : null}
    </>
  )
}
