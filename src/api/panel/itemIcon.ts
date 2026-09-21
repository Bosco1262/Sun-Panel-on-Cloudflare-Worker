import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../../types'
import { error, errorByCode, errorByCodeAndMsg, success, successData, successList } from '../../utils/response'
import { downloadFavicon, getSiteFaviconCandidates, getSiteFaviconUrl } from '../../utils/favicon'
import { buildIconKey, buildIconKeyPrefix, contentTypeFromExt, extFromContentType, extFromUrl, isImageExt, r2KeyFromSrc } from '../../utils/file'
import { cleanupUploads, isUploadSrcReferenced, srcFromIconJson } from '../../utils/uploadRefs'
import { getAutoCleanUnused } from '../../utils/settings'
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

export interface IconRow {
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

export function mapIcon(row: IconRow) {
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

/** onlyName (唯一标识) 的最大长度: 超长直接截断, 避免异常输入写库 */
const ONLY_NAME_MAX_LENGTH = 50

/**
 * 归一化唯一标识: 去空白 + 只保留英文/数字/下划线/中划线 + 限长
 *
 * 与前端 EditItem 的即时过滤保持一致, 但以服务端为准 —— 导入的数据来自文件, 不可信。
 */
function sanitizeOnlyName(raw: unknown): string {
  if (typeof raw !== 'string')
    return ''
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, ONLY_NAME_MAX_LENGTH)
}

/** 已占用的唯一标识集合 (软删的不算, 与单条 edit 的判定一致) */
async function loadTakenOnlyNames(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT only_name FROM item_icon WHERE deleted_at IS NULL AND only_name != \'\'')
    .all<{ only_name: string }>()
  return new Set(results.map(row => row.only_name))
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
  const onlyName = sanitizeOnlyName(body.onlyName)

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

// 批量添加图标 (导入流程使用: 携带 sort 保真顺序, 携带 onlyName 保真唯一标识)
app.post('/itemIcon/addMultiple', authMiddleware(), async (c) => {
  const list = await c.req.json<ItemIconBody[]>().catch(() => null)
  if (!Array.isArray(list))
    return errorByCode(c, 1400)

  for (const item of list) {
    if (!item.itemIconGroupId || item.itemIconGroupId === 0)
      return error(c, '参数错误[Group is mandatory]')
  }

  const db = c.env.DB

  // onlyName 的边界处理 (与单条 edit 的语义对齐):
  // 归一化 (去空白/剔非法字符/限长) 后, 与库内已占用或本批次内重复的标识一律降级为空串,
  // 并把被丢弃的标识回给前端提示 —— 导入不应因一个重复标识整体失败, 但也不能写出冲突数据。
  const taken = await loadTakenOnlyNames(db)
  const droppedOnlyNames: string[] = []
  const normalized = list.map((item) => {
    const onlyName = sanitizeOnlyName(item.onlyName)
    if (!onlyName)
      return { ...item, onlyName: '' }
    if (taken.has(onlyName)) {
      droppedOnlyNames.push(onlyName)
      return { ...item, onlyName: '' }
    }
    taken.add(onlyName)
    return { ...item, onlyName }
  })

  const stmts = normalized.map((item) => {
    const iconJson = JSON.stringify(item.icon ?? {})
    // sort 由导入流程携带 (用于保真原有顺序); 缺省或非法时用 9999 = 追加到末尾
    const sort = typeof item.sort === 'number' && Number.isFinite(item.sort) ? item.sort : 9999
    return db
      .prepare(
        'INSERT INTO item_icon (icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id, only_name) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(iconJson, item.title ?? '', item.url ?? '', item.lanUrl ?? '', item.description ?? '', item.openMethod ?? 0, sort, item.itemIconGroupId, item.onlyName ?? '')
  })
  await db.batch(stmts)

  return successData(c, { list: normalized, droppedOnlyNames })
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

// 删除图标 (软删记录 + 清理不再被引用的图片)
app.post('/itemIcon/deletes', authMiddleware(), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => typeof v === 'number') : []
  if (ids.length === 0)
    return errorByCode(c, 1400)

  const placeholders = ids.map(() => '?').join(',')
  let iconJsons: string[] = []

  try {
    // 先取出待删项目的图标, 用于删完后判断哪些图片没人用了
    const { results } = await c.env.DB
      .prepare(`SELECT icon_json FROM item_icon WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .bind(...ids)
      .all<{ icon_json: string }>()
    iconJsons = results.map(row => row.icon_json)

    await c.env.DB
      .prepare(`UPDATE item_icon SET deleted_at = datetime('now') WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .bind(...ids)
      .run()
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  // R2 清理放在 DB 写入之后, 失败只记日志 (cleanupUploads 内部已兜住)
  // 开关关闭时不自动回收: 图片留在「上传文件管理」里可复用, 需要时手动点「清理未引用文件」
  if (await getAutoCleanUnused(c.env.DB))
    await cleanupUploads(c.env.DB, c.env.FILES, iconJsons.map(srcFromIconJson))

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

/**
 * 下载并保存站点图标: R2 key 按站点稳定 (icons/<md5(host)>.<ext>) 覆盖写, file 行 UPSERT。
 * 扩展名变化时回收旧对象 (受自动回收开关 + 引用检查双重保护)。
 * 失败时返回 { error }, 由各路由拼成 'acquisition failed: ...' (与旧实现同文案)。
 */
async function storeFavicon(env: Env, host: string, iconUrl: string): Promise<{ iconUrl: string } | { error: string }> {
  const img = await downloadFavicon(iconUrl)
  if (!img)
    return { error: 'download favicon error' }

  // downloadFavicon 已保证是图片类型; 扩展名以 Content-Type 为准
  // (避免 icon.horse 这类无扩展名 URL 误判), URL 扩展名仅作兜底
  const urlExt = extFromUrl(iconUrl)
  const ext = extFromContentType(img.contentType) || (isImageExt(urlExt) ? urlExt : '.png')
  const contentType = contentTypeFromExt(ext)

  // 保存到 R2 + 记录到 file 表 (fileName 使用站点域名, 与 Go 版一致)
  // key 按站点稳定 (icons/<md5(host)>.<ext>): 重复获取会覆盖同一个对象,
  // 不再像旧实现那样每点一次就往 R2 里堆一份 (旧 key 带 Date.now(), 必然新建)
  const key = buildIconKey(host, ext)
  const src = `./uploads/${key}`
  try {
    await env.FILES.put(key, img.data, { httpMetadata: { contentType } })

    // 该站点已有的记录: 用来判断是覆盖、换扩展名还是首次写入
    const { results: existing } = await env.DB
      .prepare('SELECT src FROM file WHERE deleted_at IS NULL AND src LIKE ?')
      .bind(`./uploads/${buildIconKeyPrefix(host)}%`)
      .all<{ src: string }>()

    if (existing.some(row => row.src === src)) {
      await env.DB
        .prepare('UPDATE file SET file_name = ?, ext = ?, updated_at = datetime(\'now\') WHERE src = ?')
        .bind(host, ext, src)
        .run()
    }
    else if (existing.length > 0) {
      // 扩展名变了 (例如原来 .png 现在是 .ico): 复用旧行, 旧对象稍后清掉
      await env.DB
        .prepare('UPDATE file SET src = ?, ext = ?, updated_at = datetime(\'now\') WHERE src = ?')
        .bind(src, ext, existing[0].src)
        .run()
    }
    else {
      await env.DB
        .prepare('INSERT INTO file (src, file_name, method, ext) VALUES (?, ?, 0, ?)')
        .bind(src, host, ext)
        .run()
    }

    // 清掉扩展名变化后残留的旧对象
    // 两个保护: 关掉自动回收时不删; 旧图标仍被项目/背景/头像引用时不删 (否则在用图标会变 404)
    const autoClean = await getAutoCleanUnused(env.DB)
    for (const row of existing) {
      if (row.src === src || !autoClean)
        continue
      try {
        if (await isUploadSrcReferenced(env.DB, row.src))
          continue
        await env.FILES.delete(r2KeyFromSrc(row.src))
      }
      catch (err) {
        console.warn('[favicon] delete stale object failed:', (err as Error).message)
      }
    }

    return { iconUrl: `uploads/${key}` }
  }
  catch (err) {
    return { error: (err as Error).message }
  }
}

// 获取站点图标: 抓取后下载并保存至 R2 (与手动上传的图标统一存储在 R2)
// 兼容旧前端/脚本: 内部 = 候选第一条 + 保存; 需要多候选选择时改用
// getSiteFaviconCandidates 拿列表 → saveSiteFavicon 保存选中项
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

  const saved = await storeFavicon(c.env, parsed.host, iconUrl)
  if ('error' in saved)
    return error(c, `acquisition failed: ${saved.error}`)

  return successData(c, { iconUrl: saved.iconUrl })
})

// 获取站点图标候选列表 (一次抓取返回多条, 前端在 ≥2 个候选时弹窗让用户选一张)
app.post('/itemIcon/getSiteFaviconCandidates', authMiddleware(), async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url)
    return errorByCode(c, 1400)

  // 无候选 (含 url 非法/页面抓不到) 返回空数组而不是报错, 由前端统一提示「获取失败」
  const candidates = await getSiteFaviconCandidates(url)
  return successData(c, { candidates })
})

// 保存用户选中的站点图标 (下载 → 内容校验 → R2 覆盖写 → file 行 UPSERT → 旧扩展名对象回收)
app.post('/itemIcon/saveSiteFavicon', authMiddleware(), async (c) => {
  const body = await c.req.json<{ url?: string; pageUrl?: string }>().catch(() => null)
  const iconUrl = typeof body?.url === 'string' ? body.url.trim() : ''
  const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl.trim() : ''
  if (!iconUrl || !pageUrl)
    return errorByCode(c, 1400)

  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  }
  catch {
    return error(c, 'acquisition failed: invalid url')
  }

  // 只保存内容校验通过的图片 (下载失败/非图片/超限都会返回 error), 不做任意 URL 代理
  const saved = await storeFavicon(c.env, parsed.host, iconUrl)
  if ('error' in saved)
    return error(c, `acquisition failed: ${saved.error}`)

  return successData(c, { iconUrl: saved.iconUrl })
})

export default app
