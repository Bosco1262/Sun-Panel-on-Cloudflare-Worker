-- Sun-Panel D1 初始化迁移
-- 单用户模式: 无 user 表, 管理员账号信息存于 system_setting

-- ===================== 图标 =====================
CREATE TABLE IF NOT EXISTS item_icon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  icon_json TEXT DEFAULT '',
  title TEXT DEFAULT '',
  url TEXT DEFAULT '',
  lan_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  open_method INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  item_icon_group_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_item_icon_group_id ON item_icon (item_icon_group_id);

-- ===================== 分组 =====================
CREATE TABLE IF NOT EXISTS item_icon_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  icon TEXT DEFAULT '',
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

-- ===================== 面板配置 (单行) =====================
CREATE TABLE IF NOT EXISTS user_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  panel_json TEXT DEFAULT '{}',
  search_engine_json TEXT DEFAULT '{}'
);

-- ===================== 桌面模块配置 =====================
CREATE TABLE IF NOT EXISTS module_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  name TEXT NOT NULL DEFAULT '',
  value_json TEXT DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_config_name ON module_config (name);

-- ===================== 系统设置 (键值) =====================
CREATE TABLE IF NOT EXISTS system_setting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_name TEXT NOT NULL UNIQUE,
  config_value TEXT DEFAULT ''
);

-- ===================== 文件记录 =====================
CREATE TABLE IF NOT EXISTS file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  src TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  method INTEGER NOT NULL DEFAULT 0,
  ext TEXT DEFAULT ''
);

-- ===================== 通知 =====================
CREATE TABLE IF NOT EXISTS notice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  display_type INTEGER NOT NULL DEFAULT 0,
  one_read INTEGER NOT NULL DEFAULT 0,
  url TEXT DEFAULT '',
  is_login INTEGER NOT NULL DEFAULT 0
);

-- ===================== 种子数据 =====================
-- 默认管理员账号: admin / 12345678 (密码为三重 MD5 存储, 与 Sun-Panel 原版兼容)
INSERT OR IGNORE INTO system_setting (config_name, config_value) VALUES
  ('admin_username', 'admin'),
  ('admin_password', '579646aad11fae4dd295812fb4526245'),
  ('admin_name', 'admin'),
  ('admin_head_image', ''),
  ('system_application', '{"loginCaptcha":false,"register":{"emailSuffix":"","openRegister":false},"webSiteUrl":""}'),
  ('disclaimer', ''),
  ('web_about_description', '');

-- 默认分组: 首次访问 getList 时若无分组会自动创建, 这里预置以保证体验
INSERT OR IGNORE INTO item_icon_group (created_at, updated_at, icon, title, description, sort)
VALUES (datetime('now'), datetime('now'), 'material-symbols:ad-group-outline', 'APP', '', 0);
