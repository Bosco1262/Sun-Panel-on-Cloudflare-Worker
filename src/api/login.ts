import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Env, UserInfo } from '../types'
import { checkPassword, hashPassword, needsRehash, resolveIterations } from '../utils/password'
import { JWT_SECRET_MISSING_MSG, MissingJwtSecretError, signToken } from '../utils/jwt'
import { REQUEST_BODY_LIMIT, bodyLimit } from '../utils/bodyLimit'
import { apiReturn, errorByCode, errorByCodeAndMsg, success, successData } from '../utils/response'
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

/**
 * Bucket shared by callers whose IP cannot be determined (see `clientIp`)
 *
 * 无法确定来源 IP 的调用方共用的分桶 (见 `clientIp`)
 */
const UNKNOWN_IP_BUCKET = 'unknown'

/**
 * Normalises an IP-shaped header value into a bounded, single-token string
 *
 * Returns '' for anything that is not a plausible single value (empties, lists, oversized junk), so callers can
 * fall back to the shared bucket instead of writing arbitrary header text into the rate-limit key.
 *
 *
 * 把形如 IP 的头部值归一化为有界、单 token 的字符串
 *
 * 不像单个合法值的 (空、列表、超长垃圾) 一律返回 '', 让调用方回退到共享分桶,
 * 而不是把任意头部文本写进限流键。
 */
function normalizeIpHeader(value: string | undefined): string {
  const single = value?.split(',')[0]?.trim() ?? ''
  if (!single || single.length > 64)
    return ''
  return /^[0-9a-zA-Z.:_\-[\]]+$/.test(single) ? single : ''
}

/**
 * Rate-limit key of the caller (security review V-02A, see docs/security.md §3)
 *
 * Only `cf-connecting-ip` is trusted: Cloudflare sets it at the edge and overwrites whatever the client sent,
 * whereas `X-Forwarded-For` is client-controlled. The previous implementation fell back to `X-Forwarded-For`,
 * so on deployments where the header is absent at the Worker (a proxy in front, a non-standard route) an
 * attacker could send a different random value on every request and the 5-attempts-per-window limit never
 * triggered — turning the weak default password into an online brute-force target.
 *
 * When the header is missing the requests share a single `unknown` bucket. That is a deliberate fail-closed
 * choice: a misconfigured deployment still gets brute-force protection (it may be stricter than intended, i.e.
 * shared across callers, which the warning below tells the operator about), instead of silently losing it.
 *
 *
 * 限流用的调用方标识 (安全审查 V-02A, 见 docs/security.md §3)
 *
 * 只信任 `cf-connecting-ip`: 它由 Cloudflare 边缘写入并覆盖客户端发来的值, 而 `X-Forwarded-For` 由客户端
 * 控制。旧实现会回退到 `X-Forwarded-For`, 于是在「Worker 拿不到该头」的部署形态下 (前面挂了反代、
 * 非标准链路), 攻击者每次请求都能带一个随机新值, 5 次/窗口的限制永远不会触发 ——
 * 弱默认口令因此变成在线爆破目标。
 *
 * 头部缺失时所有请求共用 `unknown` 分桶。这是刻意选择的 fail-closed: 配置有误的部署仍然保有爆破防护
 * (代价是比预期更严格 —— 分桶被多个调用方共用, 下面的告警会提示运维), 而不是悄悄失去防护。
 */
function clientIp(c: Context): string {
  const cloudflareIp = normalizeIpHeader(c.req.header('cf-connecting-ip'))
  if (cloudflareIp)
    return cloudflareIp

  warnMissingClientIp(c)
  return UNKNOWN_IP_BUCKET
}

let missingClientIpWarned = false
function warnMissingClientIp(c: Context) {
  if (missingClientIpWarned)
    return
  missingClientIpWarned = true
  console.warn(
    '[login] cf-connecting-ip is missing, so login failures are counted in a single shared bucket for '
    + `this isolate (request ${c.req.method} ${new URL(c.req.url).pathname}). `
    + 'That is expected for `wrangler dev`; in production check that no proxy strips the header, '
    + 'otherwise the per-IP login rate limit degrades into one global limit.',
  )
}

/**
 * Whether rate limiting has kicked in (fail-open)
 *
 * Rate limiting is an auxiliary defence: when the table is missing or D1 hiccups, let the request through and log
 * it rather than locking the administrator out of the panel — the password itself is the real defence.
 *
 *
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

/**
 * Records one failure (fail-open: a failure only logs)
 *
 * 记录一次失败 (fail-open, 失败只记日志)
 */
