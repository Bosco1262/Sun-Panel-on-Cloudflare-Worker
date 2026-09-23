// Site icon candidate fetching: parses <link rel*="icon">, falls back to favicon.ico / icon.horse,
// and returns a candidate list for the user to choose from.
//
// 站点图标候选获取: 解析页面 <link rel*="icon">, 失败回退 favicon.ico / icon.horse, 返回候选列表供用户选择
import { normalizeIconContentType } from './file'

// 1MB cap (same as the Go version)
// 限制 1MB (与 Go 版一致)
const MAX_ICON_SIZE = 1024 * 1024

/**
 * Candidate cap: keeps malformed pages (hundreds of link tags) from slowing down parsing and dialog rendering
 *
 * 候选上限: 防止畸形页面 (几百条 link) 拖慢解析与弹窗渲染
 */
export const MAX_ICON_CANDIDATES = 12

/**
 * Candidate source: declared by the page / the site root favicon.ico / the icon.horse fallback
 *
 * 候选来源: 页面声明 / 站点根 favicon.ico / icon.horse 兜底
 */
export type IconCandidateSource = 'link' | 'favicon.ico' | 'icon-horse'

export interface IconCandidate {
  url: string
  sizes?: string
  type?: string
  source: IconCandidateSource
}

/**
 * Fetches the candidate list of site icons
 *
 * The fallback chain matches the pre-rework behaviour (page <link> → /favicon.ico → icon.horse); the difference is
 * that "take the first" became "return them all", so the frontend can show a dialog when there are several.
 * It returns an empty array instead of throwing when nothing is found.
 *
 *
 * 抓取站点图标候选列表
 *
 * 与改造前的失败链一致 (页面 <link> → /favicon.ico → icon.horse),
 * 区别是把「取第一个」变成「返回全部」, 让前端在多候选时弹窗选一张。
 * 无候选时返回空数组 (不抛错)。
 */
export async function getSiteFaviconCandidates(pageUrl: string): Promise<IconCandidate[]> {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  }
  catch {
    return []
  }

  // Approach 1: parse every <link rel*="icon"> in the page HTML
  // 方案 1: 解析页面 HTML 中的所有 <link rel*="icon">
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
      const candidates = extractIconCandidates(html, parsed)
      if (candidates.length > 0)
        return candidates
    }
  }
  catch {
    // Ignore fetch failures
    // 忽略抓取失败
  }

  // Approach 2: /favicon.ico at the site root (kept only when a HEAD returns 200)
  // 方案 2: 站点根路径 favicon.ico (HEAD 200 才收录)
  try {
    const faviconUrl = `${parsed.origin}/favicon.ico`
    const resp = await fetch(faviconUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok)
      return [{ url: faviconUrl, source: 'favicon.ico' }]
  }
  catch {
    // Ignore
    // 忽略
  }

  // Approach 3: the free icon.horse service (only when nothing above produced a candidate)
  // 方案 3: icon.horse 免费图标服务 (仅当前面一个候选都没有时)
  try {
    const horseUrl = `https://icon.horse/icon/${parsed.host}`
    const resp = await fetch(horseUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok)
      return [{ url: horseUrl, source: 'icon-horse' }]
  }
  catch {
    // Ignore
    // 忽略
  }

  return []
}

/**
 * Returns the first entry of the candidate list (used internally by the legacy getSiteFavicon endpoint,
 * with the same behaviour as before the rework)
 *
 * 取候选列表第一条 (旧接口 getSiteFavicon 内部使用, 行为与改造前一致)
 */
export async function getSiteFaviconUrl(pageUrl: string): Promise<string | null> {
  const candidates = await getSiteFaviconCandidates(pageUrl)
  return candidates[0]?.url ?? null
}

// Download the icon bytes (≤1MB, and it must be an image)
// 下载图标二进制 (≤1MB, 且必须是图片)
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

    // Non-image content is discarded immediately: otherwise a third-party page could store HTML/script in R2 and have it served same-origin from our domain
    // 非图片内容直接丢弃: 否则第三方页面可以把 HTML/脚本存进 R2, 再由我们的域名同源返回
    const contentType = normalizeIconContentType(resp.headers.get('content-type') ?? '', url)
    if (!contentType)
      return null

    return { data, contentType }
  }
  catch {
    return null
  }
}

// Reads the response body as a stream, truncated at maxBytes (so a huge page cannot eat memory/CPU)
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

/**
 * Pure function: collects every icon candidate from the HTML (no network requests, which makes self-checks easy)
 *
 * - collects <link> tags whose rel contains icon (icon / shortcut icon / apple-touch-icon / mask-icon ...)
 * - skips inline data: images and non-http(s) protocols; deduplicates by absolute URL; keeps document order; caps at 12
 * - same as the old implementation: drops query parameters (so cache busters like ?v= do not create duplicate candidates)
 * - the favicon.ico / icon.horse fallbacks need network probes, so getSiteFaviconCandidates appends them
 *
 *
 * 纯函数: 从 HTML 里收集所有图标候选 (不发网络请求, 便于自检)
 *
 * - 收集 rel 含 icon 的 <link> (icon / shortcut icon / apple-touch-icon / mask-icon ...)
 * - 跳过 data: 内联图片与非 http(s) 协议; 按绝对 URL 去重; 保留文档顺序; 上限 12 条
 * - 与旧实现一致: 去掉查询参数 (避免 ?v= 之类的缓存参数产生重复候选)
 * - favicon.ico / icon.horse 兜底需要网络探测, 在 getSiteFaviconCandidates 里追加
 */
export function extractIconCandidates(html: string, baseUrl: string | URL): IconCandidate[] {
  let base: URL
  try {
    base = typeof baseUrl === 'string' ? new URL(baseUrl) : baseUrl
  }
  catch {
    return []
  }

  const candidates: IconCandidate[] = []
  const seen = new Set<string>()

  const linkRe = /<link\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(html)) !== null) {
    if (candidates.length >= MAX_ICON_CANDIDATES)
      break

    const tag = match[0]
    const rel = getTagAttr(tag, 'rel')
    if (!rel || !rel.toLowerCase().includes('icon'))
      continue

    const href = getTagAttr(tag, 'href')
    if (!href || /^data:/i.test(href))
      continue

    let iconUrl: URL
    try {
      iconUrl = new URL(href, base)
    }
    catch {
      continue
    }
    if (iconUrl.protocol !== 'http:' && iconUrl.protocol !== 'https:')
      continue

    iconUrl.search = ''
    const abs = iconUrl.toString()
    if (seen.has(abs))
      continue
    seen.add(abs)

    const candidate: IconCandidate = { url: abs, source: 'link' }
    const sizes = getTagAttr(tag, 'sizes')
    const type = getTagAttr(tag, 'type')
    if (sizes)
      candidate.sizes = sizes
    if (type)
      candidate.type = type
    candidates.push(candidate)
  }

  return candidates
}

/**
 * Reads an HTML tag attribute (accepts double quotes, single quotes and unquoted values; whitespace is required
 * before the attribute name so that things like x-type are not matched by accident)
 *
 * 读取 HTML 标签属性 (兼容双引号 / 单引号 / 无引号三种写法; 属性名前必须是空白, 避免误配 x-type 之类)
 */
function getTagAttr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const match = re.exec(tag)
  if (!match)
    return null
  return (match[2] ?? match[3] ?? match[4] ?? '').trim()
}
