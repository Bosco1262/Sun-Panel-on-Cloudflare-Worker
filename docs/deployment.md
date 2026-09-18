# 部署与本地开发

> 本文承接根 [README](../README.md) 的「🚀 快速开始」章节，是部署与本地开发的完整说明。
> 目标形态：**单个 Cloudflare Worker 同时提供 API 与前端静态资源**。

## 技术栈

| 层 | 实现 |
|----|------|
| 后端 | Cloudflare Worker + Hono (TypeScript)，位于根目录 `src/` |
| 数据库 | Cloudflare D1 (SQLite) |
| 文件存储 | Cloudflare R2（头像、图片、文件上传） |
| 登录限流 | Cloudflare D1（同一 IP 10 分钟内最多失败 5 次，滑动窗口；单条 UPSERT 原子计数） |
| 前端 | `frontend/` 下的 Vue 3 前端，构建产物输出到根目录 `dist/`，由 Worker 静态资源托管 |
| 鉴权 | JWT（jose，无状态，72 小时有效期；`auth_epoch` 世代号支持改密/退出所有设备即刻吊销） |
| 密码存储 | 默认兼容上游的三重 MD5；配置 `PASSWORD_PEPPER` 后使用 PBKDF2-SHA256 + 随机盐 + pepper，旧哈希在登录成功后自动升级 |
| 默认账号 | `admin` / `12345678`（登录后可在「用户信息」中修改） |

## 仓库结构

```
├── src/                     # Worker 后端源码 (Hono)
│   ├── api/                 # 路由: panel/ 与 system/ 分层，与前端 src/api/ 一一对应
│   ├── middleware/          # JWT 鉴权中间件
│   └── utils/               # 响应格式 / 密码 / JWT / 文件 / 系统设置 / 站点图标
├── migrations/              # D1 数据库迁移
├── frontend/                # Vue 3 前端 (npm workspace)
├── dist/                    # 前端构建产物 (gitignored, 由 Worker 静态托管)
├── docs/                    # 项目文档 (部署、搜索引擎、迁移计划、待办、上游资料)
├── scratch/                 # 自检脚本 (搜索引擎工具函数 / userConfig 合并语义)
├── reference/               # 上游源码对照副本 (gitignored, 不参与构建)
├── wrangler.toml            # Worker 配置 (D1/R2/静态资源)
├── .dev.vars                # 本地开发环境变量 (gitignored, 模板见 .dev.vars.example)
├── package.json             # 根包: Worker 依赖 + 脚本 + frontend workspace
└── tsconfig.json            # Worker TypeScript 配置
```

## 前置要求

