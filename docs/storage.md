# 存储与资源说明

> 本文说明这个 Worker 用到哪些 Cloudflare 资源、数据存在哪里、以及本地开发状态怎么处理。
> 备份与恢复步骤见 [deployment.md](./deployment.md#备份与恢复)；结构变更约定见
> [improvement-plan.md](./improvement-plan.md) §2.2。

## 1. Cloudflare 侧资源

| 资源 | 绑定 | 名称 | 用途 | 备注 |
|------|------|------|------|------|
| D1 | `DB` | `sun-panel` | 全部业务数据（见第 2 节） | wrangler ≥ 4.45 部署时自动创建 |
| R2 | `FILES` | `sun-panel-files` | 上传的图片/文件 + 抓取的站点图标 | `/uploads/*` 由 Worker 代理读取 |
| 静态资源 | （无 binding） | `dist/` | 前端构建产物 | 资产绑定是可选的，本项目不用 `env.ASSETS` |
| Secret | `JWT_SECRET` | — | JWT 签名密钥 | **必填**，`wrangler secret put JWT_SECRET` |
| Secret | `PASSWORD_PEPPER` | — | 密码哈希 pepper（PBKDF2 的密钥一部分） | 可选但建议；配了就别改/删 |
| Secret | `PASSWORD_PBKDF2_ITERATIONS` | — | PBKDF2 迭代数 | 可选，默认 5000 |

> **历史**：KV（绑定名 `LOGIN_RATE`）曾用于登录失败限流，现已迁到 D1 的 `login_attempt` 表并移除了绑定
> （见 [improvement-plan.md](./improvement-plan.md) §2.3 / §2.4）。云端那个自动创建的 KV namespace
> 变成孤儿（只含限流计数），可以在 Dashboard 里删掉。

## 2. D1 数据表

| 表 | 用途 | 关键内容 | 删除语义 |
|----|------|----------|----------|
| `item_icon` | 面板上的项目 | `title` / `url` / `lan_url` / `description` / `open_method` / `sort` / `item_icon_group_id` / `only_name`，图标放 `icon_json` | 软删（`deleted_at`） |
| `item_icon_group` | 分组 | `title` / `sort` / `card_style` / `text_color` / `hide_description` | 软删；删分组会连带软删组内项目 |
| `user_config` | 面板与搜索配置（**单行** `id = 1`） | `panel_json`（样式/背景/页脚等整份配置）、`search_engine_json`（引擎列表 + 当前引擎 + 打开方式） | **整份覆盖写**：避免多标签同时修改 |
| `system_setting` | 系统键值 | 管理员账号/密码哈希/昵称/头像、`system_application`、`disclaimer`、`web_about_description`、`custom_css`、`custom_js`、`auth_epoch`（token 世代） | 直接覆盖 |
| `file` | 上传文件与站点图标的元数据 | `src`（`./uploads/...`）、`file_name`、`ext` | 软删；删除时同步删 R2 对象 |
| `login_attempt` | 登录失败限流 | `ip`（主键）、`fail_count`、`window_start` | 无软删；过期行由概率清理回收 |

> **已移除**（不再创建，见 [improvement-plan.md](./improvement-plan.md) §5.1）：`module_config`（旧搜索框配置，仅剩的迁移读取也已删除）、
> `notice`（通知，前端早已无调用）。已部署库里的这两张空表保留不动，代码不再访问。

## 3. R2 对象布局与回收

| key 形态 | 来源 | 覆盖行为 |
|----------|------|----------|
| `yyyy/M/d/<md5>.<ext>` | `/api/file/uploadImg`、`/api/file/uploadFiles` | 每次上传都是新对象（key 含时间戳哈希） |
| `icons/<md5(host)>.<ext>` | `/api/panel/itemIcon/getSiteFavicon` | **按站点稳定**：重复获取覆盖同一个对象；扩展名变化时旧对象会被删掉 |

- 读取统一走 `/uploads/*`：key 白名单校验（非法 key 直接 404）、`X-Content-Type-Options: nosniff`、
  非图片强制 `Content-Disposition: attachment`、SVG 额外加 `sandbox` CSP；上传件带 `immutable` 缓存头。
- 站点图标换扩展名（重新获取）时，旧对象会被清理——但同样要过下面的开关与引用检查，避免删掉仍在用的旧图标。

### 3.1 图片回收：两个入口、判定规则与开关

> 这一节对应两个用户可见的东西：**上传文件管理页顶部的开关**和**同一页的「清理未引用文件」按钮**。
> 实现：`src/utils/uploadRefs.ts`（判定与删除）、`src/utils/settings.ts`（开关读写）、
> `src/api/panel/itemIcon.ts` / `itemIconGroup.ts`（删除时触发）、`src/api/system/file.ts`（手动清理接口）。

**两个入口的分工**

| 触发动作 | 受开关控制 | 候选集（会检查哪些图） |
|----------|-----------|------------------------|
| 删除**项目** | ✅ | 被删项目的 `icon_json.src` |
| 删除**分组** | ✅ | 该分组下所有项目的 `icon_json.src`（分组删除会连带软删组内项目） |
| 重新获取站点图标、扩展名变了 | ✅ | 该站点旧 key 对应的对象 |
| 点**「清理未引用文件」**按钮 | ❌ **否**（这是你的显式操作，永远可用） | `file` 表里所有未删除记录 |

**「仍被引用」怎么判定**：把路径归一化成 `uploads/...` 后，依次检查（任一命中即保留）：

1. `item_icon` 里**还活着**（`deleted_at IS NULL`）的项目，其 `icon_json` 是否包含该路径；
2. `user_config.panel_json`（面板背景、页脚 HTML 等整份配置）是否包含该路径；
3. `system_setting.admin_head_image`（头像）是否包含该路径。

判定用的是**字符串包含**（不是 JSON 精确匹配），方向偏保守：最多把「其实没人用」判成「在用」（少删一点），
**不会**把在用的判成没人用。

**开关：删除项目/分组时自动回收未引用的图片**

| 项 | 值 |
|----|----|
| 界面位置 | 上传文件管理页顶部（左侧开关 + 说明，右侧「清理未引用文件」按钮） |
| 存储 | D1 `system_setting` 的 `storage_auto_clean_unused`：`'1'` 开 / `'0'` 关 |
| 默认值 | **开**（没有这一行 = 开，与加开关之前的行为一致） |
| 命中「关」的写法 | `0` / `false` / `off` / `no`（不区分大小写、忽略首尾空格）；其他非空值视为开 |
| 读取失败（D1 抖动等） | **按「关」处理**并记日志 —— 少删一次只是残留文件，误删会清掉你还想复用的图片 |
| 关闭后的效果 | 删除项目/分组**只软删 D1 记录、完全不动 R2**；图片留在列表里，可随时复用或手动清理 |

**按钮：「清理未引用文件」**

```
点击 → 二次确认弹窗（写明判定依据）
     → POST /api/system/file/cleanUnused
     → 后端: 取出 file 表全部未删除记录 → 逐条做上面的引用判定
            未被引用 → 删除 R2 对象 + 软删 file 行
     → 返回 { checked: 候选总数, deleted: 实际删除数 }
     → 前端提示「已清理 N 个未被引用的文件」并刷新列表
```

- `checked` 是扫描的记录数，`deleted` 是真正删掉的数量，两者差距大是正常的。
- 单个对象删除失败只记日志（`[uploads] cleanup failed for …`），不影响其它对象，也不会让接口报错；下次清理会重试。
- 因为只处理 `deleted_at IS NULL` 的记录，重复点击是幂等的。

**场景对照**

| 场景 | 开关=开 | 开关=关 |
|------|---------|---------|
| 图只被项目 A 用，删掉 A | 删对象 + 软删 `file` 行 | 都保留 |
| 图被项目 A、B 共用，只删 A | 保留（B 仍在用） | 保留 |
| 图既是项目图标又是面板背景 | 保留（`panel_json` 命中） | 保留 |
| 图被设为头像 | 保留（`head_image` 命中） | 保留 |
| 刚上传、还没用到任何地方 | 删项目不会涉及；**点按钮会删** | 同（按钮照删） |
| 图标是外链 `https://…` | 永不删（不是本站对象） | 同 |
| R2 删除失败 | 跳过该条、保留 `file` 行、日志告警 | — |

**两个必须知道的边界**

1. **引用检查的盲区**：`system_setting.custom_css` / `custom_js`（你自己的自定义 CSS/JS 里引用的图片）**不在**检查范围内。
   如果你用自定义代码引用了 `uploads/...` 图片，建议**把开关关掉**；若需要，我可以把这两项也纳入检查。
2. **卡片上的单个删除按钮不做引用检查**：文件管理列表里每张卡片右上角的删除（`POST /file/deletes`）是「你说删就删」，
   既不检查引用也不受开关影响 —— 删掉正在被项目使用的图会让那个项目变破图。批量清理请用「清理未引用文件」。

## 4. 本地开发状态（`.wrangler/state/v3/`，已 gitignore）

```
.wrangler/state/v3/
├── d1/miniflare-D1DatabaseObject/
│   ├── <hash>.sqlite          每个本地 D1 库 = 一个真实 SQLite 文件
│   ├── <hash>.sqlite-wal      预写日志（已提交但未 checkpoint 的事务）
│   ├── <hash>.sqlite-shm      WAL 的共享内存索引（可安全删除，自动重建）
│   └── metadata.sqlite        miniflare 的簿记（绑定名 ↔ 库 id 映射），不是业务数据
├── r2/                        本地 R2 对象
├── cache/                     本地 Cache API 存储
├── observability/             本地 trace 等
└── kv/                        旧限流实现的残留（已不再使用，可以删）
```

- **一个逻辑库对应三个文件**（`.sqlite` / `-wal` / `-shm`）是 SQLite WAL 模式的正常形态，不是三个库。
  备份时不要只拷 `.sqlite`；要干净快照就先停掉 `wrangler dev`（正常退出会 checkpoint）。
- 文件名里的 `<hash>` 由数据库标识推导：改过 `database_name`、以前填过 `database_id`、或 wrangler 版本变化，
  都可能生成一个新的 `<hash>.sqlite`，旧的会留在原地。判断哪个在用最直接的办法是看修改时间，
  或用 `wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table'"`。
- **重置本地数据**：停掉 `wrangler dev` → 删除 `.wrangler/state/v3/d1`（或整个 `state`）→ `npm run migrations:apply:local`。
  这只影响本地，与线上无关。

## 5. 结构变更约定（单文件基线）

- `migrations/` 现在只有一个 `0001_init.sql`，它描述「**此刻的最终结构**」，并且**只对全新库生效**。
- 已部署库为什么不会重跑：D1 的 `d1_migrations` 表只记录**文件名**（没有内容哈希），
  `0001_init.sql` 这个名字已被记录，所以内容改了也不会再执行。
- 因此对已部署库：
  - **新增表** → 可以在代码里做惰性建表兜底（`CREATE TABLE IF NOT EXISTS`，每个 isolate 一次），`login_attempt` 就是这么做的；
  - **改已有表**（加列/改约束/删表）→ 没有运行时兜底，需要写一次性 `docs/sql/<日期>_<用途>.sql` 并**在部署代码之前**执行。
- 请勿修改已被应用的迁移文件并期望它重新执行；也不要给合并后的文件改名（会被当成新迁移重跑，`ADD COLUMN` 会报重复列）。

## 6. 备份与恢复

见 [deployment.md 的「备份与恢复」](./deployment.md#备份与恢复)：D1 用 `wrangler d1 export`，
R2 用 `rclone sync`（或 `wrangler r2 object get`）。注意应用内的「导入导出」只覆盖图标与样式配置，**不含图片**。
