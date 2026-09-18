import { buildIconKey, buildIconKeyPrefix, isAllowedExt, isImageExt, isValidUploadKey, normalizeIconContentType } from '../src/utils/file'

/**
 * 上传 / 抓取校验自检 (§3.1)
 *
 * 回归的风险: uploadFiles 原本对扩展名不设限, favicon 抓取也不校验 Content-Type ——
 * 第三方页面可以把 HTML/脚本存进 R2, 再由 /uploads/* 同源返回 (存储型 XSS 跳板)。
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

console.log('== isImageExt ==')
eq('.png', isImageExt('.png'), true)
eq('.ico', isImageExt('.ico'), true)
eq('大写也能识别', isImageExt('.PNG'), true)
eq('.html 不是图片', isImageExt('.html'), false)
eq('空字符串', isImageExt(''), false)

console.log('== isAllowedExt ==')
for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.txt', '.pdf', '.zip', '.json'])
  eq(`允许 ${ext}`, isAllowedExt(ext), true)
for (const ext of ['.html', '.htm', '.js', '.mjs', '.exe', '.php', '.sh', ''])
  eq(`拒绝 ${ext || '(空)'}`, isAllowedExt(ext), false)
eq('大写扩展名也放行 (调用方会先 toLowerCase)', isAllowedExt('.PNG'), true)

console.log('== normalizeIconContentType ==')
eq('image/png 通过', normalizeIconContentType('image/png', 'https://a.com/favicon.png'), 'image/png')
eq('带参数时截断', normalizeIconContentType('image/png; charset=binary', 'https://a.com/x'), 'image/png')
eq('大小写归一', normalizeIconContentType('IMAGE/PNG', 'https://a.com/x'), 'image/png')
eq('svg 通过 (本体在 /uploads 侧再限制)', normalizeIconContentType('image/svg+xml', 'https://a.com/x.svg'), 'image/svg+xml')
eq('icon 类型通过', normalizeIconContentType('image/vnd.microsoft.icon', 'https://a.com/favicon.ico'), 'image/vnd.microsoft.icon')
eq('text/html 拒绝', normalizeIconContentType('text/html', 'https://evil.com/favicon.png'), '')
eq('javascript 拒绝', normalizeIconContentType('application/javascript', 'https://evil.com/x.js'), '')
eq('octet-stream + 图片 URL 兜底', normalizeIconContentType('application/octet-stream', 'https://a.com/favicon.ico'), 'image/x-icon')
eq('octet-stream + 无扩展名 URL 拒绝', normalizeIconContentType('application/octet-stream', 'https://icon.horse/icon/example.com'), '')
eq('空 Content-Type + 图片 URL 兜底', normalizeIconContentType('', 'https://a.com/logo.webp'), 'image/webp')
eq('空 Content-Type + 非图片 URL 拒绝', normalizeIconContentType('', 'https://a.com/page'), '')
eq('html 即使 URL 以 .png 结尾也拒绝', normalizeIconContentType('text/html', 'https://evil.com/x.png'), '')

console.log('== isValidUploadKey ==')
const hex = 'a'.repeat(32)
eq('标准 key', isValidUploadKey(`2026/9/10/${hex}.png`), true)
eq('无扩展名的老对象仍然可达', isValidUploadKey(`2026/9/10/${hex}`), true)
eq('jpeg 扩展名', isValidUploadKey(`2026/12/31/${hex}.jpeg`), true)
eq('站点图标 key', isValidUploadKey(`icons/${hex}.png`), true)
eq('站点图标 key (ico)', isValidUploadKey(`icons/${hex}.ico`), true)
eq('站点图标缺扩展名 -> 非法', isValidUploadKey(`icons/${hex}`), false)
eq('拒绝路径穿越', isValidUploadKey('../secret.txt'), false)
eq('拒绝编码斜杠', isValidUploadKey(`2026/9/10/${hex}%2f..%2fsecret`), false)
eq('拒绝非 32 位 hash', isValidUploadKey('2026/9/10/abc.png'), false)
eq('拒绝空 key', isValidUploadKey(''), false)
eq('拒绝深层路径', isValidUploadKey(`a/b/c/d/e/${hex}.png`), false)

console.log('== 站点图标 key (按站点稳定) ==')
const iconKey1 = buildIconKey('nas.example.com', '.png')
eq('key 形态', iconKey1, `${buildIconKeyPrefix('nas.example.com')}png`)
eq('同一站点同一扩展名 -> 同一个 key (重复获取是覆盖而不是新增)', buildIconKey('nas.example.com', '.png'), iconKey1)
eq('同一站点不同扩展名 -> 同前缀不同 key', buildIconKey('nas.example.com', '.ico').startsWith(buildIconKeyPrefix('nas.example.com')), true)
eq('不同站点 -> 不同 key', buildIconKey('other.example.com', '.png') === iconKey1, false)
eq('生成的 key 能通过 /uploads 校验', isValidUploadKey(iconKey1), true)
eq('前缀以 . 结尾 (便于 LIKE 查询)', buildIconKeyPrefix('nas.example.com').endsWith('.'), true)
eq('uploads 路径形态', `./uploads/${iconKey1}`.startsWith('./uploads/icons/'), true)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0)
  process.exit(1)
