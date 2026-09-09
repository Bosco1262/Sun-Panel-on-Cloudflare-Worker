import { Hono } from 'hono'
import type { Env } from '../../types'
import { error, errorByCode, errorByCodeAndMsg, success, successData, successList } from '../../utils/response'
import { downloadFavicon, getSiteFaviconUrl } from '../../utils/favicon'
import { buildR2Key, contentTypeFromExt, extFromContentType, extFromUrl, isImageExt } from '../../utils/file'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

interface ItemIconIcon {
  itemType?: number
  src?: string
  text?: string
  backgroundColor?: string
}

interface ItemIconBody {
  id?: number
  icon?: ItemIconIcon | null
  title?: string
  url?: string
  lanUrl?: string
  description?: string
  openMethod?: number
  sort?: number
  itemIconGroupId?: number
  onlyName?: string
}

interface IconRow {
  id: number
  icon_json: string
  title: string
  url: string
  lan_url: string
  description: string
  open_method: number
  sort: number
  item_icon_group_id: number
  only_name: string
  created_at: string
  updated_at: string
  createTime: string
  updateTime: string
}

function iconJsonToIcon(iconJson: string): ItemIconIcon | null {
  if (!iconJson)
    return null
  try {
    return JSON.parse(iconJson) as ItemIconIcon
  }
  catch {
    return null
  }
}

function mapIcon(row: IconRow) {
  return {
    id: row.id,
    icon: iconJsonToIcon(row.icon_json),
    title: row.title,
    url: row.url,
    lanUrl: row.lan_url,
    description: row.description,
    openMethod: row.open_method,
    sort: row.sort,
    itemIconGroupId: row.item_icon_group_id,
    onlyName: row.only_name ?? '',
    createTime: row.createTime || row.created_at,
    updateTime: row.updateTime || row.updated_at,
  }
}

// 新增/修改图标
app.post('/itemIcon/edit', authMiddleware(), async (c) => {
  const body = await c.req.json<ItemIconBody>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)

  if (!body.itemIconGroupId || body.itemIconGroupId === 0)
    return error(c, '参数错误[Group is mandatory]')

  const db = c.env.DB
  const iconJson = JSON.stringify(body.icon ?? {})
  const title = body.title ?? ''
  const url = body.url ?? ''
  const lanUrl = body.lanUrl ?? ''
  const description = body.description ?? ''
  const openMethod = body.openMethod ?? 0
  const onlyName = (body.onlyName ?? '').trim()

  // 唯一标识占用校验 (对齐上游 onlyNameExisted)
  if (onlyName) {
    const dup = await db
      .prepare('SELECT id FROM item_icon WHERE only_name = ? AND deleted_at IS NULL AND id != ?')
      .bind(onlyName, body.id ?? 0)
      .first()
    if (dup)
      return errorByCode(c, 1401)
  }

  if (body.id) {
    const updateFields = ['icon_json = ?', 'title = ?', 'url = ?', 'lan_url = ?', 'description = ?', 'open_method = ?', 'item_icon_group_id = ?', 'only_name = ?']
    const values: unknown[] = [iconJson, title, url, lanUrl, description, openMethod, body.itemIconGroupId, onlyName]
    if (typeof body.sort === 'number') {
      updateFields.push('sort = ?')
      values.push(body.sort)
    }
    updateFields.push("updated_at = datetime('now')")
    await db
      .prepare(`UPDATE item_icon SET ${updateFields.join(', ')} WHERE id = ? AND deleted_at IS NULL`)
      .bind(...values, body.id)
      .run()
  }
  else {
    const result = await db
      .prepare(
        'INSERT INTO item_icon (icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id, only_name) '
        + 'VALUES (?, ?, ?, ?, ?, ?, 9999, ?, ?)',
      )
      .bind(iconJson, title, url, lanUrl, description, openMethod, body.itemIconGroupId, onlyName)
      .run()
    body.id = Number(result.meta.last_row_id)
  }

  return successData(c, body)
})

