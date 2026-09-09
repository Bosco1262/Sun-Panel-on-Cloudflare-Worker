import { Hono } from 'hono'
import type { Env } from '../../types'
import { errorByCode, errorByCodeAndMsg, success, successData } from '../../utils/response'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

interface ModuleConfigRow {
  id: number
  name: string
  value_json: string
  createTime: string
  created_at: string
  updateTime: string
  updated_at: string
}

interface ModuleConfigBody {
  name?: string
  value?: Record<string, unknown> | null
}

// 按名称获取模块配置 (无记录时返回成功但无 data, 与 Go 版一致)
app.post('/moduleConfig/getByName', authMiddleware(), async (c) => {
  const body = await c.req.json<ModuleConfigBody>().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name : ''
  if (!name)
    return errorByCode(c, 1400)

  const row = await c.env.DB
    .prepare('SELECT * FROM module_config WHERE deleted_at IS NULL AND name = ?')
    .bind(name)
    .first<ModuleConfigRow>()

  if (!row)
    return success(c)

  let value: Record<string, unknown> | null = null
  try {
    value = JSON.parse(row.value_json)
  }
  catch {
    value = null
  }

  return successData(c, value)
})

// 保存模块配置 (upsert)
app.post('/moduleConfig/save', authMiddleware(), async (c) => {
  const body = await c.req.json<ModuleConfigBody>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)

  const name = typeof body.name === 'string' ? body.name : ''
  if (!name)
    return errorByCode(c, 1400)

  const valueJson = JSON.stringify(body.value ?? {})

  try {
    await c.env.DB
      .prepare(
        'INSERT INTO module_config (name, value_json) VALUES (?, ?) '
        + 'ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime(\'now\')',
      )
      .bind(name, valueJson)
      .run()
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

export default app
