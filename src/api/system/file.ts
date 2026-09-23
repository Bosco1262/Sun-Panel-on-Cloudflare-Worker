import { Hono } from 'hono'
import type { Env } from '../../types'
import { buildR2Key, contentTypeFromExt, isAllowedExt, isImageExt, r2KeyFromSrc } from '../../utils/file'
import { cleanupUploads, normalizeUploadSrc } from '../../utils/uploadRefs'
import { errorByCode, internalError, success, successData, successList } from '../../utils/response'
import { REQUEST_BODY_LIMIT, bodyLimit } from '../../utils/bodyLimit'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

/**
 * Cap on one delete request (security review V-05, see docs/security.md §3): the ids become bound parameters of a
 * single statement and the matching rows become one R2 delete each, so an unbounded list is both a D1
 * parameter-limit error and a subrequest burst
 *
 * 单次删除的条数上限 (安全审查 V-05, 见 docs/security.md §3): ids 会变成同一条语句的绑定参数,
 * 命中的行还会各占一次 R2 删除, 不限长的列表既会撞上 D1 的参数上限, 也会造成子请求突发
 */
const MAX_DELETE_IDS = 500

interface FileRow {
  id: number
  src: string
  file_name: string
  method: number
  ext: string
  created_at: string
  updated_at: string
}

// Upload a single image (form field: imgfile)
// 上传单张图片 (表单字段: imgfile)
app.post('/file/uploadImg', bodyLimit({ maxSize: REQUEST_BODY_LIMIT.upload, bufferBody: false }), authMiddleware(), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form)
    return errorByCode(c, 1300)

  const file = form.get('imgfile')
  if (!(file instanceof File))
    return errorByCode(c, 1300)

  const ext = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    : ''
  if (!isImageExt(ext))
    return errorByCode(c, 1301)

  const key = buildR2Key(file.name, ext)
  try {
    const uploaded = await c.env.FILES.put(key, file.stream(), {
      httpMetadata: { contentType: contentTypeFromExt(ext) },
    })
    const src = `./uploads/${key}`
    await c.env.DB
      .prepare('INSERT INTO file (src, file_name, method, ext) VALUES (?, ?, 0, ?)')
      .bind(src, file.name, ext)
      .run()
    return successData(c, { imageUrl: `uploads/${key}`, etag: uploaded.httpEtag })
  }
  catch (err) {
    // Storage detail stays in the log; the caller gets the generic 1300 message (security review V-04, see docs/security.md §3)
    // 存储层细节留在日志里, 调用方拿到 1300 的通用文案 (安全审查 V-04, 见 docs/security.md §3)
    return internalError(c, 1300, 'file/uploadImg', err)
  }
})

// Upload files in bulk (form field: files[])
// 批量上传文件 (表单字段: files[])
app.post('/file/uploadFiles', bodyLimit({ maxSize: REQUEST_BODY_LIMIT.upload, bufferBody: false }), authMiddleware(), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form)
    return errorByCode(c, 1300)

  const files = form.getAll('files[]').filter((v): v is File => v instanceof File)
  const succMap: Record<string, string> = {}
  const errFiles: string[] = []

  for (const file of files) {
    const ext = file.name.includes('.')
      ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
      : ''
    // Whitelist check: arbitrary types must not be written to R2 and then served same-origin
    // 白名单校验: 不允许任意类型写入 R2 再从同源返回
    if (!isAllowedExt(ext)) {
      errFiles.push(file.name)
      continue
    }
    const key = buildR2Key(file.name, ext)
    try {
      await c.env.FILES.put(key, file.stream(), {
        httpMetadata: { contentType: contentTypeFromExt(ext) },
      })
      const src = `./uploads/${key}`
      await c.env.DB
        .prepare('INSERT INTO file (src, file_name, method, ext) VALUES (?, ?, 0, ?)')
        .bind(src, file.name, ext)
        .run()
      succMap[file.name] = `uploads/${key}`
    }
    catch {
      errFiles.push(file.name)
    }
  }

  return successData(c, { succMap, errFiles })
})

// File list
// 文件列表
app.post('/file/getList', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM file WHERE deleted_at IS NULL ORDER BY created_at DESC')
    .all<FileRow>()

  const list = results.map(row => ({
    src: row.src.replace(/^\.\//, ''),
    fileName: row.file_name,
    id: row.id,
    createTime: row.created_at,
    updateTime: row.updated_at,
    path: row.src,
    ext: row.ext,
  }))

  return successList(c, list, list.length)
})

/**
 * Clean up unreferenced files (R2 + records)
 *
 * An image may be referenced by item icons / panel backgrounds / the avatar / custom CSS-JS at the same time, so
 * all of it goes through cleanupUploads and its reference check (string containment, deliberately conservative).
 *
 * Batching: the Workers free plan allows at most 50 subrequests per invocation and each object costs one R2
 * delete — so one call handles at most `limit` candidates (30 by default) and returns `remaining` for the
 * frontend to continue with.
 *
 *
 * 清理未被引用的文件 (R2 + 记录)
 *
 * 图片可能同时被项目图标 / 面板背景 / 头像 / 自定义 CSS/JS 引用, 所以统一交给
 * cleanupUploads 做引用检查 (字符串包含判定, 偏保守)。
 *
 * 分批: Workers 免费版每次调用最多 50 个子请求, 而每个对象要花 1 次 R2 删除 ——
 * 所以单次最多处理 `limit` 个候选 (默认 30), 返回 remaining 让前端继续调用。
 */
const DEFAULT_CLEAN_LIMIT = 30
const MAX_CLEAN_LIMIT = 60

app.post('/file/cleanUnused', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<{ limit?: unknown }>().catch(() => null)
  const limit = typeof body?.limit === 'number' && Number.isFinite(body.limit)
    ? Math.min(Math.max(Math.floor(body.limit), 1), MAX_CLEAN_LIMIT)
    : DEFAULT_CLEAN_LIMIT

  const { results } = await c.env.DB
    .prepare('SELECT * FROM file WHERE deleted_at IS NULL ORDER BY created_at')
    .all<FileRow>()

  const { deleted, remaining } = await cleanupUploads(
    c.env.DB,
    c.env.FILES,
    results.map(row => normalizeUploadSrc(row.src)),
    limit,
  )

  return successData(c, { checked: results.length, deleted, remaining })
})

// Delete files (R2 + records)
// 删除文件 (R2 + 记录)
app.post('/file/deletes', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => typeof v === 'number') : []
  if (ids.length === 0 || ids.length > MAX_DELETE_IDS)
    return errorByCode(c, 1400)

  const placeholders = ids.map(() => '?').join(',')
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM file WHERE deleted_at IS NULL AND id IN (${placeholders})`)
    .bind(...ids)
    .all<FileRow>()

  try {
    await Promise.all(results.map(row => c.env.FILES.delete(r2KeyFromSrc(row.src))))
    await c.env.DB
      .prepare(`UPDATE file SET deleted_at = datetime('now') WHERE deleted_at IS NULL AND id IN (${placeholders})`)
      .bind(...ids)
      .run()
  }
  catch (err) {
    return internalError(c, 1200, 'file/deletes', err)
  }

  return success(c)
})

export default app
