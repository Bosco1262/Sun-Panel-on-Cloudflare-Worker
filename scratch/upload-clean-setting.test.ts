import { getAutoCleanUnused, parseBoolSetting } from '../src/utils/settings'
import { clearAuthEpochCache } from '../src/utils/authEpoch'
import { signToken } from '../src/utils/jwt'
import itemIconApp from '../src/api/panel/itemIcon'

/**
 * 「删除时自动回收未引用图片」开关自检
 *
 * 关注两件事:
 * 1. 开关的解析与默认值 —— 键不存在时按「开」(与加开关之前的行为一致);
 *    读取失败时按「关」(偏保守: 少删一次只是残留文件, 误删会清掉还想复用的图片)。
 * 2. 开关真的能拦住删除接口里的 R2 回收 —— 路由级验证, 不是只看纯函数。
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

console.log('== parseBoolSetting ==')
eq('未设置 -> null', parseBoolSetting(null), null)
eq('空串 -> null', parseBoolSetting(''), null)
eq("'1' -> true", parseBoolSetting('1'), true)
eq("'0' -> false", parseBoolSetting('0'), false)
eq("'true' -> true", parseBoolSetting('true'), true)
eq("'FALSE' (大小写不敏感) -> false", parseBoolSetting('FALSE'), false)
eq("'off' -> false", parseBoolSetting('off'), false)
eq("'no' -> false", parseBoolSetting('no'), false)
eq("'yes' -> true", parseBoolSetting('yes'), true)
eq('带空格也能解析', parseBoolSetting(' 0 '), false)

// ===================== 内存版 D1 =====================

interface State {
  /** storage_auto_clean_unused 的值（null = 没这行） */
  autoClean: string | null
  /** 抛错模式: 模拟 D1 抖动 */
  broken: boolean
  itemDeleted: boolean
  fileDeleted: boolean
}

const state: State = { autoClean: null, broken: false, itemDeleted: false, fileDeleted: false }
const items = [{ icon_json: '{"itemType":0,"src":"uploads/2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"}' }]

function makeDb() {
  const db = {
    prepare(sql: string) {
      const make = (args: unknown[] = []) => ({
        first: async () => run(args, 'first'),
        all: async () => run(args, 'all'),
        run: async () => run(args, 'run'),
        bind: (...more: unknown[]) => make(more),
      })

      const run = async (args: unknown[], mode: string) => {
        if (state.broken)
          throw new Error('D1_ERROR: simulated outage')

        if (sql.includes('FROM system_setting')) {
          const name = String(args[0] ?? '')
          if (name === 'storage_auto_clean_unused')
            return state.autoClean === null ? null : { v: state.autoClean }
          return null // auth_epoch / admin_head_image 等
        }
        if (sql.includes('SELECT icon_json FROM item_icon'))
          return { results: items }
        if (sql.includes('SELECT 1 AS x FROM item_icon'))
          return null // 没有别的项目引用这张图
        if (sql.includes('FROM user_config'))
          return null
        if (sql.startsWith('UPDATE item_icon SET deleted_at')) {
          state.itemDeleted = true
          return { success: true }
        }
        if (sql.startsWith('UPDATE file SET deleted_at')) {
          state.fileDeleted = true
          return { success: true }
        }
        if (mode === 'all')
          return { results: [] }
        return null
      }

      return make()
    },
  }
  return db as never
}

const deletedKeys: string[] = []
const r2 = {
  async delete(key: string) { deletedKeys.push(key) },
} as never

console.log('== getAutoCleanUnused ==')
clearAuthEpochCache()
state.broken = false
state.autoClean = null
eq('未设置 -> 默认开', await getAutoCleanUnused(makeDb()), true)
state.autoClean = '1'
eq("'1' -> 开", await getAutoCleanUnused(makeDb()), true)
state.autoClean = '0'
eq("'0' -> 关", await getAutoCleanUnused(makeDb()), false)
state.autoClean = 'junk'
eq('无法识别的值 -> 开', await getAutoCleanUnused(makeDb()), true)
state.broken = true
eq('读取失败 -> 关 (保守, 不删)', await getAutoCleanUnused(makeDb()), false)
state.broken = false

// ===================== 路由级验证 =====================

const SECRET = 'clean-setting-test'
const token = await signToken(SECRET, { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }, 1)

async function deleteItem() {
  return await (await itemIconApp.fetch(
    new Request('http://test/itemIcon/deletes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', token },
      body: JSON.stringify({ ids: [11] }),
    }),
    { DB: makeDb(), FILES: r2, JWT_SECRET: SECRET } as never,
  )).json() as { code: number }
}

console.log('== 路由级: 默认(开) ==')
clearAuthEpochCache()
state.autoClean = null
state.itemDeleted = false
state.fileDeleted = false
deletedKeys.length = 0
let res = await deleteItem()
eq('接口返回成功', res.code, 0)
eq('项目已软删', state.itemDeleted, true)
eq('R2 对象被回收', deletedKeys, ['2026/9/10/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'])
eq('file 行被软删', state.fileDeleted, true)

console.log('== 路由级: 开关关闭 ==')
clearAuthEpochCache()
state.autoClean = '0'
state.itemDeleted = false
state.fileDeleted = false
deletedKeys.length = 0
res = await deleteItem()
eq('接口仍返回成功', res.code, 0)
eq('项目照样软删', state.itemDeleted, true)
eq('R2 对象未被回收', deletedKeys.length, 0)
eq('file 行未被软删', state.fileDeleted, false)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
