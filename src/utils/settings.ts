import type { D1Database } from '@cloudflare/workers-types'
import type { UserInfo } from '../types'

// ===================== system_setting keys =====================
// ===================== system_setting 键名 =====================
export const SETTING_ADMIN_USERNAME = 'admin_username'
export const SETTING_ADMIN_PASSWORD = 'admin_password'
export const SETTING_ADMIN_NAME = 'admin_name'
export const SETTING_ADMIN_HEAD_IMAGE = 'admin_head_image'
/**
 * Token generation: bumping it invalidates every JWT issued before (see src/utils/authEpoch.ts)
 *
 * token 世代: 递增即让此前签发的所有 JWT 失效 (见 src/utils/authEpoch.ts)
 */
export const SETTING_AUTH_EPOCH = 'auth_epoch'
/**
 * Whether deleting an item/group automatically reclaims images that are no longer referenced
 *
 * Stored as '1' / '0'; a missing key counts as **on** (the behaviour before this switch existed).
 * When off, deletes never touch R2: the images stay in the upload-file manager, can be reused, and
 * "Clean unused files" is there for manual work.
 *
 *
 * 删除项目/分组时是否自动回收不再被引用的图片
 *
 * 存 '1' / '0'; 键不存在时按**开启**处理 (与加这个开关之前的行为一致)。
 * 关闭后删除操作不再动 R2: 图片留在「上传文件管理」里可复用, 需要时手动点「清理未引用文件」。
 */
export const SETTING_AUTO_CLEAN_UNUSED = 'storage_auto_clean_unused'
/**
 * Custom CSS / JS (injected globally)
 *
 * These live here instead of the api layer because the reference check (src/utils/uploadRefs.ts) reads both keys
 * as well; keeping the constants in utils avoids a utils ↔ api circular dependency.
 *
 *
 * 自定义 CSS / JS (全局设置注入)
 *
 * 放在这里而不是 api 层: 引用检查 (src/utils/uploadRefs.ts) 也要读这两个键,
 * 常量提到 utils 可以避免 utils ↔ api 的循环依赖。
 */
export const SETTING_CUSTOM_CSS = 'custom_css'
export const SETTING_CUSTOM_JS = 'custom_js'

export async function getSetting(db: D1Database, name: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT config_value AS v FROM system_setting WHERE config_name = ?')
    .bind(name)
    .first<{ v: string }>()
  return row ? row.v : null
}

export async function setSetting(db: D1Database, name: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO system_setting (config_name, config_value) VALUES (?, ?) '
      + 'ON CONFLICT(config_name) DO UPDATE SET config_value = excluded.config_value',
    )
    .bind(name, value)
    .run()
}

// Read the current user profile (single-user mode: id is fixed at 1)
// 读取当前用户资料 (单用户模式: 固定 id=1)
export async function getUserProfile(db: D1Database, uid = 1): Promise<UserInfo> {
  const [username, name, headImage] = await Promise.all([
    getSetting(db, SETTING_ADMIN_USERNAME),
    getSetting(db, SETTING_ADMIN_NAME),
    getSetting(db, SETTING_ADMIN_HEAD_IMAGE),
  ])
  return {
    id: uid,
    username: username ?? 'admin',
    name: name ?? 'admin',
    headImage: headImage ?? '',
    role: 1,
  }
}

// ===================== Boolean settings =====================
// ===================== 布尔型设置 =====================

/**
 * Parses a boolean setting value ('0' / 'false' / 'off' mean off, any other non-empty value means on)
 *
 * 解析布尔设置值 ('0' / 'false' / 'off' 视为关, 其余非空值视为开)
 */
export function parseBoolSetting(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined || value === '')
    return null
  const v = value.trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

/**
 * Whether "automatically reclaim unreferenced images on delete" is on (on by default)
 *
 * An unreadable setting returns **false** — the error direction on this side must stay conservative: one
 * skipped deletion only leaves a file behind, while a wrong deletion removes images the user has not reused yet.
 *
 *
 * 「删除时自动回收未引用图片」是否开启 (默认开)
 *
 * 读不到设置时按**关闭**返回 —— 这一侧的错误方向要偏保守: 少删一次只是残留文件,
 * 而误删会把用户还没来得及复用的图片清掉。
 */
export async function getAutoCleanUnused(db: D1Database): Promise<boolean> {
  try {
    const parsed = parseBoolSetting(await getSetting(db, SETTING_AUTO_CLEAN_UNUSED))
    return parsed ?? true
  }
  catch (err) {
    console.warn('[settings] read auto-clean setting failed, keep files:', (err as Error).message)
    return false
  }
}
