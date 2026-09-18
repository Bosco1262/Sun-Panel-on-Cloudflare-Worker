import { SignJWT, jwtVerify } from 'jose'
import type { UserInfo } from '../types'

export interface JWTPayload {
  uid: number
  role: number
  /** token 世代: 与 system_setting.auth_epoch 比对, 落后即失效 */
  epoch: number
}

/** 有效期 72 小时 (原为 7 天; 配合 auth_epoch 可随时吊销) */
export const TOKEN_TTL = '72h'

/**
 * 弱密钥告警 (整个 isolate 生命周期只提示一次)
 *
 * jose 对 HMAC 不校验密钥长度: 空串 / 1 字符也能正常签发与校验, 配置再弱也不会报错。
 * 这里只打日志不 fail-closed —— 避免把已部署的实例锁在门外; 真正的防线是运维按文档配置随机密钥。
 */
let weakSecretWarned = false
function warnIfSecretWeak(secret: string) {
  const length = (secret ?? '').length
  if (weakSecretWarned || length >= 32)
    return
  weakSecretWarned = true
  console.warn(
    `[jwt] JWT_SECRET is missing or too short (length ${length} < 32). `
    + 'A weak secret is easy to brute-force; generate one with: openssl rand -base64 48',
  )
}

export async function signToken(secret: string, user: UserInfo, epoch: number): Promise<string> {
  warnIfSecretWeak(secret)
  return await new SignJWT({ uid: user.id, role: user.role, epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(new TextEncoder().encode(secret))
}

export async function verifyToken(secret: string, token: string): Promise<JWTPayload | null> {
  warnIfSecretWeak(secret)
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    return {
      uid: payload.uid as number,
      role: payload.role as number,
      // 老 token 没有 epoch 字段: 记 0, 会被世代检查判为过期 (要求重新登录一次)
      epoch: typeof payload.epoch === 'number' ? payload.epoch : 0,
    }
  }
  catch {
    return null
  }
}
