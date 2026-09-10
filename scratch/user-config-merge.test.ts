import userConfigApp from '../src/api/panel/userConfig'
import { signToken } from '../src/utils/jwt'

/**
 * userConfig/set 的合并语义验证
 *
 * 回归的问题: 旧实现把未提交的字段当成空对象写回, 导致「风格设置」里只提交 panel 时,
 * 会把同一行里的 search_engine_json 抹成 {}。这里用替换掉 D1 的内存实现做端到端校验。
 */

let failed = 0
let passed = 0

function check(label: string, actual: unknown, expected: unknown) {
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

const storage = new Map<string, { panel_json: string; search_engine_json: string }>()

const db = {
  prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>() {
            return (storage.get('1') ?? null) as T | null
          },
          async run() {
            if (sql.startsWith('INSERT')) {
              storage.set('1', { panel_json: String(args[0]), search_engine_json: String(args[1]) })
            }
            return { success: true }
          },
        }
      },
      async first<T>() {
        return (storage.get('1') ?? null) as T | null
      },
      async run() {
        return { success: true }
      },
    }
  },
}

const env = { DB: db, JWT_SECRET: 'test-secret' }
const token = await signToken('test-secret', { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 })

function req(path: string, body: unknown) {
  return userConfigApp.fetch(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    env as never,
  )
}

console.log('== 首次写入 ==')
storage.set('1', { panel_json: '{}', search_engine_json: '{}' })
let res = await (await req('/userConfig/set', {
  panel: { logoText: 'Sun-Panel' },
  searchEngine: { currentEngineId: 'google', engineList: [{ id: 'google', title: 'Google', url: 'https://www.google.com/search?q=%s' }], openMethod: 1 },
})).json() as { code: number }
check('返回成功', res.code, 0)
check('panel 已写入', JSON.parse(storage.get('1')!.panel_json).logoText, 'Sun-Panel')
check('searchEngine 已写入', JSON.parse(storage.get('1')!.search_engine_json).engineList.length, 1)

console.log('== 只提交 panel (修复的核心场景) ==')
res = await (await req('/userConfig/set', { panel: { logoText: 'Changed' } })).json() as { code: number }
check('返回成功', res.code, 0)
check('panel 已更新', JSON.parse(storage.get('1')!.panel_json).logoText, 'Changed')
check('searchEngine 未被清空', JSON.parse(storage.get('1')!.search_engine_json).engineList[0].id, 'google')
check('searchEngine.openMethod 保留', JSON.parse(storage.get('1')!.search_engine_json).openMethod, 1)

console.log('== 只提交 searchEngine ==')
res = await (await req('/userConfig/set', {
  searchEngine: { currentEngineId: '', engineList: [], openMethod: 0 },
})).json() as { code: number }
check('返回成功', res.code, 0)
check('panel 未被清空', JSON.parse(storage.get('1')!.panel_json).logoText, 'Changed')
check('允许保存空引擎列表 (用户主动清空)', JSON.parse(storage.get('1')!.search_engine_json).engineList.length, 0)

console.log('== 非法请求 ==')
res = await (await req('/userConfig/set', {})).json() as { code: number }
check('两个字段都不传 -> 1400', res.code, 1400)
res = await (await req('/userConfig/set', { panel: null, searchEngine: null })).json() as { code: number }
check('显式传 null -> 1400', res.code, 1400)

console.log('== get 返回结构 ==')
const got = await (await req('/userConfig/get', {})).json() as { code: number; data: { panel: unknown; searchEngine: unknown } }
check('get 成功', got.code, 0)
check('get 返回 panel', (got.data.panel as Record<string, unknown>).logoText, 'Changed')
check('get 返回 searchEngine', Array.isArray((got.data.searchEngine as Record<string, unknown>).engineList), true)

console.log('== 未登录 ==')
const denied = await userConfigApp.fetch(
  new Request('http://test/userConfig/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ panel: {} }),
  }),
  env as never,
)
check('无 token 被拦截', (await denied.json() as { code: number }).code, 1000)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
