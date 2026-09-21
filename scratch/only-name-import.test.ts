import { clearAuthEpochCache } from '../src/utils/authEpoch'
import { signToken } from '../src/utils/jwt'
import itemIconApp from '../src/api/panel/itemIcon'

/**
 * 「唯一标识 (onlyName)」导入边界自检
 *
 * 导入文件来自用户磁盘, 其中的 onlyName 不可信。约定 (与单条 edit 对齐):
 *   - 归一化: 去首尾空白 → 剔除非法字符 (只留英文/数字/下划线/中划线) → 截断到 50 字符
 *   - 库内已占用 或 本批次内重复 → 降级为空串并在响应里回报 (导入不因一个重复标识整体失败)
 *   - 空/缺省 → 空串 (与新建项目一致)
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

// ===================== 内存版 D1 =====================

/** 库里已被占用的唯一标识 (软删的不算, 这里只放活着的) */
const takenInDb = ['taken-name']
/** 记录所有 bind 过的语句, 用于断言真正写入的值 */
const bound: Array<{ sql: string; args: unknown[] }> = []

const db = {
  prepare(sql: string) {
    const make = (args: unknown[] = []) => ({
      first: async () => null,
      all: async () => {
        if (sql.includes('SELECT only_name FROM item_icon'))
          return { results: takenInDb.map(name => ({ only_name: name })) }
        return { results: [] }
      },
      run: async () => ({ success: true }),
      bind: (...more: unknown[]) => {
        bound.push({ sql, args: more })
        return make(more)
      },
    })
    return make()
  },
  async batch(stmts: unknown[]) {
    return stmts.map(() => ({ success: true }))
  },
} as never

const SECRET = 'only-name-import-test'
const token = await signToken(SECRET, { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }, 1)

async function post(path: string, body: unknown) {
  clearAuthEpochCache()
  return await (await itemIconApp.fetch(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', token },
      body: JSON.stringify(body),
    }),
    { DB: db, FILES: {} as never, JWT_SECRET: SECRET } as never,
  )).json() as { code: number, data: { droppedOnlyNames: string[] } }
}

// ===================== 批量导入 =====================

console.log('== addMultiple: 归一化 + 去重 ==')

const longName = 'a'.repeat(60)
const res = await post('/itemIcon/addMultiple', [
  { title: 'A', itemIconGroupId: 1, onlyName: 'taken-name' }, // 库内已占用 -> 丢弃
  { title: 'B', itemIconGroupId: 1, onlyName: 'New-Name' }, // 合法 -> 保留
  { title: 'C', itemIconGroupId: 1, onlyName: 'bad name!' }, // 非法字符 -> badname
  { title: 'D', itemIconGroupId: 1 }, // 缺省 -> 空
  { title: 'E', itemIconGroupId: 1, onlyName: '  spaced  ' }, // 空白 -> spaced
  { title: 'F', itemIconGroupId: 1, onlyName: 'New-Name' }, // 批内重复 -> 丢弃
  { title: 'G', itemIconGroupId: 1, onlyName: longName }, // 超长 -> 截断 50
  { title: 'H', itemIconGroupId: 1, onlyName: '!!!' }, // 归一化后为空 -> 空
])

eq('接口返回成功', res.code, 0)
eq('被丢弃的唯一标识 (库内占用 + 批内重复)', res.data.droppedOnlyNames, ['taken-name', 'New-Name'])

const inserts = bound.filter(b => b.sql.includes('INSERT INTO item_icon'))
eq('插入语句数量', inserts.length, 8)
// INSERT 的参数顺序: icon_json, title, url, lan_url, description, open_method, sort, group_id, only_name
eq('写入的 only_name 序列', inserts.map(b => b.args[8]), [
  '',
  'New-Name',
  'badname',
  '',
  'spaced',
  '',
  'a'.repeat(50),
  '',
])
eq('sort 缺省时写 9999 (不影响「保真顺序」的既有约定)', inserts.map(b => b.args[6]), [9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999])

// ===================== 单条编辑 (归一化保持一致) =====================

console.log('== edit: 与批量使用同一套归一化 ==')

bound.length = 0
const editRes = await post('/itemIcon/edit', {
  id: 7,
  itemIconGroupId: 1,
  title: 'X',
  onlyName: 'hello world!',
})

eq('编辑接口返回成功', editRes.code, 0)
const updates = bound.filter(b => b.sql.includes('UPDATE item_icon SET'))
eq('UPDATE 语句数量', updates.length, 1)
// UPDATE 的参数顺序: icon_json, title, url, lan_url, description, open_method, group_id, only_name, id
eq('UPDATE 写入归一化后的 only_name', updates[0]?.args[7], 'helloworld')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