1. 注册 [Cloudflare](https://dash.cloudflare.com) 账号
2. 安装 [Node.js](https://nodejs.org) **22+** 和 [Wrangler](https://developers.cloudflare.com/workers/wrangler/)：
   ```bash
   npm install -g wrangler
   wrangler login
   ```

> 版本下限来自 wrangler 自身：仓库锁定 `wrangler ^4.45.0`，当前 4.x 要求 Node ≥ 22
> （安装后会提示 `Wrangler requires at least Node.js v22.0.0`；Node 18 已 EOL）。
> 走方式一（Workers Git 集成）时不需要本地 Node，Cloudflare 构建镜像默认使用 Node 24。

## 方式一: Workers Git 集成 (推荐, 自动创建资源 + 自动迁移)

无需手动创建 D1/R2，也无需本地安装 wrangler：

1. 进入 Cloudflare Dashboard → **Workers & Pages → Create → Import a repository**，
   选择本仓库（Worker 名称需与 `wrangler.toml` 中的 `name = "sun-panel"` 一致）
2. **Build command**: `npm run build`
   > 不要写成 `npm install && npm run build`：Workers Builds 在执行构建命令前会**自动安装依赖**
   > （官方文档中可用 `SKIP_DEPENDENCY_INSTALL` 关闭这一行为），再装一遍依赖会让构建白白多花几分钟
   > （实测 install 阶段约 8 分钟）。
3. **Deploy command**:
   ```bash
   npx wrangler deploy && npx wrangler d1 migrations apply sun-panel --remote
   ```
   - 先 `deploy` 后迁移：`wrangler.toml` 里没有 `database_id` 时，D1 是在部署阶段由自动资源供应
     创建的，迁移命令只能作用于已存在的库（顺序颠倒会报
     `Couldn't find an auto-provisioned D1 DB named 'sun-panel' for binding 'DB'. Run 'wrangler deploy' to provision it...`）
   - 部署时 wrangler (>= 4.45) 检测到配置中的 D1/R2 资源不存在会**自动创建**并绑定
     ([自动资源供应](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/), Open Beta)
   - `wrangler deploy` 用构建环境注入的 API token 就能完成；但 Workers Builds 自动创建的 token
     权限只有 Workers Scripts / R2 (edit) 等，**不含 D1**，远程迁移可能因此报鉴权错误。
     遇到时请在 Worker → **Settings → Build → API token** 换成（或新建）一个带 D1 编辑权限的 token
4. 首次部署成功后，设置一次 JWT 密钥（Secret 无法由构建创建）：
   `JWT_SECRET` 请用随机值（可用 `openssl rand -base64 48` 生成，长度 ≥32 字符；过短时 Worker 日志会打弱密钥告警）：
   Worker → Settings → Variables and Secrets → 添加 `JWT_SECRET`（或本地执行 `npx wrangler secret put JWT_SECRET`）

之后每次 `git push` 都会自动构建、部署并应用新增的 D1 迁移。

> **环境变量无需入库**：`frontend/.env` 已被 `.gitignore` 排除，构建脚本
> `frontend/add-frontend-version.js` 在发现 `.env` 不存在时会用 `frontend/.env.example`
> 自动生成一份并写入 `VITE_APP_VERSION`，因此 Workers Build 不会因缺少 `.env` 而失败。
> 生产运行时只用到 `VITE_GLOB_API_URL=/api`，`VITE_APP_API_BASE_URL` 仅供本地 dev proxy，
> 默认配置可直接用于线上部署；如需覆盖，请在构建环境中配置对应的环境变量。

## 方式二: 本地 wrangler 部署

### 创建云资源

> wrangler >= 4.45 支持自动资源供应：`wrangler.toml` 中未填写 id 时，`wrangler deploy` 会自动创建
> D1/R2 并关联到 Worker，下列手动创建步骤仅为兼容旧版本，可选。

```bash
# 1. 创建 D1 数据库
npx wrangler d1 create sun-panel

# 2. 创建 R2 存储桶
npx wrangler r2 bucket create sun-panel-files
```

手动创建后需自行把输出的 `database_id` 加到 `wrangler.toml` 的 `[[d1_databases]]`
（当前配置里这个字段是留空的）。
不手动创建也可以：部署阶段由自动资源供应完成创建，本地交互式 `wrangler deploy`
还会把生成的 id 写回配置文件（可保存或丢弃）；CI 环境不回写，但后续部署同样可用。

## 构建与部署

```bash
# 1. 安装依赖 (单次安装, 含 frontend workspace)
npm install

# 2. 构建前端 (输出到 dist/, 由 Worker 自动托管)
npm run build

# 3. 设置 JWT 密钥 (登录签名用, 必填; 建议 ≥32 字符随机值, 如 `openssl rand -base64 48`)
npx wrangler secret put JWT_SECRET

# 3b. (可选但强烈建议) 设置密码 pepper: 之后新密码用 PBKDF2 + 随机盐 + pepper 存储,
#     旧的三重 MD5 哈希仍可登录, 并在登录成功后自动升级。
#     ⚠️ 配了就不要再改/删: 换了之后旧哈希无法校验 (会返回明确的 1009 提示而不是「密码错误」),
#     请与 JWT_SECRET 一起备份。
npx wrangler secret put PASSWORD_PEPPER

# 3c. (可选) PBKDF2 迭代数, 默认 5000 (本机实测约 2.6ms CPU)。
#     免费版每请求 CPU 上限 10ms, 调太大会让登录报 1102; 升级到 Workers Paid 后可调到 210000。
# npx wrangler secret put PASSWORD_PBKDF2_ITERATIONS

# 4. 部署 (首次部署会按 wrangler.toml 创建并绑定 D1/R2)
npm run deploy

# 5. 应用数据库迁移 (远程 D1; 需 D1 已存在, 因此放在部署之后)
npm run migrations:apply
```

> **顺序不要颠倒**：未填 `database_id` 时 D1 由第一次 `wrangler deploy` 创建，
> 先执行 `npm run migrations:apply` 会因为找不到数据库而失败。
> 已按上一节手动创建过 D1 的话，先迁移再部署也可以。

部署完成后访问输出的 URL（如 `https://sun-panel.xxx.workers.dev`），
使用默认账号 `admin` / `12345678` 登录。

> 也可执行 `npm run deploy:all` 一步完成「构建前端 + 部署」（迁移仍需单独执行）。

## 本地开发与测试

```bash
# 1. 安装依赖 (单次安装, 含 frontend workspace)
npm install

# 2. 复制前端环境变量 (仅需一次; CI 构建时会自动由 .env.example 生成)
copy frontend\.env.example frontend\.env

# 3. 复制 Worker 本地环境变量 (仅需一次, 内容为 JWT_SECRET)
copy .dev.vars.example .dev.vars

# 4. 应用本地数据库迁移 (首次)
npm run migrations:apply:local

# 终端 1: Worker + 本地 D1/R2 模拟 (http://127.0.0.1:8787)
npm run dev

# 终端 2: 前端开发 (热更新, http://127.0.0.1:1002)
npm run dev:web
```

## 代码检查

```bash
npm run check   # 完整检查: Worker typecheck + 前端 typecheck + 前端 lint
npm run build   # 构建前端 (输出到 dist/)
```

> 说明: 前端开发服务器的 `/api` 与 `/uploads` 请求已通过 Vite 代理转发到 Worker
> (`frontend/.env` 中 `VITE_APP_API_BASE_URL=http://127.0.0.1:8787/`)。
> 若只想测试 Worker + 构建产物，可先执行 `npm run build`，然后直接访问 `http://127.0.0.1:8787`。
> 本地开发密钥在 `.dev.vars` 中 (`JWT_SECRET`)，生产环境请使用 `npx wrangler secret put JWT_SECRET`。

## 备份与恢复

数据分两处：**D1**（全部业务数据）与 **R2**（上传的图片/文件 + 站点图标）。
应用内的「导入导出」只覆盖图标与样式配置，**不含图片**，所以自托管场景建议按下面的方式各备一份。

### D1（业务数据）

```bash
# 导出为 SQL（默认输出到当前目录，文件名形如 sun-panel-<时间>.sql）
npx wrangler d1 export sun-panel --remote --output=backup/$(date +%Y%m%d)-sun-panel.sql

# 只导数据（不含建表语句）: 目标库已有结构时用这个
npx wrangler d1 export sun-panel --remote --no-schema --output=backup/data.sql
```

恢复：对一个空库执行导出的 SQL 即可（`npx wrangler d1 execute sun-panel --remote --file=backup/xxx.sql`），
恢复后记得按 [storage.md §5](./storage.md#5-结构变更约定单文件基线) 的约定确认结构与当前代码匹配。

> D1 的 Time Travel 也能救急：控制台或 `npx wrangler d1 time-travel info sun-panel` 查看可回滚的时间点
> （默认保留 30 天，付费版 30 天 / 免费版 7 天，以官方文档为准）。

### R2（图片与文件）

R2 没有「导出成单文件」的命令，两种做法：

```bash
# 方案 A: rclone（推荐，支持增量同步）—— 先用 rclone config 配好 S3 兼容端点
rclone sync r2:sun-panel-files ./backup/r2 --progress

# 方案 B: 逐个对象下载（对象不多时够用）
npx wrangler r2 object get sun-panel-files/<key> --file=./backup/r2/<key>
```

对象 key 的两种形态见 [storage.md §3](./storage.md#3-r2-对象布局与回收)；
恢复时把对象按相同 key 传回桶里即可（`rclone sync ./backup/r2 r2:sun-panel-files`）。

> 注意：`file` 表里记录的是 `./uploads/<key>`，所以「D1 + R2」要一起备份/恢复，只恢复一边会出现列表有记录但图片 404，或图片在但列表看不到。

### Secret

`JWT_SECRET` 与 `PASSWORD_PEPPER`（如果配了）无法从 Cloudflare 读回，请自行在密码管理器里留存：
- 丢了 `JWT_SECRET` → 所有人需重新登录；
- 丢了 `PASSWORD_PEPPER` → 新版密码哈希无法校验（登录会返回明确的 1009 提示），需要重置密码。

## 常见问题

**构建失败：`Error: ENOENT: no such file or directory, open '.env'`**

```
> sun-panel-frontend@1.3.0 add-version
> node ./add-frontend-version.js
Error: ENOENT: no such file or directory, open '.env'
```

原因：构建脚本 `frontend/add-frontend-version.js` 需要读写 `frontend/.env`，但 `.env` 被
`.gitignore` 排除，CI 克隆下来的仓库里只有 `.env.example`，脚本直接 `readFileSync` 即崩溃，
`run-p` 会连带中断 `type-check` 与 `vite build`。

解决：当前代码已修复——脚本检测到 `.env` 缺失时会先用 `frontend/.env.example` 生成一份，
再写入 `VITE_APP_VERSION`；同时 `build` 脚本改为先串行执行 `add-version`，避免 vite 读到
尚未更新版本号的 `.env`。升级到最新代码即可。

**构建耗时过长（install 阶段出现两次、共十余分钟）**

Workers Builds 在执行构建命令前会自动安装依赖，Build command 再写一次
`npm install` 会重复装依赖。把 Build command 从 `npm install && npm run build` 改为
`npm run build` 即可。

**本地/首次部署时 `npm run migrations:apply` 报找不到数据库**

```
Couldn't find an auto-provisioned D1 DB named 'sun-panel' for binding 'DB'.
Run 'wrangler deploy' to provision it, or add 'database_name' / 'database_id' to your config.
```

原因：未填 `database_id` 时 D1 由 `wrangler deploy` 创建，迁移命令只作用于已存在的库。
先执行 `npm run deploy`，再执行 `npm run migrations:apply`。

**Workers Builds 的 Deploy command 在迁移步骤报鉴权错误**

自动创建的构建 token 不含 D1 权限。在 Worker → **Settings → Build → API token**
换成带 D1 编辑权限的 token 后重新构建。

## 与上游 (Sun-Panel v1.3.0) 的差异

| 功能 | 说明 |
|------|------|
| 单用户 | 无多用户/注册/公开访客模式，账号信息存于 D1 `system_setting` |
| 系统监控 | 已移除（Worker 无法读取宿主机信息） |
| 图形验证码/邮件 | 已移除（仅密码登录） |
| 文件存储 | 本地磁盘 → R2（路径 `/uploads/*` 由 Worker 代理） |
| 站点图标 | 抓取后下载存至 R2（与手动上传的图标统一存放于 R2） |
| 鉴权 | 内存 Token → JWT (无状态, 72 小时有效期 + `auth_epoch` 世代可吊销) |
| 登录保护 | 验证码/邮件 → D1 级失败限流 (同一 IP 10 分钟内最多失败 5 次) |
| 密码存储 | 三重 MD5 → 可选 PBKDF2-SHA256 + 随机盐 + pepper（配了 `PASSWORD_PEPPER` 才启用，登录时自动升级旧哈希） |
| 文件校验 | 上传扩展名白名单；站点图标校验 Content-Type 必须是图片；`/uploads/*` 带 `nosniff`、非图片强制下载、SVG 加 `sandbox` CSP |

> 「v1.3.0」指本移植版所基于的上游**最后一个开源代码版本**：上游自 v1.4.0 起转为闭源发布
> （最新发布版本 v1.8.1，2025-12-31），其 README 至今仍写明「目前开源最新版本为 v1.3.0」。
> 上游完整更新日志见 <https://doc.sun-panel.top/zh_cn/update/update_log.html>。

> 前端构建产物统一输出到根目录 `dist/`，由 Worker 静态资源托管；`frontend/` 仅存放源码。
