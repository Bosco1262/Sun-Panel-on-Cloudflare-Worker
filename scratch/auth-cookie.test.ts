import { Hono } from 'hono'
import { signToken } from '../src/utils/jwt'
import { clearAuthEpochCache } from '../src/utils/authEpoch'
import { authMiddleware } from '../src/middleware/auth'
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, setAuthCookie } from '../src/utils/authCookie'

/**
 * 会话 Cookie 自检 (改进计划 §9.4)
 *
 * 关注四件事:
 * 1. Cookie 能独立完成认证 (HttpOnly, JS 拿不到也无所谓);
 * 2. 用 Cookie 认证时, 跨站发起的**写操作**被拒 (CSRF 防线), 读操作不受影响;
 * 3. 请求头 (token / Bearer) 仍然可用 —— 脚本与第三方工具兼容;
 * 4. Cookie 属性正确: HttpOnly + SameSite=Lax + Max-Age 与 JWT 一致, Secure 仅在 https 下加。
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

function ok(label: string, actual: unknown) {
  if (actual) {
    passed++
    console.log(`  ok   ${label}`)
  }
  else {
    failed++
    console.log(`  FAIL ${label}\n       actual   = ${JSON.stringify(actual)}`)
  }
}

const SECRET = 'auth-cookie-test-secret-key-0123456789'
const user = { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }

const token = await signToken(SECRET, user, 1)
const staleToken = await signToken(SECRET, user, 0)

// 内存版 D1: 读不到 auth_epoch -> 使用默认世代 1 (与 token 一致)
const db = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as never
const env = { DB: db, JWT_SECRET: SECRET } as never

const app = new Hono()
app.post('/write', authMiddleware(), c => c.json({ code: 0 }))
app.get('/read', authMiddleware(), c => c.json({ code: 0 }))
app.get('/cookie', (c) => {
  setAuthCookie(c, token)
  return c.json({ code: 0 })
})

interface CallResult {
  body: { code: number }
  setCookie: string | null
}

async function call(path: string, init: RequestInit = {}, host = 'https://panel.example.com'): Promise<CallResult> {
  clearAuthEpochCache()
  const res = await app.fetch(new Request(`${host}${path}`, init), env)
  return { body: await res.json() as { code: number }, setCookie: res.headers.get('set-cookie') }
}

const cookieHeader = { cookie: `${AUTH_COOKIE_NAME}=${token}` }

// ===================== 认证来源 =====================

console.log('== 认证来源 ==')

eq('Cookie + 同站写操作 -> 放行', (await call('/write', {
  method: 'POST',
  headers: { ...cookieHeader, 'sec-fetch-site': 'same-origin' },
})).body.code, 0)

eq('请求头 token 仍然可用 (脚本兼容)', (await call('/write', {
  method: 'POST',
  headers: { token },
})).body.code, 0)

eq('Bearer 头仍然可用', (await call('/write', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
})).body.code, 0)

eq('无任何凭证 -> 1000', (await call('/write', { method: 'POST' })).body.code, 1000)

eq('世代落后的 Cookie -> 1001', (await call('/write', {
  method: 'POST',
  headers: { cookie: `${AUTH_COOKIE_NAME}=${staleToken}`, 'sec-fetch-site': 'same-origin' },
})).body.code, 1001)

// ===================== CSRF 防线 =====================

console.log('== CSRF 防线 (仅针对 Cookie 认证的写操作) ==')

eq('Cookie + 跨站写操作 -> 1005', (await call('/write', {
  method: 'POST',
  headers: { ...cookieHeader, 'sec-fetch-site': 'cross-site' },
})).body.code, 1005)

eq('Cookie + 跨站读操作 -> 放行 (读接口无副作用)', (await call('/read', {
  headers: { ...cookieHeader, 'sec-fetch-site': 'cross-site' },
})).body.code, 0)

eq('请求头认证 + 跨站写操作 -> 放行 (CSRF 只与自动携带的凭证有关)', (await call('/write', {
  method: 'POST',
  headers: { token, 'sec-fetch-site': 'cross-site' },
})).body.code, 0)

// 没有 Sec-Fetch-Site 的老浏览器: 退回 Origin 与 Host 的主机名比较
eq('无 Sec-Fetch-Site + 同主机不同端口 (本地 Vite 代理) -> 放行', (await call('/write', {
  method: 'POST',
  headers: { ...cookieHeader, origin: 'http://127.0.0.1:1002' },
}, 'http://127.0.0.1:8787')).body.code, 0)

eq('无 Sec-Fetch-Site + 异主机 Origin -> 1005', (await call('/write', {
  method: 'POST',
  headers: { ...cookieHeader, origin: 'https://evil.example' },
})).body.code, 1005)

eq('无 Origin 也无 Sec-Fetch-Site (curl) -> 放行', (await call('/write', {
  method: 'POST',
  headers: cookieHeader,
})).body.code, 0)

// ===================== Cookie 属性 =====================

console.log('== Cookie 属性 ==')

const httpsCookie = (await call('/cookie')).setCookie ?? ''
ok('含 HttpOnly (JS 读不到)', httpsCookie.includes('HttpOnly'))
ok('含 SameSite=Lax', /SameSite=Lax/i.test(httpsCookie))
ok('含 Path=/', /Path=\//i.test(httpsCookie))
ok(`Max-Age 与 JWT 有效期一致 (${AUTH_COOKIE_MAX_AGE}s)`, httpsCookie.includes(`Max-Age=${AUTH_COOKIE_MAX_AGE}`))
ok('https 下带 Secure', /Secure/i.test(httpsCookie))

const httpCookie = (await call('/cookie', {}, 'http://127.0.0.1:8787')).setCookie ?? ''
ok('http 下不带 Secure (否则本地 dev 保存不了)', !/Secure/i.test(httpCookie))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
