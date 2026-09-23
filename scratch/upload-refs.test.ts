import {
  cleanupUploads,
  isUploadSrcReferenced,
  normalizeUploadSrc,
  srcFromIconJson,
} from '../src/utils/uploadRefs'

/**
 * Self-check for R2 reference-aware cleanup (§4.1)
 *
 * The regression it guards against: the old implementation only soft-deleted the D1 rows when deleting an
 * item/group, so images stayed in R2 as orphans forever; the opposite mistake is worse — one image can be
 * referenced by items, the panel background and the avatar at the same time, so deleting blindly breaks images
 * that are still in use. This verifies "delete only when nobody references it" with in-memory D1 + R2.
 *
 *
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

// ===================== Path normalisation =====================
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

// ===================== In-memory D1 / R2 =====================
// ===================== 内存版 D1 / R2 =====================

interface Ctx {
  items: Array<{ icon_json: string }>
  panelJson: string
  headImage: string
  customCss: string
  customJs: string
}

const ctx: Ctx = { items: [], panelJson: '{}', headImage: '', customCss: '', customJs: '' }

/**
 * Records the statements created, so "the subrequest count is independent of the candidate count" can be asserted (§9.9)
 *
 * 记录创建过的语句, 用于断言「子请求数与候选数量无关」(§9.9)
 */
const statements: string[] = []

// A real D1 prepared statement can be executed directly with first()/all()/run() or bound first and then executed
// 真实 D1 的 prepared statement 既能直接 first()/all()/run(), 也能先 bind() 再执行
const db = {
  prepare(sql: string) {
    statements.push(sql)
    const make = (args: unknown[] = []) => ({
      first: async () => execFirst(args),
      all: async () => execAll(args),
      run: async () => ({ success: true }),
      bind: (...more: unknown[]) => make(more),
    })

    const execFirst = async (args: unknown[]) => {
      if (sql.includes('FROM user_config'))
        return { panel_json: ctx.panelJson }
      return null
    }

    const execAll = async (args: unknown[]) => {
      // Live items (soft-deleted ones never appear in the results)
      // 活着的项目 (软删的不会出现在结果里)
      if (sql.includes('FROM item_icon'))
        return { results: ctx.items.map(item => ({ icon_json: item.icon_json })) }
      // Avatar + custom CSS/JS: filter by the bound config_name and return as-is (only the `v` field is used)
      // 头像 + 自定义 CSS/JS: 按绑定的 config_name 过滤后原样返回 (只用到 v 字段)
      if (sql.includes('FROM system_setting')) {
        const wanted = new Set(args.map(String))
        const rows = [
          { name: 'admin_head_image', v: ctx.headImage },
          { name: 'custom_css', v: ctx.customCss },
          { name: 'custom_js', v: ctx.customJs },
        ].filter(row => wanted.has(row.name))
        return { results: rows.map(row => ({ v: row.v })) }
      }
      return { results: [] }
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

// §9.8: images referenced from custom CSS/JS must be kept as well, otherwise "Clean unused files" would delete images in use
// §9.8: 自定义 CSS/JS 里引用的图片同样要保留, 否则「清理未引用文件」会删掉在用图片
ctx.customCss = '.card{background:url(uploads/icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png)}'
eq('被自定义 CSS 引用', await isUploadSrcReferenced(db, SRC_B), true)
ctx.customCss = ''
ctx.customJs = `document.body.style.background='url(./uploads/icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png)'`
eq('被自定义 JS 引用', await isUploadSrcReferenced(db, SRC_B), true)
ctx.customJs = ''
eq('自定义代码清空后不再被引用', await isUploadSrcReferenced(db, SRC_B), false)

console.log('== 清理 ==')
ctx.items = []
deletedKeys.length = 0
let result = await cleanupUploads(db, r2, [SRC_A, SRC_B, SRC_A, null, undefined, 'https://x.com/a.png'])
eq('返回删除数量 (去重后 2 个)', result.deleted, 2)
eq('没有剩余待处理', result.remaining, 0)
eq('两个对象都被删', deletedKeys.length, 2)
eq('外链不会被当成本站对象删除', deletedKeys.some(k => k.includes('x.com')), false)
eq('key 去掉了 ./uploads/ 前缀', deletedKeys.includes('2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), true)

// Images in use must never be deleted
// 在用的图片不能被删
ctx.items = [{ icon_json: '{"src":"uploads/2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"}' }]
deletedKeys.length = 0
result = await cleanupUploads(db, r2, [SRC_A, SRC_B])
eq('在用图片被保留', result.deleted, 1)
eq('只删了没人用的那个', deletedKeys, ['icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png'])

// A single failed deletion does not affect the other objects and does not throw
// 单个删除失败不影响其它对象, 也不抛出
ctx.items = []
deletedKeys.length = 0
failedDeletes.add('icons/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png')
result = await cleanupUploads(db, r2, [SRC_B, SRC_A])
eq('失败的那个不计入', result.deleted, 1)
eq('另一个仍然被删', deletedKeys.includes('2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), true)
failedDeletes.clear()

// Batching: the free plan caps subrequests per invocation, so anything above the limit waits for the next round.
// Note the semantics: the caller passes "file rows that are still not soft-deleted" each round, so the next
// round's input shrinks (the same as cleanUnused in src/api/system/file.ts).
//
// 分批: 免费版单次调用子请求有限, 超过 limit 的部分留给下一轮。
// 注意语义: 调用方每轮传入的是「仍未软删的 file 行」, 所以下一轮的输入会变小
// (与 src/api/system/file.ts 的 cleanUnused 一致)。
console.log('== 分批 (limit) ==')
ctx.items = []
let pending = Array.from({ length: 5 }, (_, i) => `./uploads/2026/9/10/${i.toString(16).padStart(32, '0')}.png`)

deletedKeys.length = 0
const firstRound = await cleanupUploads(db, r2, pending, 2)
eq('第一轮只删 limit 个', firstRound.deleted, 2)
eq('第一轮后剩余 3 个', firstRound.remaining, 3)

pending = pending.slice(firstRound.deleted)
deletedKeys.length = 0
const secondRound = await cleanupUploads(db, r2, pending, 2)
eq('第二轮再删 2 个', secondRound.deleted, 2)
eq('第二轮后剩余 1 个', secondRound.remaining, 1)

pending = pending.slice(secondRound.deleted)
deletedKeys.length = 0
const lastRound = await cleanupUploads(db, r2, pending, 2)
eq('第三轮删完最后 1 个', lastRound.deleted, 1)
eq('第三轮后没有剩余', lastRound.remaining, 0)

console.log('== 子请求数与候选数量无关 (§9.9) ==')
ctx.items = []
ctx.panelJson = '{}'
ctx.headImage = ''
ctx.customCss = ''
ctx.customJs = ''

function makeSrc(i: number) {
  return `./uploads/2026/9/10/${i.toString(16).padStart(32, '0')}.png`
}

let mark = statements.length
deletedKeys.length = 0
await cleanupUploads(db, r2, [SRC_A, SRC_B])
const fewStatements = statements.length - mark

const many = Array.from({ length: 24 }, (_, i) => makeSrc(i))
mark = statements.length
deletedKeys.length = 0
const manyResult = await cleanupUploads(db, r2, many)
const manyStatements = statements.length - mark

eq('24 个候选都被删除', manyResult.deleted, 24)
eq('候选 2 个 -> 语句 4 条 (3 次引用读取 + 1 次批量更新)', fewStatements, 4)
eq('候选 24 个 -> 语句数不变 (旧实现是 4N 级别)', manyStatements, fewStatements)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
