import { Hono } from 'hono'
import type { Env } from './types'
import apiApp from './api'
import { isValidUploadKey } from './utils/file'
import { JWT_SECRET_MISSING_MSG, MissingJwtSecretError } from './utils/jwt'
import { apiReturn } from './utils/response'

const app = new Hono<{ Bindings: Env }>()

// Last line of defence for a missing JWT_SECRET (security review V-02B, see docs/security.md §3): any path that
// reaches token signing or verification without a usable secret reports 503 instead of producing a 500 whose stack
// the caller never sees. Everything else is rethrown to Hono's default handler, which returns a plain 500 with no internals.
//
// JWT_SECRET 缺失时的最后一道防线 (安全审查 V-02B, 见 docs/security.md §3): 任何在密钥不可用时走到签发/校验的路径
// 都返回 503, 而不是产生一个调用方看不懂的 500。其余错误交回 Hono 默认处理 (纯 500, 不含内部信息)。
app.onError((err, c) => {
  if (err instanceof MissingJwtSecretError || err.message === JWT_SECRET_MISSING_MSG)
    return apiReturn(c, 1403, JWT_SECRET_MISSING_MSG, undefined, 503)
  throw err
})

// Business API
// 业务 API
app.route('/api', apiApp)

// R2 file proxy: /uploads/* (mirrors the Go version's source_path static directory)
// Note: the imageUrl returned by the upload endpoints is the relative path "uploads/yyyy/M/d/xxx.png",
// so browsers resolve it against the current site.
//
// R2 文件代理: /uploads/* (对应 Go 版 source_path 静态目录)
// 注: 上传接口返回的 imageUrl 为相对路径 "uploads/yyyy/M/d/xxx.png", 浏览器会解析到当前站点
app.get('/uploads/*', async (c) => {
  const key = c.req.path.slice('/uploads/'.length)
  // The key must match the shape this service generates, otherwise 404
  // key 必须是本服务生成的形态, 否则一律 404
  if (!key || !isValidUploadKey(key))
    return c.text('Not Found', 404)

  // No Worker-side edge cache (caches.default): a deleted object could still be served from the edge for
  // up to 24 hours, and "the file is deleted but still reachable" is more confusing than the saved R2 reads.
  // If an edge cache is wanted, configure a Cache Rule on the Cloudflare side
  // (see docs/improvement-plan.md §4.3) and accept the same deletion delay there.
  //
  // 不做 Worker 侧边缘缓存 (caches.default): 对象删除后缓存最长还能命中 24 小时,
  // 「删掉文件却还能访问」的困惑大于省下的那点 R2 读。需要边缘缓存的话在 Cloudflare 侧配
  // Cache Rule (见 docs/improvement-plan.md §4.3), 那里同样要接受删除延迟。
  const obj = await c.env.FILES.get(key)
  if (!obj)
    return c.text('Not Found', 404)

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  // Uploads (yyyy/M/d/<content hash>) never change → immutable;
  // site icons (icons/<md5(host)>.<ext>) are overwritten, so they only get a plain max-age.
  //
  // 上传文件 (yyyy/M/d/<内容哈希>) 内容不会变 -> immutable;
  // 站点图标 (icons/<md5(host)>.<ext>) 会被覆盖写, 只给普通 max-age
  headers.set(
    'cache-control',
    key.startsWith('icons/') ? 'public, max-age=86400' : 'public, max-age=86400, immutable',
  )
  // Do not let browsers sniff the content type (so non-images are never executed as HTML/SVG)
  // 不让浏览器按内容嗅探类型 (避免把非图片当 HTML/SVG 执行)
  headers.set('x-content-type-options', 'nosniff')

  const contentType = (headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('image/')) {
    // Non-images are always served as an attachment and never rendered inline
    // 非图片一律作为附件下载, 不在页面上内联渲染
    headers.set('content-disposition', 'attachment')
  }
  else if (contentType.startsWith('image/svg')) {
    // SVG can embed scripts: harmless as an <img> subresource, but execution must be blocked on direct visits
    // SVG 可以内嵌脚本: 作为 <img> 子资源不受影响, 但直接访问时禁止执行
    headers.set('content-security-policy', 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox')
  }

  return new Response(obj.body, { headers })
})

export default app
