import { extractIconCandidates, getSiteFaviconCandidates, getSiteFaviconUrl, MAX_ICON_CANDIDATES } from '../src/utils/favicon'
import { clearAuthEpochCache } from '../src/utils/authEpoch'
import { signToken } from '../src/utils/jwt'
import itemIconApp from '../src/api/panel/itemIcon'

/**
 * 站点图标候选解析自检 (§9.2)
 *
 * 回归的风险: 页面里有多个 <link rel*="icon"> 时, 旧实现只取「文档里第一个」,
 * 用户没有选择权; 新实现要把候选全部收齐, 且不能被属性顺序 / 大小写 / 相对路径 /
 * data: 内联图 / 重复声明 / 畸形写法带偏。兜底链 (favicon.ico → icon.horse) 用
 * mock fetch 验证「只在页面没有候选时才走」。
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

const BASE = 'https://example.com/page/index.html'

// ===================== 1) 基础: rel/href 顺序 + sizes/type =====================

console.log('== 基础解析 ==')

eq(
  'rel 在前 + sizes/type 提取',
  extractIconCandidates('<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">', BASE),
  [{ url: 'https://example.com/favicon-32.png', source: 'link', sizes: '32x32', type: 'image/png' }],
)

eq(
  'href 在前 rel 在后',
  extractIconCandidates('<link href="/a.png" rel="icon">', BASE),
  [{ url: 'https://example.com/a.png', source: 'link' }],
)

eq(
  '单引号 + 自闭合 + 多行属性',
  extractIconCandidates('<link\n  href=\'/b.png\'\n  rel=\'icon\'\n/>', BASE),
  [{ url: 'https://example.com/b.png', source: 'link' }],
)

eq(
  'rel 不含 icon 的 link 忽略',
  extractIconCandidates('<link rel="stylesheet" href="/s.css"><link rel="preconnect" href="https://cdn.test"><link rel="icon" href="/i.png">', BASE),
  [{ url: 'https://example.com/i.png', source: 'link' }],
)

// ===================== 2) rel 变体 (apple-touch-icon 等) =====================

console.log('== rel 变体 ==')

eq(
  'shortcut icon / apple-touch-icon / mask-icon / 大写 ICON 全收',
  extractIconCandidates(
    '<link rel="shortcut icon" href="/f.ico">'
    + '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'
    + '<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5">'
    + '<link rel="ICON" href="/upper.ico">',
    BASE,
  ),
  [
    { url: 'https://example.com/f.ico', source: 'link' },
    { url: 'https://example.com/apple-touch-icon.png', source: 'link', sizes: '180x180' },
    { url: 'https://example.com/safari-pinned-tab.svg', source: 'link' },
    { url: 'https://example.com/upper.ico', source: 'link' },
  ],
)

// ===================== 3) 跳过 data: 与非 http(s) =====================

console.log('== 协议过滤 ==')

eq(
  'data: / javascript: / ftp: 跳过, 其后正常的仍收集',
  extractIconCandidates(
    '<link rel="icon" href="data:image/png;base64,AAAA">'
    + '<link rel="icon" href="javascript:alert(1)">'
    + '<link rel="icon" href="ftp://example.com/i.png">'
    + '<link rel="icon" href="/ok.png">',
    BASE,
  ),
  [{ url: 'https://example.com/ok.png', source: 'link' }],
)

// ===================== 4) 相对路径解析 =====================

console.log('== 相对路径 ==')

eq(
  '相对当前页 / 根路径 / 协议相对 / 父目录',
  extractIconCandidates(
    '<link rel="icon" href="favicon.png">'
    + '<link rel="icon" href="/root.png">'
    + '<link rel="icon" href="//cdn.example.net/cdn.png">'
    + '<link rel="icon" href="../up.png">',
    BASE,
  ),
  [
    { url: 'https://example.com/page/favicon.png', source: 'link' },
    { url: 'https://example.com/root.png', source: 'link' },
    { url: 'https://cdn.example.net/cdn.png', source: 'link' },
    { url: 'https://example.com/up.png', source: 'link' },
  ],
)

// ===================== 5) 去重与文档顺序 =====================

console.log('== 去重 ==')

eq(
  '同一 URL 重复只留一条, 不同 ?v= 去参后合并',
  extractIconCandidates(
    '<link rel="icon" href="/i.png">'
    + '<link rel="icon" href="/i.png">'
    + '<link rel="icon" href="/i.png?v=2">',
    BASE,
  ),
  [{ url: 'https://example.com/i.png', source: 'link' }],
)

eq(
  '不同 URL 各自保留 (文档顺序)',
  extractIconCandidates('<link rel="icon" href="/b.png"><link rel="icon" href="/a.png">', BASE),
  [
    { url: 'https://example.com/b.png', source: 'link' },
    { url: 'https://example.com/a.png', source: 'link' },
  ],
)

// ===================== 6) 上限截断 =====================

console.log('== 上限截断 ==')

{
  const html = Array.from({ length: MAX_ICON_CANDIDATES + 3 }, (_, i) => `<link rel="icon" href="/i${i}.png">`).join('')
  const list = extractIconCandidates(html, BASE)
  eq('超过 12 条截断', list.length, MAX_ICON_CANDIDATES)
  eq('截断保留前 12 条 (顺序)', [list[0].url, list[list.length - 1].url], [
    'https://example.com/i0.png',
    'https://example.com/i11.png',
  ])
}

// ===================== 7) 边界 =====================

console.log('== 边界 ==')

eq('没有 link 时返回空数组', extractIconCandidates('<html><head><title>t</title></head></html>', BASE), [])
eq('空 HTML', extractIconCandidates('', BASE), [])
eq('非法 baseUrl 返回空数组', extractIconCandidates('<link rel="icon" href="/a.png">', 'not a url'), [])

// ===================== 8) 兜底链 (mock fetch) =====================

console.log('== 兜底链 (mock fetch) ==')

const routes = new Map<string, { status: number, body?: string, contentType?: string }>()
const calls: Array<{ url: string, method: string }> = []

globalThis.fetch = (async (input: string | URL, init?: { method?: string }) => {
  const url = typeof input === 'string' ? input : input.toString()
  calls.push({ url, method: (init?.method ?? 'GET').toUpperCase() })
  const route = routes.get(url)
  const headers: Record<string, string> = {}
  if (route?.contentType)
    headers['content-type'] = route.contentType
  return new Response(route?.body ?? '', { status: route?.status ?? 404, headers })
}) as unknown as typeof fetch

function resetMock(rules: Array<[string, number, string?, string?]>) {
  calls.length = 0
  routes.clear()
  for (const [url, status, body, contentType] of rules)
    routes.set(url, { status, body, contentType })
}

// 8.1 页面有 link 候选: 不走兜底, 只请求页面一次
resetMock([
  ['https://site-a.test/', 200, '<link rel="icon" href="/a.png">'],
])
eq('页面有候选时结果来自页面', await getSiteFaviconCandidates('https://site-a.test/'), [
  { url: 'https://site-a.test/a.png', source: 'link' },
])
eq('页面有候选时不请求 favicon.ico', calls.map(c => c.url), ['https://site-a.test/'])

// 8.2 页面无 link: 回退 favicon.ico (HEAD 200)
resetMock([
  ['https://site-b.test/', 200, '<html><head><title>no icon</title></head></html>'],
  ['https://site-b.test/favicon.ico', 200],
])
eq('无 link 时回退 favicon.ico', await getSiteFaviconCandidates('https://site-b.test/'), [
  { url: 'https://site-b.test/favicon.ico', source: 'favicon.ico' },
])
eq('请求顺序 = 页面 + favicon.ico', calls.map(c => c.url), [
  'https://site-b.test/',
  'https://site-b.test/favicon.ico',
])

// 8.3 页面抓取失败 + favicon.ico 404: 落到 icon.horse
resetMock([
  ['https://site-c.test/favicon.ico', 404],
  ['https://icon.horse/icon/site-c.test', 200],
])
eq('favicon.ico 不存在时落到 icon.horse', await getSiteFaviconCandidates('https://site-c.test/'), [
  { url: 'https://icon.horse/icon/site-c.test', source: 'icon-horse' },
])

// 8.4 全都没有: 空数组
resetMock([
  ['https://site-d.test/favicon.ico', 404],
  ['https://icon.horse/icon/site-d.test', 404],
])
eq('全都没有时返回空数组', await getSiteFaviconCandidates('https://site-d.test/'), [])

// 8.5 非法 url: 不发请求
resetMock([])
eq('非法 url 返回空数组', await getSiteFaviconCandidates('not a url'), [])
eq('非法 url 不发请求', calls.length, 0)

// 8.6 旧函数兼容: getSiteFaviconUrl = 候选第一条
resetMock([
  ['https://site-e.test/', 200, '<link rel="icon" href="/1.png"><link rel="icon" href="/2.png">'],
])
eq('getSiteFaviconUrl 取候选第一条', await getSiteFaviconUrl('https://site-e.test/'), 'https://site-e.test/1.png')

// ===================== 9) 路由级: 两个新接口 + 旧接口兼容 =====================

console.log('== 路由级: 候选 / 保存接口 ==')

const SECRET = 'favicon-candidates-test'
const token = await signToken(SECRET, { id: 1, username: 'admin', name: 'admin', headImage: '', role: 1 }, 1)

interface FileState {
  rows: Array<{ src: string }>
  inserted?: { src: string, fileName: string, ext: string }
  updatedSame?: { src: string, fileName: string, ext: string }
}

const fileState: FileState = { rows: [] }

// 内存版 D1: 只实现这两个接口用到的 SQL 分支
function makeDb() {
  return {
    prepare(sql: string) {
      const make = (args: unknown[] = []) => ({
        // auth_epoch / storage_auto_clean_unused / 引用检查都按「无」处理
        first: async () => null,
        all: async () => {
          if (sql.includes('SELECT src FROM file'))
            return { results: fileState.rows }
          return { results: [] }
        },
        run: async () => {
          if (sql.startsWith('INSERT INTO file')) {
            fileState.inserted = { src: String(args[0]), fileName: String(args[1]), ext: String(args[2]) }
          }
          else if (sql.startsWith('UPDATE file SET file_name')) {
            fileState.updatedSame = { fileName: String(args[0]), ext: String(args[1]), src: String(args[2]) }
          }
          return { success: true }
        },
        bind: (...more: unknown[]) => make(more),
      })
      return make()
    },
  } as never
}

const puts: Array<{ key: string, contentType?: string }> = []
const deletedKeys: string[] = []
const r2 = {
  async put(key: string, _data: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
    puts.push({ key, contentType: opts?.httpMetadata?.contentType })
  },
  async delete(key: string) {
    deletedKeys.push(key)
  },
} as never

function req(path: string, body: unknown, withToken = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (withToken)
    headers.token = token
  return itemIconApp.fetch(
    new Request(`http://test${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    { DB: makeDb(), FILES: r2, JWT_SECRET: SECRET } as never,
  )
}

function resetFile() {
  fileState.rows = []
  fileState.inserted = undefined
  fileState.updatedSame = undefined
  puts.length = 0
  deletedKeys.length = 0
}

// 9.1 鉴权与参数
clearAuthEpochCache()
resetMock([['https://site-x.test/', 200, '<link rel="icon" href="/i.png">']])
let r = await (await req('/itemIcon/getSiteFaviconCandidates', { url: 'https://site-x.test/' }, false)).json() as { code: number }
eq('候选接口: 无 token 被拦截', r.code, 1000)

r = await (await req('/itemIcon/getSiteFaviconCandidates', {})).json() as { code: number }
eq('候选接口: 空 url -> 1400', r.code, 1400)

// 9.2 候选正常返回
resetMock([['https://site-x.test/', 200, '<link rel="icon" href="/1.png"><link rel="icon" href="/2.png" sizes="32x32"><link rel="icon" href="/3.png">']])
r = await (await req('/itemIcon/getSiteFaviconCandidates', { url: 'https://site-x.test/' })).json() as { code: number, data: { candidates: Array<{ url: string }> } }
eq('候选接口: code 0', r.code, 0)
eq('候选接口: 返回 3 条', r.data.candidates.length, 3)
eq('候选接口: 顺序与内容', r.data.candidates.map(c => c.url), [
  'https://site-x.test/1.png',
  'https://site-x.test/2.png',
  'https://site-x.test/3.png',
])

// 9.3 无候选 -> 空数组而不是报错
resetMock([
  ['https://site-y.test/', 404],
  ['https://site-y.test/favicon.ico', 404],
  ['https://icon.horse/icon/site-y.test', 404],
])
r = await (await req('/itemIcon/getSiteFaviconCandidates', { url: 'https://site-y.test/' })).json() as { code: number, data: { candidates: unknown[] } }
eq('候选接口: 无候选 code 0 + 空数组', [r.code, r.data.candidates.length], [0, 0])

// 9.4 保存: 首次写入 (INSERT file 行 + R2 put)
clearAuthEpochCache()
resetMock([['https://site-x.test/2.png', 200, 'PNGDATA', 'image/png']])
resetFile()
r = await (await req('/itemIcon/saveSiteFavicon', { url: 'https://site-x.test/2.png', pageUrl: 'https://site-x.test/' })).json() as { code: number, data: { iconUrl: string } }
eq('保存接口: code 0', r.code, 0)
eq('保存接口: iconUrl 形态', /^uploads\/icons\/[0-9a-f]{32}\.png$/.test(r.data.iconUrl), true)
eq('保存接口: R2 写入 1 次', puts.length, 1)
eq('保存接口: R2 key 与 iconUrl 对应', `uploads/${puts[0].key}`, r.data.iconUrl)
eq('保存接口: R2 content-type', puts[0].contentType, 'image/png')
eq('保存接口: file 行 INSERT', fileState.inserted, {
  src: `./${r.data.iconUrl}`,
  fileName: 'site-x.test',
  ext: '.png',
})

// 9.5 保存: 同一站点再次获取 -> 复用同一 key (UPDATE 而不是 INSERT)
const firstIconUrl = r.data.iconUrl
clearAuthEpochCache()
resetMock([['https://site-x.test/4.png', 200, 'PNGDATA', 'image/png']])
resetFile()
fileState.rows = [{ src: `./${firstIconUrl}` }]
r = await (await req('/itemIcon/saveSiteFavicon', { url: 'https://site-x.test/4.png', pageUrl: 'https://site-x.test/' })).json() as { code: number, data: { iconUrl: string } }
eq('保存接口: 覆盖写复用同一 key', r.data.iconUrl, firstIconUrl)
eq('保存接口: 同 src 走 UPDATE', fileState.updatedSame?.src, `./${firstIconUrl}`)
eq('保存接口: 不重复 INSERT', fileState.inserted, undefined)
eq('保存接口: 无旧对象可删', deletedKeys.length, 0)

// 9.6 保存: 非图片被拒 (与上传/抓取同一个信任模型)
resetMock([['https://site-x.test/evil', 200, '<html>', 'text/html']])
resetFile()
r = await (await req('/itemIcon/saveSiteFavicon', { url: 'https://site-x.test/evil', pageUrl: 'https://site-x.test/' })).json() as { code: number, msg: string }
eq('保存接口: 非图片 -> 失败', r.code, -1)
eq('保存接口: 提示 download favicon error', r.msg.includes('download favicon error'), true)
eq('保存接口: 不写 R2 / 不写 file 表', [puts.length, fileState.inserted], [0, undefined])

// 9.7 保存: 参数校验
r = await (await req('/itemIcon/saveSiteFavicon', { url: 'https://a.test/i.png' })).json() as { code: number }
eq('保存接口: 缺 pageUrl -> 1400', r.code, 1400)
r = await (await req('/itemIcon/saveSiteFavicon', { url: 'https://a.test/i.png', pageUrl: 'not a url' })).json() as { code: number, msg: string }
eq('保存接口: 非法 pageUrl -> 报错', [r.code, r.msg.includes('invalid url')], [-1, true])

// 9.8 旧接口兼容: 内部 = 候选第一条 + 保存
clearAuthEpochCache()
resetMock([
  ['https://site-z.test/', 200, '<link rel="icon" href="/old-1.png"><link rel="icon" href="/old-2.png">'],
  ['https://site-z.test/old-1.png', 200, 'PNGDATA', 'image/png'],
])
resetFile()
r = await (await req('/itemIcon/getSiteFavicon', { url: 'https://site-z.test/' })).json() as { code: number, data: { iconUrl: string } }
eq('旧接口: code 0', r.code, 0)
eq('旧接口: 下载的是第一条候选', calls.some(c => c.url === 'https://site-z.test/old-1.png'), true)
eq('旧接口: 不下载第二条', calls.some(c => c.url === 'https://site-z.test/old-2.png'), false)
eq('旧接口: file 行写入', fileState.inserted?.fileName, 'site-z.test')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