// 批量添加图标
app.post('/itemIcon/addMultiple', authMiddleware(), async (c) => {
  const list = await c.req.json<ItemIconBody[]>().catch(() => null)
  if (!Array.isArray(list))
    return errorByCode(c, 1400)

  for (const item of list) {
    if (!item.itemIconGroupId || item.itemIconGroupId === 0)
      return error(c, '参数错误[Group is mandatory]')
  }

  const db = c.env.DB
  const stmts = list.map((item) => {
    const iconJson = JSON.stringify(item.icon ?? {})
    return db
      .prepare(
        'INSERT INTO item_icon (icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id) '
        + 'VALUES (?, ?, ?, ?, ?, ?, 9999, ?)',
      )
      .bind(iconJson, item.title ?? '', item.url ?? '', item.lanUrl ?? '', item.description ?? '', item.openMethod ?? 0, item.itemIconGroupId)
  })
  await db.batch(stmts)

  return successData(c, list)
})

// 按分组获取图标列表
app.post('/itemIcon/getListByGroupId', authMiddleware(), async (c) => {
  const body = await c.req.json<{ itemIconGroupId?: number }>().catch(() => null)
  const groupId = typeof body?.itemIconGroupId === 'number' ? body.itemIconGroupId : 0
  if (!groupId)
    return errorByCode(c, 1400)

  const { results } = await c.env.DB
    .prepare('SELECT * FROM item_icon WHERE deleted_at IS NULL AND item_icon_group_id = ? ORDER BY sort, created_at')
    .bind(groupId)
    .all<IconRow>()

  return successList(c, results.map(mapIcon), 0)
})

// 删除图标
app.post('/itemIcon/deletes', authMiddleware(), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => typeof v === 'number') : []
  if (ids.length === 0)
    return errorByCode(c, 1400)

  try {
    const placeholders = ids.map(() => '?').join(',')
    await c.env.DB
      .prepare(`UPDATE item_icon SET deleted_at = datetime('now') WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .bind(...ids)
      .run()
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

// 保存图标排序
app.post('/itemIcon/saveSort', authMiddleware(), async (c) => {
  const body = await c.req.json<{ sortItems?: Array<{ id: number; sort: number }>; itemIconGroupId?: number }>().catch(() => null)
  const sortItems = Array.isArray(body?.sortItems) ? body.sortItems : []
  const groupId = typeof body?.itemIconGroupId === 'number' ? body.itemIconGroupId : 0
  if (sortItems.length === 0 || !groupId)
    return errorByCode(c, 1400)

  try {
    const stmts = sortItems.map((v) => {
      if (typeof v.id !== 'number' || typeof v.sort !== 'number')
        throw new Error('bad sort item')
      return c.env.DB
        .prepare('UPDATE item_icon SET sort = ? WHERE id = ? AND item_icon_group_id = ? AND deleted_at IS NULL')
        .bind(v.sort, v.id, groupId)
    })
    await c.env.DB.batch(stmts)
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

// 获取站点图标: 抓取后下载并保存至 R2 (与手动上传的图标统一存储在 R2)
app.post('/itemIcon/getSiteFavicon', authMiddleware(), async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url)
    return errorByCode(c, 1400)

  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return error(c, 'acquisition failed: invalid url')
  }

  const iconUrl = await getSiteFaviconUrl(url)
  if (!iconUrl)
    return error(c, 'acquisition failed: get favicon url error')

  const img = await downloadFavicon(iconUrl)
  if (!img)
    return error(c, 'acquisition failed: download favicon error')

  // 扩展名: Content-Type 优先 (避免 icon.horse 等无扩展名 URL 误判),
  // URL 扩展名仅在属于图片格式时采用
  const urlExt = extFromUrl(iconUrl)
  const ctExt = extFromContentType(img.contentType)
  const ext = ctExt || (isImageExt(urlExt) ? urlExt : '.png')
  const contentType = img.contentType || contentTypeFromExt(ext)

  // 保存到 R2 + 记录到 file 表 (fileName 使用站点域名, 与 Go 版一致)
  const key = buildR2Key(parsed.host, ext)
  try {
    await c.env.FILES.put(key, img.data, { httpMetadata: { contentType } })
    const src = `./uploads/${key}`
    await c.env.DB
      .prepare('INSERT INTO file (src, file_name, method, ext) VALUES (?, ?, 0, ?)')
      .bind(src, parsed.host, ext)
      .run()
    return successData(c, { iconUrl: `uploads/${key}` })
  }
  catch (err) {
    return error(c, `acquisition failed: ${(err as Error).message}`)
  }
})

export default app
