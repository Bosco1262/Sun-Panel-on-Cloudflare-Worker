import { Hono } from 'hono'
import type { Env } from '../types'
import { passwordEncryption } from '../utils/password'
import { errorByCode, success, successData } from '../utils/response'
import {
  SETTING_ADMIN_HEAD_IMAGE,
  SETTING_ADMIN_NAME,
  SETTING_ADMIN_PASSWORD,
  SETTING_ADMIN_USERNAME,
  getSetting,
  getUserProfile,
  setSetting,
} from '../utils/settings'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

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

// 修改登录信息（用户名 + 密码）
app.post('/user/updatePassword', authMiddleware(), async (c) => {
  const body = await c.req.json<{ username?: string; oldPassword?: string; newPassword?: string }>().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const oldPassword = typeof body?.oldPassword === 'string' ? body.oldPassword : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  if (!username || username.length > 20)
    return errorByCode(c, 1400)
  if (!oldPassword || !newPassword || newPassword.length < 6 || newPassword.length > 20)
    return errorByCode(c, 1400)

  const storedPassword = await getSetting(c.env.DB, SETTING_ADMIN_PASSWORD)
  if (storedPassword === null || passwordEncryption(oldPassword) !== storedPassword)
    return errorByCode(c, 1007)

  await setSetting(c.env.DB, SETTING_ADMIN_USERNAME, username)
  await setSetting(c.env.DB, SETTING_ADMIN_PASSWORD, passwordEncryption(newPassword))
  return success(c)
})

export default app
