import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSearchUrl,
  deduceTemplateFromTestUrl,
  hasPlaceholder,
  hasStoredSearchEngineConfig,
  normalizeSearchEngineConfig,
  validateSearchEngine,
  isDuplicateEngine,
} from '../frontend/src/utils/searchBox/index'

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

console.log('== buildSearchUrl ==')
eq('%s 模板', buildSearchUrl('https://www.bing.com/search?q=%s', '你好 世界'), 'https://www.bing.com/search?q=%E4%BD%A0%E5%A5%BD%20%E4%B8%96%E7%95%8C')
eq('{keyword} 模板', buildSearchUrl('https://example.com/s?q={keyword}', 'a b'), 'https://example.com/s?q=a%20b')
eq('{q} 模板', buildSearchUrl('https://example.com/s?q={q}&x=1', 'a&b'), 'https://example.com/s?q=a%26b&x=1')
eq('多个占位符全部替换', buildSearchUrl('https://e.com/?a=%s&b=%s', 'x'), 'https://e.com/?a=x&b=x')
eq('无占位符时追加到末尾', buildSearchUrl('https://example.com/search?q=', 'hello'), 'https://example.com/search?q=hello')
eq('无占位符且关键词为空', buildSearchUrl('https://example.com/', ''), 'https://example.com/')
eq('空模板', buildSearchUrl('', 'x'), '')
eq('hasPlaceholder %s', hasPlaceholder('https://a/?q=%s'), true)
eq('hasPlaceholder 无', hasPlaceholder('https://a/?q='), false)

console.log('== deduceTemplateFromTestUrl ==')
eq(
  'bing 真实地址',
  deduceTemplateFromTestUrl('https://www.bing.com/search?q=test&form=QBLH', 'sun panel')?.template,
  'https://www.bing.com/search?q=%s&form=QBLH',
)
eq(
  'google 真实地址',
  deduceTemplateFromTestUrl('https://www.google.com/search?q=sun+panel&oq=sun', 'sun panel')?.param,
  'q',
)
eq(
  '中文关键词被编码后仍能识别',
  deduceTemplateFromTestUrl('https://www.baidu.com/s?wd=%E4%BD%A0%E5%A5%BD&rsv=1', '你好')?.template,
  'https://www.baidu.com/s?wd=%s&rsv=1',
)
eq(
  '非通用参数按值匹配',
  deduceTemplateFromTestUrl('https://search.example.com/find?term=hello&lang=zh', 'hello')?.template,
  'https://search.example.com/find?term=%s&lang=zh',
)
eq(
  '无 query 时只能追加',
  deduceTemplateFromTestUrl('https://example.com/search/', 'x')?.matched,
  false,
)
eq('带 # 的地址保留 hash', deduceTemplateFromTestUrl('https://e.com/s?q=abc#top', 'abc')?.template, 'https://e.com/s?q=%s#top')
eq('非法地址返回 null', deduceTemplateFromTestUrl('not-a-url', 'x'), null)
eq('已含占位符保持原样', deduceTemplateFromTestUrl('https://e.com/s?q=%s', 'x')?.template, 'https://e.com/s?q=%s')

function SAMPLE() {
  return '你好 世界'
}
eq(
  '占位符写回为 %s 而不是 %25s',
  deduceTemplateFromTestUrl('https://e.com/s?q=abc', 'abc')?.template.includes('%25s'),
  false,
)

console.log('== validateSearchEngine ==')
// 校验返回的 i18n key 必须与 locales 里的命名空间一致 (deskModule.searchEngine.*),
// 否则表单会把原始 key 直接显示给用户
eq('缺名称', validateSearchEngine({ id: '1', title: '', url: 'https://a.com?q=%s' }).titleError, 'deskModule.searchEngine.engineNameRequired')
eq('名称超长', validateSearchEngine({ id: '1', title: 'x'.repeat(21), url: 'https://a.com?q=%s' }).titleError, 'deskModule.searchEngine.engineNameTooLong')
eq('缺地址', validateSearchEngine({ id: '1', title: 'a', url: '' }).urlError, 'deskModule.searchEngine.engineUrlRequired')
eq('地址非法', validateSearchEngine({ id: '1', title: 'a', url: 'a.com?q=%s' }).urlError, 'deskModule.searchEngine.engineUrlInvalid')
eq('图标非法', validateSearchEngine({ id: '1', title: 'a', url: 'https://a.com', iconSrc: 'javascript:alert(1)' }).iconError, 'deskModule.searchEngine.engineIconUrlInvalid')
eq('站内相对路径图标合法', validateSearchEngine({ id: '1', title: 'a', url: 'https://a.com', iconSrc: '/uploads/x.png' }).valid, true)
eq('全通过', validateSearchEngine({ id: '1', title: 'a', url: 'https://a.com', iconSrc: 'https://a.com/f.ico' }).valid, true)

