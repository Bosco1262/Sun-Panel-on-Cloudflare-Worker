import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'
import { SearchEngineOpenMethodEnum } from '@/enums/panel'

/**
 * Shared helpers for the search box's "search engine settings"
 *
 * Design points:
 * 1. The keyword placeholder is no longer required to be %s: {keyword} / {q} work too, and when the template has
 *    no placeholder at all the keyword is appended to the end of the URL, so "paste a working search URL" is enough.
 * 2. List entries carry a stable id and the current selection is stored by id, so object-reference comparison is gone.
 * 3. Normalisation is compatible with historical shapes: the old built-in engines (no id) and the old field names
 *    (newWindowOpen + iconSrc), so leftover data in the local cache survives the upgrade.
 *
 *
 * 搜索框「搜索引擎设置」的共享工具
 *
 * 设计要点:
 * 1. 关键词占位符不再强制要求 %s, 同时兼容 {keyword} / {q}; 模板中没有任何占位符时
 *    自动把关键词追加到地址末尾, 保证「填一个能打开的搜索地址」即可用。
 * 2. 列表项带稳定 id, 当前选中项按 id 记录, 不再依赖对象引用比较。
 * 3. normalize 兼容历史结构: 旧内置引擎 (无 id) 与旧字段名 (newWindowOpen + iconSrc),
 *    保证本地缓存里残留的老数据升级后不丢。
 */

/**
 * Built-in search-engine ids used for new users / resetting
 *
 * 新用户 / 重置时使用的内置搜索引擎 id
 */
const BUILTIN_ENGINE_IDS = ['google', 'baidu', 'bing']

/**
 * Parameter names matched first when detecting the keyword parameter (the conventions of the usual search engines)
 *
 * 识别关键词参数时优先匹配的参数名 (各家搜索引擎的常规写法)
 */
const KEYWORD_PARAM_NAMES = [
  'q',
  'wd',
  'word',
  'query',
  'keyword',
  'keywords',
  'kw',
  'search_query',
  'text',
  'p',
  's',
  'k',
]

/**
 * Supported placeholder forms (in priority order)
 *
 * 支持的占位符写法 (按优先级)
 */
const PLACEHOLDER_TOKENS = ['%s', '{keyword}', '{q}']

