import { Hono } from 'hono'
import type { Env } from '../types'
import { successList } from '../utils/response'

const app = new Hono<{ Bindings: Env }>()

interface NoticeRow {
  id: number
  title: string
  content: string
  display_type: number
  one_read: number
  url: string
  is_login: number
  createTime: string
  created_at: string
}

// 按展示类型获取通知
app.post('/notice/getListByDisplayType', async (c) => {
  const body = await c.req.json<{ displayType?: unknown }>().catch(() => null)
  const displayType = Array.isArray(body?.displayType)
    ? body.displayType.filter((v): v is number => typeof v === 'number')
    : []

  if (displayType.length === 0)
    return successList(c, [], 0)

  const placeholders = displayType.map(() => '?').join(',')
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM notice WHERE deleted_at IS NULL AND display_type IN (${placeholders})`)
    .bind(...displayType)
    .all<NoticeRow>()

  const list = results.map(row => ({
    id: row.id,
    title: row.title,
    content: row.content,
    displayType: row.display_type,
    oneRead: row.one_read,
    url: row.url,
    isLogin: row.is_login,
    createTime: row.createTime || row.created_at,
  }))

  return successList(c, list, 0)
})

export default app
