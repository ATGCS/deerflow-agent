function showLightbox(src: string) {
  const existing = document.querySelector('.chat-lightbox')
  if (existing) existing.remove()
  const lb = document.createElement('div')
  lb.className = 'chat-lightbox'
  lb.innerHTML = `<img src="${src.replace(/"/g, '&quot;')}" class="chat-lightbox-img" alt="" />`
  lb.onclick = (e) => {
    if (e.target === lb || (e.target as HTMLElement).tagName !== 'IMG') lb.remove()
  }
  document.body.appendChild(lb)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      lb.remove()
      document.removeEventListener('keydown', onKey)
    }
  }
  document.addEventListener('keydown', onKey)
}

function imgSrc(img: Record<string, unknown>): string {
  const source = img?.source as { data?: string; media_type?: string } | undefined
  if (source?.data) return `data:${source.media_type || 'image/png'};base64,${source.data}`
  if (img?.data) {
    const mt = (img.mediaType as string) || (img.media_type as string) || 'image/png'
    return `data:${mt};base64,${String(img.data)}`
  }
  const iu = img?.image_url as { url?: string } | undefined
  if (iu?.url) return iu.url
  if (img?.url) return String(img.url)
  return ''
}

export function MessageMedia({
  images,
  videos,
  audios,
  files,
}: {
  images?: unknown[]
  videos?: unknown[]
  audios?: unknown[]
  files?: unknown[]
}) {
  return (
    <>
      {!!images?.length && (
        <div className="react-msg-media-row">
          {images.map((img, i) => {
            const src = imgSrc(img as Record<string, unknown>)
            if (!src) return null
            return (
              <img
                key={i}
                className="msg-img"
                src={src}
                alt=""
                onClick={() => showLightbox(src)}
              />
            )
          })}
        </div>
      )}
      {!!videos?.length && (
        <div className="react-msg-media-row">
          {videos.map((v, i) => {
            const o = v as { data?: string; mediaType?: string; url?: string }
            const src = o.data
              ? `data:${o.mediaType || 'video/mp4'};base64,${o.data}`
              : o.url || ''
            if (!src) return null
            return (
              <video key={i} className="msg-video" src={src} controls playsInline preload="metadata" />
            )
          })}
        </div>
      )}
      {!!audios?.length && (
        <div className="react-msg-media-row">
          {audios.map((a, i) => {
            const o = a as { data?: string; mediaType?: string; url?: string }
            const src = o.data
              ? `data:${o.mediaType || 'audio/mpeg'};base64,${o.data}`
              : o.url || ''
            if (!src) return null
            return <audio key={i} className="msg-audio" src={src} controls preload="metadata" />
          })}
        </div>
      )}
      {!!files?.length && (
        <div className="react-msg-files">
          {files.map((f, i) => {
            const o = f as { url?: string; name?: string }
            return (
              <a
                key={i}
                className="msg-file-card"
                href={o.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="msg-file-name">{o.name || '文件'}</span>
              </a>
            )
          })}
        </div>
      )}
    </>
  )
}
