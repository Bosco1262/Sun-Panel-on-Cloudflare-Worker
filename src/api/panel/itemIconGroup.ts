import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../../types'
import { errorByCode, errorByCodeAndMsg, success, successData, successList } from '../../utils/response'
import { mapIcon } from './itemIcon'
import type { IconRow } from './itemIcon'
import { cleanupUploads, srcFromIconJson } from '../../utils/uploadRefs'
import { getAutoCleanUnused } from '../../utils/settings'
import { authMiddleware } from '../../middleware/auth'

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

/** 读取全部分组; 空库时自动建默认分组并把游离项目挂过去 (与 Go 版行为一致) */
async function loadGroups(db: D1Database): Promise<GroupRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM item_icon_group WHERE deleted_at IS NULL ORDER BY sort, created_at')
    .all<GroupRow>()

  if (results.length > 0)
    return results

  const created = await db
    .prepare('INSERT INTO item_icon_group (icon, title, description, sort) VALUES (?, ?, ?, 0)')
    .bind('material-symbols:ad-group-outline', 'APP', '')
    .run()
  const groupId = Number(created.meta.last_row_id)
  await db
    .prepare('UPDATE item_icon SET item_icon_group_id = ? WHERE deleted_at IS NULL AND item_icon_group_id = 0')
    .bind(groupId)
    .run()

  return [{
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

// 分组列表 (为空时自动创建默认分组 "APP", 与 Go 版行为一致)
app.post('/itemIconGroup/getList', authMiddleware(), async (c) => {
  const list = (await loadGroups(c.env.DB)).map(mapGroup)
  return successList(c, list, list.length)
})

/**
 * 分组 + 项目一次返回 (首页使用)
 *
 * 旧流程是「先查分组, 再对每个分组各发一次 getListByGroupId」= 1+N 次 Worker 请求,
 * 这里两条 SQL 搞定, 在 Worker 内按 item_icon_group_id 归组。
 */
app.post('/itemIconGroup/getListWithItems', authMiddleware(), async (c) => {
  const db = c.env.DB
  const groups = await loadGroups(db)
  const { results: items } = await db
    .prepare('SELECT * FROM item_icon WHERE deleted_at IS NULL ORDER BY sort, created_at')
    .all<IconRow>()

  const byGroup = new Map<number, ReturnType<typeof mapIcon>[]>()
  for (const row of items) {
    const list = byGroup.get(row.item_icon_group_id)
    if (list)
      list.push(mapIcon(row))
    else
      byGroup.set(row.item_icon_group_id, [mapIcon(row)])
  }

  const list = groups.map(group => ({ ...mapGroup(group), items: byGroup.get(Number(group.id)) ?? [] }))
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

  const placeholders = ids.map(() => '?').join(',')
  let iconJsons: string[] = []

  try {
    // 先取出这些分组下项目的图标, 删完后据判断图片是否还有人用
    const { results } = await db
      .prepare(`SELECT icon_json FROM item_icon WHERE deleted_at IS NULL AND item_icon_group_id IN (${placeholders})`)
      .bind(...ids)
      .all<{ icon_json: string }>()
    iconJsons = results.map(row => row.icon_json)

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

  // R2 清理放在 DB 写入之后, 失败只记日志
  // 开关关闭时不自动回收: 图片留在「上传文件管理」里可复用, 需要时手动点「清理未引用文件」
  if (await getAutoCleanUnused(db))
    await cleanupUploads(db, c.env.FILES, iconJsons.map(srcFromIconJson))

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
