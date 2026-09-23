import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../types'
import { JWT_SECRET_MISSING_MSG, MissingJwtSecretError, verifyToken } from '../utils/jwt'
import { getAuthEpoch, isTokenEpochStale } from '../utils/authEpoch'
import { apiReturn } from '../utils/response'
import { readAuthToken } from '../utils/authCookie'

declare module 'hono' {
  interface ContextVariableMap {
    uid: number
  }
}

/**
 * Request methods with side effects: cookie authentication needs an extra cross-site check for these
 *
 * 有副作用的请求方法: 用 Cookie 认证时要额外做跨站校验
 */
const STATEFUL_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Whether the request comes from this site (the second CSRF line of defence; the first is the cookie's SameSite=Lax)
 *
 * - `Sec-Fetch-Site` is the standard header in modern browsers: same-origin / same-site / none are allowed, cross-site is rejected;
 * - browsers without that header fall back to comparing the **host names** of Origin and Host — cookies ignore the port,
 *   and comparing host names is what keeps the local Vite dev proxy (:1002 → :8787) working;
 * - a completely missing Origin (curl / scripts) counts as allowed: they never carry cookies automatically anyway.
 *
 *
 * 请求是否来自本站 (CSRF 第二道防线, 第一道是 Cookie 的 SameSite=Lax)
 *
 * - `Sec-Fetch-Site` 是现代浏览器的标准头: same-origin / same-site / none 放行, cross-site 拒绝;
 * - 老浏览器没有该头时退回 Origin 与 Host 的**主机名**比较 —— Cookie 本身不区分端口,
 *   比较主机名才能让本地 dev 的 Vite 代理 (:1002 → :8787) 正常工作;
 * - 完全没有 Origin (curl / 脚本) 视为放行: 它们本来也不会自动携带 Cookie。
 */
function isSameSiteRequest(c: Context): boolean {
  const site = c.req.header('sec-fetch-site')
  if (site)
    return site === 'same-origin' || site === 'same-site' || site === 'none'

  const origin = c.req.header('origin')
  if (!origin)
    return true

  try {
    return new URL(origin).hostname === new URL(c.req.url).hostname
  }
  catch {
    return false
  }
}

// JWT auth check (mirrors the Go version's LoginInterceptor)
// Single-user mode: the JWT is stateless, so no server-side session cache is needed;
// revocation relies on the auth_epoch generation number.
//
// JWT 登录校验 (对应 Go 版 LoginInterceptor)
// 单用户模式: JWT 无状态, 无需服务端会话缓存; 吊销靠 auth_epoch 世代号
export function authMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    // Read order: cookie (preferred, HttpOnly) → `token` header → Authorization: Bearer (script compatibility)
    // 读取顺序: Cookie (首选, HttpOnly) → `token` 头 → Authorization: Bearer (兼容脚本)
    const cookieToken = readAuthToken(c)
    let token: string | undefined = cookieToken ?? undefined

    if (!token) {
      token = c.req.header('token') || undefined
      if (!token) {
        const authorization = c.req.header('Authorization')
        if (authorization?.startsWith('Bearer '))
          token = authorization.slice(7)
      }
    }

    if (!token)
      return apiReturn(c, 1000, 'Not logged in yet')

    // With cookie authentication the browser sends credentials automatically, so writes must be confirmed as non-cross-site (CSRF)
    // 用 Cookie 认证时浏览器会自动带上凭证, 所以写操作必须确认不是跨站发起的 (CSRF)
    if (cookieToken && STATEFUL_METHODS.has(c.req.method.toUpperCase()) && !isSameSiteRequest(c))
      return apiReturn(c, 1005, 'Cross-site request rejected')

    // Without a usable secret every token is unverifiable, so the request fails closed instead of comparing
    // signatures under an empty key (security review V-02B, see docs/security.md §3)
    //
    // 密钥不可用时任何 token 都无法校验, 因此这里 fail-closed, 而不是在空密钥下比对签名 (安全审查 V-02B, 见 docs/security.md §3)
    let payload
    try {
      payload = await verifyToken(c.env.JWT_SECRET, token)
    }
    catch (err) {
      if (err instanceof MissingJwtSecretError)
        return apiReturn(c, 1403, JWT_SECRET_MISSING_MSG, undefined, 503)
      throw err
    }
    if (!payload)
      return apiReturn(c, 1001, 'Token expired or invalid')

    // Generation check: after a password change / username change / logout everywhere, old tokens stop working immediately
    // 世代检查: 改密码 / 改用户名 / 退出所有设备后, 旧 token 立即失效
    if (isTokenEpochStale(payload.epoch, await getAuthEpoch(c.env.DB)))
      return apiReturn(c, 1001, 'Token expired or invalid')

    c.set('uid', payload.uid)
    await next()
  }
}