async function recordFailSafe(c: Context<{ Bindings: Env }>, ip: string): Promise<void> {
  try {
    await recordFail(c.env.DB, ip, nowSeconds())
  }
  catch (err) {
    console.warn('[login] record login failure failed:', (err as Error).message)
  }
}

/**
 * Clears the failure count after a successful login (fail-open: a failure only logs)
 *
 * 登录成功后清除失败计数 (fail-open, 失败只记日志)
 */
async function clearFailsSafe(c: Context<{ Bindings: Env }>, ip: string): Promise<void> {
  try {
    await clearFails(c.env.DB, ip)
  }
  catch (err) {
    console.warn('[login] clear login failures failed:', (err as Error).message)
  }
}

// Login
// 登录
// bodyLimit first: this is the only unauthenticated write endpoint, so it is the one an anonymous caller can aim
// an oversized body at (security review V-05, see docs/security.md §3)
//
// bodyLimit 放最前: 这是唯一的未认证写接口, 也就是匿名调用方唯一能用超大请求体攻击的入口 (安全审查 V-05, 见 docs/security.md §3)
app.post('/login', bodyLimit(REQUEST_BODY_LIMIT.small), async (c) => {
  const body = await c.req.json<LoginRequest>().catch(() => null)
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!username || !password)
    return errorByCode(c, 1400)

  const ip = clientIp(c)

  // Rate limiting: reject immediately when this IP reached the failure cap inside the sliding window (D1 login_attempt table)
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

  // Password check: the legacy triple MD5 is still supported, the new format is PBKDF2 + salt + pepper
  // 密码校验: 旧版三重 MD5 仍然支持, 新版为 PBKDF2 + 盐 + pepper
  const pepper = c.env.PASSWORD_PEPPER ?? ''
  const iterations = resolveIterations(c.env.PASSWORD_PBKDF2_ITERATIONS)
  const outcome = await checkPassword(password, storedPassword, pepper)

  // Pepper problems are server-side misconfiguration: fail closed with an actionable message instead of
  // pretending the password is wrong (otherwise users keep thinking they misremembered it).
  //
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

  // Successful login: clear the failure count
  // 登录成功清除失败计数
  await clearFailsSafe(c, ip)

  // Legacy format (or a lower iteration count) with a pepper configured: upgrade in place using this plaintext; a failure does not affect the login
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

  // A missing JWT_SECRET makes every session forgeable, so the login fails closed with an actionable message
  // instead of signing with an empty key (security review V-02B, see docs/security.md §3)
  //
  // JWT_SECRET 缺失时任何会话都可伪造, 因此这里 fail-closed 并给出可操作的提示,
  // 绝不用空密钥签发 (安全审查 V-02B, 见 docs/security.md §3)
  let token: string
  try {
    token = await signToken(c.env.JWT_SECRET, user, await getAuthEpoch(db))
  }
  catch (err) {
    if (err instanceof MissingJwtSecretError) {
      // Reached only after a correct password, so this message never tells an attacker whether a guess was right
      // 只有密码正确才会走到这里, 因此该提示不会告诉攻击者猜测是否正确
      return apiReturn(c, 1403, JWT_SECRET_MISSING_MSG, undefined, 503)
    }
    throw err
  }

  // The session travels in an HttpOnly cookie; the token in the response body stays for scripts/third-party tools,
  // which cannot use an HttpOnly cookie at all (see docs/security.md §3, V-07). Because that token is a live
  // credential and `POST` responses are cacheable unless told otherwise, the response is marked no-store: an
  // intermediate proxy must never be able to replay someone else's session.
  //
  // 会话承载在 HttpOnly Cookie 上; 响应体里的 token 保留给脚本/第三方工具 ——
  // 它们根本无法使用 HttpOnly Cookie (见 docs/security.md §3, V-07)。由于这枚 token 就是活凭证,
  // 而 `POST` 响应在未声明时是可缓存的, 因此这里标记 no-store: 中间代理绝不能回放别人的会话。
  c.header('Cache-Control', 'no-store')
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

// Logout
// Clears the session cookie (the frontend also drops its local cache); allDevices=true bumps the generation so
// every previously issued token (including the cookies on other devices) stops working immediately.
//
// 登出
// 清掉会话 Cookie (前端也会清本地缓存); 传 allDevices=true 时递增世代,
// 让此前签发的所有 token (含其它设备上的 Cookie) 立即失效
app.post('/logout', bodyLimit(REQUEST_BODY_LIMIT.small), authMiddleware(), async (c) => {
  const body = await c.req.json<{ allDevices?: boolean }>().catch(() => null)
  if (body?.allDevices)
    await bumpAuthEpoch(c.env.DB)

  clearAuthCookie(c)

  return success(c)
})

export default app
