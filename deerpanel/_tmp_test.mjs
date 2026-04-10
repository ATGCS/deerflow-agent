// 测试：用正确的数组格式 args 调用 skills:listPublicPageV4
const resp = await fetch('https://wry-manatee-359.convex.cloud/api/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'convex-client': 'npm-1.34.1' },
  body: JSON.stringify({
    path: 'skills:listPublicPageV4',
    // 官方格式：args 是 [{}] 数组！
    args: [{
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: true,
      numItems: 5,
      sort: 'downloads',
    }],
  }),
  signal: AbortSignal.timeout(15_000),
})

console.log('HTTP status:', resp.status)
const data = await resp.json()
console.log('status:', data.status)
const val = data.value

if (val) {
  console.log('hasMore:', val.hasMore)
  console.log('cursor type:', typeof val.nextCursor, val.nextCursor?.substring(0, 40))
  console.log('page length:', Array.isArray(val.page) ? val.page.length : 'NOT ARRAY')

  if (Array.isArray(val.page) && val.page.length > 0) {
    const item = val.page[0]
    console.log('Top-level keys:', Object.keys(item))
    console.log('Has .skill?', !!item.skill)
    if (item.skill) {
      const s = item.skill
      console.log('.skill.slug:', s.slug)
      console.log('.skill.displayName:', s.displayName)
      console.log('.skill.summary:', (s.summary || '').substring(0, 80))
      console.log('.skill.stats:', JSON.stringify(s.stats))
    }
  }
} else {
  console.log('NO value')
}
