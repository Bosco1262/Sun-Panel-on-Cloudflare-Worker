import { Hono } from 'hono'
import { clearAuthEpochCache } from '../src/utils/authEpoch'
import { bodyLimit, isOverLimit, REQUEST_BODY_LIMIT } from '../src/utils/bodyLimit'
import { signToken, verifyToken, isSecretUsable, MissingJwtSecretError } from '../src/utils/jwt'
import loginApp from '../src/api/login'
import settingApp from '../src/api/system/setting'
import userConfigApp from '../src/api/panel/userConfig'
import itemIconApp from '../src/api/panel/itemIcon'
import itemIconGroupApp from '../src/api/panel/itemIconGroup'
import fileApp from '../src/api/system/file'
import { internalError } from '../src/utils/response'

/**
 * Self-check for the security-review fixes (§ security review)
 *
 * Scope: V-02A (login rate-limit key), V-02B (JWT_SECRET fail-closed), V-03 (custom code needs auth),
 * V-04 (no raw DB error text on the wire), V-05 (request-body limits).
 *
 * What actually matters here:
 * 1. an unauthenticated caller can no longer leak custom JS/CSS;
 * 2. a missing JWT_SECRET fails loudly instead of signing sessions with an empty key;
 * 3. `X-Forwarded-For` can no longer move a login attempt into a fresh rate-limit bucket;
 * 4. a database error never puts schema names into a response;
 * 5. oversized bodies are rejected **before** the handler parses them, while normal bodies still parse (the
 *    middleware buffers via `c.req.arrayBuffer()` and downstream `c.req.json()` must keep working).
 *
 *
 * 安全审查修复项自检
 *
 * 覆盖: V-02A (限流键), V-02B (JWT_SECRET fail-closed), V-03 (自定义代码需鉴权),
 * V-04 (不回传 DB 错误原文), V-05 (请求体上限)。
 *
 * 真正要守住的是:
 * 1. 未认证调用方再也拿不到自定义 JS/CSS;
 * 2. JWT_SECRET 缺失时明确报错, 而不是用空密钥签发会话;
 * 3. `X-Forwarded-For` 不再能把一次登录尝试挪进新的限流分桶;
 * 4. 数据库错误不会把表名/列名带进响应;
 * 5. 超大请求体在 handler 解析**之前**就被拒, 同时正常请求体仍能解析
 *    (中间件通过 `c.req.arrayBuffer()` 缓冲, 下游 `c.req.json()` 必须照常工作)。
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

function throws(label: string, fn: () => Promise<unknown>, name: string) {
  return fn().then(
    () => {
      failed++
      console.log(`  FAIL ${label} (no error thrown)`)
    },
    (err: Error) => eq(label, err.name, name),
  )
}

const SECRET = 'security-fixes-test-secret-key-0123456789'
const user = { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }

/**
 * Minimal D1 stub driven by callbacks: each test decides what a statement returns
 *
 * 由回调驱动的最小 D1 桩: 每个用例自行决定语句返回什么
 */
function makeDb(handler: (sql: string, params: unknown[]) => unknown) {
  const bound = new WeakMap<object, unknown[]>()
  return {
    prepare(sql: string) {
      const stmt = {
        _sql: sql,
        _params: [] as unknown[],
        bind(...args: unknown[]) {
          this._params = args
          bound.set(stmt, args)
          return stmt
        },
        first: async () => handler(sql, bound.get(stmt) ?? []),
        all: async () => ({ results: asRows(handler(sql, bound.get(stmt) ?? [])) }),
        run: async () => ({ meta: { last_row_id: 1 } }),
      }
      return stmt
    },
    async batch(stmts: unknown[]): Promise<unknown[]> {
      // Mirrors D1: a promise, so callers using `.then()` on the batch keep working
      // 与 D1 一致: 返回 promise, 让用 `.then()` 的调用方照常工作
      return (stmts as unknown[]).map(() => ({}))
    },
  }
}

/** Reads the SQL a prepared statement was created with (self-check only) / 读取语句的 SQL (仅自检用) */
function sqlOf(stmt: unknown): string {
  return String((stmt as { _sql?: string })?._sql ?? '')
}

/** Reads the bound parameters of a prepared statement (self-check only) / 读取语句的绑定参数 (仅自检用) */
function paramsOf(stmt: unknown): unknown[] {
  return ((stmt as { _params?: unknown[] })?._params) ?? []
}

function asRows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

const r2 = {
  put: async () => ({ httpEtag: '"etag"' }),
  get: async () => null,
  delete: async () => undefined,
}

// ===================== V-02B: JWT_SECRET =====================
console.log('== V-02B: JWT_SECRET fail-closed ==')

