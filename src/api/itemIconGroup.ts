import { Hono } from 'hono'
import type { Env } from '../types'
import { errorByCode, errorByCodeAndMsg, success, successData, successList } from '../utils/response'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

interface GroupRow {
  id: number
  icon: string
  title: string
  description: string
  sort: number
  card_style: number
  text_color: string
  hide_description: number
  created_at: string
  updateTime: string
  updated_at: string
  createTime: string
}

interface ItemIconGroup {
  id?: number
  icon?: string
  title?: string
  description?: string
  sort?: number
  cardStyle?: number
  textColor?: string
  hideDescription?: number
}

// 分组列表 (为空时自动创建默认分组 "APP", 与 Go 版行为一致)
app.post('/itemIconGroup/getList', authMiddleware(), async (c) => {
  const db = c.env.DB

  let { results } = await db
    .prepare('SELECT * FROM item_icon_group WHERE deleted_at IS NULL ORDER BY sort, created_at')
    .all<GroupRow>()

  if (results.length === 0) {
    const created = await db
      .prepare('INSERT INTO item_icon_group (icon, title, description, sort) VALUES (?, ?, ?, 0)')
      .bind('material-symbols:ad-group-outline', 'APP', '')
      .run()
    const groupId = Number(created.meta.last_row_id)
    await db
      .prepare('UPDATE item_icon SET item_icon_group_id = ? WHERE deleted_at IS NULL AND item_icon_group_id = 0')
      .bind(groupId)
      .run()
    results = [{
      id: groupId,
      icon: 'material-symbols:ad-group-outline',
      title: 'APP',
      description: '',
      sort: 0,
      card_style: -1,
      text_color: '',
      hide_description: 0,
      created_at: '',
      updated_at: '',
      createTime: '',
      updateTime: '',
    }]
  }

  const list = results.map(mapGroup)
  return successList(c, list, list.length)
})

// 新增/修改分组
app.post('/itemIconGroup/edit', authMiddleware(), async (c) => {
  const body = await c.req.json<ItemIconGroup>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)

  const db = c.env.DB
  const icon = body.icon ?? ''
  const title = body.title ?? ''
  const description = body.description ?? ''
  const cardStyle = typeof body.cardStyle === 'number' ? body.cardStyle : -1
  const textColor = body.textColor ?? ''
  const hideDescription = body.hideDescription === 1 ? 1 : 0

  if (body.id) {
    const sort = body.sort ?? 0
    await db
      .prepare('UPDATE item_icon_group SET icon = ?, title = ?, description = ?, sort = ?, card_style = ?, text_color = ?, hide_description = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(icon, title, description, sort, cardStyle, textColor, hideDescription, body.id)
      .run()
  }
  else {
    const result = await db
      .prepare('INSERT INTO item_icon_group (icon, title, description, sort, card_style, text_color, hide_description) VALUES (?, ?, ?, 0, ?, ?, ?)')
      .bind(icon, title, description, cardStyle, textColor, hideDescription)
      .run()
    body.id = Number(result.meta.last_row_id)
  }

  return successData(c, body)
})

// 删除分组 (至少保留一个)
app.post('/itemIconGroup/deletes', authMiddleware(), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => typeof v === 'number') : []
  if (ids.length === 0)
    return errorByCode(c, 1400)

  const db = c.env.DB
  const countRow = await db
    .prepare('SELECT COUNT(*) AS c FROM item_icon_group WHERE deleted_at IS NULL')
    .first<{ c: number }>()
  const count = countRow?.c ?? 0

  if (Math.abs(ids.length - count) < 1)
    return errorByCode(c, 1201)

  try {
    const placeholders = ids.map(() => '?').join(',')
    await db.batch([
      db
        .prepare(`UPDATE item_icon_group SET deleted_at = datetime('now') WHERE deleted_at IS NULL AND id IN (${placeholders})`)
        .bind(...ids),
      db
        .prepare(`UPDATE item_icon SET deleted_at = datetime('now') WHERE deleted_at IS NULL AND item_icon_group_id IN (${placeholders})`)
        .bind(...ids),
    ])
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

// 保存分组排序
app.post('/itemIconGroup/saveSort', authMiddleware(), async (c) => {
  const body = await c.req.json<{ sortItems?: Array<{ id: number; sort: number }> }>().catch(() => null)
  const sortItems = Array.isArray(body?.sortItems) ? body.sortItems : []
  if (sortItems.length === 0)
    return errorByCode(c, 1400)

  try {
    const stmts = sortItems.map((v) => {
      if (typeof v.id !== 'number' || typeof v.sort !== 'number')
        throw new Error('bad sort item')
      return c.env.DB
        .prepare('UPDATE item_icon_group SET sort = ? WHERE id = ? AND deleted_at IS NULL')
        .bind(v.sort, v.id)
    })
    await c.env.DB.batch(stmts)
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

function mapGroup(row: GroupRow) {
  return {
    id: row.id,
    icon: row.icon,
    title: row.title,
    description: row.description,
    sort: row.sort,
    cardStyle: row.card_style ?? -1,
    textColor: row.text_color ?? '',
    hideDescription: row.hide_description ?? 0,
    createTime: row.createTime || row.created_at,
    updateTime: row.updateTime || row.updated_at,
  }
}

export default app