// 所有校验错误文案都必须存在于 zh-CN / en-US 的 deskModule.searchEngine 命名空间下
console.log('== 校验文案 key 与 locales 对齐 ==')
{
  const zhLocale = JSON.parse(readFileSync(join(process.cwd(), 'frontend/src/locales/zh-CN.json'), 'utf8'))
  const enLocale = JSON.parse(readFileSync(join(process.cwd(), 'frontend/src/locales/en-US.json'), 'utf8'))
  const samples: DeskModule.SearchBox.SearchEngine[] = [
    { id: '1', title: '', url: '' },
    { id: '1', title: 'x'.repeat(21), url: '' },
    { id: '1', title: 'a', url: 'bad-url' },
    { id: '1', title: 'a', url: 'https://a.com', iconSrc: 'javascript:1' },
  ]
  const keys = new Set<string>()
  for (const sample of samples) {
    const r = validateSearchEngine(sample)
    for (const k of [r.titleError, r.urlError, r.iconError]) {
      if (k)
        keys.add(k)
    }
  }
  eq('覆盖到全部 5 个校验文案', keys.size, 5)
  for (const key of keys) {
    const path = key.split('.')
    const pick = (obj: Record<string, unknown>) => path.reduce<unknown>((acc, p) => (acc as Record<string, unknown>)?.[p], obj)
    eq(`zh-CN 存在 ${key}`, typeof pick(zhLocale), 'string')
    eq(`en-US 存在 ${key}`, typeof pick(enLocale), 'string')
  }
}

console.log('== isDuplicateEngine ==')
const list = [
  { id: 'a', title: 'Google', url: 'https://g.com?q=%s' },
  { id: 'b', title: 'Bing', url: 'https://b.com?q=%s' },
]
eq('同名', isDuplicateEngine(list, { id: 'c', title: 'google', url: 'https://x.com' }), 'title')
eq('同地址', isDuplicateEngine(list, { id: 'c', title: 'X', url: 'https://B.COM?q=%s' }), 'url')
eq('编辑自身不算重复', isDuplicateEngine(list, { id: 'a', title: 'Google', url: 'https://g.com?q=%s' }), '')
eq('全新', isDuplicateEngine(list, { id: 'c', title: 'X', url: 'https://x.com' }), '')

console.log('== hasStoredSearchEngineConfig ==')
eq('未配置', hasStoredSearchEngineConfig(undefined), false)
eq('老 module_config 数据', hasStoredSearchEngineConfig({ currentSearchEngine: {}, searchEngineList: [], newWindowOpen: false }), false)
eq('新结构', hasStoredSearchEngineConfig({ currentEngineId: 'a', engineList: [] }), true)

console.log('== normalizeSearchEngineConfig ==')
const legacy = normalizeSearchEngineConfig({
  currentSearchEngine: { iconSrc: 'x.svg', title: 'Baidu', url: 'https://www.baidu.com/s?wd=%s' },
  searchEngineList: [
    { iconSrc: 'g.svg', title: 'Google', url: 'https://www.google.com/search?q=%s' },
    { iconSrc: 'b.svg', title: 'Baidu', url: 'https://www.baidu.com/s?wd=%s' },
  ],
  newWindowOpen: true,
})
eq('旧结构: 列表长度', legacy.engineList.length, 2)
eq('旧结构: newWindowOpen 迁移为 openMethod', legacy.openMethod, 1)
eq('旧结构: 补上 id', legacy.engineList.every(e => !!e.id), true)
eq('旧结构: 当前项按地址匹配', legacy.engineList.find(e => e.id === legacy.currentEngineId)?.title, 'Baidu')

const cleared = normalizeSearchEngineConfig({ currentEngineId: '', engineList: [], openMethod: 0 })
eq('主动清空保留空列表', cleared.engineList.length, 0)

const dirty = normalizeSearchEngineConfig({ currentEngineId: 'nope', engineList: [{ id: 'x', title: 'A', url: 'https://a' }, { id: 'x', title: 'B', url: 'https://b' }, null, { title: '', url: '' }] })
eq('脏数据: 过滤空项', dirty.engineList.length, 2)
eq('脏数据: id 去重', dirty.engineList[0].id !== dirty.engineList[1].id, true)
eq('脏数据: currentEngineId 失效时回退首项', dirty.currentEngineId, dirty.engineList[0].id)

eq('完全无数据 -> 内置默认', normalizeSearchEngineConfig(null).engineList.length, 3)
eq('默认当前项是 Google', normalizeSearchEngineConfig(null).engineList[0].title, 'Google')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
