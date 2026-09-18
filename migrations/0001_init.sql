-- Sun-Panel D1 初始化迁移 (单文件基线)
--
-- 合并历史: 本文件由 0001_init.sql + 0002_item_icon_group_style.sql + 0003_item_only_name.sql 合并而来。
--   原 0002 的内容已折叠进 item_icon_group 的建表语句 (card_style / text_color / hide_description),
--   原 0003 的内容已折叠进 item_icon 的建表语句 (only_name)。
-- 维护约定: 本文件描述「此刻的最终结构」, 只对**全新库**生效 —— 已部署库因为文件名已被
--   d1_migrations 记录, 不会重跑本文件。因此单文件策略下对已部署库的结构变化需另行走升级流程,
--   详见 docs/improvement-plan.md §2.2。
-- 历史: module_config / notice 两张表已随死代码清理从本文件移除 (见 docs/improvement-plan.md §5.1);
--   已部署库里的这两张空表保留不动 (代码不再访问, 无害)。
--
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
  item_icon_group_id INTEGER NOT NULL DEFAULT 0,
  -- 项目唯一标识 (原 0003, 对齐上游 v1.8.1): 仅限英文, 可用作 OpenAPI 字段
  only_name TEXT NOT NULL DEFAULT ''
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
  sort INTEGER NOT NULL DEFAULT 0,
  -- 分组级卡片样式 (原 0002, 对齐上游 v1.8.1): -1=跟随全局设置, 0=详情图标(长条形), 1=小图标(正方形)
  card_style INTEGER NOT NULL DEFAULT -1,
  -- 分组级文字颜色 (原 0002): 空字符串=跟随全局设置
  text_color TEXT NOT NULL DEFAULT '',
  -- 分组级隐藏描述 (原 0002): 0=显示描述, 1=隐藏描述
  hide_description INTEGER NOT NULL DEFAULT 0
);

-- ===================== 面板配置 (单行) =====================
CREATE TABLE IF NOT EXISTS user_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  panel_json TEXT DEFAULT '{}',
  search_engine_json TEXT DEFAULT '{}'
);

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

-- ===================== 登录失败限流 =====================
-- 单条 UPSERT 原子累加, 详见 src/utils/loginRate.ts
-- (旧实现用 KV 读-改-写: 并发会丢计数, 且读有最长约 60s 的边缘缓存, 短时间连发可绕过)
CREATE TABLE IF NOT EXISTS login_attempt (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  -- Unix 秒: 最近一次失败时间 (滑动窗口起点)
  window_start INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_login_attempt_window ON login_attempt (window_start);

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
