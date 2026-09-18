import {
  cleanupUploads,
  isUploadSrcReferenced,
  normalizeUploadSrc,
  srcFromIconJson,
} from '../src/utils/uploadRefs'

/**
 * R2 引用清理自检 (§4.1)
 *
 * 回归的风险: 旧实现删项目/分组只软删 D1 行, 图片永远留在 R2 变成孤儿;
 * 而反过来的错误更严重 —— 一张图可能同时被项目、面板背景、头像引用, 无脑删会删坏在用图片。
 * 这里用内存版 D1 + R2 验证「只在确实没人引用时才删」。
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

// ===================== 路径归一化 =====================

console.log('== 路径归一化 ==')
eq('相对路径补前缀', normalizeUploadSrc('uploads/2026/9/10/a.png'), './uploads/2026/9/10/a.png')
eq('./ 前缀保持不变', normalizeUploadSrc('./uploads/2026/9/10/a.png'), './uploads/2026/9/10/a.png')
eq('外链不算本站对象', normalizeUploadSrc('https://cdn.example.com/a.png'), null)
eq('空值', normalizeUploadSrc(''), null)
eq('非字符串', normalizeUploadSrc(undefined), null)

eq('从 icon_json 取 src', srcFromIconJson('{"itemType":0,"src":"uploads/icons/aa.png"}'), './uploads/icons/aa.png')
eq('icon_json 无 src', srcFromIconJson('{"itemType":3,"text":"subway:add"}'), null)
eq('icon_json 是外链', srcFromIconJson('{"src":"https://x.com/a.png"}'), null)
eq('icon_json 脏数据', srcFromIconJson('not-json'), null)

// ===================== 内存版 D1 / R2 =====================

interface Ctx {
  items: Array<{ icon_json: string }>
  panelJson: string
  headImage: string
}

const ctx: Ctx = { items: [], panelJson: '{}', headImage: '' }

// 真实 D1 的 prepared statement 既能直接 first()/all()/run(), 也能先 bind() 再执行
const db = {
  prepare(sql: string) {
    const make = (args: unknown[] = []) => ({
      first: async () => exec(args),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      bind: (...more: unknown[]) => make(more),
    })

    const exec = async (args: unknown[]) => {
      if (sql.includes('FROM item_icon')) {
        const needle = String(args[0] ?? '').replace(/%/g, '')
        return ctx.items.some(i => i.icon_json.includes(needle)) ? { x: 1 } : null
      }
      if (sql.includes('FROM user_config'))
        return { panel_json: ctx.panelJson }
      if (sql.includes('FROM system_setting'))
        return { v: ctx.headImage }
      return null
    }

    return make()
  },
} as never

const deletedKeys: string[] = []
const failedDeletes = new Set<string>()
const r2 = {
  async delete(key: string) {
    if (failedDeletes.has(key))
      throw new Error('r2 delete failed')
    deletedKeys.push(key)
  },
} as never

const SRC_A = './uploads/2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
const SRC_B = './uploads/icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'

console.log('== 引用检查 ==')
ctx.items = [{ icon_json: '{"src":"uploads/2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"}' }]
eq('被活着的项目引用', await isUploadSrcReferenced(db, SRC_A), true)
ctx.items = []
eq('项目已删 -> 不再被引用', await isUploadSrcReferenced(db, SRC_A), false)
ctx.panelJson = '{"backgroundImageSrc":"uploads/2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"}'
eq('被面板背景引用', await isUploadSrcReferenced(db, SRC_A), true)
ctx.panelJson = '{}'
ctx.headImage = 'uploads/icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'
eq('被头像引用', await isUploadSrcReferenced(db, SRC_B), true)
ctx.headImage = ''
eq('没人引用', await isUploadSrcReferenced(db, SRC_B), false)

console.log('== 清理 ==')
ctx.items = []
deletedKeys.length = 0
let count = await cleanupUploads(db, r2, [SRC_A, SRC_B, SRC_A, null, undefined, 'https://x.com/a.png'])
eq('返回删除数量 (去重后 2 个)', count, 2)
eq('两个对象都被删', deletedKeys.length, 2)
eq('外链不会被当成本站对象删除', deletedKeys.some(k => k.includes('x.com')), false)
eq('key 去掉了 ./uploads/ 前缀', deletedKeys.includes('2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), true)

// 在用的图片不能被删
ctx.items = [{ icon_json: '{"src":"uploads/2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"}' }]
deletedKeys.length = 0
count = await cleanupUploads(db, r2, [SRC_A, SRC_B])
eq('在用图片被保留', count, 1)
eq('只删了没人用的那个', deletedKeys, ['icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'])

// 单个删除失败不影响其它对象, 也不抛出
ctx.items = []
deletedKeys.length = 0
failedDeletes.add('icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png')
count = await cleanupUploads(db, r2, [SRC_B, SRC_A])
eq('失败的那个不计入', count, 1)
eq('另一个仍然被删', deletedKeys.includes('2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), true)
failedDeletes.clear()

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
