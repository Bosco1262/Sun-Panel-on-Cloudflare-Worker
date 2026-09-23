---
title: 部署与本地开发
status: current
audience: deployer
last_verified: 2026-09-23
---

# 部署与本地开发

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

> 本文承接根 [README.zh-CN.md](../README.zh-CN.md)（英文版 `README.md`）的「🚀 快速开始」章节，是部署与本地开发的完整说明。
> 目标形态：**单个 Cloudflare Worker 同时提供 API 与前端静态资源**。

## 技术栈

技术栈与「与上游的差异」集中在根 [README 的技术栈表](../README.zh-CN.md#️-技术栈)（单一事实来源，避免两处重复维护）。
部署时需要知道的只有一件事：**默认账号 `admin` / `12345678`**（首次登录后请立即在「用户信息」里修改）。

## 仓库结构

```
├── src/                     # Worker 后端源码 (Hono)
│   ├── api/                 # 路由: panel/ 与 system/ 分层，与前端 src/api/ 一一对应
│   ├── middleware/          # JWT 鉴权中间件
│   └── utils/               # 响应格式 / 密码 / JWT / 文件 / 系统设置 / 站点图标
├── migrations/              # D1 数据库迁移
├── frontend/                # Vue 3 前端 (npm workspace)
├── dist/                    # 前端构建产物 (gitignored, 由 Worker 静态托管)
├── docs/                    # 项目文档 (索引见 docs/README.md; history/ 为历史存档, upstream/ 为上游资料)
├── scratch/                 # 自检脚本 (14 个: 密码/限流/上传/图标/过滤/引擎/Cookie/i18n 等, 见 improvement-plan 附录 C)
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
   选择本仓库（Worker 名称需与 `wrangler.toml` 中的 `name = "sun-panel-on-cloudflare-worker"` 一致）
2. **Build command**: `npm run build`
   > 不要写成 `npm install && npm run build`：Workers Builds 在执行构建命令前会**自动安装依赖**
   > （官方文档中可用 `SKIP_DEPENDENCY_INSTALL` 关闭这一行为），再装一遍依赖会让构建白白多花几分钟
   > （实测 install 阶段约 8 分钟）。
3. **Deploy command**:
   ```bash
   npx wrangler deploy && npx wrangler d1 migrations apply sun-panel-on-cloudflare-worker-db --remote
   ```
   - 先 `deploy` 后迁移：`wrangler.toml` 里没有 `database_id` 时，D1 是在部署阶段由自动资源供应
     创建的，迁移命令只能作用于已存在的库（顺序颠倒会报
     `Couldn't find an auto-provisioned D1 DB named 'sun-panel-on-cloudflare-worker-db' for binding 'DB'. Run 'wrangler deploy' to provision it...`）
   - 部署时 wrangler (>= 4.45) 检测到配置中的 D1/R2 资源不存在会**自动创建**并绑定
     ([自动资源供应](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/), Open Beta)
   - `wrangler deploy` 用构建环境注入的 API token 就能完成；但 Workers Builds 自动创建的 token
     权限只有 Workers Scripts / R2 (edit) 等，**不含 D1**，远程迁移可能因此报鉴权错误。
     遇到时请在 Worker → **Settings → Build → API token** 换成（或新建）一个带 D1 编辑权限的 token
4. 首次部署成功后，设置一次 JWT 密钥（Secret 无法由构建创建）：
   `JWT_SECRET` 请用随机值（可用 `openssl rand -base64 48` 生成，长度 ≥32 字符；过短时 Worker 日志会打弱密钥告警）：
   Worker → Settings → Variables and Secrets → 添加 `JWT_SECRET`（或本地执行 `npx wrangler secret put JWT_SECRET`）
5. （可选但强烈建议）再设置 `PASSWORD_PEPPER`（密码哈希 pepper）：配好后新密码以 PBKDF2 + 随机盐 + pepper 存储，
   旧的三重 MD5 哈希在下次成功登录时自动升级。配置方式、生效条件，以及「配了就不能改/删」的原因见
   [Worker Secret](#worker-secret密钥与变量) 一节。

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
npx wrangler d1 create sun-panel-on-cloudflare-worker-db

# 2. 创建 R2 存储桶
npx wrangler r2 bucket create sun-panel-on-cloudflare-worker-files
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

部署完成后访问输出的 URL（如 `https://sun-panel-on-cloudflare-worker.xxx.workers.dev`），
使用默认账号 `admin` / `12345678` 登录。

> 也可执行 `npm run deploy:all` 一步完成「构建前端 + 部署」（迁移仍需单独执行）。

## Worker Secret（密钥与变量）

Worker 从环境变量读取三项配置（类型定义见 `src/types.ts` 的 `Env`），资源与数据的完整清单见
[storage.zh-CN.md §1](./storage.zh-CN.md#1-cloudflare-侧资源)：

| 名称 | 建议类型 | 必要性 | 作用 |
|------|----------|--------|------|
| `JWT_SECRET` | **Secret** | 必填 | 登录 token 的签名密钥（HS256）。缺失或全空白时登录/鉴权一律 fail-closed 返回 503 |
| `PASSWORD_PEPPER` | **Secret** | 可选，强烈建议 | 密码哈希 pepper（PBKDF2 密钥材料的一半），见下一小节 |
| `PASSWORD_PBKDF2_ITERATIONS` | 变量即可 | 可选 | PBKDF2 迭代数，默认 5000，取值夹在 1000–1000000 |

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put PASSWORD_PEPPER
```

也可以走 Dashboard → Worker → **Settings → Variables and Secrets**（类型选 Secret）。
`PASSWORD_PBKDF2_ITERATIONS` 只是迭代数、不含秘密，写成普通变量（`wrangler.toml` 的 `[vars]` 或 Dashboard 的 Text）也可以。

> Secret 无法由构建创建：首次部署后必须手工设置一次。此后 `git push` 触发的自动部署会沿用已存在的 Secret，
> 不会覆盖或清空它们。

### PASSWORD_PEPPER：密码哈希 pepper

**它解决什么**：只拿到 D1 数据库（或备份导出）的人，无法离线爆破管理员密码。

- **未配置时**：密码以**无盐三重 MD5**（`md5(md5(md5(pwd)))`，与上游 Sun-Panel 兼容）存储。
  这类哈希有公开彩虹表（`12345678` 直接命中），即使不查表，8 位数字口令在 GPU 上也是秒级穷尽。
- **配置后**：新密码以 PBKDF2-SHA256 + 随机盐 + pepper 存储，即
  `hash = PBKDF2-SHA256(pepper ‖ 密码, salt, iterations)`，哈希串自描述为
  `pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>$<pepperId>`（实现见 `src/utils/password.ts`）。
  攻击者必须同时拿到数据库**和** pepper（只存在于 Worker 环境变量）才能验证任何一个候选口令。

**⚠️ 配了就必须原样保留**：pepper 被换掉后所有 `pbkdf2$…` 哈希都无法校验，登录返回明确的 `1009` 提示
（而不是「密码错误」）——哈希串末尾的 `pepperId`（`sha256(pepper)` 的前 8 位）就是用来识别这种情况的。
请与 `JWT_SECRET` 一起存进密码管理器。反向也一样：配置之后**不要删**，否则改密会退回写入三重 MD5
（只打一条 `console.warn`），安全性一起退回。

**生效条件是「登录一次或改一次密码」**：只设置 secret 不会改写已有哈希——只要库里还是旧格式
（`^[0-9a-f]{32}$`），`checkPassword()` 会直接走三重 MD5 分支，pepper 完全不参与。所以要让它真正生效：

- 用现有密码**成功登录一次**：命中 `needsRehash()`，登录成功后立刻就地重写为 `pbkdf2$…`（`src/api/login.ts`）；
- 或在「用户信息」里**改一次密码**：直接写入 v2 哈希（`src/api/system/user.ts`）。

验证是否已生效：

```bash
npx wrangler d1 execute sun-panel-on-cloudflare-worker-db --remote \
  --command "SELECT substr(config_value, 1, 45) FROM system_setting WHERE config_name = 'admin_password'"
```

输出以 `pbkdf2$sha256$` 开头 = 已生效；仍是 `579646aad11fae4dd295812fb4526245`（`12345678` 的三重 MD5、
迁移种子值）= 还没重算过。

**pepper 丢失、或需要重置密码时**：把 `admin_password` 写回旧格式，再用 `12345678` 登录一次，让系统用
*当前* pepper 重算，随后立即改成自己的密码：

```bash
npx wrangler d1 execute sun-panel-on-cloudflare-worker-db --remote \
  --command "UPDATE system_setting SET config_value = '579646aad11fae4dd295812fb4526245' WHERE config_name = 'admin_password'"
```

> 这条兜底路径之所以成立，是因为旧格式哈希不需要 pepper 就能校验；但它只在**服务端已配置 pepper** 时
> 才会把哈希升级成 v2，所以要先把 pepper 设好。

### PASSWORD_PBKDF2_ITERATIONS：PBKDF2 迭代数

- 默认 **5000**。本机 WebCrypto 实测：5k ≈ 2.6 ms、10k ≈ 4.5 ms、100k ≈ 43 ms、210k ≈ 85 ms CPU。
- **免费层的硬约束是每请求 10 ms CPU**，超限直接 Error 1102（登录失败，见
  [storage.zh-CN.md §7](./storage.zh-CN.md)）。默认值留了约 3~4 倍余量；
  免费层不要调到十万级，想调 210000 需要先升级 Workers Paid（CPU 上限 30 s/请求）。
- 取值会被 `resolveIterations()` 夹到 `[1000, 1000000]`，非法或越界时回落默认 5000。
- **可以随时调整**：迭代数写进了哈希串，调高后旧哈希仍能校验，并在下次登录成功时自动重算为新值
  （与 pepper 的「配了就锁死」正相反）。
- 它**只有在 pepper 已配置时才有意义**：未配置 pepper 时不会生成 v2 哈希，迭代数也就无从生效。

## 本地开发与测试

```bash
# 1. 安装依赖 (单次安装, 含 frontend workspace)
npm install

# 2. 复制前端环境变量 (仅需一次; CI 构建时会自动由 .env.example 生成)
copy frontend\.env.example frontend\.env

# 3. 复制 Worker 本地环境变量 (仅需一次; 模板里 JWT_SECRET 已给值,
#    PASSWORD_PEPPER / PASSWORD_PBKDF2_ITERATIONS 以注释形式给出)
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
> 本地开发密钥在 `.dev.vars` 中 (`JWT_SECRET`，可选 `PASSWORD_PEPPER` / `PASSWORD_PBKDF2_ITERATIONS`)，
> 生产环境请使用 `npx wrangler secret put <名称>`（说明见 [Worker Secret](#worker-secret密钥与变量)）。
> 未配置 pepper 时本地与线上一样走兼容的三重 MD5 路径，只有需要验证 PBKDF2 行为时才要补上；
> 本地 D1 与线上是两套独立数据，**不需要**与生产用同一个 pepper。

## 备份与恢复

数据分两处：**D1**（全部业务数据）与 **R2**（上传的图片/文件 + 站点图标）。
应用内的「导入导出」只覆盖图标与样式配置，**不含图片**，所以自托管场景建议按下面的方式各备一份。

### D1（业务数据）

```bash
# 导出为 SQL（默认输出到当前目录，文件名形如 <库名>-<时间>.sql）
npx wrangler d1 export sun-panel-on-cloudflare-worker-db --remote --output=backup/$(date +%Y%m%d)-db.sql

# 只导数据（不含建表语句）: 目标库已有结构时用这个
npx wrangler d1 export sun-panel-on-cloudflare-worker-db --remote --no-schema --output=backup/data.sql
```

恢复：对一个空库执行导出的 SQL 即可（`npx wrangler d1 execute sun-panel-on-cloudflare-worker-db --remote --file=backup/xxx.sql`），
恢复后记得按 [storage.zh-CN.md §5](./storage.zh-CN.md#5-结构变更约定单文件基线) 的约定确认结构与当前代码匹配。

> D1 的 Time Travel 也能救急：控制台或 `npx wrangler d1 time-travel info sun-panel-on-cloudflare-worker-db` 查看可回滚的时间点
> （默认保留 30 天，付费版 30 天 / 免费版 7 天，以官方文档为准）。

### R2（图片与文件）

R2 没有「导出成单文件」的命令，两种做法：

```bash
# 方案 A: rclone（推荐，支持增量同步）—— 先用 rclone config 配好 S3 兼容端点
rclone sync r2:sun-panel-on-cloudflare-worker-files ./backup/r2 --progress

# 方案 B: 逐个对象下载（对象不多时够用）
npx wrangler r2 object get sun-panel-on-cloudflare-worker-files/<key> --file=./backup/r2/<key>
```

对象 key 的两种形态见 [storage.zh-CN.md §3](./storage.zh-CN.md#3-r2-对象布局与回收)；
恢复时把对象按相同 key 传回桶里即可（`rclone sync ./backup/r2 r2:sun-panel-on-cloudflare-worker-files`）。

> 注意：`file` 表里记录的是 `./uploads/<key>`，所以「D1 + R2」要一起备份/恢复，只恢复一边会出现列表有记录但图片 404，或图片在但列表看不到。

### Secret

`JWT_SECRET` 与 `PASSWORD_PEPPER`（如果配了）无法从 Cloudflare 读回，请自行在密码管理器里留存：
- 丢了 `JWT_SECRET` → 所有人需重新登录；
- 丢了 `PASSWORD_PEPPER` → 新版密码哈希无法校验（登录会返回明确的 1009 提示），需要重置密码。

`PASSWORD_PBKDF2_ITERATIONS` **不需要备份**：它不含秘密，随时可改，调高后旧哈希仍会校验并在下次登录自动重算。

另外，**D1 备份与 `PASSWORD_PEPPER` 必须成对保存**：从备份恢复出来的库是 `pbkdf2$…` 格式，少了 pepper
就会出现「密码明明是对的却登录不了（1009）」。详见 [Worker Secret](#worker-secret密钥与变量)。

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
Couldn't find an auto-provisioned D1 DB named 'sun-panel-on-cloudflare-worker-db' for binding 'DB'.
Run 'wrangler deploy' to provision it, or add 'database_name' / 'database_id' to your config.
```

原因：未填 `database_id` 时 D1 由 `wrangler deploy` 创建，迁移命令只作用于已存在的库。
先执行 `npm run deploy`，再执行 `npm run migrations:apply`。

**Workers Builds 的 Deploy command 在迁移步骤报鉴权错误**

自动创建的构建 token 不含 D1 权限。在 Worker → **Settings → Build → API token**
换成带 D1 编辑权限的 token 后重新构建。

**登录返回 1009：`PASSWORD_PEPPER` 未配置 / 与现有哈希不匹配**

```
服务端未配置 PASSWORD_PEPPER，无法校验当前密码哈希，请执行 wrangler secret put PASSWORD_PEPPER 后重试
PASSWORD_PEPPER 与当前密码哈希不匹配，请恢复原有 secret 后重试
```

原因：`system_setting.admin_password` 里存的是 `pbkdf2$sha256$…` 格式，但 Worker 没有配置 pepper，
或配置的 pepper 与哈希串末尾记录的 `pepperId` 不一致（pepper 被换过/删过）。这两种情况服务端都会
fail-closed 并明确报错，而不是伪装成「密码错误」。

解决：把 pepper 恢复成配置时的那一个（`npx wrangler secret put PASSWORD_PEPPER`）。确实找不回来时按
[Worker Secret](#worker-secret密钥与变量) 里的重置步骤操作（写回旧格式哈希 → 用 `12345678` 登录 →
系统用当前 pepper 重算 → 立刻改密）。

## 与上游的差异

见根 [README 的「与上游 (Sun-Panel v1.3.0) 的差异」表与「已知限制」](../README.zh-CN.md#-与上游-sun-panel-v130-的差异)（含 v1.3.0 的版本口径说明）。

> 前端构建产物统一输出到根目录 `dist/`，由 Worker 静态资源托管；`frontend/` 仅存放源码。

> 数据存在哪、能不能删、免费层额度够不够 —— 见 [storage.zh-CN.md](./storage.zh-CN.md)（含 2026-09-21 的实测用量）。
