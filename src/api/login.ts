import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, UserInfo } from '../types'
import { checkPassword, hashPassword, needsRehash, resolveIterations } from '../utils/password'
import { signToken } from '../utils/jwt'
import { errorByCode, errorByCodeAndMsg, success, successData } from '../utils/response'
import {
  SETTING_ADMIN_HEAD_IMAGE,
  SETTING_ADMIN_NAME,
  SETTING_ADMIN_PASSWORD,
  SETTING_ADMIN_USERNAME,
  getSetting,
  setSetting,
} from '../utils/settings'
import { clearFails, ensureLoginAttemptTable, isLocked, nowSeconds, readAttempt, recordFail } from '../utils/loginRate'
import { bumpAuthEpoch, getAuthEpoch } from '../utils/authEpoch'
import { clearAuthCookie, setAuthCookie } from '../utils/authCookie'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<{ Bindings: Env }>()

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

/**
 * 是否已触发限流 (fail-open)
 *
 * 限流是辅助防线, 表缺失或 D1 抖动时放行并记日志, 避免把管理员锁在面板外;
 * 真正的防线是密码本身。
 */
async function isRateLimited(c: Context<{ Bindings: Env }>, ip: string): Promise<boolean> {
  try {
    await ensureLoginAttemptTable(c.env.DB)
    return isLocked(await readAttempt(c.env.DB, ip), nowSeconds())
  }
  catch (err) {
    console.warn('[login] rate limit check failed, fail-open:', (err as Error).message)
    return false
  }
}

/** 记录一次失败 (fail-open, 失败只记日志) */
async function recordFailSafe(c: Context<{ Bindings: Env }>, ip: string): Promise<void> {
  try {
    await recordFail(c.env.DB, ip, nowSeconds())
  }
  catch (err) {
    console.warn('[login] record login failure failed:', (err as Error).message)
  }
}

/** 登录成功后清除失败计数 (fail-open, 失败只记日志) */
async function clearFailsSafe(c: Context<{ Bindings: Env }>, ip: string): Promise<void> {
  try {
    await clearFails(c.env.DB, ip)
  }
  catch (err) {
    console.warn('[login] clear login failures failed:', (err as Error).message)
  }
}

// 登录
app.post('/login', async (c) => {
  const body = await c.req.json<LoginRequest>().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!username || !password)
    return errorByCode(c, 1400)

  const ip = clientIp(c)

  // 限流: 同一 IP 在滑动窗口内失败达到上限直接拒绝 (D1 login_attempt 表)
  if (await isRateLimited(c, ip))
    return errorByCode(c, 1008)

  const db = c.env.DB
  const [storedUsername, storedPassword, name, headImage] = await Promise.all([
    getSetting(db, SETTING_ADMIN_USERNAME),
    getSetting(db, SETTING_ADMIN_PASSWORD),
    getSetting(db, SETTING_ADMIN_NAME),
    getSetting(db, SETTING_ADMIN_HEAD_IMAGE),
  ])

  if (storedUsername === null || storedPassword === null || storedUsername !== username) {
    await recordFailSafe(c, ip)
    return errorByCode(c, 1003)
  }

  // 密码校验: 旧版三重 MD5 仍然支持, 新版为 PBKDF2 + 盐 + pepper
  const pepper = c.env.PASSWORD_PEPPER ?? ''
  const iterations = resolveIterations(c.env.PASSWORD_PBKDF2_ITERATIONS)
  const outcome = await checkPassword(password, storedPassword, pepper)

  // pepper 相关的问题属于服务端配置错误: fail-closed 并给出可操作的提示,
  // 不能当成「密码错误」糊弄过去 (否则用户会一直以为是自己记错了密码)
  if (outcome === 'pepper-missing' || outcome === 'pepper-changed') {
    console.error(`[login] PASSWORD_PEPPER ${outcome === 'pepper-missing' ? '未配置' : '与现有密码哈希不匹配'}, 无法校验密码`)
    return errorByCodeAndMsg(
      c,
      1009,
      outcome === 'pepper-missing'
        ? '服务端未配置 PASSWORD_PEPPER，无法校验当前密码哈希，请执行 wrangler secret put PASSWORD_PEPPER 后重试'
        : 'PASSWORD_PEPPER 与当前密码哈希不匹配，请恢复原有 secret 后重试',
    )
  }

  if (outcome !== 'ok') {
    await recordFailSafe(c, ip)
    return errorByCode(c, 1003)
  }

  // 登录成功清除失败计数
  await clearFailsSafe(c, ip)

  // 旧格式 (或迭代数偏低) 且已配置 pepper: 借这次明文就地升级, 失败不影响登录
  if (pepper && needsRehash(storedPassword, iterations)) {
    try {
      await setSetting(db, SETTING_ADMIN_PASSWORD, await hashPassword(password, pepper, iterations))
    }
    catch (err) {
      console.warn('[login] password rehash failed:', (err as Error).message)
    }
  }

  const user: UserInfo = {
    id: 1,
    username: storedUsername,
    name: name ?? storedUsername,
    headImage: headImage ?? '',
    role: 1,
  }

  const token = await signToken(c.env.JWT_SECRET, user, await getAuthEpoch(db))

  // 会话承载在 HttpOnly Cookie 上 (§9.4); 响应体里的 token 保留给脚本/第三方工具使用
  setAuthCookie(c, token)

  return successData(c, {
    ...user,
    status: 1,
    mail: '',
    isAdmin: 1,
    createTime: '',
    token,
  })
})

// 登出
// 清掉会话 Cookie (前端也会清本地缓存); 传 allDevices=true 时递增世代,
// 让此前签发的所有 token (含其它设备上的 Cookie) 立即失效
app.post('/logout', authMiddleware(), async (c) => {
  const body = await c.req.json<{ allDevices?: boolean }>().catch(() => null)
  if (body?.allDevices)
    await bumpAuthEpoch(c.env.DB)

  clearAuthCookie(c)

  return success(c)
})

export default app