eq('非空密钥可用', isSecretUsable('x'), true)
eq('空串不可用', isSecretUsable(''), false)
eq('未定义不可用', isSecretUsable(undefined), false)
eq('纯空白不可用', isSecretUsable('   '), false)

await throws('空密钥签发抛 MissingJwtSecretError', () => signToken('', user, 1), 'MissingJwtSecretError')
await throws('空密钥校验抛 MissingJwtSecretError', () => verifyToken('  ', 'a.b.c'), 'MissingJwtSecretError')

const okToken = await signToken(SECRET, user, 1)
eq('正常密钥仍可签发与校验', (await verifyToken(SECRET, okToken))?.uid, 1)

// ===================== V-02A: rate-limit bucket =====================
console.log('\n== V-02A: 登录限流键只信任 cf-connecting-ip ==')

/** IP values the rate limiter writes into login_attempt / 限流器写入 login_attempt 的 IP 值 */
const recordedIps: string[] = []
const originalBatch = makeDb(() => null)
const recordingDb = makeDb(() => null)
// Intercept the statements handed to db.batch(): the failing-login INSERT carries (ip, now, cutoff, now)
// 拦截交给 db.batch() 的语句: 登录失败的 INSERT 绑定顺序是 (ip, now, cutoff, now)
recordingDb.batch = async (stmts: unknown[]) => {
  for (const stmt of stmts) {
    if (sqlOf(stmt).includes('INSERT INTO login_attempt'))
      recordedIps.push(String(paramsOf(stmt)[0]))
  }
  return await originalBatch.batch(stmts)
}

