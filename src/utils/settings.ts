import type { D1Database } from '@cloudflare/workers-types'
import type { UserInfo } from '../types'

// ===================== system_setting 键名 =====================
export const SETTING_ADMIN_USERNAME = 'admin_username'
export const SETTING_ADMIN_PASSWORD = 'admin_password'
export const SETTING_ADMIN_NAME = 'admin_name'
export const SETTING_ADMIN_HEAD_IMAGE = 'admin_head_image'
export const SETTING_SYSTEM_APPLICATION = 'system_application'
export const SETTING_DISCLAIMER = 'disclaimer'
export const SETTING_WEB_ABOUT_DESCRIPTION = 'web_about_description'

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

export async function getSettingJson<T>(db: D1Database, name: string, fallback: T): Promise<T> {
  const v = await getSetting(db, name)
  if (v === null || v === '')
    return fallback
  try {
    return JSON.parse(v) as T
  }
  catch {
    return fallback
  }
}

export async function setSettingJson(db: D1Database, name: string, value: unknown): Promise<void> {
  await setSetting(db, name, JSON.stringify(value))
}

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
