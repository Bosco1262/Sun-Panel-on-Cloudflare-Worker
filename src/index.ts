import { Hono } from 'hono'
import type { Env } from './types'
import apiApp from './api'
import { isValidUploadKey } from './utils/file'

const app = new Hono<{ Bindings: Env }>()

// 业务 API
app.route('/api', apiApp)

// R2 文件代理: /uploads/* (对应 Go 版 source_path 静态目录)
// 注: 上传接口返回的 imageUrl 为相对路径 "uploads/yyyy/M/d/xxx.png", 浏览器会解析到当前站点
app.get('/uploads/*', async (c) => {
  const key = c.req.path.slice('/uploads/'.length)
  // key 必须是本服务生成的形态, 否则一律 404
  if (!key || !isValidUploadKey(key))
    return c.text('Not Found', 404)

  // 不做 Worker 侧边缘缓存 (caches.default): 对象删除后缓存最长还能命中 24 小时,
  // 「删掉文件却还能访问」的困惑大于省下的那点 R2 读。需要边缘缓存的话在 Cloudflare 侧配
  // Cache Rule (见 docs/improvement-plan.md §4.3), 那里同样要接受删除延迟。
  const obj = await c.env.FILES.get(key)
  if (!obj)
    return c.text('Not Found', 404)

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  // 上传文件 (yyyy/M/d/<内容哈希>) 内容不会变 -> immutable;
  // 站点图标 (icons/<md5(host)>.<ext>) 会被覆盖写, 只给普通 max-age
  headers.set(
    'cache-control',
    key.startsWith('icons/') ? 'public, max-age=86400' : 'public, max-age=86400, immutable',
  )
  // 不让浏览器按内容嗅探类型 (避免把非图片当 HTML/SVG 执行)
  headers.set('x-content-type-options', 'nosniff')

  const contentType = (headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('image/')) {
    // 非图片一律作为附件下载, 不在页面上内联渲染
    headers.set('content-disposition', 'attachment')
  }
  else if (contentType.startsWith('image/svg')) {
    // SVG 可以内嵌脚本: 作为 <img> 子资源不受影响, 但直接访问时禁止执行
    headers.set('content-security-policy', 'default-src \'none\'; style-src \'unsafe-inline\'; sandbox')
  }

  return new Response(obj.body, { headers })
})

export default app
