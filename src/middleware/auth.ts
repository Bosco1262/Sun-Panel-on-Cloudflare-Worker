import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../types'
import { verifyToken } from '../utils/jwt'
import { getAuthEpoch, isTokenEpochStale } from '../utils/authEpoch'
import { apiReturn } from '../utils/response'
import { readAuthToken } from '../utils/authCookie'

declare module 'hono' {
  interface ContextVariableMap {
    uid: number
  }
}

/** 有副作用的请求方法: 用 Cookie 认证时要额外做跨站校验 */
const STATEFUL_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
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

// JWT 登录校验 (对应 Go 版 LoginInterceptor)
// 单用户模式: JWT 无状态, 无需服务端会话缓存; 吊销靠 auth_epoch 世代号
export function authMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
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

    // 用 Cookie 认证时浏览器会自动带上凭证, 所以写操作必须确认不是跨站发起的 (CSRF)
    if (cookieToken && STATEFUL_METHODS.has(c.req.method.toUpperCase()) && !isSameSiteRequest(c))
      return apiReturn(c, 1005, 'Cross-site request rejected')

    const payload = await verifyToken(c.env.JWT_SECRET, token)
    if (!payload)
      return apiReturn(c, 1001, 'Token expired or invalid')

    // 世代检查: 改密码 / 改用户名 / 退出所有设备后, 旧 token 立即失效
    if (isTokenEpochStale(payload.epoch, await getAuthEpoch(c.env.DB)))
      return apiReturn(c, 1001, 'Token expired or invalid')

    c.set('uid', payload.uid)
    await next()
  }
}
