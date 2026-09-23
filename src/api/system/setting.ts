import { Hono } from 'hono'
import type { Env } from '../../types'
import { errorByCode, success, successData } from '../../utils/response'
import { REQUEST_BODY_LIMIT, bodyLimit } from '../../utils/bodyLimit'
import { authMiddleware } from '../../middleware/auth'
import {
  SETTING_AUTO_CLEAN_UNUSED,
  SETTING_CUSTOM_CSS,
  SETTING_CUSTOM_JS,
  getAutoCleanUnused,
  getSetting,
  setSetting,
} from '../../utils/settings'

const app = new Hono<{ Bindings: Env }>()

// Read the custom CSS/JS
// 获取自定义 CSS/JS
//
// Authenticated (security review V-03, see docs/security.md §3). It used to be a public endpoint "because the
// read-only public view also injects it", but this port has no public mode at all (see docs/search-engine.md:
// getAuthInfo always returns visitMode 0), so the only thing the public endpoint achieved was handing any anonymous
// visitor the full source of the custom JS/CSS — i.e. internal hostnames, endpoints and any secret an operator stored there.
//
// The frontend calls it after the token exists (App.vue, GlobalSetting dialog) and skips injection when it is
// missing, so an unauthenticated page load simply has no custom code.
//
// 需要鉴权 (安全审查 V-03, 见 docs/security.md §3)。它原先公开的理由是「公开模式的只读视图也要注入」, 但本移植版根本没有公开模式
// (见 docs/search-engine.md: getAuthInfo 固定返回 visitMode 0), 于是公开接口唯一的效果就是把自定义
// JS/CSS 的完整源码交给任意匿名访客 —— 也就是内网域名、接口路径与运维写在里面的任何密钥。
//
// 前端在有 token 之后才调用 (App.vue、GlobalSetting 弹窗), 没有 token 时跳过注入,
// 因此未登录页面只是没有自定义代码而已。
app.post('/getCustomCode', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const [customCss, customJs] = await Promise.all([
    getSetting(c.env.DB, SETTING_CUSTOM_CSS),
    getSetting(c.env.DB, SETTING_CUSTOM_JS),
  ])
  return successData(c, {
    customCss: customCss ?? '',
    customJs: customJs ?? '',
  })
})

// Save the custom CSS/JS
// 保存自定义 CSS/JS
app.post('/saveCustomCode', bodyLimit(REQUEST_BODY_LIMIT.large), authMiddleware(), async (c) => {
  const body = await c.req.json<{ customCss?: unknown; customJs?: unknown }>().catch(() => null)
  if (!body || typeof body !== 'object')
    return errorByCode(c, 1400)
  if (typeof body.customCss !== 'string' || typeof body.customJs !== 'string')
    return errorByCode(c, 1400)

  await setSetting(c.env.DB, SETTING_CUSTOM_CSS, body.customCss)
  await setSetting(c.env.DB, SETTING_CUSTOM_JS, body.customJs)
  return success(c)
})

// ===================== Storage settings =====================
// ===================== 存储设置 =====================

// Read the storage settings (currently only "reclaim unreferenced images on delete")
// 读取存储相关设置 (目前只有「删除时自动回收未引用图片」)
app.post('/getStorageSettings', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  return successData(c, {
    autoCleanUnused: await getAutoCleanUnused(c.env.DB),
  })
})

// Save the storage settings
// 保存存储相关设置
app.post('/saveStorageSettings', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<{ autoCleanUnused?: unknown }>().catch(() => null)
  if (typeof body?.autoCleanUnused !== 'boolean')
    return errorByCode(c, 1400)

  await setSetting(c.env.DB, SETTING_AUTO_CLEAN_UNUSED, body.autoCleanUnused ? '1' : '0')
  return success(c)
})

export default app
