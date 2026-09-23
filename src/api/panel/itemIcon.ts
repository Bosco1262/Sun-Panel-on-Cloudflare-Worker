import { Hono } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import type { Env } from '../../types'
import { error, errorByCode, internalError, logInternalError, success, successData, successList } from '../../utils/response'
import { REQUEST_BODY_LIMIT, bodyLimit } from '../../utils/bodyLimit'
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

/**
 * Maximum length of onlyName (the unique identifier): longer values are truncated, so odd input cannot reach the database
 *
 * onlyName (唯一标识) 的最大长度: 超长直接截断, 避免异常输入写库
 */
const ONLY_NAME_MAX_LENGTH = 50

/**
 * Caps on the two batch endpoints (security review V-05, see docs/security.md §3)
 *
 * `addMultiple` turns every element into one `INSERT` of a single `db.batch()` call and `saveSort` into one
 * `UPDATE` per element, so an unbounded array is a direct resource amplifier for an authenticated caller.
 * 1000 is far above any real import (an imported panel with more than a thousand entries is not a panel).
 *
 *
 * 两个批量接口的条数上限 (安全审查 V-05, 见 docs/security.md §3)
 *
 * `addMultiple` 会把每个元素变成同一次 `db.batch()` 里的一条 `INSERT`, `saveSort` 则是每元素一条 `UPDATE`,
 * 不限长的数组对已认证调用方来说就是直接可用的资源放大器。
 * 1000 远高于任何真实导入 (超过一千条的项目面板已经不是面板了)。
 */
const MAX_BATCH_ITEMS = 1000
const MAX_SORT_ITEMS = 1000
/** Same reasoning as `MAX_DELETE_IDS` in src/api/system/file.ts / 与 src/api/system/file.ts 的 MAX_DELETE_IDS 同理 */
const MAX_DELETE_IDS = 500

/**
 * Normalises the unique identifier: trims, keeps only letters/digits/underscore/hyphen, and caps the length
 *
 * Consistent with EditItem's live filtering on the frontend, but the server decides — imported data comes from
 * a file and cannot be trusted.
 *
 *
 * 归一化唯一标识: 去空白 + 只保留英文/数字/下划线/中划线 + 限长
 *
 * 与前端 EditItem 的即时过滤保持一致, 但以服务端为准 —— 导入的数据来自文件, 不可信。
 */
function sanitizeOnlyName(raw: unknown): string {
  if (typeof raw !== 'string')
    return ''
  return raw.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, ONLY_NAME_MAX_LENGTH)
}

/**
 * Set of identifiers already taken (soft-deleted rows do not count, matching the per-item edit check)
 *
 * 已占用的唯一标识集合 (软删的不算, 与单条 edit 的判定一致)
 */
async function loadTakenOnlyNames(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT only_name FROM item_icon WHERE deleted_at IS NULL AND only_name != \'\'')
    .all<{ only_name: string }>()
  return new Set(results.map(row => row.only_name))
}

// Create / update an icon
// 新增/修改图标
app.post('/itemIcon/edit', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<ItemIconBody>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)

  if (!body.itemIconGroupId || body.itemIconGroupId === 0)
    return errorByCode(c, 1404)

  const db = c.env.DB
  const iconJson = JSON.stringify(body.icon ?? {})
  const title = body.title ?? ''
  const url = body.url ?? ''
  const lanUrl = body.lanUrl ?? ''
  const description = body.description ?? ''
  const openMethod = body.openMethod ?? 0
  const onlyName = sanitizeOnlyName(body.onlyName)

  // Uniqueness check for the identifier (aligned with upstream's onlyNameExisted)
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

