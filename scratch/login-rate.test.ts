import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_SECONDS,
  clearFails,
  ensureLoginAttemptTable,
  isLocked,
  readAttempt,
  recordFail,
} from '../src/utils/loginRate'

/**
 * Self-check for login rate limiting
 *
 * This drives the real call sequence and bind order through an **in-memory D1 emulator**: the emulator only
 * understands the statements in loginRate.ts and throws on anything else — so changing the SQL without
 * updating the semantics immediately fails the self-check. The real SQL is verified end-to-end against a local
 * `wrangler dev` (six wrong logins in a row; the sixth must return 1008).
 *
 *
 * 登录限流自检
 *
 * 这里用一个**内存版 D1 模拟器**跑真实的调用序列与绑定顺序: 模拟器只认 loginRate.ts 里
 * 那几条语句, 认不出就直接抛错 —— 这样以后改了 SQL 而忘了同步语义, 自检会立刻失败。
 * 真 SQL 的端到端验证走本地 `wrangler dev` (连续 6 次错误登录, 第 6 次应为 1008)。
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

// ===================== In-memory D1 =====================
// ===================== 内存版 D1 =====================

interface Row { fail_count: number, window_start: number }

const table = new Map<string, Row>()
let createTableCount = 0

function execute(sql: string, args: unknown[]) {
  if (sql.startsWith('CREATE TABLE IF NOT EXISTS login_attempt')) {
    createTableCount++
    return null
  }
  if (sql.startsWith('CREATE INDEX IF NOT EXISTS idx_login_attempt_window'))
    return null

  if (sql.startsWith('SELECT fail_count, window_start FROM login_attempt WHERE ip = ?')) {
    const row = table.get(String(args[0]))
    return row ? { ...row } : null
  }

  if (sql.startsWith('INSERT INTO login_attempt')) {
    const [ip, now, cutoff] = args as [string, number, number]
    const row = table.get(ip)
    if (!row) {
      table.set(ip, { fail_count: 1, window_start: now })
    }
    else {
      // Same as the CASE WHEN in the SQL: an expired window restarts the count
      // 与 SQL 里的 CASE WHEN 一致: 窗口过期则重新计数
      row.fail_count = row.window_start < cutoff ? 1 : row.fail_count + 1
      row.window_start = now
    }
    return null
  }

  if (sql.startsWith('DELETE FROM login_attempt WHERE ip = ?')) {
    table.delete(String(args[0]))
    return null
  }

  if (sql.startsWith('DELETE FROM login_attempt WHERE window_start < ?')) {
    const cutoff = Number(args[0])
    for (const [ip, row] of table)
      if (row.window_start < cutoff)
        table.delete(ip)
    return null
  }

  throw new Error(`模拟器无法识别的 SQL (请同步更新自检): ${sql}`)
}

function makeStatement(sql: string, args: unknown[] = []) {
  return {
    bind: (...bound: unknown[]) => makeStatement(sql, bound),
    first: async () => execute(sql, args),
    run: async () => execute(sql, args),
  }
}

const db = {
  prepare: (sql: string) => makeStatement(sql),
  batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
    const results = []
    for (const stmt of statements)
      results.push(await stmt.run())
    return results
  },
} as never

// ===================== isLocked (pure function) =====================
// ===================== isLocked (纯函数) =====================

const NOW = 1_700_000_000

console.log('== isLocked ==')
eq('无记录 -> 不锁', isLocked(null, NOW), false)
eq(`失败 ${LOGIN_MAX_ATTEMPTS - 1} 次 -> 不锁`, isLocked({ fail_count: LOGIN_MAX_ATTEMPTS - 1, window_start: NOW }, NOW), false)
eq(`失败 ${LOGIN_MAX_ATTEMPTS} 次 -> 锁`, isLocked({ fail_count: LOGIN_MAX_ATTEMPTS, window_start: NOW }, NOW), true)
eq('窗口刚好到期 -> 不锁', isLocked({ fail_count: 9, window_start: NOW - LOGIN_WINDOW_SECONDS }, NOW), false)
eq('窗口到期前 1 秒 -> 锁', isLocked({ fail_count: 9, window_start: NOW - LOGIN_WINDOW_SECONDS + 1 }, NOW), true)

// ===================== Call sequence =====================
// ===================== 调用序列 =====================

console.log('== 限流序列 ==')
const ip = '203.0.113.7'

await ensureLoginAttemptTable(db)
eq('首次调用会建表', createTableCount, 1)
await ensureLoginAttemptTable(db)
eq('同一 isolate 内不重复建表', createTableCount, 1)

eq('初始无记录', await readAttempt(db, ip), null)

// Failures 1~4: further attempts are still allowed
// 第 1~4 次失败: 仍可继续尝试
for (let i = 1; i < LOGIN_MAX_ATTEMPTS; i++)
  await recordFail(db, ip, NOW, () => 0.9)

eq(`失败 ${LOGIN_MAX_ATTEMPTS - 1} 次后不锁`, isLocked(await readAttempt(db, ip), NOW), false)

// Failure 5: the next login request is rejected with 1008
// 第 5 次失败: 下一次登录请求会被 1008 拒绝
await recordFail(db, ip, NOW, () => 0.9)
eq('fail_count 累加到上限', (await readAttempt(db, ip))?.fail_count, LOGIN_MAX_ATTEMPTS)
eq('达到上限 -> 锁', isLocked(await readAttempt(db, ip), NOW), true)

// Counting restarts once the window expires
// 窗口过期后重新计数
const LATER = NOW + LOGIN_WINDOW_SECONDS + 1
eq('窗口过期 -> 解锁', isLocked(await readAttempt(db, ip), LATER), false)
await recordFail(db, ip, LATER, () => 0.9)
eq('过期后失败计数重置为 1', (await readAttempt(db, ip))?.fail_count, 1)
eq('window_start 刷新', (await readAttempt(db, ip))?.window_start, LATER)

// Cleared after a successful login
// 登录成功清除
await clearFails(db, ip)
eq('登录成功后记录被清除', await readAttempt(db, ip), null)

console.log('== 概率清理 ==')
await recordFail(db, 'old.example', NOW, () => 0.9)
await recordFail(db, 'new.example', LATER, () => 0.9)

// random=0.9 -> the sweep is not triggered, expired rows stay
// random=0.9 -> 不触发清理, 过期行保留
await recordFail(db, 'new.example', LATER, () => 0.9)
eq('未触发清理时过期行仍在', (await readAttempt(db, 'old.example'))?.fail_count, 1)

// random=0 -> the sweep runs and only removes rows outside the window
// random=0 -> 触发清理, 只删窗口外的行
await recordFail(db, 'new.example', LATER, () => 0)
eq('触发清理后过期行被删', await readAttempt(db, 'old.example'), null)
eq('窗口内的行保留', (await readAttempt(db, 'new.example'))?.fail_count, 3)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
