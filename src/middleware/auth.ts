import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types'
import { verifyToken } from '../utils/jwt'
import { getAuthEpoch, isTokenEpochStale } from '../utils/authEpoch'
import { apiReturn } from '../utils/response'

declare module 'hono' {
  interface ContextVariableMap {
    uid: number
  }
}

// JWT 登录校验 (对应 Go 版 LoginInterceptor)
// 单用户模式: JWT 无状态, 无需服务端会话缓存; 吊销靠 auth_epoch 世代号
export function authMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    let token = c.req.header('token')
    if (!token) {
      const authorization = c.req.header('Authorization')
      if (authorization?.startsWith('Bearer '))
        token = authorization.slice(7)
    }

    if (!token)
      return apiReturn(c, 1000, 'Not logged in yet')

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
