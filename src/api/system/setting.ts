import { Hono } from 'hono'
import type { Env } from '../../types'
import { errorByCode, success, successData } from '../../utils/response'
import { authMiddleware } from '../../middleware/auth'
import { getSetting, setSetting } from '../../utils/settings'

const app = new Hono<{ Bindings: Env }>()

const SETTING_CUSTOM_CSS = 'custom_css'
const SETTING_CUSTOM_JS = 'custom_js'

// 获取自定义 CSS/JS (公开接口: 前端在所有页面注入, 包括公开模式的只读视图)
app.post('/getCustomCode', async (c) => {
  const [customCss, customJs] = await Promise.all([
    getSetting(c.env.DB, SETTING_CUSTOM_CSS),
    getSetting(c.env.DB, SETTING_CUSTOM_JS),
  ])
  return successData(c, {
    customCss: customCss ?? '',
    customJs: customJs ?? '',
  })
})

// 保存自定义 CSS/JS
app.post('/saveCustomCode', authMiddleware(), async (c) => {
  const body = await c.req.json<{ customCss?: unknown; customJs?: unknown }>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)
  if (typeof body.customCss !== 'string' || typeof body.customJs !== 'string')
    return errorByCode(c, 1400)

  await setSetting(c.env.DB, SETTING_CUSTOM_CSS, body.customCss)
  await setSetting(c.env.DB, SETTING_CUSTOM_JS, body.customJs)
  return success(c)
})

export default app