export function generateEngineId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function')
    return cryptoObj.randomUUID()
  return `engine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * The three built-in search engines (a fresh object every call, so callers cannot corrupt the originals)
 *
 * 三个内置搜索引擎 (每次返回全新对象, 避免被调用方改坏)
 */
export function createDefaultEngines(): DeskModule.SearchBox.SearchEngine[] {
  const engines: DeskModule.SearchBox.SearchEngine[] = [
    { id: BUILTIN_ENGINE_IDS[0], title: 'Google', url: 'https://www.google.com/search?q=%s', iconSrc: SvgSrcGoogle },
    { id: BUILTIN_ENGINE_IDS[1], title: '百度', url: 'https://www.baidu.com/s?wd=%s', iconSrc: SvgSrcBaidu },
    { id: BUILTIN_ENGINE_IDS[2], title: 'Bing', url: 'https://www.bing.com/search?q=%s', iconSrc: SvgSrcBing },
  ]
  return engines
}

export function createDefaultSearchEngineConfig(): DeskModule.SearchBox.SearchEngineConfig {
  const engineList = createDefaultEngines()
  return {
    currentEngineId: engineList[0].id,
    engineList,
    openMethod: SearchEngineOpenMethodEnum.currentPage,
  }
}

/**
 * Creates a blank engine record (an id may be supplied so a form draft can be matched to its list entry)
 *
 * 创建一条空白的引擎记录 (可指定 id, 便于把表单草稿与列表项对应起来)
 */
export function createEmptyEngine(id = ''): DeskModule.SearchBox.SearchEngine {
  return {
    id: id || generateEngineId(),
    title: '',
    url: '',
    iconSrc: '',
    remark: '',
  }
}

function toStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Normalises cloud / historical data into a SearchEngineConfig
 * - compatible with the old iconSrc field and the newWindowOpen boolean (they may still be in the local cache)
 * - drops empty entries, fills in missing ids and de-duplicates ids
 *
 *
 * 把云端 / 历史数据结构统一成 SearchEngineConfig
 * - 兼容旧结构中的 iconSrc 字段与 newWindowOpen 布尔值 (本地缓存里可能还有)
 * - 过滤空项、补齐缺失 id、去重 id
 */
export function normalizeSearchEngineConfig(raw: unknown): DeskModule.SearchBox.SearchEngineConfig {
  const source = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : null
  if (!source)
    return createDefaultSearchEngineConfig()

  const rawList = Array.isArray(source.engineList) ? source.engineList : null

  // The old shape (upstream v1.8's searchEngineList) has no ids; fill them in here
  // 老结构(上游 v1.8 的 searchEngineList) 没有 id, 这里补齐
  if (!rawList && Array.isArray(source.searchEngineList))
    return normalizeEngineList(source.searchEngineList, source)
  if (!rawList)
    return createDefaultSearchEngineConfig()
  if (rawList.length === 0) {
    // Cleared by the user on purpose: keep the empty list, the search box falls back to the built-in default engine so it stays usable
    // 用户主动清空: 保留空列表, 搜索框会回退到内置默认引擎保证可用
    return {
      currentEngineId: '',
      engineList: [],
      openMethod: resolveOpenMethod(source),
    }
  }
  return normalizeEngineList(rawList, source)
}

function normalizeEngineList(rawList: unknown[], source: Record<string, unknown>): DeskModule.SearchBox.SearchEngineConfig {
  const engineList: DeskModule.SearchBox.SearchEngine[] = []
  const usedIds = new Set<string>()
  for (const item of rawList) {
    if (!item || typeof item !== 'object')
      continue
    const record = item as Record<string, unknown>
    const title = toStr(record.title)
    const url = toStr(record.url)
    // Historical junk entries with neither a name nor a URL are dropped
    // 名称与地址都为空的历史脏数据直接丢弃
    if (!title && !url)
      continue

    let id = toStr(record.id)
    if (!id || usedIds.has(id))
      id = generateEngineId()
    usedIds.add(id)

    engineList.push({
      id,
      title: title || url,
      url,
      iconSrc: toStr(record.iconSrc) || toStr(record.icon) || '',
      remark: toStr(record.remark),
    })
  }

  if (engineList.length === 0)
    return { currentEngineId: '', engineList: [], openMethod: resolveOpenMethod(source) }

  let currentEngineId = toStr(source.currentEngineId)
  if (!engineList.some(engine => engine.id === currentEngineId)) {
    // In the old shape currentSearchEngine was the whole object rather than an id, so match it back by url/title
    // 旧结构里 currentSearchEngine 是整个对象而不是 id, 按地址/名称回认
    const legacyCurrent = source.currentSearchEngine as Record<string, unknown> | undefined
    const legacyUrl = toStr(legacyCurrent?.url).toLowerCase()
    const legacyTitle = toStr(legacyCurrent?.title).toLowerCase()
    const matched = (legacyUrl && engineList.find(engine => engine.url.toLowerCase() === legacyUrl))
      || (legacyTitle && engineList.find(engine => engine.title.toLowerCase() === legacyTitle))
    currentEngineId = matched ? matched.id : engineList[0].id
  }

  return {
    currentEngineId,
    engineList,
    openMethod: resolveOpenMethod(source),
  }
}

function resolveOpenMethod(source: Record<string, unknown> | null): SearchEngineOpenMethodEnum {
  const raw = Number(source?.openMethod ?? source?.openMethodEnum ?? Number.NaN)
  if (raw === SearchEngineOpenMethodEnum.currentPage || raw === SearchEngineOpenMethodEnum.newWindow)
    return raw
  // Compatible with the old newWindowOpen field (boolean)
  // 兼容旧字段 newWindowOpen (boolean)
  return source?.newWindowOpen === true
    ? SearchEngineOpenMethodEnum.newWindow
    : SearchEngineOpenMethodEnum.currentPage
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url.trim())
}

function isSupportedIconSrc(src: string): boolean {
  const value = src.trim()
  if (!value)
    return true
  if (value.startsWith('//'))
    return true
  // Site-relative paths / uploaded image URLs / built-in svg build artefacts
  // 站内相对路径 / 上传后的图片地址 / 内置 svg 打包产物
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('data:image/'))
    return true
  return isHttpUrl(value)
}

/**
 * Form validation; returns i18n keys for the caller to translate (the strings live under deskModule.searchEngine.*)
 *
 * 表单校验, 返回 i18n key, 由调用方翻译 (文案在 locales 的 deskModule.searchEngine.* 下)
 */
export function validateSearchEngine(engine: DeskModule.SearchBox.SearchEngine): DeskModule.SearchBox.SearchEngineValidateResult {
  const title = engine.title.trim()
  const url = engine.url.trim()
  const iconSrc = (engine.iconSrc ?? '').trim()

  let titleError = ''
  if (!title)
    titleError = 'deskModule.searchEngine.engineNameRequired'
  else if (title.length > 20)
    titleError = 'deskModule.searchEngine.engineNameTooLong'

  let urlError = ''
  if (!url)
    urlError = 'deskModule.searchEngine.engineUrlRequired'
  else if (!isHttpUrl(url))
    urlError = 'deskModule.searchEngine.engineUrlInvalid'

  const iconError = isSupportedIconSrc(iconSrc) ? '' : 'deskModule.searchEngine.engineIconUrlInvalid'

  return {
    valid: !titleError && !urlError && !iconError,
    titleError,
    urlError,
    iconError,
  }
}

/**
 * Whether the engine duplicates another one by name or URL (the engine itself is ignored while editing)
 *
 * 按名称 / 地址判断是否重复 (编辑时忽略自身)
 */
export function isDuplicateEngine(
  list: DeskModule.SearchBox.SearchEngine[],
  engine: DeskModule.SearchBox.SearchEngine,
): 'title' | 'url' | '' {
  const title = engine.title.trim().toLowerCase()
  const url = engine.url.trim().toLowerCase()
  for (const item of list) {
    if (item.id === engine.id)
      continue
    if (title && item.title.trim().toLowerCase() === title)
      return 'title'
    if (url && item.url.trim().toLowerCase() === url)
      return 'url'
  }
  return ''
}

/**
 * Builds the final search URL
 * - when the template contains %s / {keyword} / {q}, each occurrence is replaced (the keyword is URL-encoded)
 * - when the template has no placeholder, the keyword is appended to the end while keeping the existing query structure
 *
 *
 * 生成最终搜索地址
 * - 模板含 %s / {keyword} / {q} 时逐个替换 (关键词做 URL 编码)
 * - 模板不含占位符时把关键词追加到末尾, 保留原有 query 结构
 */
export function buildSearchUrl(template: string, keyword: string): string {
  const base = (template ?? '').trim()
  const encoded = encodeURIComponent(keyword)
  if (!base)
    return ''

  let replaced = false
  let result = base
  for (const token of PLACEHOLDER_TOKENS) {
    if (result.includes(token)) {
      result = result.split(token).join(encoded)
      replaced = true
    }
  }
  if (replaced)
    return result

  if (!keyword)
    return result
  return `${result}${encoded}`
}

export function hasPlaceholder(template: string): boolean {
  return PLACEHOLDER_TOKENS.some(token => (template ?? '').includes(token))
}

/**
 * Deduces the template from "a search URL that opens"
 * Example: https://www.bing.com/search?q=test&form=QBLH -> https://www.bing.com/search?q=%s&form=QBLH
 *
 *
 * 从「一个能打开的搜索地址」反推模板
 * 例: https://www.bing.com/search?q=测试&form=QBLH -> https://www.bing.com/search?q=%s&form=QBLH
 */
export function deduceTemplateFromTestUrl(testUrl: string, keyword: string): DeskModule.SearchBox.TemplateDeduceResult | null {
  const raw = (testUrl ?? '').trim()
  const word = (keyword ?? '').trim()
  if (!raw || !isHttpUrl(raw))
    return null

  // The user pasted a template that already contains a placeholder: keep it as-is
  // 用户直接粘了带占位符的模板, 保持原样
  if (hasPlaceholder(raw))
    return { template: raw, param: '', matched: true }

  const hashIndex = raw.indexOf('#')
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : ''
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw
  const queryIndex = withoutHash.indexOf('?')
  const origin = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : ''

  const params = new URLSearchParams(query)
  const entries = [...params.entries()]
  if (entries.length > 0) {
    let targetKey = ''
    let targetValue = ''
    if (word) {
      const byValue = entries.find(([, value]) => value.includes(word))
      if (byValue) {
        [targetKey, targetValue] = byValue
      }
      else {
        // When the keyword is encoded or truncated, fall back to guessing the usual parameter names
        // 关键词被编码或截断时, 退化为猜测常见参数名
        const byName = entries.find(([key]) => KEYWORD_PARAM_NAMES.includes(key.toLowerCase()))
        if (byName) {
          targetKey = byName[0]
          targetValue = byName[1]
        }
      }
    }
    if (!targetKey) {
      const byName = entries.find(([key]) => KEYWORD_PARAM_NAMES.includes(key.toLowerCase())) ?? entries[0]
      targetKey = byName[0]
      targetValue = byName[1]
    }

    // The placeholder is always written as %s, so URLSearchParams cannot encode it a second time
    // 占位符统一写成 %s, 避免 URLSearchParams 把占位符再次编码
    params.set(targetKey, '%s')
    const search = params.toString().replace(/%25s/gi, '%s')
    return {
      template: `${origin}?${search}${hash}`,
      param: targetKey,
      matched: !word || targetValue.includes(word) || KEYWORD_PARAM_NAMES.includes(targetKey.toLowerCase()),
    }
  }

  // No query at all: the keyword can only be appended to the end
  // 没有 query: 关键词只能追加到末尾
  return { template: `${origin}${hash}`, param: '', matched: false }
}

/**
 * Candidate icon URLs (tried in order, falling back one by one through the <img> onerror handler)
 * When the user has not set an icon, the list can still show the site favicon instead of the first letter.
 *
 *
 * 站点图标候选地址 (按顺序尝试, 用 <img> 的 onerror 逐个回退)
 * 用户没填图标地址时, 让列表里也能直接看到网站图标而不是首字母
 */
export function guessIconCandidates(template: string): string[] {
  const raw = (template ?? '').trim()
  if (!raw)
    return []
  try {
    const parsed = new URL(raw.replace(/%s|\{keyword\}|\{q\}/g, 'test'))
    return [
      `${parsed.origin}/favicon.ico`,
      `https://www.google.com/s2/favicons?domain=${parsed.host}&sz=64`,
    ]
  }
  catch {
    return []
  }
}
