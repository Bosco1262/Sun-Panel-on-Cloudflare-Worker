import { SignJWT, decodeJwt } from 'jose'
import { TOKEN_TTL, signToken, verifyToken } from '../src/utils/jwt'
import {
  DEFAULT_AUTH_EPOCH,
  bumpAuthEpoch,
  clearAuthEpochCache,
  getAuthEpoch,
  isTokenEpochStale,
} from '../src/utils/authEpoch'

/**
 * Self-check for the token generation (§3.3)
 *
 * With a stateless JWT the price is "once issued it cannot be taken back": after a password change or a
 * logout-everywhere the old token stays valid until it expires. This verifies that the generation number can
 * kill an old token immediately while the in-process cache does not kill a freshly issued one.
 *
 *
 * token 世代 (§3.3) 自检
 *
 * JWT 无状态时代价是「签出去就收不回」: 改密/退出所有设备后旧 token 仍有效直到过期。
 * 这里验证世代号能把旧 token 立刻判死, 同时不因为进程内缓存误杀刚签发的新 token。
 */

let failed = 0
let passed = 0

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
    console.log(`  ok   ${label}`)
  }
  else {
    failed++
    console.log(`  FAIL ${label}\n       actual   = ${a}\n       expected = ${e}`)
  }
}

// ===================== Generation comparison (pure function) =====================
// ===================== 世代比较 (纯函数) =====================

console.log('== isTokenEpochStale ==')
eq('老 token 无 epoch 字段 -> 过期', isTokenEpochStale(undefined, 1), true)
eq('epoch 0 对当前 1 -> 过期', isTokenEpochStale(0, 1), true)
eq('同世代 -> 有效', isTokenEpochStale(1, 1), false)
eq('比当前新 -> 有效 (缓存滞后时不误杀新 token)', isTokenEpochStale(2, 1), false)
eq('非法值按 0 处理', isTokenEpochStale('x', 1), true)
eq('NaN 按 0 处理', isTokenEpochStale(Number.NaN, 1), true)

// ===================== Generation read/write and caching =====================
// ===================== 世代读写与缓存 =====================

let stored: string | null = null
let queries = 0

const db = {
  prepare(_sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async first() {
            queries++
            return stored === null ? null : { v: stored }
          },
          async run() {
            queries++
            const [, initial] = args as [string, string]
            // Mirrors the SQL's ON CONFLICT ... CAST(config_value AS INTEGER) + 1
            // 对应 SQL 里的 ON CONFLICT ... CAST(config_value AS INTEGER) + 1
            stored = stored === null ? initial : String(Number(stored) + 1)
            return { success: true }
          },
        }
      },
    }
  },
} as never

console.log('== getAuthEpoch ==')
clearAuthEpochCache()
eq('无记录 -> 默认世代', await getAuthEpoch(db), DEFAULT_AUTH_EPOCH)
const queriesAfterFirst = queries
await getAuthEpoch(db)
eq('第二次命中进程内缓存 (不再查库)', queries, queriesAfterFirst)

clearAuthEpochCache()
stored = '7'
eq('读到已存世代', await getAuthEpoch(db), 7)
clearAuthEpochCache()
stored = 'not-a-number'
eq('脏数据回退默认世代', await getAuthEpoch(db), DEFAULT_AUTH_EPOCH)

console.log('== bumpAuthEpoch ==')
clearAuthEpochCache()
stored = null
const bumped1 = await bumpAuthEpoch(db)
// Key regression: a missing row means "the default generation", so the first bump must step past it,
// otherwise a token signed with the default generation would still be valid (= revocation does not work).
//
// 关键回归: 记录不存在时代表「默认世代」, 首次递增必须跨过它,
// 否则用默认世代签发的 token 依旧有效 (= 吊销失效)
eq('首次递增必须大于默认世代', bumped1 > DEFAULT_AUTH_EPOCH, true)
eq('首次递增写入默认值 + 1', bumped1, DEFAULT_AUTH_EPOCH + 1)
eq('默认世代签发的 token 立刻失效', isTokenEpochStale(DEFAULT_AUTH_EPOCH, bumped1), true)
eq('再次递增 +1', await bumpAuthEpoch(db), bumped1 + 1)
eq('递增后缓存立即生效', await getAuthEpoch(db), bumped1 + 1)

// ===================== JWT generation round-trip =====================
// ===================== JWT 世代往返 =====================

console.log('== JWT 往返 ==')
const SECRET = 'test-secret'
const user = { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }

const token = await signToken(SECRET, user, 3)
const payload = await verifyToken(SECRET, token)
eq('世代被写入 token', payload?.epoch, 3)
eq('uid 正确', payload?.uid, 1)

const claims = decodeJwt(token)
const ttlHours = ((claims.exp ?? 0) - (claims.iat ?? 0)) / 3600
eq('有效期 72 小时', ttlHours, 72)
eq('TTL 常量', TOKEN_TTL, '72h')

// Simulates a token issued before this change (no epoch field)
// 模拟改动前签发的旧 token (没有 epoch 字段)
const legacyToken = await new SignJWT({ uid: 1, role: 1 })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('72h')
  .sign(new TextEncoder().encode(SECRET))
const legacyPayload = await verifyToken(SECRET, legacyToken)
eq('旧 token 的 epoch 记 0', legacyPayload?.epoch, 0)
eq('旧 token 会被判过期 (要求重新登录一次)', isTokenEpochStale(legacyPayload?.epoch, 1), true)

console.log('== 签名校验 ==')
eq('换密钥后校验失败', await verifyToken('another-secret', token), null)
eq('乱码 token 校验失败', await verifyToken(SECRET, 'not.a.jwt'), null)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
