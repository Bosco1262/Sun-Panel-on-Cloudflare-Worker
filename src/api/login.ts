import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, UserInfo } from '../types'
import { passwordEncryption } from '../utils/password'
import { signToken } from '../utils/jwt'
import { errorByCode, success, successData } from '../utils/response'
import {
  SETTING_ADMIN_HEAD_IMAGE,
  SETTING_ADMIN_NAME,
  SETTING_ADMIN_PASSWORD,
  SETTING_ADMIN_USERNAME,
  getSetting,
} from '../utils/settings'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

// 登录失败限流: 同一 IP 在窗口期内失败次数达到上限后锁定 (KV 存储, 无状态 Worker 适用)
const MAX_LOGIN_ATTEMPTS = 5
const RATE_WINDOW_SECONDS = 600 // 10 分钟
const RATE_KEY_PREFIX = 'login:fail:'

interface LoginRequest {
  username?: string
  password?: string
}

function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip')
    ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown'
  )
}

async function loginFailCount(kv: KVNamespace, ip: string): Promise<number> {
  const v = await kv.get(`${RATE_KEY_PREFIX}${ip}`)
  const n = Number(v ?? '0')
  return Number.isFinite(n) ? n : 0
}

async function recordLoginFail(kv: KVNamespace, ip: string): Promise<void> {
  const count = await loginFailCount(kv, ip)
  await kv.put(`${RATE_KEY_PREFIX}${ip}`, String(count + 1), { expirationTtl: RATE_WINDOW_SECONDS })
}

async function clearLoginFails(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(`${RATE_KEY_PREFIX}${ip}`)
}

// 登录
app.post('/login', async (c) => {
  const body = await c.req.json<LoginRequest>().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!username || !password)
    return errorByCode(c, 1400)

  const ip = clientIp(c)

  // 限流: 失败次数达到上限直接拒绝
  if (await loginFailCount(c.env.LOGIN_RATE, ip) >= MAX_LOGIN_ATTEMPTS)
    return errorByCode(c, 1008)

  const db = c.env.DB
  const [storedUsername, storedPassword, name, headImage] = await Promise.all([
    getSetting(db, SETTING_ADMIN_USERNAME),
    getSetting(db, SETTING_ADMIN_PASSWORD),
    getSetting(db, SETTING_ADMIN_NAME),
    getSetting(db, SETTING_ADMIN_HEAD_IMAGE),
  ])

  if (storedUsername === null || storedPassword === null || storedUsername !== username
    || passwordEncryption(password) !== storedPassword) {
    await recordLoginFail(c.env.LOGIN_RATE, ip)
    return errorByCode(c, 1003)
  }

  // 登录成功清除失败计数
  await clearLoginFails(c.env.LOGIN_RATE, ip)

  const user: UserInfo = {
    id: 1,
    username: storedUsername,
    name: name ?? storedUsername,
    headImage: headImage ?? '',
    role: 1,
  }

  const token = await signToken(c.env.JWT_SECRET, user)
  return successData(c, {
    ...user,
    status: 1,
    mail: '',
    isAdmin: 1,
    createTime: '',
    token,
  })
})

// 登出 (JWT 无状态, 前端删除 token 即可)
app.post('/logout', authMiddleware(), async (c) => success(c))

export default app
