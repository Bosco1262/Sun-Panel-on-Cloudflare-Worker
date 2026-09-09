import { Hono } from 'hono'
import type { Env } from '../../types'
import { buildR2Key, contentTypeFromExt, r2KeyFromSrc } from '../../utils/file'
import { errorByCode, errorByCodeAndMsg, success, successData, successList } from '../../utils/response'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

const IMG_AGREE_EXTS = ['.png', '.jpg', '.gif', '.jpeg', '.webp', '.svg', '.ico']

interface FileRow {
  id: number
  src: string
  file_name: string
  method: number
  ext: string
  created_at: string
  updated_at: string
}

// 上传单张图片 (表单字段: imgfile)
app.post('/file/uploadImg', authMiddleware(), async (c) => {
  const form = await c.req.formData().catch(() => null)
  if (!form)
    return errorByCode(c, 1300)

  const file = form.get('imgfile')
  if (!(file instanceof File))
    return errorByCode(c, 1300)

  const ext = file.name.includes('.')
    ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    : ''
  if (!IMG_AGREE_EXTS.includes(ext))
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
    return errorByCodeAndMsg(c, 1300, (err as Error).message)
  }
})

// 批量上传文件 (表单字段: files[])
app.post('/file/uploadFiles', authMiddleware(), async (c) => {
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

// 文件列表
app.post('/file/getList', authMiddleware(), async (c) => {
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

// 删除文件 (R2 + 记录)
app.post('/file/deletes', authMiddleware(), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null)
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is number => typeof v === 'number') : []
  if (ids.length === 0)
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
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

export default app