async function attemptLogin(env: unknown, headers: Record<string, string>) {
  return await loginApp.fetch(new Request('http://localhost/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  }), env as never)
}

const loginEnv = { DB: recordingDb, JWT_SECRET: SECRET }

await attemptLogin(loginEnv, { 'cf-connecting-ip': '203.0.113.9' })
await attemptLogin(loginEnv, { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4' })
await attemptLogin(loginEnv, { 'x-forwarded-for': '9.9.9.9' })
await attemptLogin(loginEnv, { 'x-forwarded-for': '8.8.8.8' })
await attemptLogin(loginEnv, { 'cf-connecting-ip': '198.51.100.7, 10.0.0.1' })

eq('限流写入的键 (伪造的 XFF 不再产生新分桶)', recordedIps, [
  '203.0.113.9',
  '203.0.113.9',
  'unknown',
  'unknown',
  '198.51.100.7',
])
ok('没有把 X-Forwarded-For 的值写进限流键', !recordedIps.includes('1.2.3.4') && !recordedIps.includes('9.9.9.9'))

// ===================== V-03: getCustomCode needs auth =====================
// ===================== V-07 A 步: 登录响应不可缓存 =====================
console.log('\n== V-07 A 步: 登录响应 Cache-Control ==')

// A correct password is needed for a successful login; the seeded hash is md5(md5(md5('12345678')))
// The settings are keyed by the first bound parameter — the SQL text alone cannot tell them apart
const SEEDED_PASSWORD_HASH = '579646aad11fae4dd295812fb4526245'
const seededDb = makeDb((sql, params) => {
  if (sql.includes('SELECT config_value')) {
    if (params[0] === 'admin_password')
      return { v: SEEDED_PASSWORD_HASH }
    return { v: 'admin' }
  }
  return null
})

const okLogin = await loginApp.fetch(new Request('http://localhost/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.11' },
  body: JSON.stringify({ username: 'admin', password: '12345678' }),
}), { DB: seededDb, JWT_SECRET: SECRET, PASSWORD_PEPPER: '' } as never)
const okLoginBody = await okLogin.json() as { code: number, data?: { token: string } }
eq('口令正确时登录成功', okLoginBody.code, 0)
eq('响应体仍返回 token (B 步之前契约不变)', typeof okLoginBody.data?.token, 'string')
eq('登录响应声明不可缓存', okLogin.headers.get('cache-control'), 'no-store')
ok('同时下发了会话 Cookie', (okLogin.headers.get('set-cookie') ?? '').includes('sun_panel_token='))

// ===================== V-03: getCustomCode needs auth =====================
console.log('\n== V-03: 自定义代码接口需要鉴权 ==')

const authnDb = makeDb((sql) => {
  if (sql.includes('SELECT config_value')) {
    return { v: sql.includes('auth_epoch') ? '1' : '' }
  }
  return null
})

const anon = await settingApp.fetch(new Request('http://localhost/getCustomCode', { method: 'POST' }), {
  DB: authnDb,
  JWT_SECRET: SECRET,
  PASSWORD_PEPPER: '',
} as never)
const anonBody = await anon.json() as { code: number, data?: unknown }
eq('未认证调用被拒 (1000)', anonBody.code, 1000)
eq('响应里没有 customCss/customJs', anonBody.data, undefined)

const authed = await settingApp.fetch(new Request('http://localhost/getCustomCode', {
  method: 'POST',
  headers: { token: await signToken(SECRET, user, 1) },
}), { DB: authnDb, JWT_SECRET: SECRET } as never)
const authedBody = await authed.json() as { code: number, data?: { customCss: string, customJs: string } }
eq('认证后仍可读取', authedBody.code, 0)
eq('返回结构不变', typeof authedBody.data?.customCss, 'string')

// ===================== V-04: no raw DB error text =====================
console.log('\n== V-04: 错误信息不回传 DB 原文 ==')

clearAuthEpochCache()
const token = await signToken(SECRET, user, 1)

const brokenDb = makeDb((sql) => {
  if (sql.includes('SELECT config_value'))
    return { v: '1' }
  return null
})
brokenDb.batch = async () => {
  throw new Error('UNIQUE constraint failed: item_icon.only_name')
}

const failing = await itemIconGroupApp.fetch(new Request('http://localhost/itemIconGroup/saveSort', {
  method: 'POST',
  headers: { 'content-type': 'application/json', token },
  body: JSON.stringify({ sortItems: [{ id: 1, sort: 1 }] }),
}), { DB: brokenDb, FILES: r2, JWT_SECRET: SECRET } as never)
const failingText = await failing.text()
ok('响应文本不含表名', !failingText.includes('item_icon.only_name') && !failingText.includes('UNIQUE constraint'))
eq('仍是既有错误码 1200', (JSON.parse(failingText) as { code: number }).code, 1200)

// internalError is the shared exit point: prove it never emits the raw text
const echoesBack = await (async () => {
  const app = new Hono()
  app.get('/', c => internalError(c, 1200, 'self-check', new Error('secret-table-name leaked')))
  const res = await app.fetch(new Request('http://localhost/'))
  return await res.text()
})()
ok('internalError 不泄露原始信息', !echoesBack.includes('secret-table-name'))

// ===================== V-05: request-body limits =====================
console.log('\n== V-05: 请求体上限 ==')

eq('Content-Length 解析: 正常值', isOverLimit('1024', 64 * 1024), false)
eq('Content-Length 解析: 恰好等于上限放行', isOverLimit(String(64 * 1024), 64 * 1024), false)
eq('Content-Length 解析: 超限拒绝', isOverLimit(String(64 * 1024 + 1), 64 * 1024), true)
eq('Content-Length 解析: 科学计数法按超限处理 (fail closed)', isOverLimit('1e9', 64 * 1024), true)
eq('Content-Length 解析: 十六进制按超限处理', isOverLimit('0x1000', 64 * 1024), true)
eq('Content-Length 解析: 负数按超限处理', isOverLimit('-1', 64 * 1024), true)
eq('Content-Length 解析: 非数字按超限处理', isOverLimit('abc', 64 * 1024), true)
eq('Content-Length 解析: 前导零不误判', isOverLimit('0001024', 64 * 1024), false)
eq('Content-Length 解析: 超长数字按超限处理', isOverLimit('9'.repeat(20), 64 * 1024), true)

{
  const app = new Hono()
  app.post('/x', bodyLimit(1024), c => c.json({ code: 0 }))

  const small = await app.fetch(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-length': '10' },
    body: 'hello',
  }))
  eq('正常体积放行且下游可解析', (await small.json() as { code: number }).code, 0)

  const declaredBig = await app.fetch(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-length': '999999' },
    body: 'hello',
  }))
  eq('声明超限直接 413', declaredBig.status, 413)
  eq('413 的响应体沿用 { code, msg }', (await declaredBig.json() as { code: number }).code, 1402)

  // A lying Content-Length must not pass: the real length is what decides
  // 说谎的 Content-Length 不能通过: 决定权在真实长度
  const lying = await app.fetch(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-length': '1' },
    body: 'x'.repeat(2048),
  }))
  eq('头部撒谎时按真实体积拒绝', lying.status, 413)

  // No header at all (chunked): must fall through, never be treated as oversized
  // 完全没有头部 (分块): 必须放行, 不能被误判为超限
  const chunked = await app.fetch(new Request('http://localhost/x', {
    method: 'POST',
    body: 'hello',
  }))
  eq('无长度头部时按真实体积放行', (await chunked.json() as { code: number }).code, 0)
}

