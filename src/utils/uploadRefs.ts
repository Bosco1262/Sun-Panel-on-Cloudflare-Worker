import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { r2KeyFromSrc } from './file'
import { SETTING_ADMIN_HEAD_IMAGE, SETTING_CUSTOM_CSS, SETTING_CUSTOM_JS } from './settings'

/**
 * R2 对象与 file 表的引用清理
 *
 * 一张图片可能同时被项目图标、面板背景、头像、自定义 CSS/JS 引用, 所以删项目/分组时
 * 不能无脑删对象: 统一走「引用检查 → 确认没人用才删 R2 + 软删 file 行」。
 * 所有失败只记日志, 不影响主流程 (图片残留比删错图轻微得多)。
 *
 * 子请求约定 (见 docs/improvement-plan.md §9.9): 引用判定用「一次性读取 + 内存比对」而不是
 * 「每个候选各查几次」—— 读取固定 3 次、与候选数量无关; 删除后的 file 行合并成分片 UPDATE。
 * 免费版对单次请求的子请求数有上限, 图库变大时这条约束才是关键。
 */

/** file 行批量更新的分片大小 (D1 单条语句最多 100 个绑定参数, 留出余量) */
const FILE_UPDATE_CHUNK = 90

/**
 * 归一化成 file 表里的 src 形态 (`./uploads/...`); 外链或空值返回 null
 *
 * 外链 (`https://...`) 不是本站 R2 对象, 必须在这里挡掉 —— 早期实现少了这一步,
 * 会把外链当 key 去删 R2 对象。
 */
export function normalizeUploadSrc(src: unknown): string | null {
  if (typeof src !== 'string')
    return null
  const bare = src.trim().replace(/^\.\//, '')
  if (!bare.startsWith('uploads/'))
    return null
  return `./${bare}`
}

/** 从 item_icon.icon_json 里取图标图片路径 (外链返回 null) */
export function srcFromIconJson(iconJson: unknown): string | null {
  if (typeof iconJson !== 'string' || !iconJson)
    return null
  try {
    const parsed = JSON.parse(iconJson) as { src?: unknown }
    return normalizeUploadSrc(parsed?.src)
  }
  catch {
    return null
  }
}

/**
 * 一次性取出所有「可能包含 uploads 引用」的文本 (固定 3 次查询, 与候选数量无关)
 *
 * 判定用**字符串包含**而不是精确解析: 方向偏保守 —— 最多把「其实没人用」判成「在用」(少删一点),
 * 不会把在用的判成没人用。
 */
async function loadReferenceTexts(db: D1Database): Promise<string[]> {
  const texts: string[] = []

  const { results: icons } = await db
    .prepare('SELECT icon_json FROM item_icon WHERE deleted_at IS NULL')
    .all<{ icon_json: string }>()
  for (const row of icons)
    texts.push(row.icon_json ?? '')

  const config = await db
    .prepare('SELECT panel_json FROM user_config WHERE id = 1')
    .first<{ panel_json: string }>()
  texts.push(config?.panel_json ?? '')

  const { results: settings } = await db
    .prepare('SELECT config_value AS v FROM system_setting WHERE config_name IN (?, ?, ?)')
    .bind(SETTING_ADMIN_HEAD_IMAGE, SETTING_CUSTOM_CSS, SETTING_CUSTOM_JS)
    .all<{ v: string }>()
  for (const row of settings)
    texts.push(row.v ?? '')

  return texts
}

/**
 * 纯函数: 该 uploads 路径是否出现在任一引用文本里
 *
 * 空路径返回 true (保守: 不该把「不知道是什么」的东西当成可删对象)。
 */
export function isSrcReferenced(texts: string[], src: string): boolean {
  const bare = src.replace(/^\.\//, '')
  if (!bare)
    return true
  return texts.some(text => text.includes(bare))
}

/** 单条引用检查 (站点图标换扩展名等单点场景), 内部固定 3 次查询 */
export async function isUploadSrcReferenced(db: D1Database, src: string): Promise<boolean> {
  return isSrcReferenced(await loadReferenceTexts(db), src)
}

export interface CleanupResult {
  /** 本次实际删除的对象数 */
  deleted: number
  /** 还有多少「可删」的候选没处理完 (受 limit 限制时为 > 0, 调用方可再调一次) */
  remaining: number
}

/**
 * 清理一批 uploads 对象 (无引用才删)
 *
 * @param limit 单次最多删除的对象数 (默认不限制)
 *   —— Workers 免费版**每次调用最多 50 个子请求**, 而每个对象要花 1 次 R2 删除,
 *   所以大批量清理由调用方分批进行 (见 src/api/system/file.ts 的 cleanUnused 与
 *   前端「清理未引用文件」的循环调用)。
 */
export async function cleanupUploads(
  db: D1Database,
  files: R2Bucket,
  srcs: Array<string | null | undefined>,
  limit = Number.POSITIVE_INFINITY,
): Promise<CleanupResult> {
  // 一律先归一化: 外链、空值、非法路径都不该被当成 R2 对象去删
  const unique = [...new Set(srcs.map(normalizeUploadSrc).filter((s): s is string => !!s))]
  if (unique.length === 0)
    return { deleted: 0, remaining: 0 }

  const texts = await loadReferenceTexts(db)
  const deletable = unique.filter(src => !isSrcReferenced(texts, src))
  const batch = deletable.slice(0, Math.max(0, limit))
  const remaining = deletable.length - batch.length
  if (batch.length === 0)
    return { deleted: 0, remaining }

  const deletedSrcs: string[] = []
  for (const src of batch) {
    try {
      await files.delete(r2KeyFromSrc(src))
      deletedSrcs.push(src)
    }
    catch (err) {
      console.warn(`[uploads] cleanup failed for ${src}:`, (err as Error).message)
    }
  }

  // file 行合并成分片 UPDATE: 旧实现每删一个对象就发一条 UPDATE, 子请求数随文件数线性增长
  for (let i = 0; i < deletedSrcs.length; i += FILE_UPDATE_CHUNK) {
    const chunk = deletedSrcs.slice(i, i + FILE_UPDATE_CHUNK)
    const holders = chunk.map(() => '?').join(',')
    try {
      await db
        .prepare(`UPDATE file SET deleted_at = datetime('now') WHERE deleted_at IS NULL AND src IN (${holders})`)
        .bind(...chunk)
        .run()
    }
    catch (err) {
      // 对象已删, 行没标记成功只影响列表展示, 记日志即可
      console.warn('[uploads] mark file rows deleted failed:', (err as Error).message)
    }
  }

  return { deleted: deletedSrcs.length, remaining }
}
