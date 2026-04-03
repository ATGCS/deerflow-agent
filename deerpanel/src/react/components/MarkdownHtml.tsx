import { useMemo } from 'react'
import { renderMarkdown } from '../../lib/markdown.js'

/** 与经典聊天页一致：沿用 markdown.js（代码高亮、Copy） */
export function MarkdownHtml({ text, className = 'msg-text' }: { text?: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text || ''), [text])
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