// Add icons in bulk (used by the import flow: `sort` preserves the original order, `onlyName` preserves the identifier)
// 批量添加图标 (导入流程使用: 携带 sort 保真顺序, 携带 onlyName 保真唯一标识)
app.post('/itemIcon/addMultiple', bodyLimit(REQUEST_BODY_LIMIT.large), authMiddleware(), async (c) => {
  const list = await c.req.json<ItemIconBody[]>().catch(() => null)
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BATCH_ITEMS)
    return errorByCode(c, 1400)

  for (const item of list) {
    if (!item.itemIconGroupId || item.itemIconGroupId === 0)
      return errorByCode(c, 1404)
  }

  const db = c.env.DB

  // onlyName edge cases (same semantics as the single-item edit):
  // after normalisation (trim / drop invalid characters / cap the length), any identifier already taken in the
  // database or duplicated inside this batch is downgraded to an empty string, and the dropped identifiers are
  // reported back to the frontend — an import must not fail as a whole over one duplicate, but it must not write
  // conflicting data either.
  //
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
    // `sort` comes from the import flow (to preserve the original order); a missing or invalid value uses 9999 = append at the end
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

// List icons by group
// 按分组获取图标列表
app.post('/itemIcon/getListByGroupId', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
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

// Delete icons (soft-delete the records + clean up images that are no longer referenced)
// 删除图标 (软删记录 + 清理不再被引用的图片)
app.post('/itemIcon/deletes', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => typeof v === 'number') : []
  if (ids.length === 0 || ids.length > MAX_DELETE_IDS)
    return errorByCode(c, 1400)

  const placeholders = ids.map(() => '?').join(',')
  let iconJsons: string[] = []

  try {
    // Collect the icons of the items about to be deleted, so that afterwards we can tell which images nobody uses
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
    return internalError(c, 1200, 'itemIcon/deletes', err)
  }

  // R2 cleanup happens after the database writes and only logs on failure (cleanupUploads already swallows them).
  // With the switch off nothing is reclaimed automatically: the images stay in the upload-file manager for reuse
  // and can be cleaned up manually with "Clean unused files".
  //
  // R2 清理放在 DB 写入之后, 失败只记日志 (cleanupUploads 内部已兜住)
  // 开关关闭时不自动回收: 图片留在「上传文件管理」里可复用, 需要时手动点「清理未引用文件」
  if (await getAutoCleanUnused(c.env.DB))
    await cleanupUploads(c.env.DB, c.env.FILES, iconJsons.map(srcFromIconJson))

  return success(c)
})

// Save the icon order
// 保存图标排序
app.post('/itemIcon/saveSort', bodyLimit(REQUEST_BODY_LIMIT.large), authMiddleware(), async (c) => {
  const body = await c.req.json<{ sortItems?: Array<{ id: number; sort: number }>; itemIconGroupId?: number }>().catch(() => null)
  const sortItems = Array.isArray(body?.sortItems) ? body.sortItems : []
  const groupId = typeof body?.itemIconGroupId === 'number' ? body.itemIconGroupId : 0
  if (sortItems.length === 0 || sortItems.length > MAX_SORT_ITEMS || !groupId)
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
    return internalError(c, 1200, 'itemIcon/saveSort', err)
  }

  return success(c)
})

/**
 * Downloads and stores a site icon: the R2 key is stable per site (icons/<md5(host)>.<ext>) and overwritten, and
 * the file row is UPSERTed. When the extension changes the old object is reclaimed (guarded both by the automatic
 * reclamation switch and by the reference check). On failure it returns { error }, which each route turns into
 * 'acquisition failed: ...' (the same wording as the old implementation).
 *
 *
 * 下载并保存站点图标: R2 key 按站点稳定 (icons/<md5(host)>.<ext>) 覆盖写, file 行 UPSERT。
 * 扩展名变化时回收旧对象 (受自动回收开关 + 引用检查双重保护)。
 * 失败时返回 { error }, 由各路由拼成 'acquisition failed: ...' (与旧实现同文案)。
 */
