import type { D1Database } from '@cloudflare/workers-types'

/**
 * 登录失败限流
 *
 * 存储放在 D1: 用单条 UPSERT 原子累加, 并发不会丢计数。
 * 旧实现用 KV 的「读-改-写」: 并发请求会互相覆盖, 且 KV 读有最长约 60s 的边缘缓存,
 * 短时间连发可以在缓存刷新前绕过计数。
 *
 * 全部操作都由调用方以 fail-open 方式使用 (见 src/api/login.ts):
 * 限流是辅助防线, 表缺失或 D1 抖动时不能让管理员被锁在面板外。
 */
export const LOGIN_MAX_ATTEMPTS = 5
export const LOGIN_WINDOW_SECONDS = 600 // 10 分钟 (滑动窗口: 自最后一次失败起算)

/** 清理概率的分母: 约每 50 次失败顺带清一次过期行, 保证表有界 */
const SWEEP_ONE_IN = 50

export interface LoginAttemptRow {
  fail_count: number
  window_start: number
}

/** 当前 Unix 秒 (秒级即可, 抽出来便于自检注入固定时间) */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** 是否处于锁定期 (纯函数) */
export function isLocked(row: LoginAttemptRow | null | undefined, now: number): boolean {
  if (!row)
    return false
  // 窗口已过期 -> 计数作废
  if (row.window_start + LOGIN_WINDOW_SECONDS <= now)
    return false
  return row.fail_count >= LOGIN_MAX_ATTEMPTS
}

/**
 * 一次性建表兜底
 *
 * 建表基线 (migrations/0001_init.sql) 只对全新库执行, 已部署库因为文件名已被 d1_migrations
 * 记录不会重跑, 因此可能没有 login_attempt 表。这里在每个 isolate 生命周期内执行一次
 * `CREATE TABLE IF NOT EXISTS`, 让限流在旧库上也能生效 (表已存在时只是一次 no-op)。
 */
let ensured: Promise<void> | null = null

export function ensureLoginAttemptTable(db: D1Database): Promise<void> {
  if (!ensured) {
    ensured = db
      .batch([
        db.prepare(
          'CREATE TABLE IF NOT EXISTS login_attempt ('
          + 'ip TEXT PRIMARY KEY, '
          + 'fail_count INTEGER NOT NULL DEFAULT 0, '
          + 'window_start INTEGER NOT NULL DEFAULT 0)',
        ),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_login_attempt_window ON login_attempt (window_start)'),
      ])
      .then(() => undefined)
      .catch((err) => {
        // 失败时清掉缓存, 下次请求重试
        ensured = null
        throw err
      })
  }
  return ensured
}

/** 只读当前计数 (表不存在等异常交由调用方处理) */
export async function readAttempt(db: D1Database, ip: string): Promise<LoginAttemptRow | null> {
  return await db
    .prepare('SELECT fail_count, window_start FROM login_attempt WHERE ip = ?')
    .bind(ip)
    .first<LoginAttemptRow>()
}

/**
 * 记录一次失败
 *
 * 单条 UPSERT 完成「窗口过期则重新计数, 否则 +1」, 因此无需读-改-写。
 * 绑定顺序: ip, now, now - LOGIN_WINDOW_SECONDS, now
 */
export async function recordFail(db: D1Database, ip: string, now: number, random = Math.random): Promise<void> {
  const cutoff = now - LOGIN_WINDOW_SECONDS
  const statements = [
    db
      .prepare(
        'INSERT INTO login_attempt (ip, fail_count, window_start) VALUES (?, 1, ?) '
        + 'ON CONFLICT(ip) DO UPDATE SET '
        + 'fail_count = CASE WHEN login_attempt.window_start < ? THEN 1 ELSE login_attempt.fail_count + 1 END, '
        + 'window_start = ?',
      )
      .bind(ip, now, cutoff, now),
  ]

  // D1 没有 TTL: 顺手清掉窗口外的行 (概率执行, 避免每次失败都扫表)
  if (random() < 1 / SWEEP_ONE_IN)
    statements.push(db.prepare('DELETE FROM login_attempt WHERE window_start < ?').bind(cutoff))

  await db.batch(statements)
}

/** 登录成功后清除该 IP 的失败计数 */
export async function clearFails(db: D1Database, ip: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempt WHERE ip = ?').bind(ip).run()
}
