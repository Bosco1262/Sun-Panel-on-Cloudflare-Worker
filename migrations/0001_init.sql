-- Sun-Panel D1 initial migration (single-file baseline)
--
-- Merge history: this file merges 0001_init.sql + 0002_item_icon_group_style.sql + 0003_item_only_name.sql.
--   The content of the former 0002 is folded into the item_icon_group CREATE statement (card_style / text_color /
--   hide_description), and the former 0003 into the item_icon CREATE statement (only_name).
-- Maintenance policy: this file describes the **final schema as of now** and only applies to **brand-new**
--   databases — a deployed database never re-runs it because its file name is already recorded in d1_migrations.
--   Under the single-file policy, structural changes on a deployed database therefore need a separate upgrade
--   flow; see docs/improvement-plan.md §2.2.
-- History: the module_config / notice tables were removed from this file together with the dead code
--   (see docs/improvement-plan.md §5.1); the two empty tables in deployed databases are left untouched
--   (the code no longer touches them, so they are harmless).
-- History: the seeds for the settings system_application / disclaimer / web_about_description were removed
--   (only the deleted /openness/* endpoints read them, see docs/improvement-plan.md §10.5); the three leftover
--   rows in deployed databases are equally harmless.
--
-- Single-user mode: there is no user table, the administrator account lives in system_setting
--
--
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
-- 历史: system_application / disclaimer / web_about_description 三个设置项的种子已移除
--   (它们只被已删除的 /openness/* 接口读取, 见 docs/improvement-plan.md §10.5);
--   已部署库里残留的这三行同样无害。
--
-- 单用户模式: 无 user 表, 管理员账号信息存于 system_setting

-- ===================== Icons =====================
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
  -- Unique item identifier (formerly 0003, aligned with upstream v1.8.1): English only, usable as an OpenAPI field
  -- 项目唯一标识 (原 0003, 对齐上游 v1.8.1): 仅限英文, 可用作 OpenAPI 字段
  only_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_item_icon_group_id ON item_icon (item_icon_group_id);

-- ===================== Groups =====================
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
  -- Group-level card style (formerly 0002, aligned with upstream v1.8.1): -1=follow global settings, 0=detail icon (bar), 1=small icon (square)
  -- 分组级卡片样式 (原 0002, 对齐上游 v1.8.1): -1=跟随全局设置, 0=详情图标(长条形), 1=小图标(正方形)
  card_style INTEGER NOT NULL DEFAULT -1,
  -- Group-level text colour (formerly 0002): an empty string means "follow global settings"
  -- 分组级文字颜色 (原 0002): 空字符串=跟随全局设置
  text_color TEXT NOT NULL DEFAULT '',
  -- Group-level hide description (formerly 0002): 0=show the description, 1=hide it
  -- 分组级隐藏描述 (原 0002): 0=显示描述, 1=隐藏描述
  hide_description INTEGER NOT NULL DEFAULT 0
);

-- ===================== Panel config (single row) =====================
-- ===================== 面板配置 (单行) =====================
CREATE TABLE IF NOT EXISTS user_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  panel_json TEXT DEFAULT '{}',
  search_engine_json TEXT DEFAULT '{}'
);

-- ===================== System settings (key/value) =====================
-- ===================== 系统设置 (键值) =====================
CREATE TABLE IF NOT EXISTS system_setting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_name TEXT NOT NULL UNIQUE,
  config_value TEXT DEFAULT ''
);

-- ===================== File records =====================
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

-- ===================== Login failure rate limiting =====================
-- One atomic UPSERT accumulates the count, see src/utils/loginRate.ts
-- (the old implementation used KV read-modify-write: concurrency lost counts, and reads could be up to ~60 s
-- stale at the edge, so a short burst could bypass the counter)
--
-- ===================== 登录失败限流 =====================
-- 单条 UPSERT 原子累加, 详见 src/utils/loginRate.ts
-- (旧实现用 KV 读-改-写: 并发会丢计数, 且读有最长约 60s 的边缘缓存, 短时间连发可绕过)
CREATE TABLE IF NOT EXISTS login_attempt (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  -- Unix seconds: time of the most recent failure (the start of the sliding window)
  -- Unix 秒: 最近一次失败时间 (滑动窗口起点)
  window_start INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_login_attempt_window ON login_attempt (window_start);

-- ===================== Seed data =====================
-- ===================== 种子数据 =====================
-- Default administrator account: admin / 12345678 (the password is stored as triple MD5, compatible with upstream Sun-Panel)
-- 默认管理员账号: admin / 12345678 (密码为三重 MD5 存储, 与 Sun-Panel 原版兼容)
INSERT OR IGNORE INTO system_setting (config_name, config_value) VALUES
  ('admin_username', 'admin'),
  ('admin_password', '579646aad11fae4dd295812fb4526245'),
  ('admin_name', 'admin'),
  ('admin_head_image', '');

-- Default group: created automatically on the first getList call when there is none, pre-seeded here for a better first experience
-- 默认分组: 首次访问 getList 时若无分组会自动创建, 这里预置以保证体验
INSERT OR IGNORE INTO item_icon_group (created_at, updated_at, icon, title, description, sort)
VALUES (datetime('now'), datetime('now'), 'material-symbols:ad-group-outline', 'APP', '', 0);
