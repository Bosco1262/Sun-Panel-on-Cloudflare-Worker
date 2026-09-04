// 站点图标获取: 解析页面 <link rel="icon">, 失败回退 favicon.ico / icon.horse, 返回可下载的图标 URL
const MAX_ICON_SIZE = 1024 * 1024 // 限制 1MB (与 Go 版一致)

export async function getSiteFaviconUrl(pageUrl: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  }
  catch {
    return null
  }

  // 方案 1: 解析页面 HTML 中的 <link rel="icon">
  try {
    const resp = await fetch(parsed.toString(), {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Sun-Panel/1.0)',
        'accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    if (resp.ok) {
      const html = await readBodyTruncated(resp, MAX_ICON_SIZE)
      const icon = extractIconHref(html, parsed)
      if (icon)
        return icon
    }
  }
  catch {
    // 忽略抓取失败
  }

  // 方案 2: 站点根路径 favicon.ico
  try {
    const resp = await fetch(`${parsed.origin}/favicon.ico`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok)
      return `${parsed.origin}/favicon.ico`
  }
  catch {
    // 忽略
  }

  // 方案 3: icon.horse 免费图标服务 (失败则返回 null)
  try {
    const resp = await fetch(`https://icon.horse/icon/${parsed.host}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok)
      return `https://icon.horse/icon/${parsed.host}`
  }
  catch {
    // 忽略
  }

  return null
}

// 下载图标二进制 (≤1MB)
export async function downloadFavicon(url: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok)
      return null

    const contentLength = Number(resp.headers.get('content-length') ?? 0)
    if (contentLength > MAX_ICON_SIZE)
      return null

    const data = await resp.arrayBuffer()
    if (data.byteLength > MAX_ICON_SIZE)
      return null

    return { data, contentType: resp.headers.get('content-type') ?? '' }
  }
  catch {
    return null
  }
}

// 流式读取响应体, 最多截断 maxBytes (防止超大页面占用内存/CPU)
async function readBodyTruncated(resp: Response, maxBytes: number): Promise<string> {
  if (!resp.body)
    return ''

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done)
        break
      const chunk = decoder.decode(value, { stream: true })
      text += chunk
      total += chunk.length
      if (text.length > maxBytes)
        break
    }
  }
  finally {
    reader.releaseLock()
  }
  return text
}

function extractIconHref(html: string, base: URL): string | null {
  // rel="icon" 在前, href 在后
  const relFirst = /<link[^>]+rel=["'][^"']*\bicon\b[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(html)
  // href 在前, rel 在后
  const hrefFirst = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*\bicon\b[^"']*["']/i.exec(html)

  const href = relFirst?.[1] || hrefFirst?.[1]
  if (!href)
    return null

  // 跳过 data: 内联图片
  if (/^data:/i.test(href.trim()))
    return null

  try {
    const iconUrl = new URL(href, base)
    if (iconUrl.protocol !== 'http:' && iconUrl.protocol !== 'https:')
      return null
    // 与 Go 版一致: 去除参数的图标 URL (scheme://host/path)
    iconUrl.search = ''
    return iconUrl.toString()
  }
  catch {
    return null
  }
}