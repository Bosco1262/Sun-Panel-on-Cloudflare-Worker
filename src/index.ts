import { Hono } from 'hono'
import type { Env } from './types'
import apiApp from './api'

const app = new Hono<{ Bindings: Env }>()

// 业务 API
app.route('/api', apiApp)

// R2 文件代理: /uploads/* (对应 Go 版 source_path 静态目录)
// 注: 上传接口返回的 imageUrl 为相对路径 "uploads/yyyy/M/d/xxx.png", 浏览器会解析到当前站点
app.get('/uploads/*', async (c) => {
  const key = c.req.path.slice('/uploads/'.length)
  if (!key)
    return c.text('Not Found', 404)

  const obj = await c.env.FILES.get(key)
  if (!obj)
    return c.text('Not Found', 404)

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=86400')
  return new Response(obj.body, { headers })
})

export default app
