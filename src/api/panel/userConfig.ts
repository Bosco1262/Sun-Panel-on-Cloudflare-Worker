import { Hono } from 'hono'
import type { Env } from '../../types'
import { apiReturn, errorByCode, errorByCodeAndMsg, success, successData } from '../../utils/response'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

interface UserConfigBody {
  panel?: Record<string, unknown> | null
  searchEngine?: Record<string, unknown> | null
}

interface UserConfigRow {
  id: number
  panel_json: string
  search_engine_json: string
  createTime: string
  created_at: string
  updateTime: string
  updated_at: string
}

// 获取面板配置 (无记录时返回 code -1, 与 Go 版 ErrorDataNotFound 一致)
app.post('/userConfig/get', authMiddleware(), async (c) => {
  const row = await c.env.DB
    .prepare('SELECT * FROM user_config WHERE id = 1')
    .first<UserConfigRow>()

  if (!row)
    return apiReturn(c, -1, 'Server error')

  let panel: Record<string, unknown> | null = null
  let searchEngine: Record<string, unknown> | null = null
  try {
    panel = JSON.parse(row.panel_json)
  }
  catch {
    panel = null
  }
  try {
    searchEngine = JSON.parse(row.search_engine_json)
  }
  catch {
    searchEngine = null
  }

  return successData(c, { panel, searchEngine })
})

// 保存面板配置
// panel 与 searchEngine 同属一行数据: 只提交其中一个字段时保留另一个字段的原值,
// 避免「改样式」把搜索引擎配置(或反之)清空
app.post('/userConfig/set', authMiddleware(), async (c) => {
  const body = await c.req.json<UserConfigBody>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)

  const hasPanel = body.panel !== undefined && body.panel !== null
  const hasSearchEngine = body.searchEngine !== undefined && body.searchEngine !== null
  if (!hasPanel && !hasSearchEngine)
    return errorByCode(c, 1400)

  const current = await c.env.DB
    .prepare('SELECT panel_json, search_engine_json FROM user_config WHERE id = 1')
    .first<Pick<UserConfigRow, 'panel_json' | 'search_engine_json'>>()

  const panelJson = hasPanel ? JSON.stringify(body.panel) : (current?.panel_json ?? '{}')
  const searchEngineJson = hasSearchEngine ? JSON.stringify(body.searchEngine) : (current?.search_engine_json ?? '{}')

  try {
    await c.env.DB
      .prepare(
        'INSERT INTO user_config (id, panel_json, search_engine_json) VALUES (1, ?, ?) '
        + 'ON CONFLICT(id) DO UPDATE SET panel_json = excluded.panel_json, search_engine_json = excluded.search_engine_json, updated_at = datetime(\'now\')',
      )
      .bind(panelJson, searchEngineJson)
      .run()
  }
  catch (err) {
    return errorByCodeAndMsg(c, 1200, (err as Error).message)
  }

  return success(c)
})

export default app
