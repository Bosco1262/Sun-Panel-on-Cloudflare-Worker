import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env } from '../../types'
import { checkPassword, hashPassword, passwordEncryption, resolveIterations } from '../../utils/password'
import { bumpAuthEpoch } from '../../utils/authEpoch'
import { errorByCode, errorByCodeAndMsg, success, successData } from '../../utils/response'
import {
  SETTING_ADMIN_HEAD_IMAGE,
  SETTING_ADMIN_NAME,
  SETTING_ADMIN_PASSWORD,
  SETTING_ADMIN_USERNAME,
  getSetting,
  getUserProfile,
  setSetting,
} from '../../utils/settings'
import { authMiddleware } from '../../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

/**
 * 校验当前密码 (改密 / 改用户名共用)
 *
 * 返回 null 表示通过, 否则返回可直接回给前端的错误响应。
 * 注意: 代码 1009 故意不放进 ERROR_CODE_MAP, 这样 errorByCodeAndMsg 会原样带上我们的提示
 * (放进表里的话会被表里的通用文案覆盖)。
 */
async function ensurePasswordOk(c: Context<{ Bindings: Env }>, plain: string) {
  const stored = await getSetting(c.env.DB, SETTING_ADMIN_PASSWORD)
  if (stored === null)
    return errorByCode(c, 1007)

  const pepper = c.env.PASSWORD_PEPPER ?? ''
  const outcome = await checkPassword(plain, stored, pepper)

  if (outcome === 'pepper-missing' || outcome === 'pepper-changed') {
    console.error(`[user] PASSWORD_PEPPER ${outcome === 'pepper-missing' ? '未配置' : '与现有密码哈希不匹配'}`)
    return errorByCodeAndMsg(
      c,
      1009,
      outcome === 'pepper-missing'
        ? '服务端未配置 PASSWORD_PEPPER，无法校验当前密码，请执行 wrangler secret put PASSWORD_PEPPER 后重试'
        : 'PASSWORD_PEPPER 与当前密码哈希不匹配，请恢复原有 secret 后重试',
    )
  }

  if (outcome !== 'ok')
    return errorByCode(c, 1007)

  return null
}

// 当前用户信息
app.post('/user/getInfo', authMiddleware(), async (c) => {
  const user = await getUserProfile(c.env.DB, c.get('uid'))
  return successData(c, {
    userId: user.id,
    id: user.id,
    headImage: user.headImage,
    name: user.name,
    role: user.role,
  })
})

// 认证信息 (前端 updateLocalUserInfo 调用; 单用户模式 visitMode 固定 0=登录模式)
app.post('/user/getAuthInfo', authMiddleware(), async (c) => {
  const user = await getUserProfile(c.env.DB, c.get('uid'))
  return successData(c, {
    user,
    visitMode: 0,
  })
})

// 修改资料
app.post('/user/updateInfo', authMiddleware(), async (c) => {
  const body = await c.req.json<{ headImage?: string; name?: string }>().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const headImage = typeof body?.headImage === 'string' ? body.headImage : ''
  if (name.length < 3 || name.length > 15)
    return errorByCode(c, 1400)

  await setSetting(c.env.DB, SETTING_ADMIN_NAME, name)
  await setSetting(c.env.DB, SETTING_ADMIN_HEAD_IMAGE, headImage)
  return success(c)
})

// 修改密码（仅密码, 不改用户名）
app.post('/user/updatePassword', authMiddleware(), async (c) => {
  const body = await c.req.json<{ oldPassword?: string; newPassword?: string }>().catch(() => null)
  const oldPassword = typeof body?.oldPassword === 'string' ? body.oldPassword : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  if (!oldPassword || !newPassword || newPassword.length < 6 || newPassword.length > 20)
    return errorByCode(c, 1400)

  const failed = await ensurePasswordOk(c, oldPassword)
  if (failed)
    return failed

  const pepper = c.env.PASSWORD_PEPPER ?? ''
  if (pepper) {
    await setSetting(
      c.env.DB,
      SETTING_ADMIN_PASSWORD,
      await hashPassword(newPassword, pepper, resolveIterations(c.env.PASSWORD_PBKDF2_ITERATIONS)),
    )
  }
  else {
    // 未配置 pepper 时维持旧行为 (兼容优先), 但把风险写进日志
    console.warn('[user] PASSWORD_PEPPER 未配置, 仍写入旧版三重 MD5 哈希; 建议执行 wrangler secret put PASSWORD_PEPPER')
    await setSetting(c.env.DB, SETTING_ADMIN_PASSWORD, passwordEncryption(newPassword))
  }

  // 改密后让所有已签发的 token 失效 (含当前这个, 前端会在下一个请求收到 1001 并跳登录页)
  await bumpAuthEpoch(c.env.DB)

  return success(c)
})

// 修改用户名（需当前密码校验, 不改密码）
app.post('/user/updateUsername', authMiddleware(), async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!username || username.length > 20)
    return errorByCode(c, 1400)
  if (!password)
    return errorByCode(c, 1400)

  const failed = await ensurePasswordOk(c, password)
  if (failed)
    return failed

  await setSetting(c.env.DB, SETTING_ADMIN_USERNAME, username)
  // 账号标识变了, 也让旧 token 失效
  await bumpAuthEpoch(c.env.DB)
  return success(c)
})

export default app
