import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import enUS from '../frontend/src/locales/en-US.json'
import zhCN from '../frontend/src/locales/zh-CN.json'

/**
 * i18n key 使用审计
 *
 * 1. 收集源码里所有 t(...) / $t(...) 的字面量 key
 * 2. 与 zh-CN.json / en-US.json 对比, 找出
 *    - 缺失 key（会直接把原始 key 显示给用户）
 *    - 两侧不齐的 key
 *    - 已经没有任何代码引用的死文案
 */

const SRC_DIR = join(process.cwd(), 'frontend', 'src')

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory())
      walk(full, files)
    else if (/\.(ts|vue|tsx|js)$/.test(entry) && !/\.d\.ts$/.test(entry))
      files.push(full)
  }
  return files
}

function flatten(obj: Record<string, unknown>, prefix = '', out = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value))
      flatten(value as Record<string, unknown>, path, out)
    else
      out.add(path)
  }
  return out
}

// 源码里出现的 key（含 t('x') / $t('x') / t(`x`) 与 apiErrorCode 这种动态拼接的部分单独处理）
const KEY_CALL = /(?<![\w.])\$?t\(\s*['"`]([^'"`$]+)['"`]/g
const used = new Map<string, string[]>()
let dynamicCallCount = 0

for (const file of walk(SRC_DIR)) {
  const code = readFileSync(file, 'utf8')
  const rel = relative(process.cwd(), file).replace(/\\/g, '/')
  for (const match of code.matchAll(KEY_CALL)) {
    const key = match[1]
    if (!key.includes('.'))
      continue
    const list = used.get(key) ?? []
    if (!list.includes(rel))
      list.push(rel)
    used.set(key, list)
  }
  // 记录模板字符串拼接的调用, 这类 key 无法静态解析
  dynamicCallCount += (code.match(/\$?t\(\s*`[^`]*\$\{/g) ?? []).length
}

const zh = flatten(zhCN as Record<string, unknown>)
const en = flatten(enUS as Record<string, unknown>)

const missingInZh = [...used.keys()].filter(k => !zh.has(k)).sort()
const missingInEn = [...used.keys()].filter(k => !en.has(k)).sort()
const onlyZh = [...zh].filter(k => !en.has(k)).sort()
const onlyEn = [...en].filter(k => !zh.has(k)).sort()

// 死文案: 两侧都有, 但代码里没有任何引用
const unused = [...zh].filter(k => !used.has(k)).sort()

// searchBox / searchEngine 两个命名空间的明细
function ns(prefix: string) {
  const all = [...zh].filter(k => k.startsWith(prefix))
  const dead = all.filter(k => !used.has(k))
  return { all: all.length, dead }
}
const boxNs = ns('deskModule.searchBox.')
const engineNs = ns('deskModule.searchEngine.')

console.log(`源码中静态可解析的 key: ${used.size} 个（另有 ${dynamicCallCount} 处动态拼接调用未纳入统计）`)
console.log(`zh-CN 文案: ${zh.size} 条 / en-US 文案: ${en.size} 条`)

console.log(`\n== 使用了但 zh-CN 缺失（会直接显示原始 key）: ${missingInZh.length} ==`)
for (const k of missingInZh)
  console.log(`  ${k}\n      <- ${used.get(k)!.join(', ')}`)

console.log(`\n== 使用了但 en-US 缺失: ${missingInEn.length} ==`)
for (const k of missingInEn)
  console.log(`  ${k}\n      <- ${used.get(k)!.join(', ')}`)

console.log(`\n== 只有 zh-CN 有 / 只有 en-US 有: ${onlyZh.length} / ${onlyEn.length} ==`)
for (const k of onlyZh)
  console.log(`  zh only: ${k}`)
for (const k of onlyEn)
  console.log(`  en only: ${k}`)

console.log(`\n== 死文案（两侧都有但代码未引用）: ${unused.length} ==`)
for (const k of unused)
  console.log(`  ${k}`)

console.log(`\n== 命名空间明细 ==`)
console.log(`  deskModule.searchBox.*    : 共 ${boxNs.all} 条, 死文案 ${boxNs.dead.length} 条`)
for (const k of boxNs.dead)
  console.log(`      dead: ${k}`)
console.log(`  deskModule.searchEngine.* : 共 ${engineNs.all} 条, 死文案 ${engineNs.dead.length} 条`)
for (const k of engineNs.dead)
  console.log(`      dead: ${k}`)
