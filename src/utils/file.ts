import { md5Hex } from '../utils/password'

// R2 文件 key: yyyy/M/d/<md5>.<ext> (与 Go 版目录结构一致)
export function buildR2Key(fileName: string, ext: string): string {
  const now = new Date()
  const hash = md5Hex(`${fileName}${Date.now()}`)
  return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${hash}${ext}`
}

/**
 * 站点图标 key: `icons/<md5(host)>.<ext>`
 *
 * 按站点稳定 —— 同一个站点重复「获取图标」会覆盖同一个对象, 不再像以前那样
 * 每点一次就往 R2 里塞一份 (旧实现 key 里带 Date.now(), 必然新建对象)。
 */
export function buildIconKey(host: string, ext: string): string {
  return `icons/${md5Hex(host)}${ext}`
}

/** 站点图标的 key 前缀 (用来查同一站点已有的对象 / file 行) */
export function buildIconKeyPrefix(host: string): string {
  return `icons/${md5Hex(host)}.`
}

// 文件记录 src -> R2 key (Go 版 src 形如 "./uploads/2026/1/5/xxx.png")
export function r2KeyFromSrc(src: string): string {
  return src.replace(/^\.\/(uploads\/)?/, '')
}

export function contentTypeFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.json': 'application/json',
  }
  return map[ext] ?? 'application/octet-stream'
}

export function extFromContentType(contentType: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
  }
  return map[ct] ?? ''
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico']

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.includes((ext ?? '').toLowerCase())
}

/**
 * 允许上传的扩展名白名单
 *
 * 与 contentTypeFromExt 的映射保持一致: 只有这些类型能拿到确定的 Content-Type,
 * 其余一律拒绝 (否则会以 application/octet-stream 存进 R2 再从同源返回)。
 */
const ALLOWED_EXTS = [...IMAGE_EXTS, '.txt', '.pdf', '.zip', '.json']

export function isAllowedExt(ext: string): boolean {
  return ALLOWED_EXTS.includes((ext ?? '').toLowerCase())
}

/** 允许作为站点图标存储的 Content-Type */
const ICON_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]

/**
 * 归一化抓取到的图标 Content-Type
 *
 * 非图片内容一律返回 '' (由调用方丢弃): 否则第三方页面可以把 HTML/脚本塞进 R2,
 * 再由我们的域名同源返回 (存储型 XSS 跳板)。
 * 少数站点会把图标标成 application/octet-stream, 此时仅在 URL 扩展名明确是图片时才接受。
 */
export function normalizeIconContentType(contentType: string, url: string): string {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (ICON_CONTENT_TYPES.includes(ct))
    return ct

  if (ct === '' || ct === 'application/octet-stream') {
    const ext = extFromUrl(url)
    if (isImageExt(ext))
      return contentTypeFromExt(ext)
  }

  return ''
}

/**
 * /uploads/<key> 的 key 校验
 *
 * 允许两种形态:
 * - `yyyy/M/d/<32位md5>[.ext]`  (上传文件, 扩展名可选以兼容早期无扩展名对象)
 * - `icons/<32位md5>.<ext>`     (站点图标, 按站点稳定)
 *
 * 禁止 `/`、`..` 等越界写法 —— R2 的 key 是扁平的, 这里是防止用 `/uploads/../` 之类的路径读到别的对象。
 */
const UPLOAD_KEY_PATTERN = new RegExp(
  '^(?:'
  + '\\d{4}/\\d{1,2}/\\d{1,2}/[0-9a-f]{32}(\\.[a-z0-9]{1,10})?'
  + '|icons/[0-9a-f]{32}\\.[a-z0-9]{1,10}'
  + ')$',
)

export function isValidUploadKey(key: string): boolean {
  return UPLOAD_KEY_PATTERN.test(key)
}

export function extFromUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  }
  catch {
    return ''
  }
  const name = u.pathname
  const idx = name.lastIndexOf('.')
  if (idx === -1 || idx === 0)
    return ''
  const ext = name.slice(idx).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ''
}