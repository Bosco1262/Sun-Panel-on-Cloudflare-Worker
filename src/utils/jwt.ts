import { SignJWT, jwtVerify } from 'jose'
import type { UserInfo } from '../types'

export interface JWTPayload {
  uid: number
  role: number
  /**
   * Token generation: compared against system_setting.auth_epoch, and a lagging value invalidates the token
   *
   * token 世代: 与 system_setting.auth_epoch 比对, 落后即失效
   */
  epoch: number
}

/**
 * 72-hour lifetime (it used to be 7 days; together with auth_epoch it can be revoked at any time)
 *
 * 有效期 72 小时 (原为 7 天; 配合 auth_epoch 可随时吊销)
 */
export const TOKEN_TTL = '72h'

/**
 * Minimum length recommended for `JWT_SECRET`
 *
 * Only used for the warning below: length is not enforced as a hard requirement (see `isSecretUsable`), because
 * locking an already-deployed instance out of its own panel is worse than a short secret.
 *
 *
 * `JWT_SECRET` 的推荐最小长度
 *
 * 仅用于下面的告警: 长度不作为硬性门槛 (原因见 `isSecretUsable`) ——
 * 把一个已部署实例锁在自己的面板外面, 比密钥偏短更糟。
 */
export const MIN_JWT_SECRET_LENGTH = 32

/**
 * The message the operator sees when `JWT_SECRET` is unusable
 *
 * 运维在 `JWT_SECRET` 不可用时看到的提示
 */
export const JWT_SECRET_MISSING_MSG
  = 'Server error[JWT_SECRET is not configured: set it with `wrangler secret put JWT_SECRET` '
    + '(random, at least 32 characters, e.g. `openssl rand -base64 48`)]'

/**
 * Weak-secret warning (logged once per isolate lifetime)
 *
 * jose does not validate HMAC key length, so a weak secret never errors on its own. Note the division of labour:
 * an **empty** secret is refused outright by `isSecretUsable` (fail closed), while a merely short one only gets
 * this warning — it is weak, but not trivially forgeable.
 *
 *
 * 弱密钥告警 (整个 isolate 生命周期只提示一次)
 *
 * jose 不校验 HMAC 密钥长度, 所以弱密钥本身不会报错。注意这里的职责划分:
 * **空**密钥由 `isSecretUsable` 直接拒绝 (fail closed), 而仅仅偏短的密钥只给这条告警 ——
 * 它确实弱, 但不是「可平凡伪造」。
 */
let weakSecretWarned = false
function warnIfSecretWeak(secret: string) {
  const length = (secret ?? '').length
  if (weakSecretWarned || length >= MIN_JWT_SECRET_LENGTH)
    return
  weakSecretWarned = true
  console.warn(
    `[jwt] JWT_SECRET is missing or too short (length ${length} < ${MIN_JWT_SECRET_LENGTH}). `
    + 'A weak secret is easy to brute-force; generate one with: openssl rand -base64 48',
  )
}

/**
 * Whether the configured secret is usable at all (security review V-02B, see docs/security.md §3)
 *
 * Before this check the service signed and verified tokens with an **empty** HMAC key: jose does not validate
 * HMAC key length, so a missing `JWT_SECRET` never raised an error and anyone could mint a token with the same
 * empty key — a complete authentication bypass that only showed up as one log line.
 *
 * A short secret is still weak, but it is not trivially forgeable, so it is only warned about (see
 * warnIfSecretWeak) and the minimum is deliberately not enforced here: locking an already-deployed instance out
 * of its own panel is worse than a warning, and `docs/deployment.md` prescribes a >=32-character secret.
 *
 *
 * 配置的密钥是否可用 (安全审查 V-02B, 见 docs/security.md §3)
 *
 * 在这道检查之前, 服务会用**空** HMAC 密钥签发与校验 token: jose 不校验 HMAC 密钥长度, 所以
 * `JWT_SECRET` 缺失时不会报错, 任何人都能用同一个空密钥伪造 token —— 一次完整的认证绕过,
 * 而它只会表现为日志里的一行。
 *
 * 短密钥仍然弱, 但不是「可平凡伪造」, 因此只告警 (见 warnIfSecretWeak) 而不在这里强制最小长度:
 * 把一个已部署实例锁在自己的面板外面, 比一条告警更糟; 而 `docs/deployment.md` 已规定 >=32 字符。
 */
export function isSecretUsable(secret: string | undefined | null): boolean {
  return (secret ?? '').trim().length > 0
}

/**
 * Thrown when a token operation is attempted without a usable secret; mapped to 503 by the app-level error handler
 *
 * 在密钥不可用时执行 token 操作所抛出的错误; 由应用级错误处理映射为 503
 */
export class MissingJwtSecretError extends Error {
  constructor() {
    super(JWT_SECRET_MISSING_MSG)
    this.name = 'MissingJwtSecretError'
  }
}

export async function signToken(secret: string, user: UserInfo, epoch: number): Promise<string> {
  // Fail closed: signing with an empty key would hand out forgeable sessions (see isSecretUsable)
  // fail-closed: 用空密钥签发等于发放可伪造的会话 (原因见 isSecretUsable)
  if (!isSecretUsable(secret))
    throw new MissingJwtSecretError()
  warnIfSecretWeak(secret)
  return await new SignJWT({ uid: user.id, role: user.role, epoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(new TextEncoder().encode(secret))
}

export async function verifyToken(secret: string, token: string): Promise<JWTPayload | null> {
  if (!isSecretUsable(secret))
    throw new MissingJwtSecretError()
  warnIfSecretWeak(secret)
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    return {
      uid: payload.uid as number,
      role: payload.role as number,
      // Old tokens carry no epoch field: treat it as 0, which the generation check sees as expired (one re-login required)
      // 老 token 没有 epoch 字段: 记 0, 会被世代检查判为过期 (要求重新登录一次)
      epoch: typeof payload.epoch === 'number' ? payload.epoch : 0,
    }
  }
  catch {
    return null
  }
}
