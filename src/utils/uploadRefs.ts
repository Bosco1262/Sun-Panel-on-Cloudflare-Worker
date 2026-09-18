import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { r2KeyFromSrc } from './file'
import { SETTING_ADMIN_HEAD_IMAGE } from './settings'

/**
 * R2 对象与 file 表的引用清理
 *
 * 一张图片可能同时被项目图标、面板背景、头像引用, 所以删项目/分组时不能无脑删对象:
 * 统一走「引用检查 → 确认没人用才删 R2 + 软删 file 行」。
 * 所有失败只记日志, 不影响主流程 (图片残留比删错图轻微得多)。
 */

/** 归一化成 file 表里的 src 形态 (`./uploads/...`); 外链或空值返回 null */
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

/** 该 uploads 路径是否仍被引用 (项目图标 / 面板背景 / 管理员头像) */
export async function isUploadSrcReferenced(db: D1Database, src: string): Promise<boolean> {
  const bare = src.replace(/^\.\//, '') // uploads/...  (icon_json 里可能带或不带 ./ 前缀)

  const item = await db
    .prepare('SELECT 1 AS x FROM item_icon WHERE deleted_at IS NULL AND icon_json LIKE ? LIMIT 1')
    .bind(`%${bare}%`)
    .first()
  if (item)
    return true

  const config = await db
    .prepare('SELECT panel_json FROM user_config WHERE id = 1')
    .first<{ panel_json: string }>()
  if (config?.panel_json?.includes(bare))
    return true

  const headImage = await db
    .prepare('SELECT config_value AS v FROM system_setting WHERE config_name = ?')
    .bind(SETTING_ADMIN_HEAD_IMAGE)
    .first<{ v: string }>()
  if (headImage?.v?.includes(bare))
    return true

  return false
}

/**
 * 清理一批 uploads 对象 (无引用才删)
 *
 * @returns 实际删除的对象数
 */
export async function cleanupUploads(
  db: D1Database,
  files: R2Bucket,
  srcs: Array<string | null | undefined>,
): Promise<number> {
  // 一律先归一化: 外链、空值、非法路径都不该被当成 R2 对象去删
  const unique = [...new Set(srcs.map(normalizeUploadSrc).filter((s): s is string => !!s))]
  let deleted = 0

  for (const src of unique) {
    try {
      if (await isUploadSrcReferenced(db, src))
        continue

      await files.delete(r2KeyFromSrc(src))
      await db
        .prepare('UPDATE file SET deleted_at = datetime(\'now\') WHERE deleted_at IS NULL AND src = ?')
        .bind(src)
        .run()
      deleted++
    }
    catch (err) {
      console.warn(`[uploads] cleanup failed for ${src}:`, (err as Error).message)
    }
  }

  return deleted
}