async function storeFavicon(env: Env, host: string, iconUrl: string): Promise<{ iconUrl: string } | { error: string }> {
  const img = await downloadFavicon(iconUrl)
  if (!img)
    return { error: 'download favicon error' }

  // downloadFavicon already guarantees an image type; the extension follows the Content-Type
  // (so extension-less URLs such as icon.horse are not misjudged), with the URL extension as a fallback.
  //
  // downloadFavicon 已保证是图片类型; 扩展名以 Content-Type 为准
  // (避免 icon.horse 这类无扩展名 URL 误判), URL 扩展名仅作兜底
  const urlExt = extFromUrl(iconUrl)
  const ext = extFromContentType(img.contentType) || (isImageExt(urlExt) ? urlExt : '.png')
  const contentType = contentTypeFromExt(ext)

  // Store in R2 + record in the file table (fileName uses the site host, same as the Go version).
  // The key is stable per site (icons/<md5(host)>.<ext>): fetching again overwrites the same object instead of
  // piling up one more copy in R2 per click like the old implementation (whose key contained Date.now()).
  //
  // 保存到 R2 + 记录到 file 表 (fileName 使用站点域名, 与 Go 版一致)
  // key 按站点稳定 (icons/<md5(host)>.<ext>): 重复获取会覆盖同一个对象,
  // 不再像旧实现那样每点一次就往 R2 里堆一份 (旧 key 带 Date.now(), 必然新建)
  const key = buildIconKey(host, ext)
  const src = `./uploads/${key}`
  try {
    await env.FILES.put(key, img.data, { httpMetadata: { contentType } })

    // Existing records of this site: used to decide between overwrite, extension change and first write
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
      // The extension changed (say .png before, .ico now): reuse the old row and clean the old object up afterwards
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

    // Clean up the stale object left behind by an extension change.
    // Two guards: nothing is deleted while automatic reclamation is off, and nothing is deleted while the old icon
    // is still referenced by an item / the background / the avatar (otherwise an icon in use would start returning 404).
    //
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
    // V-04 (see docs/security.md §3): the raw R2/D1 message used to be forwarded verbatim; the log keeps it,
    // the caller gets a generic sentence that names the step instead of the storage internals.
    //
    // V-04 (见 docs/security.md §3): 原先会把 R2/D1 的原始信息原样转发; 现在日志保留细节,
    // 调用方只拿到一句指明步骤的通用文案, 不含存储内部信息。
    logInternalError('favicon/store', err)
    return { error: 'store favicon error' }
  }
}

// Fetch a site icon: download it and store it in R2 (so manual uploads and fetched icons live in the same place).
// Kept for old frontends/scripts: internally it is "first candidate + store"; for multi-candidate selection use
// getSiteFaviconCandidates to fetch the list and then saveSiteFavicon to store the chosen one.
//
// 获取站点图标: 抓取后下载并保存至 R2 (与手动上传的图标统一存储在 R2)
// 兼容旧前端/脚本: 内部 = 候选第一条 + 保存; 需要多候选选择时改用
// getSiteFaviconCandidates 拿列表 → saveSiteFavicon 保存选中项
app.post('/itemIcon/getSiteFavicon', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
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

// Fetch the site icon candidates (one fetch returns several entries; the frontend shows a dialog when there are ≥2)
// 获取站点图标候选列表 (一次抓取返回多条, 前端在 ≥2 个候选时弹窗让用户选一张)
app.post('/itemIcon/getSiteFaviconCandidates', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null)
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url)
    return errorByCode(c, 1400)

  // No candidates (including an invalid url / an unreachable page) returns an empty array instead of an error; the frontend shows a uniform "fetch failed"
  // 无候选 (含 url 非法/页面抓不到) 返回空数组而不是报错, 由前端统一提示「获取失败」
  const candidates = await getSiteFaviconCandidates(url)
  return successData(c, { candidates })
})

// Store the site icon the user picked (download → content validation → R2 overwrite → file row UPSERT → reclaim the old-extension object)
// 保存用户选中的站点图标 (下载 → 内容校验 → R2 覆盖写 → file 行 UPSERT → 旧扩展名对象回收)
app.post('/itemIcon/saveSiteFavicon', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
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

  // Only images that pass content validation are stored (a failed download / non-image / oversized body all return an error); arbitrary URL proxying is never done
  // 只保存内容校验通过的图片 (下载失败/非图片/超限都会返回 error), 不做任意 URL 代理
  const saved = await storeFavicon(c.env, parsed.host, iconUrl)
  if ('error' in saved)
    return error(c, `acquisition failed: ${saved.error}`)

  return successData(c, { iconUrl: saved.iconUrl })
})

export default app