{
  // bufferBody=false (the upload configuration): the declared length decides, and the body must still parse
  // bufferBody=false (上传路由的配置): 由声明长度决定, 且请求体仍必须能解析
  const app = new Hono()
  app.post('/up', bodyLimit({ maxSize: 1024, bufferBody: false }), async c => c.json({
    code: 0,
    got: await c.req.text(),
  }))

  const declaredBig = await app.fetch(new Request('http://localhost/up', {
    method: 'POST',
    headers: { 'content-length': '4096' },
    body: 'hello',
  }))
  eq('bufferBody=false: 声明超限被拒', declaredBig.status, 413)

  const fine = await app.fetch(new Request('http://localhost/up', {
    method: 'POST',
    headers: { 'content-length': '5' },
    body: 'hello',
  }))
  const fineBody = await fine.json() as { code: number, got: string }
  eq('bufferBody=false: 正常请求放行', fineBody.code, 0)
  eq('bufferBody=false: 下游仍能读到完整请求体', fineBody.got, 'hello')

  // Without a declared length the real size is still measured, so the mode cannot be used to smuggle a big body
  // 没有声明长度时仍会量真实体积, 因此该模式无法用来夹带大请求体
  const undeclared = await app.fetch(new Request('http://localhost/up', {
    method: 'POST',
    body: 'y'.repeat(5000),
  }))
  eq('bufferBody=false: 无声明长度时按真实体积拒绝', undeclared.status, 413)
}

{
  // The real route tables: prove the middleware is mounted and JSON bodies still parse
  // 真实路由表: 证明中间件已挂载, 且 JSON 请求体仍能解析
  const cfgDb = makeDb((sql) => {
    if (sql.includes('SELECT config_value'))
      return { v: '1' }
    if (sql.includes('SELECT panel_json'))
      return { panel_json: '{}', search_engine_json: '{}' }
    return null
  })

  const hugePanel = 'x'.repeat(REQUEST_BODY_LIMIT.large + 1024)
  const tooBig = await userConfigApp.fetch(new Request('http://localhost/userConfig/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json', token },
    body: JSON.stringify({ panel: { footerHtml: hugePanel } }),
  }), { DB: cfgDb, JWT_SECRET: SECRET } as never)
  eq('userConfig/set 超限被拒', tooBig.status, 413)

  const normal = await userConfigApp.fetch(new Request('http://localhost/userConfig/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json', token },
    body: JSON.stringify({ panel: { footerHtml: '<div>ok</div>' } }),
  }), { DB: cfgDb, JWT_SECRET: SECRET } as never)
  eq('userConfig/set 正常请求仍通过', (await normal.json() as { code: number }).code, 0)

  const manyIcons = Array.from({ length: 1001 }, (_, i) => ({ itemIconGroupId: 1, title: `t${i}` }))
  const tooMany = await itemIconApp.fetch(new Request('http://localhost/itemIcon/addMultiple', {
    method: 'POST',
    headers: { 'content-type': 'application/json', token },
    body: JSON.stringify(manyIcons),
  }), { DB: cfgDb, FILES: r2, JWT_SECRET: SECRET } as never)
  eq('addMultiple 超过 1000 条被拒', (await tooMany.json() as { code: number }).code, 1400)

  const tenIcons = manyIcons.slice(0, 10)
  const okIcons = await itemIconApp.fetch(new Request('http://localhost/itemIcon/addMultiple', {
    method: 'POST',
    headers: { 'content-type': 'application/json', token },
    body: JSON.stringify(tenIcons),
  }), { DB: cfgDb, FILES: r2, JWT_SECRET: SECRET } as never)
  const okIconsBody = await okIcons.json() as { code: number, data?: { list: unknown[] } }
  eq('addMultiple 正常条数通过', okIconsBody.code, 0)
  eq('返回条数与提交一致', okIconsBody.data?.list.length, 10)

  const tooManyDeletes = await fileApp.fetch(new Request('http://localhost/file/deletes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', token },
    body: JSON.stringify({ ids: Array.from({ length: 501 }, (_, i) => i + 1) }),
  }), { DB: cfgDb, FILES: r2, JWT_SECRET: SECRET } as never)
  eq('file/deletes 超过 500 条被拒', (await tooManyDeletes.json() as { code: number }).code, 1400)
}

{
  // Upload route: multipart bodies must survive the buffering done by bodyLimit
  // 上传路由: multipart 请求体必须能挺过 bodyLimit 的缓冲
  const uploadDb = makeDb(() => null)
  const form = new FormData()
  form.append('imgfile', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
  const uploaded = await fileApp.fetch(new Request('http://localhost/file/uploadImg', {
    method: 'POST',
    headers: { token },
    body: form,
  }), { DB: uploadDb, FILES: r2, JWT_SECRET: SECRET } as never)
  const uploadedBody = await uploaded.json() as { code: number, data?: { imageUrl: string } }
  eq('multipart 上传在 bodyLimit 之后仍可解析', uploadedBody.code, 0)
  ok('返回的 imageUrl 形态正确', /^uploads\/\d{4}\/\d{1,2}\/\d{1,2}\/[0-9a-f]{32}\.png$/.test(uploadedBody.data?.imageUrl ?? ''))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
