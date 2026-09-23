import type { D1Database } from '@cloudflare/workers-types'
import { SETTING_AUTH_EPOCH } from './settings'

/**
 * Token generation (auth_epoch)
 *
 * A JWT is stateless, so once issued it cannot be taken back. This keeps a monotonically increasing generation
 * number in system_setting, writes it into the token when signing and compares it on every verification:
 * a password change / username change / "log out all devices" bumps it once and every previously issued token
 * stops working immediately.
 *
 * Reads are cached in-process (10 s TTL) because the middleware needs the value on every request and must not hit
 * D1 each time. Across isolates that leaves at most a TTL of delay, which is why the comparison only blocks
 * tokens that are *older*: an expired cache can keep an individual old token alive for up to 10 seconds but never
 * kills a freshly issued one.
 *
 *
 * token 世代 (auth_epoch)
 *
 * JWT 是无状态的, 签发出去就没法收回。这里给 system_setting 里放一个单调递增的世代号,
 * 签发时写进 token、校验时比对: 改密码 / 改用户名 / 「退出所有设备」时递增一次,
 * 之前签发的 token 立刻失效。
 *
 * 读取带进程内缓存 (TTL 10 秒): 中间件在每个请求上都要用, 不能每次都读 D1。
 * 跨 isolate 最长有 TTL 级延迟, 所以世代比较采用「只拦更旧的 token」策略 —— 缓存过期
 * 只会让个别旧 token 多活最多 10 秒, 绝不会把刚签发的新 token 误杀。
 */

const CACHE_TTL_MS = 10_000
export const DEFAULT_AUTH_EPOCH = 1

let cache: { value: number, expiresAt: number } | null = null

/**
 * Reads the database directly (bypassing the cache)
 *
 * 直接读库 (不走缓存)
 */
async function readAuthEpoch(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT config_value AS v FROM system_setting WHERE config_name = ?')
    .bind(SETTING_AUTH_EPOCH)
    .first<{ v: string }>()

  const parsed = Number(row?.v ?? '')
  if (Number.isFinite(parsed) && parsed > 0)
    return Math.floor(parsed)
  return DEFAULT_AUTH_EPOCH
}

/**
 * Current generation (in-process cache included)
 *
 * 当前世代 (带进程内缓存)
 */
export async function getAuthEpoch(db: D1Database): Promise<number> {
  const now = Date.now()
  if (cache && cache.expiresAt > now)
    return cache.value

  let value = DEFAULT_AUTH_EPOCH
  try {
    value = await readAuthEpoch(db)
  }
  catch (err) {
    // A failed read falls back to the default generation: better to let one request through than to log everyone out over a D1 hiccup
    // 读不到就按默认世代放行: 宁可少拦一次, 也不能因为 D1 抖动把所有人踢下线
    console.warn('[auth] read auth_epoch failed:', (err as Error).message)
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS }
  return value
}

/**
 * Bumps the generation (one atomic UPSERT) and invalidates this isolate's cache immediately
 *
 * 递增世代 (单条 UPSERT 原子完成) 并让本 isolate 的缓存立即失效
 */
export async function bumpAuthEpoch(db: D1Database): Promise<number> {
  await db
    .prepare(
      'INSERT INTO system_setting (config_name, config_value) VALUES (?, ?) '
      + 'ON CONFLICT(config_name) DO UPDATE SET config_value = CAST(CAST(system_setting.config_value AS INTEGER) + 1 AS TEXT)',
    )
    // The seed value is DEFAULT + 1: a missing row already means "the default generation", so the first bump must
    // step past it, otherwise tokens signed with the default generation would not be revoked
    // (this off-by-one was caught once by end-to-end testing).
    //
    // 种子值是 DEFAULT + 1: 记录不存在本身就代表「默认世代」, 所以第一次递增必须跨过它,
    // 否则用默认世代签发的 token 不会被作废 (这个 off-by-one 已在端到端测试里被抓到过一次)
    .bind(SETTING_AUTH_EPOCH, String(DEFAULT_AUTH_EPOCH + 1))
    .run()

  cache = null
  return await readAuthEpoch(db)
}

/**
 * Whether the generation in the token is stale (stale means invalid; newer than the current one is allowed,
 * so a stale cache cannot kill a fresh token)
 *
 * token 里的世代是否已落后 (落后即失效; 比当前更新则放行, 避免缓存导致误杀新 token)
 */
export function isTokenEpochStale(tokenEpoch: unknown, current: number): boolean {
  const epoch = typeof tokenEpoch === 'number' && Number.isFinite(tokenEpoch) ? tokenEpoch : 0
  return epoch < current
}

/**
 * Clears the in-process cache (self-check use only)
 *
 * 仅供自检使用: 清掉进程内缓存
 */
export function clearAuthEpochCache(): void {
  cache = null
}
