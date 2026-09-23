import { clearAuthEpochCache } from '../src/utils/authEpoch'
import { signToken } from '../src/utils/jwt'
import itemIconGroupApp from '../src/api/panel/itemIconGroup'

/**
 * Self-check for the home page's "groups + items in one call" (§4.2)
 *
 * The old flow took 1+N Worker requests (query the groups, then query the items of each group). This verifies
 * with an in-memory D1:
 * - grouping is correct and orphan items (whose group_id points at a non-existent group) are not attached anywhere;
 * - on an empty database the default group is created and orphan items are "claimed" before the items are queried —
 *   the reverse order loses those items;
 * - the number of SQL statements is fixed at 3 (1 epoch + 2 data queries) and does not grow with the group count.
 *
 *
 * 首页「分组 + 项目一次返回」自检 (§4.2)
 *
 * 旧流程是 1+N 次 Worker 请求 (先查分组, 再逐个分组查项目)。这里用内存版 D1 验证:
 * - 归组正确, 游离项目 (group_id 指向不存在的分组) 不会乱挂;
 * - 空库时先建默认分组并「认领」游离项目, 再查项目 —— 顺序错了这些项目就会丢;
 * - SQL 次数固定为 3 (1 次 epoch + 2 次数据查询), 不随分组数增长。
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

interface GroupRow {
  id: number
  icon: string
  title: string
  description: string
  sort: number
  card_style: number
  text_color: string
  hide_description: number
  created_at: string
  updated_at: string
}

interface ItemRow {
  id: number
  icon_json: string
  title: string
  url: string
  lan_url: string
  description: string
  open_method: number
  sort: number
  item_icon_group_id: number
  only_name: string
  created_at: string
  updated_at: string
}

function group(id: number, title: string, extra: Partial<GroupRow> = {}): GroupRow {
  return {
    id,
    icon: 'x',
    title,
    description: '',
    sort: id,
    card_style: -1,
    text_color: '',
    hide_description: 0,
    created_at: `t${id}`,
    updated_at: `t${id}`,
    ...extra,
  }
}

function item(id: number, groupId: number, sort: number): ItemRow {
  return {
    id,
    icon_json: `{"itemType":0,"src":"uploads/icons/${String(id).padStart(32, 'a')}.png"}`,
    title: `item-${id}`,
    url: `https://example.com/${id}`,
    lan_url: '',
    description: '',
    open_method: 0,
    sort,
    item_icon_group_id: groupId,
    only_name: '',
    created_at: `t${id}`,
    updated_at: `t${id}`,
  }
}

function makeDb(state: { groups: GroupRow[], items: ItemRow[], nextGroupId: number }) {
  let queries = 0

  const exec = async (sql: string) => {
    queries++
    if (sql.includes('FROM system_setting'))
      return null
    if (sql.startsWith('SELECT') && sql.includes('FROM item_icon_group'))
      return { results: state.groups }
    if (sql.startsWith('SELECT') && sql.includes('FROM item_icon '))
      return { results: state.items }
    if (sql.startsWith('INSERT INTO item_icon_group')) {
      const created = group(state.nextGroupId++, 'APP')
      state.groups = [created]
      return { success: true, meta: { last_row_id: created.id } }
    }
    if (sql.startsWith('UPDATE item_icon SET item_icon_group_id')) {
      const target = state.groups[0]?.id ?? 0
      for (const row of state.items) {
        if (row.item_icon_group_id === 0)
          row.item_icon_group_id = target
      }
      return { success: true }
    }
    throw new Error(`模拟器无法识别的 SQL: ${sql}`)
  }

  const db = {
    prepare(sql: string) {
      return {
        bind: () => ({ first: () => exec(sql), all: () => exec(sql), run: () => exec(sql) }),
        first: () => exec(sql),
        all: () => exec(sql),
        run: () => exec(sql),
      }
    },
  }
  return { db: db as never, queryCount: () => queries }
}

const SECRET = 'group-test-secret'
const token = await signToken(SECRET, { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }, 1)

function request(db: unknown) {
  // Call the sub-app directly; the path has no /panel prefix (same as the user-config-merge self-check)
  // 直接调用子应用, 路径不带 /panel 前缀 (与 user-config-merge 自检一致)
  return itemIconGroupApp.fetch(
    new Request('http://test/itemIconGroup/getListWithItems', {
      method: 'POST',
      headers: { 'content-type': 'application/json', token },
      body: '{}',
    }),
    { DB: db, JWT_SECRET: SECRET } as never,
  )
}

console.log('== 归组 ==')
clearAuthEpochCache()
const state1 = {
  groups: [group(1, 'APP', { card_style: 0, text_color: '#fff' }), group(2, 'NAS', { hide_description: 1 })],
  items: [item(11, 1, 0), item(12, 1, 1), item(13, 2, 0), item(14, 999, 0)],
  nextGroupId: 3,
}
const fake1 = makeDb(state1)
let res = await (await request(fake1.db)).json() as { code: number, data: { list: any[], count: number } }
eq('返回成功', res.code, 0)
eq('分组数', res.data.list.length, 2)
eq('count 与列表一致', res.data.count, 2)
eq('第 1 组项目数', res.data.list[0].items.length, 2)
eq('第 1 组项目顺序', res.data.list[0].items.map((i: any) => i.id), [11, 12])
eq('第 2 组项目数', res.data.list[1].items.length, 1)
eq('第 2 组项目 id', res.data.list[1].items.map((i: any) => i.id), [13])
eq('游离项目不会被挂到任何分组', res.data.list.flatMap((g: any) => g.items).some((i: any) => i.id === 14), false)
eq('分组级样式随之下发', [res.data.list[0].cardStyle, res.data.list[0].textColor, res.data.list[1].hideDescription], [0, '#fff', 1])
eq('SQL 次数固定为 3 (1 epoch + 2 数据查询)', fake1.queryCount(), 3)

console.log('== 空库: 先建默认分组并认领游离项目, 再查项目 ==')
clearAuthEpochCache()
const state2 = { groups: [] as GroupRow[], items: [item(21, 0, 0), item(22, 0, 1)], nextGroupId: 7 }
const fake2 = makeDb(state2)
res = await (await request(fake2.db)).json() as { code: number, data: { list: any[] } }
eq('返回成功', res.code, 0)
eq('自动创建了 1 个分组', res.data.list.length, 1)
eq('默认分组标题', res.data.list[0].title, 'APP')
eq('游离项目被认领到默认分组', res.data.list[0].items.map((i: any) => i.id), [21, 22])

console.log('== 未登录 ==')
const denied = await itemIconGroupApp.fetch(
  new Request('http://test/itemIconGroup/getListWithItems', { method: 'POST' }),
  { DB: fake1.db, JWT_SECRET: SECRET } as never,
)
const deniedBody = await denied.json() as { code: number }
eq('无 token 被拦截', deniedBody.code, 1000)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
