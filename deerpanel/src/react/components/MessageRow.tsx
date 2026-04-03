import { useMemo } from 'react'
import { MarkdownHtml } from './MarkdownHtml.js'
import { ToolCallList } from './ToolCallList.js'
import { MessageMedia } from './MessageMedia.js'
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

function AssistantBody({ row, isStreaming }: { row: DisplayRow; isStreaming?: boolean }) {
  const tools = row.tools || []
  const segments = row.segments as MessageSegment[] | undefined
  const showTail = !!(row.text?.trim() || isStreaming)

  const interleaved = useMemo(() => {
    if (!segments?.length) return null
    return segments.map((seg, i) =>
      seg.kind === 'text' ? (
        <MarkdownHtml key={`seg-t-${i}`} text={seg.text} />
      ) : (
        <ToolCallList key={`seg-k-${i}`} tools={tools} filterIds={seg.ids} />
      ),
    )
  }, [segments, tools])

  if (segments?.length) {
    return (
      <>
        {interleaved}
        {showTail && (
          <>
            <MarkdownHtml text={row.text || ''} />
            {isStreaming && <span className="stream-cursor" aria-hidden />}
          </>
        )}
      </>
    )
  }

  return (
    <>
      {(row.text || isStreaming) && (
        <>
          <MarkdownHtml text={row.text || ''} />
          {isStreaming && <span className="stream-cursor" aria-hidden />}
        </>
      )}
      <ToolCallList tools={tools} />
    </>
  )
}
