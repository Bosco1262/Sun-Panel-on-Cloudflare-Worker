import { md5Hex } from '../utils/password'

// R2 文件 key: yyyy/M/d/<md5>.<ext> (与 Go 版目录结构一致)
export function buildR2Key(fileName: string, ext: string): string {
  const now = new Date()
  const hash = md5Hex(`${fileName}${Date.now()}`)
  return `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}/${hash}${ext}`
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
  return IMAGE_EXTS.includes(ext)
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