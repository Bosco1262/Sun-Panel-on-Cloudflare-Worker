import { buildItemGroupViews, matchItem } from '../frontend/src/utils/panelFilter/index'

/**
 * 首页「搜索栏过滤项目」纯逻辑自检
 *
 * 回归的问题: 旧实现把命中的分组浅拷贝一份渲染, 交互回调再按数组下标回原数组取分组,
 * 过滤后下标偏移 → hover / 排序作用到了别的分组上。
 * 因此这里除命中判定外, 特别断言视图里的 group 必须是**原始对象引用**。
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

function ok(label: string, cond: boolean) {
  eq(label, cond, true)
}

function item(title: string, url = '', description = ''): Panel.ItemInfo {
  return { title, url, description } as Panel.ItemInfo
}

function group(id: number, title: string, items?: Panel.ItemInfo[]) {
  return { id, title, description: '', sort: 0, hoverStatus: false, items }
}

console.log('== matchItem ==')
eq('标题命中', matchItem(item('GitHub', 'https://github.com'), 'github'), true)
eq('标题命中(中文)', matchItem(item('我的笔记'), '笔记'), true)
eq('网址命中', matchItem(item('A', 'https://nas.example.com'), 'nas.example'), true)
eq('描述命中', matchItem(item('A', 'https://a.com', '家庭相册'), '相册'), true)
eq('都不命中', matchItem(item('A', 'https://a.com', 'x'), 'zzz'), false)
eq('空关键词视为全部命中', matchItem(item('A', 'https://a.com'), ''), true)
eq('纯空格关键词视为全部命中', matchItem(item('A', 'https://a.com'), '   '), true)
eq('关键词首尾空格被忽略', matchItem(item('GitHub'), '  git  '), true)
eq('字段缺失不报错', matchItem({ title: 'A' } as Panel.ItemInfo, 'a'), true)

console.log('== buildItemGroupViews: 未过滤 ==')
const g1 = group(1, 'APP', [item('GitHub', 'https://github.com'), item('Baidu', 'https://baidu.com')])
const g2 = group(2, 'NAS', [item('群晖', 'https://nas.local')])
const groups = [g1, g2]

const all = buildItemGroupViews(groups, '', true)
eq('分组数量', all.length, 2)
eq('分组顺序不变', all.map(v => v.group.id), [1, 2])
ok('group 是原始对象引用', all[0].group === g1)
ok('items 保持原数组引用', all[0].items === g1.items)

const disabled = buildItemGroupViews(groups, 'github', false)
eq('开关关闭时不过滤', disabled.length, 2)
ok('开关关闭时 items 仍是原引用', disabled[1].items === g2.items)

console.log('== buildItemGroupViews: 过滤 ==')
const onlyGithub = buildItemGroupViews(groups, 'github', true)
eq('只保留命中分组', onlyGithub.length, 1)
eq('命中的是第 1 组', onlyGithub[0].group.id, 1)
ok('过滤后 group 仍是原始对象引用 (旧实现是浅拷贝)', onlyGithub[0].group === g1)
eq('items 是命中子集', onlyGithub[0].items?.map(i => i.title), ['GitHub'])
ok('子集是新数组, 原数组未被改动', g1.items?.length === 2)

eq('大小写不敏感', buildItemGroupViews(groups, 'GITHUB', true).length, 1)
eq('描述命中同样生效', buildItemGroupViews([group(3, 'X', [item('A', 'https://a', '相册')])], '相册', true).length, 1)
eq('一个都没命中 -> 空列表', buildItemGroupViews(groups, 'zzz', true).length, 0)

console.log('== buildItemGroupViews: 边界 ==')
const pending = buildItemGroupViews([group(1, 'APP'), group(2, 'NAS', [item('群晖')])], '群晖', true)
eq('items 未加载的分组被丢弃', pending.length, 1)
eq('保留的是已加载且命中的分组', pending[0].group.id, 2)
eq('空分组列表', buildItemGroupViews([], 'x', true).length, 0)
eq('关键词为空但 enabled=true -> 全量', buildItemGroupViews(groups, '  ', true).length, 2)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
