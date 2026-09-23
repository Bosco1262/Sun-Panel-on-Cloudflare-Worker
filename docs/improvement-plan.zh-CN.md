---
title: 改进计划
status: current
audience: developer
last_verified: 2026-09-23
---

# 改进计划（待办 · 已结项记录 · 自检）

[English](improvement-plan.md) | [简体中文](improvement-plan.zh-CN.md)

> 本文件是当前仓库**改动计划的唯一来源**，落地后回填状态列。
> 历史设计（Go → Worker 迁移期）见 [history/migration/plan.zh-CN.md](./history/migration/plan.zh-CN.md)，早期需求清单见 [history/requirements/early-todo.zh-CN.md](./history/requirements/early-todo.zh-CN.md)（归档判定标准见 [history/README.zh-CN.md](./history/README.zh-CN.md)）。
>
> **怎么读**：
> - 想找**还没做的事** → §9「后续候选」（9.10~9.12 待明确需求）与 §10.3「仍待处理」；
> - 想找**本轮修了什么** → §10.1 / §10.2 与 §10.5；
> - 想找**当时的验证证据** → §1~§8 各节的「落地结果」与附录 C 的自检脚本清单。
>
> **当前状态**：§2 ~ §6 全部结项（§2.5 按决策 D5 取消、§5.3 按决策不做）；§9 中 9.0 ~ 9.5、9.8、9.9 已完成，9.6 待确认（运维侧可选）、9.7 待执行、9.10 ~ 9.13 待明确需求 / 待决策。
> 收尾验证：**14 个自检脚本全过**、`npm run check`（tsc + vue-tsc + eslint）**0 error / 0 warning**、i18n 审计缺失 0 / 中英不齐 0 / 死文案 0、`vite build` 重建 `dist/` 成功。

**状态图例**：`已完成` / `待执行` / `进行中` / `待确认`

---

## 0. 决策记录（本轮确认）

| # | 决策 | 直接后果 |
|---|------|----------|
| **D1** | `migrations/` 合并为单个 `0001_init.sql` | 目录只剩一个文件；**代价**：已部署库的结构变化必须走一次性升级脚本（见 2.2） |
| **D2** | 登录限流由 KV 改为 D1（单语句原子 UPSERT） | 消除「读-改-写丢计数」与 KV 读滞后导致的限流绕过 |
| **D3** | KV 不再被使用 → 删除 KV 绑定、类型、代码与文档 | `wrangler.toml` 少一个绑定；云端自动创建的 namespace 变为可清理的孤儿 |
| **D4** | 「搜索栏搜索项目」过滤缺陷采用方案 A 修复 | 已完成，见 §7 |
| **D5** | **跳过老库一次性升级脚本**：已部署库所需的 `login_attempt` 表由代码里的**惰性建表兜底**创建（每个 isolate 生命周期执行一次 `CREATE TABLE IF NOT EXISTS`） | `docs/sql/` 目录不再需要；旧库与新库都无需手工 SQL，见 §2.3 |
| **D6** | **密码 pepper 可选、不设即不升级**；PBKDF2 迭代数默认 5000（实测 ≈2.6ms，免费版 CPU 上限 10ms），可用 `PASSWORD_PBKDF2_ITERATIONS` 覆盖 | 设置 `PASSWORD_PEPPER` 之前系统行为与旧版一致，不会把自己锁死；设置后登录自动升级哈希，见 §3.2 |
| **D7** | **不做 Worker 侧边缘缓存**（`caches.default`），只保留浏览器缓存头：日期哈希 key 用 `immutable`，站点图标用普通 `max-age` | 实测发现边缘缓存会让「已删除的图片」继续命中最长 24 小时；需要边缘缓存的话改为在 Cloudflare 配 Cache Rule，并接受同样的删除延迟，见 §4.3 |
| **D8** | **新增「删除项目/分组时自动回收未引用图片」开关，默认开**（`system_setting.storage_auto_clean_unused`，上传文件管理页切换） | 想保留图片以便日后复用的用户可以关掉自动回收：删除只软删 D1、不动 R2，需要时手动点「清理未引用文件」。读取设置失败按「关」处理（偏保守），见 §9.0 |

> D8 是计划结项后按用户需求追加的一项（原计划未包含），已实现并验证，详见 §9.0。

> D2 与 D3 是同一件事的两半：限流迁走之后 KV 在本项目里再无用途（已全仓库确认 `LOGIN_RATE` 只出现在 `src/api/login.ts` 与 `src/types.ts`），因此一并移除。

---

## 1. 阶段总览

> 编号 = 章节号（阶段一在 §2、阶段二在 §3、阶段三在 §4、阶段四在 §5、阶段五在 §6）。

| 阶段 | 项目 | 目标 | 量级 | 依赖 | 状态 |
|------|------|------|------|------|------|
| 一 | **2.1** migrations 合并为单文件 | 目录整洁 + 新库一次建全 | S | 前置校验（§2.1.2） | 已完成 |
| 一 | **2.3** 登录限流迁 D1 | 原子计数、行为不变 | M | §2.1 | 已完成 |
| 一 | **2.4** 移除 KV | 去掉无用绑定与文档描述 | S | §2.3 | 已完成 |
| 二 | **3.1** 上传/抓取校验 | 堵住「非图片入库 + 同源返回」 | S | — | 已完成 |
| 二 | **3.2** 密码哈希升级 | 加盐 + pepper，登录时自动重哈希 | M | 需新增 secret | 已完成 |
| 二 | **3.3** JWT 可吊销 | 改密即全端下线 + 缩短有效期 | M | §3.2 | 已完成 |
| 三 | **4.1** R2 ↔ `file` 一致性 | 消除孤儿对象、重复 favicon | M | — | 已完成 |
| 三 | **4.2** 首页 getListWithItems | 去掉 N+1 请求 | M | — | 已完成 |
| 三 | **4.3** `/uploads/*` 缓存 | 减少 R2 穿透 | S | — | 已完成（决策 D7：仅浏览器缓存） |
| 四 | **5.1** 死存储清理 | 删 `module_config` / `notice` | M | §2.1（新库不建表） | 已完成 |
| 四 | **5.2** `ASSETS` 绑定 | 删掉未使用的 binding 声明 | S | — | 已完成 |
| 四 | **5.3** `user_config` 乐观锁 | 防多标签互相覆盖 | S | — | 已决定不做（改为文档提示） |
| 五 | **6.1** 备份章节 | D1 + R2 备份/恢复文档 | S | — | 已完成 |
| 五 | **6.2** 存储说明文档 | 表/绑定/本地 WAL 三件套说明 | S | §2.1 | 已完成 |
| 五 | **6.3** 重建 `dist/` | 让前端改动生效 | S | §7 | 已完成 |

---

## 2. 阶段一：数据层整理

### 2.1 `migrations/` 合并为单个 `0001_init.sql` ✅ 已完成

#### 2.1.1 为什么必须「保留同名」

D1 的记账表只记**文件名**，没有内容哈希（本地库实测）：

```sql
CREATE TABLE "d1_migrations"(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
```

`wrangler d1 migrations apply` 的判定逻辑是「本地存在的文件名 − 已记录的名字」= 待应用。因此：

| 做法 | 已部署库 | 全新库 | 结论 |
|------|----------|--------|------|
| 内容并进**仍叫 `0001_init.sql`** 的文件，删除 0002/0003 | 名字已记录 → 跳过，零影响 | 一次建全 | ✅ 采用 |
| 合并后改名（如 `0001_init_full.sql`） | 视为新迁移 → `ALTER TABLE ADD COLUMN` 报 duplicate column → **部署失败** | 可行 | ❌ |
| 保留 0002/0003 同时把列写进 0001 | 三个都跳过 | 0001 建列后又跑 0002 → duplicate column | ❌ |

#### 2.1.2 前置校验（必须先做）

```bash
# 远端必须已记录三个迁移名，否则不能删 0002/0003
npx wrangler d1 migrations list DB --remote
# 期望输出包含：0001_init.sql / 0002_item_icon_group_style.sql / 0003_item_only_name.sql
```

若某个环境只应用过 0001（例如很久没部署过的实例），**先在该环境执行 `wrangler d1 migrations apply DB --remote` 把 0002/0003 补上再合并**，否则它的表会缺 `card_style` / `text_color` / `hide_description` / `only_name`，运行时报错。

#### 2.1.3 合并内容

- **折叠列定义**：`card_style` / `text_color` / `hide_description` 直接写进 `item_icon_group` 的 `CREATE TABLE`，`only_name` 写进 `item_icon`，不再保留 ALTER（新库一次建好，语义更清楚）。
- 保留原有的两个索引与种子数据（`INSERT OR IGNORE`）。
- 本轮新增 `login_attempt` 表（见 2.3）直接进 0001。
- 文件头保留**合并历史注释**，说明「本文件由 0001 + 0002 + 0003 合并而来，0002/0003 的内容已折叠进建表语句」，避免后人以为历史被抹掉。
- 结构清单见 [附录 A](#附录-a0001_initsql-结构)。

#### 2.1.4 执行步骤

1. 完成 2.1.2 的远端校验；
2. 重写 `migrations/0001_init.sql`（内容 = 附录 A）；
3. 删除 `migrations/0002_item_icon_group_style.sql`、`migrations/0003_item_only_name.sql`；
4. **本地验证（新库路径）**：把本地 D1 状态目录挪走 → `npm run migrations:apply:local` → 断言 8 张业务表与全部列存在（命令见 [附录 C](#附录-c自检脚本与命令)）；
5. **本地验证（老库路径）**：把状态目录挪回来 → 再跑一次 `npm run migrations:apply:local` → 期望输出「No migrations to apply」，且无报错；
6. 提交；CI 的 `wrangler d1 migrations apply --remote` 对已部署库将是空操作（见 2.2 的约定）。

#### 2.1.5 回滚

纯文件改动：`git revert` 即可，**数据库无需回滚**（老库压根没执行新内容）。

#### 2.1.6 落地结果（本轮实测）

| 验证 | 命令 | 结果 |
|------|------|------|
| 新库一次建全 | `wrangler d1 migrations apply DB --local --persist-to scratch/.tmp-d1-fresh` | `0001_init.sql ✅`，**14 commands executed successfully**；8 张业务表 + `only_name`/`card_style`/`text_color`/`hide_description` + `login_attempt` 索引 + 种子数据全部就位 |
| 老库 no-op | `wrangler d1 migrations apply DB --local`（现有状态） | `✅ No migrations to apply!`，**未因 0002/0003 文件被删除而报错** |

产物：`migrations/` 现在只有 `0001_init.sql`（5.5 KB），另两个文件已删除；`wrangler.toml` 的 `migrations_dir` 不变。

### 2.2 单文件策略下的长期约定（重要）

> **规则**：`0001_init.sql` 永远描述「此刻的最终结构」，只对**全新库**生效；**已部署库**因为 `0001_init.sql` 这个名字已被记录，结构变化需另行处理：
>
> | 变化类型 | 已部署库怎么办 |
> |----------|----------------|
> | **新增表** | 可在代码里做**惰性建表兜底**（`CREATE TABLE IF NOT EXISTS`，每个 isolate 一次），无需手工 SQL —— 本轮 `login_attempt` 即采用此法（决策 D5） |
> | **改已有表**（加列/改约束/删表） | 没有运行时兜底，必须写 `docs/sql/<日期>_<用途>.sql` 一次性脚本，并在**部署代码之前**执行 |

推论（请接受这个代价，否则应回到 append-only）：

- CI 里的 `wrangler d1 migrations apply` 从此基本是空操作，真正的结构升级靠「惰性建表」或 `docs/sql/` 脚本；
- 一次性脚本一律写成幂等形式（`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`），允许重复执行；
- 建议**每次大版本「重基线」**：把历史变化折进 `0001_init.sql`，已执行脚本移入 `docs/sql/archive/`，避免 0001 与脚本账本长期分叉。

### 2.3 登录限流迁到 D1（原 0-2）✅ 已完成

**行为保持**：同一 IP **10 分钟内失败 5 次**即锁定，滑动窗口（自最后一次失败起算），错误码保持 `1003`（凭据错）/ `1008`（已锁定），前端无需改动。

**表结构**（进 `0001_init.sql`）

```sql
CREATE TABLE IF NOT EXISTS login_attempt (
  ip           TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0   -- Unix 秒: 最近一次失败时间
);
CREATE INDEX IF NOT EXISTS idx_login_attempt_window ON login_attempt (window_start);
```

**三条语句**（完整写法见 [附录 B](#附录-b登录限流-sql)）

| 时机 | 语句 | 说明 |
|------|------|------|
| 请求开始（校验前） | `SELECT fail_count, window_start FROM login_attempt WHERE ip = ?` | 命中「窗口未过期且 `fail_count >= 5`」→ 直接 `1008` |
| 凭据错误 | 单条 `INSERT … ON CONFLICT(ip) DO UPDATE SET fail_count = CASE WHEN login_attempt.window_start < ? THEN 1 ELSE login_attempt.fail_count + 1 END, window_start = ?` | **原子**，并发不会丢计数（这是替换 KV 的核心收益） |
| 登录成功 | `DELETE FROM login_attempt WHERE ip = ?` | 与现行为一致 |

**清理策略**：D1 没有 TTL，所以在「记录失败」时**按 1/50 概率**顺带执行 `DELETE FROM login_attempt WHERE window_start < ?`（滑动窗口外即过期），用 `db.batch` 两条语句一次提交，保证表有界；备选是加 Cron Trigger 每天清一次（会多一个 handler 与配置，非必要不引入）。

**健壮性要求**：限流相关的 D1 读写**全部 fail-open**——捕获异常后 `console.warn` 并当作「未锁定」继续走密码校验。理由：限流是防爆破的辅助层，绝不能因为表缺失/D1 抖动把管理员锁在自己的面板外；真正的防线是密码。

**代码组织**（便于自检）

- 新增 `src/utils/loginRate.ts`：`LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` / `isLocked(row, now)`（纯函数）/ `readAttempt()` / `recordFail()` / `clearFails()`；
- `src/api/login.ts` 只保留调用，删掉 KV 辅助函数。

**测试**

- 纯逻辑：`isLocked()` 的窗口边界（过期/未过期、等于上限、恰好 5 次）；
- 集成（本地真实 D1）：连续 6 次错误登录 → 第 6 次返回 `1008`；第 7 次仍 `1008`；正确密码登录后被清除；
- 新增 `scratch/login-rate.test.ts`（沿用仓库「esbuild 打包 + node 运行」的自检风格，见附录 C）。

**落地结果（本轮实测）**

- 新增 `src/utils/loginRate.ts`（常量 + `isLocked` 纯函数 + `readAttempt`/`recordFail`/`clearFails` + `ensureLoginAttemptTable` 惰性兜底）；`src/api/login.ts` 改为三个 fail-open 包装（`isRateLimited` / `recordFailSafe` / `clearFailsSafe`），KV 辅助函数全部删除。
- `scratch/login-rate.test.ts`：**18 passed, 0 failed**（内存版 D1 模拟器只认 `loginRate.ts` 里的真实 SQL，SQL 一改就会报错，避免语义漂移）。
- 端到端（`wrangler dev --persist-to <老库副本>`，即**没有 `login_attempt` 表的旧库**）：连续 5 次错误密码返回 `1003` → **第 6 次返回 `1008`** → 第 7 次仍 `1008`；服务端日志无 fail-open 告警；测试后确认 `login_attempt` 表已被惰性兜底自动创建。
- 惰性兜底的代价：仅「每个 isolate 生命周期一次 `CREATE TABLE IF NOT EXISTS`」，表已存在时是一次 no-op。

### 2.4 移除 KV（原 0-2 的收尾）✅ 已完成

| 位置 | 改动 |
|------|------|
| `wrangler.toml` | 删除 `[[kv_namespaces]]` 整段（`binding = "LOGIN_RATE"`） |
| `src/types.ts` | `Env` 删除 `LOGIN_RATE: KVNamespace` |
| `src/api/login.ts` | 删除 `loginFailCount` / `recordLoginFail` / `clearLoginFails` 与 `RATE_KEY_PREFIX` |
| `package.json` | `description` 去掉 `KV`（`Hono + D1 + R2`） |
| `README.md` | 技术栈串 `Worker (Hono) + D1 + KV + R2 + Vue 3` → 去掉 KV；技术栈表「登录限流」一行改为 D1 |
| `docs/deployment.md` | 技术栈表、「与上游的差异」表同步 |
| 云端清理（可选） | Dashboard → Workers & Pages → KV → 删除自动创建的那个 namespace（只含限流计数，无业务数据） |
| 本地清理（可选） | 删除 `.wrangler/state/v3/kv`（gitignored） |

**对 §3.3（JWT 可吊销）的影响**：token 世代缓存改为**进程内模块级缓存**（TTL 5–10 秒），不再依赖 KV；同一 isolate 内的延迟为 0，跨 isolate 最长 TTL 级延迟，可接受。

**验证**：`grep -rn "LOGIN_RATE\|KVNamespace" src/` 应为空；`npm run typecheck` 通过；本地 `npm run dev` 启动日志中不再出现 `env.LOGIN_RATE`。

**落地结果（本轮实测）**：上述表格全部完成；`src/` 中已无 `LOGIN_RATE` / `KVNamespace`；`tsc --noEmit` 通过；`wrangler dev` 启动日志的绑定列表只剩 `env.DB` / `env.FILES` / `env.ASSETS` / `env.JWT_SECRET`（**KV 已消失**）。README / docs/deployment.md / package.json 的 KV 描述已同步（README「与上游差异」表另加了一行说明单文件基线策略）。

### 2.5 一次性升级脚本（`docs/sql/`）❌ 已取消（决策 D5）

原计划为已部署库提供 `docs/sql/2026xx_login_attempt.sql`。按本轮决策**不再需要**：`login_attempt` 属于「新增表」，已由 `ensureLoginAttemptTable()` 的惰性建表兜底覆盖（§2.3），旧库与新库都不需要手工 SQL。

保留本条仅为记录：**将来若出现「改已有表」的变化（加列/删表），仍必须回到 `docs/sql/` 一次性脚本 + 部署前执行的流程**（见 §2.2 的规则表）。部署顺序也回到最简形式：

- **已部署库**：直接部署代码（首次请求会自动建表）→ 验证 6 次错误登录被锁定；
- **全新部署**：`wrangler deploy` → `wrangler d1 migrations apply --remote`（0001 建全表）。

---

## 3. 阶段二：安全加固

### 3.1 上传与抓取校验（原 0-1）✅ 已完成

| 改动 | 文件 |
|------|------|
| `uploadFiles` 增加扩展名白名单（复用 `IMG_AGREE_EXTS`，另设允许的非图片类型），被拒文件进 `errFiles` | `src/api/system/file.ts` |
| favicon 下载后校验 `content-type` 以 `image/` 开头，否则丢弃（SVG 单独开关）；保留 1MB 上限与超时 | `src/utils/favicon.ts`、`src/api/panel/itemIcon.ts` |
| `/uploads/*` 增加 `X-Content-Type-Options: nosniff`；非 `image/*` 补 `Content-Disposition: attachment`；SVG 额外加 `Content-Security-Policy: default-src 'none'; …; sandbox`；key 校验 `^\d{4}/\d{1,2}/\d{1,2}/[0-9a-f]{32}(\.[a-z0-9]{1,10})?$`（扩展名可选以兼容早期无扩展名对象，但禁止 `/`、`..` 等越界写法） | `src/index.ts` |

**落地结果（本轮实测）**

- `src/utils/file.ts` 新增 `isAllowedExt()`（图片 + `.txt/.pdf/.zip/.json`）、`normalizeIconContentType()`（非图片返回空 → 丢弃）、`isValidUploadKey()`；`isImageExt/isAllowedExt` 内部统一 `toLowerCase()`。
- `downloadFavicon()` 现在会校验 Content-Type：`text/html`、`application/javascript` 一律丢弃（即使 URL 以 `.png` 结尾）；`application/octet-stream` 仅在 URL 扩展名是图片时兜底接受。
- `scratch/upload-validate.test.ts`：**45 passed, 0 failed**。
- 端到端（wrangler dev + curl）：`.png` 上传成功并返回 key；`.html` 走 `uploadImg` → `1301 Unsupported file format`；`uploadFiles` 同时传 `.txt` + `.html` → `.txt` 入库、`.html` 进 `errFiles`；`/uploads/<png>` 响应带 `x-content-type-options: nosniff` 且无 attachment；`/uploads/<txt>` 额外带 `Content-Disposition: attachment`；非法 key（`not-a-valid-key.png`、`2026/9/10/short.png`）→ 404。

### 3.2 密码哈希升级（原 0-3 的 PR-1）✅ 已完成

- 哈希串自描述：`pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>$<pepperId>`；`^[0-9a-f]{32}$` 识别为旧版三重 MD5。
- 新增 `checkPassword()` / `hashPassword()` / `needsRehash()` / `resolveIterations()`（`src/utils/password.ts`），WebCrypto PBKDF2-SHA256 + **常量时间比较**。
- **pepper 用 env secret**（`PASSWORD_PEPPER`）：哈希 = PBKDF2(pepper ‖ 密码)，D1 泄露也无法离线爆破。
- **迭代数实测**（Node/BoringSSL，与 workerd 同源）：5k ≈ 2.6ms、10k ≈ 4.5ms、100k ≈ 43ms、210k ≈ 85ms。免费版每请求 CPU 仅 10ms，故默认 **5000**；可用 `PASSWORD_PBKDF2_ITERATIONS` 覆盖（上限 100 万，下限 1000），迭代数写进哈希串 → **调高后旧哈希仍可校验并在下次登录自动重算**。
- 防锁死设计（决策补充）：**未配置 pepper 时不会生成 v2 哈希**（旧格式照常校验、跳过重哈希并告警），所以何时 `wrangler secret put PASSWORD_PEPPER` 都不会把自己挡在门外；已配置后若 pepper 被换掉，返回明确的 `1009` 提示（而不是假装「密码错误」）。
- 登录成功且 `needsRehash()` → 就地重写为 v2；改密接口在配置了 pepper 时写 v2，未配置时维持旧行为并 `console.warn`。

**落地结果（本轮实测）**

- `scratch/password-hash.test.ts`：**29 passed, 0 failed**（含旧种子哈希夹具 `579646aad11fae4dd295812fb4526245` ↔ `12345678`、随机盐、pepper 缺失/变更的可区分结果、迭代数夹取、CPU 预算断言：默认迭代数校验 ~2.2ms）。
- 端到端：带 `--var PASSWORD_PEPPER=…` 启动后，用旧哈希登录成功（`code=0`）→ 数据库中 `system_setting.admin_password` 变成 `pbkdf2$sha256$…`，旧种子哈希已消失；随后重新登录仍正常。

### 3.3 JWT 可吊销（原 0-3 的 PR-2）✅ 已完成

- 新增 `src/utils/authEpoch.ts`：`auth_epoch` 存于 `system_setting`，读取带 **10 秒进程内缓存**（不使用 KV）；JWT 载荷加 `epoch`；中间件比对，落后即 `1001`（前端已有「登录过期 → 跳登录页」逻辑，零改动）。
- 递增时机：改密码、改用户名、`/logout { allDevices: true }`。
- 比较策略是「只拦更旧的 token」：缓存滞后最多让个别旧 token 多活 10 秒，但绝不会误杀刚签发的新 token。
- `exp` 由 7 天缩到 **72 小时**。
- 破坏性：本次上线后，改动前签发的老 token（没有 `epoch` 字段，按 0 处理）会失效一次，重登即可。
- 可选后续：token 从 `localStorage` 迁到 `HttpOnly + SameSite=Lax` Cookie（需补 CSRF 防护），独立立项。

**落地结果（本轮实测）**

- `scratch/auth-epoch.test.ts`：**23 passed, 0 failed**（含「默认世代签发的 token 立刻失效」这条回归断言）。
- 端到端：登出前 `getInfo=0` → `/logout {allDevices:true}` 返回 0 → **同一 token 再用返回 `1001`** → 重新登录后恢复正常。
- 🐞 端到端抓到并修掉一个真实 bug：`bumpAuthEpoch` 首次递增时把种子值写成默认世代 1，等于没作废（记录不存在本身就代表世代 1）。已改为种子 `DEFAULT + 1`，并补上对应自检断言。

---

## 4. 阶段三：一致性与成本

### 4.1 R2 ↔ `file` 表一致性（原 1-1）✅ 已完成

**落地结果**

- 站点图标改**按站点稳定 key**：`icons/<md5(host)>.<ext>`（`buildIconKey`），重复获取是覆盖写；`file` 表按同站点已有记录做 UPSERT（复用旧行、扩展名变化时更新 `src` 并删掉旧对象）。`/uploads` 的 key 校验同步支持 `icons/` 形态。
- 新增 `src/utils/uploadRefs.ts`：`normalizeUploadSrc` / `srcFromIconJson` / `isUploadSrcReferenced`（检查项目 `icon_json`、面板 `background_json`、头像）/ `cleanupUploads`（只删没人引用的，失败只记日志）。
- `itemIcon/deletes` 与 `itemIconGroup/deletes` 在软删之后调用 `cleanupUploads` 回收图片；
  新增 `POST /api/system/file/cleanUnused` + 「上传文件管理」里的**清理未引用文件**按钮（二次确认）。
- 自检 `scratch/upload-refs.test.ts`：**22 passed**（含「在用图片被保留」「外链不会被当成 R2 对象删除」——后者是自检抓出来的真实缺陷，已在 `cleanupUploads` 里统一归一化修掉）。
- 端到端：新建引用图标的项目 → `cleanUnused` 返回 `deleted=0`（受保护）→ 删除该项目 → 该图标 GET 变 **404**、`file` 表记录清空；未引用的上传文件 → `cleanUnused` `deleted=1` → GET 404。

> 注意：`cleanUnused` 也会把「刚上传但还没被任何地方引用」的图片算作未引用，所以按钮带二次确认；这一步是手动的，不会自动跑。

### 4.2 首页去 N+1（原 1-2）✅ 已完成

**落地结果**

- 新增 `POST /api/panel/itemIconGroup/getListWithItems`：1 次查分组 + 1 次查全部项目，在 Worker 内按 `item_icon_group_id` 归组；空库时先建默认分组并认领游离项目**再**查项目（顺序反了这些项目会丢）。`itemIcon/getListByGroupId` 保留（排序退出/过滤退出时仍会单组刷新）。
- 前端 `home/index.vue` 的 `getList()` 改为单次调用，`frontend/src/api/panel/itemIconGroup.ts` 增加对应 API。
- 自检 `scratch/group-with-items.test.ts`：**15 passed**，其中一条专门断言 **SQL 次数固定为 3**（1 次 epoch + 2 次数据查询），不随分组数增长。
- 端到端：真实 D1 上 `code=0 groups=1 首组=APP`，分组内项目正常下发。

### 4.3 `/uploads/*` 缓存（原 1-3）✅ 已完成（决策 D7）

- 缓存头：日期哈希的上传文件 `public, max-age=86400, immutable`；站点图标 `public, max-age=86400`（会被覆盖写，不能 immutable）。
- **不做 `caches.default` 边缘缓存**：端到端实测发现，边缘缓存会让已删除的图片继续命中最长 24 小时（删除项目后 GET 仍 200），「删了还能访问」的困惑大于省下的 R2 读。
- 需要边缘缓存时的做法（可选，运维侧）：在 Cloudflare 给 `<域名>/uploads/*` 配 Cache Rule（Edge TTL 自定义），并接受同样的删除延迟；R2 Class B 免费额度 1000 万次/月，个人站点通常无需额外缓存。
- 端到端已验证两类 key 的缓存头与删除后的 404 行为（见 4.1）。

---

## 5. 阶段四：结构清理

### 5.1 死存储清理（原 2-1）✅ 已完成（决策：现在删代码 + 新库不建表）

**落地结果**

- 后端：删除 `src/api/notice.ts`、`src/api/system/moduleConfig.ts` 并从 `src/api/index.ts` 摘掉挂载。
- 前端：删除 `api/notice.ts`、`api/system/moduleConfig.ts`、`store/modules/notice/*`、`store/modules/moduleConfig/*`、`typings/notice.d.ts`；
  `utils/cmn/index.ts` 里的 `noticeCreate` / `getNotice` 一并移除；面板 store 里的 `migrateLegacySearchEngine` 与首页调用点删除；
  `searchBox` 工具里只剩「旧内置引擎/旧字段名」的本地缓存归一化（`hasStoredSearchEngineConfig`、`SEARCH_BOX_LEGACY_MODULE_NAME` 已删）。
- 建表基线：`0001_init.sql` 不再创建 `module_config` 与 `notice`（并在文件头记录这段历史）；
  **已部署库里的这两张空表保留不动**（代码不再访问，无需手工 SQL，符合决策 D5 的单文件策略）。
- 文档：`docs/search-engine.md` 的「存储与兼容」改为说明「迁移已移除」，并提示老版本直升的用户需重新配置引擎。
- 影响面（需知晓）：从很老的版本直接升级、且从未打开过迁移后新版的用户，自定义引擎不会自动恢复（回退内置三项）；
  本仓库当前只有单一自用实例，已确认可接受。

### 5.2 `ASSETS` 绑定（原 2-2）✅ 已完成

从 `wrangler.toml` 删掉 `binding = "ASSETS"`，保留 `[assets] directory = "dist"`。

依据（Cloudflare 官方文档 <https://developers.cloudflare.com/workers/static-assets/binding/>）：资产绑定是**可选**的，只用于在 Worker 里调用 `env.ASSETS.fetch()`；静态资产默认「资产优先」路由（`run_worker_first` 默认 false），不声明 binding 不影响托管。本项目 Worker 只实现 `/api/*` 与 `/uploads/*`，从不读资产，所以该绑定纯属多余；`Env` 类型里本来也没有它（只有 `wrangler.toml` 声明了），删掉后 dev 启动日志里不再出现 `env.ASSETS`。

### 5.3 `user_config` 覆盖写（原 2-3）❌ 已决定不做（仅文档提示）

按要求不加乐观锁：单用户场景下多标签同时改样式的概率很低，加锁需要改前端两处保存调用与冲突提示，收益不成比例。
改为在 README 的「已知限制」中提示：**避免多个标签页同时修改样式/搜索引擎配置**，否则后保存的会覆盖先保存的（`user_config` 是整份 JSON 覆盖写）。

---

## 6. 阶段五：文档与备份

| # | 内容 |
|---|------|
| 6.1 | ✅ 已完成：`docs/deployment.md` 新增「备份与恢复」——D1 `export`（含 `--no-schema`）与恢复、R2 用 `rclone sync` / `wrangler r2 object get`、D1 与 R2 必须成对备份的说明、Time Travel 兜底、以及两个 secret 无法读回需自行留存 |
| 6.2 | ✅ 已完成：新增 [`docs/storage.zh-CN.md`](./storage.zh-CN.md)——Cloudflare 资源与绑定清单、D1 六张表用途与删除语义、R2 两种 key 形态与引用回收规则、本地 `.wrangler/state/v3` 的 WAL 三件套与多 hash 文件成因、单文件基线的结构变更约定 |
| 6.3 | ✅ 已完成：`vite build` 重建 `dist/`（3207 modules，21.3s）；核对新产物含「清理未引用文件 / cleanUnused / filteringTip / getListWithItems」，且不再含 `moduleConfig/getByName`、`notice/getListByDisplayType` |

---

## 7. 已完成（总表）

| 项目 | 内容 | 验证 |
|------|------|------|
| **§2.1 migrations 单文件基线** | `0001_init.sql` 折叠原 0002/0003 的列并新增 `login_attempt`；删除 0002/0003；文件头记录合并历史与维护约定 | 新库一次建全；老库 `No migrations to apply!`（§5.1 后再验证：11 条语句、6 张业务表） |
| **§2.3 登录限流迁 D1** | 新增 `src/utils/loginRate.ts`（原子 UPSERT + 概率清理 + 惰性建表兜底）；`src/api/login.ts` 三个 fail-open 包装 | `scratch/login-rate.test.ts` 18 passed；真实 D1 端到端：5×`1003` → 第 6 次 `1008` → 第 7 次仍 `1008` |
| **§2.4 移除 KV** | `wrangler.toml` / `src/types.ts` / `src/api/login.ts` / README / docs/deployment.md / package.json | `tsc --noEmit` 通过；dev 绑定列表已无 KV |
| **§3.1 上传/抓取校验** | 扩展名白名单、图标 Content-Type 校验、`/uploads/*` nosniff + 附件下载 + key 校验 | `upload-validate` 55 passed；端到端 `.html`→1301、txt→attachment、非法 key→404 |
| **§3.2 密码哈希升级** | PBKDF2 + 随机盐 + 可选 pepper（含 pepperId 防误判）；登录自动重哈希 | `password-hash` 29 passed；端到端旧哈希登录后库内变为 `pbkdf2$…` |
| **§3.3 JWT 可吊销** | `auth_epoch` 世代 + 进程内缓存 + 72h；改密/改用户名/退出所有设备递增 | `auth-epoch` 23 passed；端到端旧 token 立刻 `1001` |
| **§4.1 R2 ↔ file 一致性** | 站点图标稳定 key、引用感知回收、`cleanUnused` 接口与前端按钮 | `upload-refs` 22 passed；端到端：引用时 `deleted=0`、删项目后对象回收 404 |
| **§4.2 首页去 N+1** | `getListWithItems`（1 次查分组 + 1 次查项目） | `group-with-items` 15 passed（含 SQL 次数固定为 3）；端到端真实 D1 通过 |
| **§4.3 缓存头** | 上传件 `immutable`、图标仅 `max-age`（决策 D7：不做 Worker 侧边缘缓存） | 端到端核对两类响应头与删除后 404 |
| **§5.1 死存储清理** | 删 `notice` / `moduleConfig` 全部代码；新库不建这两张表（老库空表保留） | 残留引用 grep 为空；`tsc`/`vue-tsc`/`eslint` 通过；全新库 11 条语句、6 张业务表 |
| **§5.2 `ASSETS` 绑定** | 从 `wrangler.toml` 删除未使用的 binding | 官方文档依据；dev 启动绑定列表已无 `env.ASSETS` |
| **§6.1 / §6.2 文档** | `docs/deployment.md` 增「备份与恢复」；新增 `docs/storage.md` | 文档索引已更新 |
| **§6.3 重建 `dist/`** | `vite build`（3207 modules / 21.3s） | 产物含新功能字符串、不再含已删死代码 |
| 引擎设置按钮同行 | 「添加搜索引擎 / 排序 / 恢复内置引擎」合并为一行，窄屏自动换行；破坏性「重置」仍单独置底 | `frontend/src/components/apps/Style/SearchEngineSettings.vue` |
| 过滤缺陷修复（方案 A） | 过滤视图改为携带**原始分组对象**；交互回调由「下标」改为「分组对象」；`filterItems` 改为 `computed`；`:key` 用稳定 id；新增过滤提示与「无结果」提示；过滤中禁用排序并在进入过滤时退出排序模式 | `frontend/src/utils/panelFilter/index.ts`（新）、`frontend/src/views/home/index.vue`、两个 locale、`scratch/panel-filter.test.ts`（27 passed） |

**收尾状态**：§2 ~ §9 的改动**已全部提交**（当前基线见 git log）；`dist/` 随各轮改动重建；后续增量见 §10「全仓库排查结论（本轮）」。
**部署提醒**：`dist/` 已 gitignore，线上产物由构建流程生成 —— 本地 `npm run deploy:all` 或在 Cloudflare Workers Builds 里 `npm run build`。

---

## 8. 风险登记表

| # | 风险 | 影响 | 规避 |
|---|------|------|------|
| R1 | 某环境只应用过 0001，删掉 0002/0003 后缺列 | 运行时报错 | ✅ 已闭环：合并前需 `migrations list --remote` 校验；本轮用户确认「重新部署新版」，老库路径不再涉及 |
| R2 | 新代码先于 `login_attempt` 表上线 | 登录时 D1 报错 | ✅ 已闭环：改为惰性建表兜底 + 限流全部 fail-open（实测旧库副本上自动建表成功） |
| R3 | 单文件策略下忘记处理结构变化 | 老库结构落后于代码 | 见 §2.2 规则表：新增表用惰性兜底，改已有表必须写 `docs/sql/` 脚本并在部署前执行 |
| R4 | 移除 KV 后仍残留引用 | 部署失败/类型报错 | ✅ 已闭环：`grep -rn "LOGIN_RATE\|KVNamespace" src/` 为空；`tsc --noEmit` 通过；dev 绑定列表已无 KV |
| R5 | PBKDF2 迭代数过高触发 `1102` | 登录失败 | ✅ 已闭环：默认 5000（实测 ≈2.6ms）；可用 `PASSWORD_PBKDF2_ITERATIONS` 调整；迭代数写进哈希串，调高后旧哈希仍可校验 |
| R6 | `PASSWORD_PEPPER` 丢失/被换 | 无法校验密码 | ✅ 已闭环：pepper 未配置时不生成 v2 哈希（不会锁死）；已配置后被换会返回明确的 `1009` 提示而非「密码错误」；文档要求与 `JWT_SECRET` 一同备份 |
| R7 | 删 `module_config` / `notice` 时仍有老用户未迁移 | 自定义引擎丢失 | 确认版本覆盖率后再执行；README 说明 |

---

## 9. 后续候选详细计划

> §2 ~ §6 已全部结项；本节是**尚未执行**的后续项（含实现过程中新发现的缺口与用户追加的需求），按建议优先级排列。
> 每项格式：目标 / 前置 / 步骤 / 涉及文件 / 验证 / 风险 / 量级（S = 半小时级，M = 半天级，L = 一天以上）。
> 执行时请把状态回填到本节的 `状态` 行。
>
> **本节变更（按用户指示）**：新增 **9.2「获取图标弹窗选一张」**；**移除**原 9.4（PBKDF2 迭代数提升）与
> 原 9.7（仓库原有待确认需求）；编号已重新连续化，9.0 为已完成的回收开关。
>
> **执行进度**：9.0 ~ 9.5、9.8、9.9 已完成；9.6 待确认（运维侧可选）；9.7 待执行（提交拆分与手动回归）；
> 9.10 ~ 9.13 为待明确需求 / 待决策（**9.13** = 安全审查 V-07 的打包方案，建议一次做完）。
>
> **待用户操作（不阻塞开发，详见 [deployment.zh-CN.md](./deployment.zh-CN.md)）**：
> ① 配置 secrets（`JWT_SECRET` 必填；建议配 `PASSWORD_PEPPER`，**配后勿改勿删**）；
> ② `npm run build` + `wrangler deploy`（新库再跑 `wrangler d1 migrations apply DB --remote`）；
> ③ 首次登录确认旧密码哈希已自动升级（`system_setting.admin_password` 变为 `pbkdf2$…`）；
> ④ 可选：删除云端孤儿 KV namespace（§2.4 移除 KV 后的遗留）；
> ⑤ **旧资源清理**：命名基线为 Worker `sun-panel-on-cloudflare-worker`、D1 `sun-panel-on-cloudflare-worker-db`、
> R2 `sun-panel-on-cloudflare-worker-files`；按此部署并验证通过后，把不再使用的旧 Worker（`sun-panel`）、
> 旧 D1（`sun-panel`）、旧 R2（`sun-panel-files`）与孤儿 KV 从控制台删除。

### 9.0 图片回收开关（**已实现**，决策 D8，作为格式参照）

- **目标**：删除项目/分组时是否自动回收未引用图片，做成可切换项，默认开。
- **落地**：`system_setting.storage_auto_clean_unused`（'1'/'0'，缺省=开）；接口 `POST /api/system/getStorageSettings` / `saveStorageSettings`（`src/api/system/setting.ts`）；
  读取与解析在 `src/utils/settings.ts`（`SETTING_AUTO_CLEAN_UNUSED` / `parseBoolSetting` / `getAutoCleanUnused`，**读取失败按「关」**）；
  两个删除路由（`itemIcon/deletes`、`itemIconGroup/deletes`）与站点图标换扩展名的旧对象清理都以它为前置条件，并叠加引用检查；
  前端开关在上传文件管理页顶部（`UploadFileManager/index.vue` + `api/system/setting.ts` + 两个 locale）。
- **验证**：`scratch/upload-clean-setting.test.ts` **23 passed**（含路由级：默认开→R2 被删、设为 '0'→R2 不动但项目照样软删）；
  真实 D1+R2 端到端：关→删项目→图片 HTTP 200 且 `file` 行保留；开→删项目→图片 HTTP 404 且 `file` 行消失；设置持久化 ✓。
- **配套文档**：[storage.zh-CN.md](./storage.zh-CN.md) §3 有专门的「图片回收：两个入口、判定规则与开关」小节，逐条记录开关与按钮的行为、场景与盲区（按用户要求补充）。
- **状态**：已完成。

### 9.1 `1009` 在前端可见（新发现的缺口）— 量级 S

- **问题**：`PASSWORD_PEPPER` 缺失/不匹配时后端返回 `1009`，但前端 `apiRespErrMsg`（`frontend/src/utils/request/apiMessage.ts:22-26`）
  发现 locale 里没有 `apiErrorCode.1009` → 返回 `false` → 拦截器 `Promise.reject` 且**不弹任何提示**，登录页只 `console.log`。
  用户看到的现象是「点登录没反应」，原因只在浏览器控制台和 Worker 日志里。
- **步骤**：① 两个 locale 的 `apiErrorCode` 下各加 `"1009"`，文案带可操作信息（如「服务端密码配置异常：PASSWORD_PEPPER 未配置或已变更，请检查 Worker Secret」）；
  ② 无需改拦截器（命中 locale 后会自动走 `message.error`）；③ `npm run build` 重建 `dist/`。
- **涉及文件**：`frontend/src/locales/zh-CN.json`、`en-US.json`、`dist/`（构建产物）。
- **验证**：`scratch/i18n-audit.ts` 缺失 0 / 中英不齐 0；本地起 dev（故意不配 `PASSWORD_PEPPER`，并把库里 `admin_password` 改成 v2 串）→ 登录页应弹出提示。
- **风险**：低。⚠️ 不要把 `1009` 加进后端 `ERROR_CODE_MAP`，否则 `errorByCodeAndMsg` 会用它覆盖掉具体提示（`src/utils/response.ts:49-52`）。
- **状态**：已完成。
- **落地结果（本轮实测）**：两个 locale 的 `apiErrorCode` 下各加 `"1009"`（中文文案：「服务端密码配置异常：PASSWORD_PEPPER 未配置或已变更，请检查 Worker Secret」），
  未动拦截器、未动 `ERROR_CODE_MAP`；`scratch/i18n-audit.ts` 复跑：缺失 0 / 中英不齐 0（1009 出现在「死文案」列表属动态 key 的已知误报，见 §9.3）；`dist/` 已随本轮统一重建。

### 9.2 获取图标：多候选时弹窗让用户选一张 — 量级 M（用户已确认要做）

- **现状（为什么需要改）**：`POST /api/panel/itemIcon/getSiteFavicon` 把「抓页面 → 取**第一个** `rel` 含 `icon` 的 `<link>` → 退到 `/favicon.ico` → 再退到 icon.horse」串成一条链，
  **只下载并保存一张**；页面里有多个尺寸/多种 rel（`icon` / `shortcut icon` / `apple-touch-icon` / `mask-icon`）时，取谁取决于 **HTML 里谁先出现**，用户没有选择权。
- **目标**：一次抓取返回**候选列表**（带尺寸与来源）；≥2 个候选时弹窗让用户选一张，**只下载并保存选中的那张**；只有 1 个候选时保持现在的「一键获取」体验（不弹窗）。

**后端步骤**

1. `src/utils/favicon.ts` 新增纯函数 `extractIconCandidates(html, baseUrl)`：收集所有 `rel` 含 `icon` 的 `<link>`（含 `shortcut icon`、`apple-touch-icon`、`mask-icon`）的 `href` + `sizes` + `type`；
   跳过 `data:` 与非 http(s)；按解析后的绝对 URL 去重；保留文档顺序；**上限 12 条**。
   兜底候选：`<origin>/favicon.ico`（HEAD 200 才收录，`source: 'favicon.ico'`）、icon.horse（仅当上面一个都没有时收录，`source: 'icon-horse'`）。
   现有 `getSiteFaviconUrl()` 保留（内部改为「取候选列表第一条」），不破坏旧调用。
2. 新接口 `POST /api/panel/itemIcon/getSiteFaviconCandidates { url }` → `{ candidates: [{ url, sizes?, type?, source }] }`
   （需登录；沿用 8s 超时与 1MB HTML 截断；无候选时返回空数组而不是报错）。
3. 新接口 `POST /api/panel/itemIcon/saveSiteFavicon { url, pageUrl }`：`url` = 选中的候选，`pageUrl` = 用户填的站点地址（用它推导 host 作为稳定 key 与 `file_name`）。
   内部复用现有逻辑：`downloadFavicon(url)`（≤1MB、必须是 `image/*`）→ `buildIconKey(host, ext)` 覆盖写 → `file` 行 UPSERT → 旧扩展名对象回收（**受回收开关 + 引用检查双重保护**）→ 返回 `{ iconUrl }`。
   ⚠️ 不做「任意 URL 代理」：只保存内容校验通过的图片，与现有抓取同一信任模型。
4. 旧接口 `getSiteFavicon` 保留（内部 = 候选第一条 + 保存），兼容旧前端/脚本。

**前端步骤**

1. 新增 `frontend/src/views/home/components/EditItem/FaviconPicker.vue`（与 `GalleryPicker.vue` 同级、沿用 `RoundCardModal` + 网格样式）：网格展示候选，标注尺寸与来源徽标，点击选中并确认 → `emit('selected', candidate)`。
2. `EditItem/index.vue` 的 `getIconByUrl(url, loadingIndex)`（第 178-196 行；入口是「网址 / 内网网址」旁的获取按钮，第 319 / 335 行）改为：
   先调 `getSiteFaviconCandidates` → 0 个则报 `iconItem.geticonFail`；1 个直接调 `saveSiteFavicon`（保持一键）；≥2 个打开 `FaviconPicker`，选完再调 `saveSiteFavicon`。
3. 预览直接用候选原 URL（`<img>` 不需要 CORS）；若面板是 https 而候选是 http，浏览器会拦混合内容 → 这类候选在弹窗里标注「不安全（http）」并置灰不可选（或改用下面的可选增强）。
4. 可选增强：加 `POST /api/panel/itemIcon/previewFavicon { url }`，由 Worker 取回图片字节原样返回（≤1MB、content-type 校验、10s 超时），弹窗统一用它预览——顺带解决混合内容与第三方跟踪。

**i18n**：`iconItem.faviconPickerTitle` / `faviconPickerTip` / `faviconPickerEmpty` / `faviconPickerSourceLink` / `faviconPickerSourceFallback` / `faviconPickerInsecure`（zh + en 各一条，中英对齐）。

**验证**

- 新增自检 `scratch/favicon-candidates.test.ts`：HTML 夹具覆盖「rel/href 顺序颠倒」「`sizes="32x32"`」「`apple-touch-icon`」「`data:` 跳过」「相对路径解析」「重复 href 去重」「超过 12 条截断」「无 link 时回退外」。
- 端到端：用一个返回 3 个 icon link 的本地页面 → 候选接口返回 3 条 → 保存第 2 条 → `file` 表 `icons/` 只有 1 条记录、`/uploads/<key>` 200。
- `vue-tsc` + `eslint` + `npm run check` + 重建 `dist/`。

**风险**：中。① 正则解析对写法怪异的站点可能漏候选（有兜底链）；② 弹窗多一步交互（仅多候选时出现）；③ 重新获取仍会覆盖同一稳定 key（符合预期）。

**状态**：已完成（本轮实现）。
**落地结果（本轮实测）**：
- 后端：`src/utils/favicon.ts` 新增纯函数 `extractIconCandidates(html, baseUrl)`（收集 rel 含 icon 的 link，带 `sizes`/`type`；跳过 `data:` 与非 http(s)；去掉查询参数后按绝对 URL 去重；保留文档顺序；上限 12 条）
  与 `getSiteFaviconCandidates(pageUrl)`（页面提取为空时依次 HEAD 探测 `/favicon.ico` → `icon.horse`，无候选返回空数组）；`getSiteFaviconUrl()` 改为取候选第一条（旧调用行为不变）。
  `src/api/panel/itemIcon.ts`：保存逻辑抽成 `storeFavicon()`；新增 `POST /panel/itemIcon/getSiteFaviconCandidates` 与 `POST /panel/itemIcon/saveSiteFavicon`（下载校验 → `buildIconKey` 覆盖写 → `file` 行 UPSERT → 旧扩展名对象回收，受开关+引用检查保护）；旧接口 `getSiteFavicon` 保留（内部 = 候选第一条 + 保存）。
- 前端：新增 `frontend/src/views/home/components/EditItem/FaviconPicker.vue`（网格候选 + 尺寸/类型 + 来源徽标；http 候选在 https 页面下标注「不安全」并置灰）；
  `EditItem/index.vue` 的 `getIconByUrl()` 改为「0 个报错 / 1 个直存 / ≥2 个弹窗选择后保存」；新增 `Panel.FaviconCandidate` 类型与两个 API 封装；6 条 `iconItem.faviconPicker*` 文案（中英对齐）。
- 自检：新增 `scratch/favicon-candidates.test.ts` **48 passed, 0 failed**：纯函数 8 类 HTML 夹具 + mock fetch 兜底链（有候选不走兜底、无 link 回退 favicon.ico、再落到 icon.horse、全无返回空、非法 URL 不发请求、旧函数取第一条）
  + 路由级（鉴权 1000、空参 1400、3 条候选、无候选返回空数组、保存写 R2 + INSERT file 行、同站点覆盖写走 UPDATE、非图片被拒、旧接口取第一条）。
- 质量闸门：`npm run check` 通过（0 error / 4 个既有 warning）；`scratch/i18n-audit.ts` 缺失 0 / 中英不齐 0；`dist/` 已重建。

### 9.3 清理 57 条上游遗留 i18n 死文案 — 量级 S/M

- **目标**：让 `scratch/i18n-audit.ts` 的「死文案」降到 0（或把确认保留的写进白名单）。
- **现状**：57 条，主要是上游未使用命名空间（`adminSettingUsers.*` 12 条、`common.*` 22 条、`apiErrorCode.*` 15 条等）。
  注意 `apiErrorCode.*` 与 `deskModule.searchEngine.*` 的 5 条是**误报**：它们在代码里通过动态 key 使用（`apiErrorCode.${code}`、`t(result.titleError)`），不要删。
- **步骤**：① 先给 `i18n-audit.ts` 加一份「确认保留」白名单（动态 key + 上游预留），让输出只剩余真正可删的；
  ② 按命名空间分批删除 `zh-CN.json` / `en-US.json` 中两侧都无引用的 key；③ 每批跑一次审计确认「缺失 0 / 不齐 0」。
- **验证**：审计输出「死文案 0（白名单 N）」；`vue-tsc` 通过（locale 是 JSON，类型来自 key 字面量，删错会立刻在页面上显示原始 key，所以手动点几页）。
- **风险**：中（删错会让界面显示原始 key）。建议按命名空间小步提交，便于回滚。
- **状态**：已完成。
- **落地结果（本轮实测）**：`scratch/i18n-audit.ts` 增加 `DYNAMIC_KEY_WHITELIST`（`apiErrorCode.*` 15 条 + `deskModule.searchEngine` 的 5 条校验文案，均由动态 key 使用），输出改为「死文案（已排除白名单）+ 白名单明细」；
  两个 locale 各删除 **36 条**真正无引用的文案（`adminSettingUsers.*` 12、`common.*` 21、`apps.baseSettings.*` 4 等），并清理因此产生的空对象；文案量 298 → 262 条（两侧齐平）。
  复跑审计：**缺失 0 / 中英不齐 0 / 死文案 0（白名单 20）**；`npm run check`（tsc + vue-tsc + eslint）通过。

### 9.4 token 从 localStorage 迁到 HttpOnly Cookie — 量级 L

- **目标**：让 JWT 不再暴露给 JavaScript（XSS 也偷不走），同时保留「改密/退出所有设备即刻吊销」的能力（`auth_epoch` 已具备）。
- **前置**：确认自定义域已启用 HTTPS（`Secure` cookie 需要）；确认调用方没有依赖 `token` 请求头的第三方脚本（若有，保留 header 兼容）。
- **设计**：
  1. 登录成功时 `Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=259200`（72h，与 JWT 一致）；`/logout` 清 cookie（`Max-Age=0`）。
  2. `authMiddleware` 读取顺序：Cookie → `token` 头 → `Authorization: Bearer`（后两者保留，便于脚本/兼容期）。
  3. CSRF：`SameSite=Lax` 已阻止跨站 POST 携带 cookie；再叠加 `Origin` / `Sec-Fetch-Site` 校验（仅允许同站）作为第二道。
  4. 前端：`authStore` 不再持久化 token（或仅内存态）；`request` 拦截器去掉 `token` 头；`1000/1001` 的跳登录逻辑不变。
  5. 迁移期：服务端**先**同时接受 cookie 与 header（旧前端不受影响），确认稳定后再改前端；回滚只需恢复前端。
- **涉及文件**：`src/api/login.ts`、`src/middleware/auth.ts`、`frontend/src/utils/request/index.ts`、`frontend/src/store/modules/auth/*`、`docs/deployment.md`（本地 dev 的 cookie 说明）。
- **验证**：登录后 `document.cookie` 读不到 token；带 cookie 的请求正常；跨站来源的 POST 被拒（可用 `curl -H 'Origin: https://evil.example'` 验证）；改密/退出所有设备后旧 cookie 失效（1001）。
- **风险**：中高。注意本地 `wrangler dev`（http://127.0.0.1）上 `Secure` cookie 的行为、以及 workers.dev 与自定义域混用时的 cookie 作用域。
- **状态**：**已完成**。
- **落地结果（本轮实测）**：
  - 新增 `src/utils/authCookie.ts`：`setAuthCookie` / `clearAuthCookie` / `readAuthToken`；属性 `Path=/; HttpOnly; SameSite=Lax; Max-Age=259200`（与 JWT 的 72h 一致），**`Secure` 仅在 https 下添加**（本地 dev 是 http，加了浏览器会丢弃该 Cookie）。
  - `src/middleware/auth.ts`：读取顺序改为 **Cookie → `token` 头 → `Authorization: Bearer`**；用 Cookie 认证时对写操作（POST/PUT/PATCH/DELETE）做跨站校验 —— 优先看 `Sec-Fetch-Site`，缺失时退回「Origin 与 Host 的**主机名**比较」（Cookie 不区分端口，比较主机名才能让本地 Vite 代理 :1002 → :8787 正常工作）。
  - `src/api/login.ts`：登录成功下发 Cookie；`/logout` 清除 Cookie（`allDevices` 仍递增世代，其它设备上的 Cookie 一并失效）。
  - 前端：`store/modules/auth/helper.ts` 的 `setStorage` **不再把 token 落盘**（localStorage 只剩用户信息与 visitMode）；请求头仅在内存里有 token 时才补发；登录响应体里的 `token` 保留给命令行脚本使用。
  - 自检 `scratch/auth-cookie.test.ts`：**17 passed**（Cookie 认证 / 跨站写 1005 / 跨站读放行 / 头认证兼容 / 无凭证 1000 / 世代过期 1001 / 同主机不同端口放行 / Cookie 属性 + http 下无 Secure）。

### 9.5 `JWT_SECRET` 强度提示 — 量级 S

- **背景（本会话实测）**：jose 5.10 对 HMAC **不校验密钥长度**，空串、1 字符、8 字符都能正常签发与校验——也就是说配置再弱也不会报错，只会静默地不安全。
- **步骤**：① 在 `src/utils/jwt.ts` 或登录路由里加一次性检查：`JWT_SECRET` 长度 < 32 时 `console.warn`（**不要** fail-closed，避免把已部署实例锁在门外）；
  ② 在 `docs/deployment.md` 的 secret 步骤补一条生成命令（如 `openssl rand -base64 48`）。
- **验证**：短密钥启动时日志出现告警；正常长度无告警；登录功能不受影响。
- **风险**：极低（只加日志与文档）。
- **状态**：已完成。
- **落地结果（本轮实测）**：`src/utils/jwt.ts` 新增 `warnIfSecretWeak()`（`signToken` / `verifyToken` 入口检查，长度 < 32 时 `console.warn` 一次；空串/未配置也会提示；不 fail-closed）；
  `docs/deployment.md` 两处 secret 步骤补 `openssl rand -base64 48` 生成建议与长度说明。

### 9.6 `/uploads/*` 边缘缓存（运维侧可选）— 量级 S

- **背景**：决策 D7 不做 Worker 侧缓存（删除后仍命中 24h）。若确实想省 R2 读，可在 Cloudflare 侧配 Cache Rule。
- **步骤**：① Dashboard → Caching → Cache Rules → 新建规则，匹配 `http.request.uri.path matches "^/uploads/"`；
  ② 设 Edge TTL（例如 1 小时，别太长）；③ 如遇「删了还能访问」的困惑，Purge 对应 URL 或降低 TTL。
- **验证**：第二次请求响应头出现 `cf-cache-status: HIT`；删除对象后 1 小时内仍可能命中（已知取舍）。
- **风险**：低（纯运维配置，随时可删规则）。R2 Class B 免费额度 1000 万次/月，个人站点通常不需要。
- **状态**：待确认（可选）。

### 9.7 工程收尾 — 量级 S

- **提交拆分建议**（§2 ~ §9.5 已提交；本轮 §10 的改动建议单独成一个 PR，见 §10.4）：PR-A（§2 数据层）→ PR-B（§3.1）→ PR-C（§3.2）→ PR-D（§3.3）→ PR-E（§4）→ PR-F（§5）→ PR-G（§6 文档）→ PR-H（§9.0 开关 + 配套文档）→ PR-I（§9.1 / §9.2 / §9.5 / §9.3 / §9.8）。
  每批提交前跑 `npm run check`（根 typecheck + 前端 type-check + lint）；`dist/` 已 gitignore，无需提交。
- **手动回归清单**（浏览器，脚本覆盖不到交互）：① 登录 / 改密 / 退出所有设备；② 首页「不过滤 → 过滤 → 清空关键词」三步（hover 按钮、排序、拖拽保存、右键、跳转、「+」落到正确分组）；
  ③ 引擎设置三个按钮是否在同行；④ 上传文件管理：开关切换、清理未引用文件；⑤ 同一站点连点两次「获取图标」应复用同一 URL；
  ⑥ 「获取图标」：页面声明多个 icon 时应弹窗选择（只保存选中那张），只有 1 个候选时不弹窗直接保存。
- **状态**：待执行。

### 9.8 把 `custom_css` / `custom_js` 纳入引用检查 — 量级 S（**待确认**）

- **问题**：`isUploadSrcReferenced()` 只检查三处（项目图标、`user_config.panel_json`、头像）。若你在「全局设置 → 自定义 CSS/JS」里引用了 `uploads/...` 图片，
  它不会被视为「在用」——手动点「清理未引用文件」时可能被删掉。
- **步骤**：`isUploadSrcReferenced()` 增加一次查询把 `custom_css` 与 `custom_js` 两行一起取回（`config_name IN (?, ?)`），`includes(bare)` 命中即保留。
- **涉及文件**：`src/utils/uploadRefs.ts`（+ 常量从 `src/api/system/setting.ts` 提升到 `src/utils/settings.ts` 以免循环依赖）、`scratch/upload-refs.test.ts`。
- **验证**：自检增断言；端到端：把某张图的 URL 写进自定义 JS → `cleanUnused` 返回 `deleted=0`。
- **风险**：极低（多一次查询、判定更保守）。
- **状态**：**已完成**。
- **落地结果（本轮实测）**：`SETTING_CUSTOM_CSS` / `SETTING_CUSTOM_JS` 常量从 `src/api/system/setting.ts` 提升到 `src/utils/settings.ts`（避免 utils ↔ api 循环依赖）；
  `isUploadSrcReferenced()` 增加一次 `config_name IN (?, ?)` 查询，命中即保留；顶部注释与 [storage.zh-CN.md](./storage.zh-CN.md) §3.1 的判定清单同步为 4 项。
  `scratch/upload-refs.test.ts` 增加 3 条断言（CSS 引用保留 / JS 引用保留 / 清空后不再保留），**25 passed**（原 22）；
  `scratch/upload-clean-setting.test.ts` 的内存版 D1 补齐 `.all()` 契约，**23 passed**。

### 9.9 清理流程的子请求优化（图库变大后的稳定性）— 量级 S/M（**待确认**）

- **问题**：`cleanupUploads` 对**每张**候选最多 3 次引用查询 + 1 次 R2 删除 + 1 次 `file` 行更新；图片几十上百张时，单次请求的子请求数与耗时线性上升
  （免费版对单次请求的子请求数有上限，见 Workers limits；本项目无法在本地复现该上限，只能按官方口径预防）。
- **方案**：三个引用来源**各查一次**（全部 `item_icon.icon_json`、`panel_json`、头像、可选 custom_css/js）在内存里建「仍被引用的 bare 路径集合」，
  再把 `file` 行更新合并成一条 `UPDATE ... WHERE src IN (...)` → 子请求从约 `5M` 降到约 `M + 4`；若仍偏大，再加「每次只处理 N 张 + 前端循环调用」。
- **涉及文件**：`src/utils/uploadRefs.ts`、`src/api/system/file.ts`（可选加 `limit` 参数）、`UploadFileManager/index.vue`（可选循环）、`scratch/upload-refs.test.ts`。
- **验证**：自检覆盖「引用集合构建 + 批量更新」；端到端用 20 张图跑一次清理，核对 `checked/deleted` 与耗时。
- **风险**：低（纯内部重构），但必须保持「可能被引用 → 保留」的保守语义不变。
- **状态**：**已完成**。
- **落地结果（本轮实测）**：`src/utils/uploadRefs.ts` 重构为「一次性读取 + 内存比对」：
  - `loadReferenceTexts()` 固定 **3 次查询**（活着的 `item_icon.icon_json`、`user_config.panel_json`、`system_setting` 的头像 + 自定义 CSS/JS 三键），与候选数量**无关**；
  - `isSrcReferenced()` 纯函数做字符串包含判定（保守语义不变），`isUploadSrcReferenced()` 复用它（站点图标换扩展名的单点场景同样只 3 次查询）；
  - `file` 行改为**分片批量 UPDATE**（每片 90 个绑定参数，D1 上限 100）；
  - 新增 `limit` 参数与 `remaining` 返回值：`/file/cleanUnused` 默认每次最多处理 **30** 个候选（免费版每次调用只有 50 个子请求，删对象各占 1 个），前端「清理未引用文件」循环调用直到 `remaining === 0`（上限 50 轮兜底）。
  - 自检 `scratch/upload-refs.test.ts`：**35 passed**，其中断言「2 个候选与 24 个候选的语句数都是 4 条」（旧实现是 4N 级别）以及分批语义（limit=2 时 2/3 → 2/1 → 1/0）。

### 9.10 「我的信息」合并登录信息 — 量级 S（**待明确需求**）

- **背景**：原需求是「账号区放用户名（合并原『账号』与『昵称』、去掉『编辑』按钮）→ 分隔线 → 修改登录信息（弹窗顶部加用户名输入且不能为空）」。
  当前实现仍是「修改用户名」「修改密码」两个独立入口，密码弹窗里没有用户名输入，「昵称」也不再展示。
- **需要确认**：是否把两个弹窗合并为一个「修改登录信息」表单（用户名 + 当前密码 + 新密码 + 确认新密码，留空表示不修改该项）？「昵称」是否恢复展示与编辑（后端 `admin_name` 与 `/user/updateInfo` 都还在）？
- **涉及**：`frontend/src/components/apps/UserInfo/index.vue`；后端 `/user/updateUsername`、`/user/updatePassword`（若合并接口，需保持 `auth_epoch` 递增语义不变）。

### 9.11 上传文件管理的图片背景（棋盘格）透明度 — 量级 S（**待明确需求**）

- **背景**：需求为「图片背景太花，减少 50% 透明度」。当前棋盘格为 `rgba(0, 0, 0, 0.03)`（`frontend/src/components/apps/UploadFileManager/index.vue` 的 `.transparent-grid`），上游是 `#f0f0f0` / 16px。
- **需要确认**：目标值取 `rgba(0, 0, 0, 0.015)`（严格减半）还是改成更中性的浅灰（例如 `#f7f7f7`）？给一句结论即可落地。

### 9.12 「新建」布局调整 — 量级 ?（**需求待明确**）

- **背景**：原需求只有「调整新建的布局」一句，无法判断指哪个界面（分组管理的「新建分组」弹窗？首页的「新增项目」弹窗？启动器布局？）。
- **需要确认**：具体界面 + 期望效果（截图或文字描述均可）。

### 9.13 脚本凭证与 Web 会话分离（安全审查 V-07 的 B + C 步）— 量级 M/L（**待确认：是否一次做完**）

- **背景**：登录响应体返回与 Cookie 相同的 JWT，原因是中间件为命令行脚本与第三方工具保留了
  `token` / `Authorization: Bearer` —— 这些客户端用不了 `HttpOnly` Cookie，因此必须有一个**获取** token 的途径。
  代价是这枚 token 对页面 JavaScript 也可读，一旦存在 XSS，就把「借用受害者的浏览器」升级为
  「离线复用凭证」，最长 72 小时。完整分析、残留风险清单与为何仅评为「低」见
  [security.zh-CN.md](./security.zh-CN.md) §3（V-07）。
- **A 步（已实施）**：登录响应带 `Cache-Control: no-store`，中间代理绝无可能回放某个会话。
  一行代码、零兼容代价 —— 它关闭的是那份风险清单里唯一能靠代码单独关闭的一条。
- **B 步（token 改为显式索取）**：普通浏览器登录不再返回 `token`，只有调用方明确要求时才回传
  （请求体带 `withToken: true`，或另开 `POST /login/token`）。脚本按需索取即可继续工作；
  普通浏览器登录从此不再把一个凭证放进可被页面读取的响应体。
  - ⚠️ **只做一半的 B 比看起来更没价值**：它去掉的是**顺带的**暴露（代理缓存、HAR 导出、会记录响应体的 SDK），
    去不掉**主动的**暴露 —— 攻击者的脚本可以自己调 `POST /api/login`。真正的收益要等 C 步。
  - ⚠️ **前端必须同一次提交内改完**，否则自定义 CSS/JS 注入会静默失效：触发点是
    `frontend/src/App.vue:69-76` 的 `watch(() => authStore.token, …, { immediate: true })`，
    而 `authStore.setToken()` 只有登录页会调用。
- **C 步（凭证分离）**：Web 会话只走 Cookie，脚本改用一套独立的、可单独吊销与审计的凭证。
  - **存储**：新增 `api_key` 表 —— `id`、`name`（给人看的备注）、`key_hash`（**只存哈希，绝不存明文**）、
    `prefix`（可见前缀，便于界面列出条目）、`created_at`、`last_used_at`、`revoked_at`。这些列就是全部契约。
  - **接口**：`POST /api/system/apiKey/create`（明文 key **只返回一次**）、`/list`、`/revoke`。
    接受方式用 `Authorization: Bearer sp_<key>`（`sp_` 前缀便于在日志与代码审查中检索），
    服务端哈希后查 `api_key` 表；已吊销或不存在一律 `1001`。
  - **与 `auth_epoch` 的关系**：递增世代**不得**让 API Key 失效（否则改一次密码就会静默打断所有自动化任务）；
    吊销某个 Key 也不得把 Web 会话踢下线。两类凭证走各自的校验路径，互不影响。
  - **C 落地之后 B 才真正划算**：登录接口可以无条件不再返回 token，脚本一律走 `api_key`。
- **迁移顺序（不可跳步）**：① 先上线 B，并在调用方索取时照旧返回 token → ② 把脚本/CLI 改成显式索取 →
  ③ 上线 C → ④ 从登录响应中移除 token，并更新 [deployment.zh-CN.md](./deployment.zh-CN.md) 与本文档。
  每一步都可回滚。
- **B + C 的前端改动**（最容易漏掉的部分）：
  `frontend/src/store/modules/auth/index.ts`（去掉 `token` / `setToken`，改用一个「已认证」标志）、
  `frontend/src/views/login/index.vue`（登录后改调 `updateLocalUserInfo()` —— 它通过 `getAuthInfo` 填充
  `userInfo`，不依赖 token）、`frontend/src/utils/request/index.ts`（去掉 `headers.token` 兜底）、
  `frontend/src/App.vue`（注入触发条件从 `authStore.token` 改为「已认证」标志）。
- **验证**：只有 Cookie、不带 token 头时, 所有页面级请求仍须返回 `0`
  （`getAuthInfo` / `userConfig/get` / `getListWithItems` / `getCustomCode` —— 已实测，见
  [security.zh-CN.md](./security.zh-CN.md) §4）；普通浏览器登录的响应体中不得出现 token；
  自定义 CSS/JS 在「刚登录」与「刷新页面」两种时序下都必须仍然注入；
  用 `withToken: true` 登录的脚本仍能拿到可用 token；被吊销的 API Key 返回 `1001` 而 Web 会话不受影响；
  改密码让会话失效但**不**影响 API Key。请为上述四条前端触发路径补自检 ——
  触发逻辑漏掉时是静默失败（不报错，只是样式没出现）。
- **风险**：中高，主要在前端侧。失败模式是「自定义 CSS/JS 静默失效」而不是崩溃，
  因此上面的人工验证与自检脚本同等重要。
- **需要用户决策**：B 与 C 是否一次做完（建议一次做完 —— 只做 B 收益很小却同样要付前端迁移成本）；
  以及 `api_key` 的接口挂在 `/api/system/` 下还是新开 `/api/key/`。

---

## 10. 全仓库排查结论（本轮）

> 触发：对整个仓库做一次「缺陷 / 异常处理 / 性能 / 弃用内容」的系统排查，并按类别逐条评估后分批落地。
> 本节只记录**结论与裁决**，逐条证据与评估表见当时产出的排查报告（不在仓库内）。

### 10.1 已落地的修复（按批次）

| 批次 | 内容 |
|------|------|
| P0 高危 | `Style/index.vue` 补 `NInputNumber` 导入（「面板最大宽度」输入框原本不可用）；`ImportExport` 导入失败不再用「成功」提示、部分失败不再谎报成功；`ItemGroupManage` 点「添加」前重置表单（原本会静默覆盖正在编辑的分组）、编辑改为浅拷贝；`zh-CN` 的 `common.saveFail` 文案由「保存成功」改为「保存失败」 |
| P1 健壮性 | 首页 `jumpUrl` 空值回退（原本可能跳 `/undefined`）；拖拽 `item-key` 改 `id` 并在保存后同步本地 `sort`；`RoundCardModal` 去掉 `:style="$parent"`；导入 JSON 顶层非对象时给出提示（不再静默失败）；请求层 `failHandler` 修正类型并显示服务端 msg（错误弹窗 50s → 8s）、GET 也带 headers；`updatePanelConfigByCloud` 补 catch 且只在 `code -1` 时重置、保存动作合并为一个入口；删除指向不存在路由的 `reloadRoute`；拖拽手柄改用本地存在的图标（原本空白）；`getFileList` 补 code/异常/loading 复位；设置壁纸等待结果、失败回滚；导出失败不再静默丢数据；上传回调补 `JSON.parse` 保护与 `@error`；搜索框保存补 catch；`max-[400px]` → `max-w-[400px]`；登录页内联样式补单位；`add-frontend-version.js` 版本日期改北京时间口径；`AppIcon` 的 `style` prop 改名 `cardStyle`；`IconEditor` 去掉「靠 computed 缓存传值」的脆弱实现；`useLanguage` 改为 watch 驱动；`AppStarter` 应用列表改 computed（语言切换即时生效）且不再强制覆盖折叠状态 |
| P2 清理 | 删除 15 个整文件死代码（`utils/is`、`utils/format`、`utils/functions`、`utils/crypto` 等）与 3 个空目录；清理约 20 处注释残留；删除 8 个未使用 SVG 图标与 4 张未使用大图（≈620 KB，保留 `avatar.png`）；`store/modules/app`、`panel`、`auth` 的死 action/字段/类型一并移除 |
| P3 依赖 | 移除 `vuedraggable`（零引用）与 `rimraf`；`axios` / `crypto-js` / `@iconify/vue` / `markdown-it-link-attributes` 从 devDependencies 移入 dependencies；删除未生效的 `terserOptions.drop_console`；补 `VITE_APP_VERSION` 类型声明并移除未使用的 env 变量 |
| P4 文档 | 「未提交」等过时说明修正；`scratch/` 描述与自检命令统一；`/about` 版本号改为读根 `package.json`（消除三处硬编码）；关于页补本仓库链接 |
| P5 附加 | §9.3 死文案清理（36 条）+ 审计脚本白名单；§9.8 自定义 CSS/JS 纳入引用检查；后端 `addMultiple` 接受传入 `sort`（导入顺序保真）；删除 `ImportExport` 恒不显示的调试 UI 与「样式配置」死复选框 |

### 10.2 评估后判定「不改」的项（避免误伤）

- `apiMessage` 里调用 `useOsTheme()` **不存在**监听器泄漏（naive-ui 内部以 `usedCount` 计数，根组件已持有实例）。
- 请求层 `code === -1` 保持静默：各调用方已各自提示，统一弹窗会造成重复提示。
- 首页/文件列表的虚拟滚动、面板/引擎两个 deep watch：当前规模（<100 项 + 1s 防抖）下收益不足。
- `1001` 只清 auth store：显式登出已清全部 store，被动失效保留缓存反而体验更好。
- 限流/抓取 fail-open、前端 role 只作展示拦截：均为有意取舍，注释与文档已说明。
- `github-markdown.less` / `highlight.less` / markdown 系依赖**暂不删除**（保留将来做 markdown 渲染的余地，且自定义 CSS 可能引用 `.markdown-body` / `.hljs`）。

### 10.3 仍待处理（需决策或属运维动作）

| 项 | 说明 |
|----|------|
| 本地残留 | 已清理 `.wrangler/state/v3/kv`、8 月的孤儿 D1 文件（4 KB，仅含种子数据）与 5 个空目录；**仅剩根目录 `.dev-web.log` / `.dev-worker.log`** 两个开发日志（工具的安全删除被拒，需手动删；已被 `.gitignore` 覆盖） |
| 云端残留 | 孤儿 KV namespace `sun-panel-login-rate` —— 实测 **0 个 key**，纯清理项（Dashboard 手动删即可）；线上 D1 仍有 `module_config` / `notice` 两张历史表，其中 **`module_config` 有 1 行历史数据**（旧版搜索框配置，代码已不再读取），删表前建议先备份 |
| §9.6 | `/uploads/*` 边缘缓存（运维侧可选，取舍见 §9.6） |
| §9.10 ~ 9.13 | 待明确需求 / 待决策（详见 §9 末尾；9.13 为安全审查 V-07 的 B+C 打包方案） |
| 安全审查未结项 | V-01（默认口令强制改密）与 V-08（未配 pepper 时拒绝改密）待处置；V-06 / V-07（B+C 见 §9.13）/ V-09 已评估并接受，理由见 [security.zh-CN.md](./security.zh-CN.md) §3 |

### 10.4 提交建议

本轮改动跨前后端与文档，建议按 P0+P1（行为修复）→ P2+P3（清理与依赖）→ P4+P5（文档与附加项）→ P6（本轮第二批，见 §10.5）拆四个提交；
每批提交前跑 `npm run check` 与附录 C 的全部自检脚本；`dist/` 已 gitignore，部署前由构建流程生成。

### 10.5 本轮第二批（排查结论落地后追加）

> 触发：用户要求「核对未被使用的 openness 接口 → 清除；补 `onlyName` 的导入导出；评估并优化 §9.4 / §9.9；整理 docs/」。

| 主题 | 结论与落地 |
|------|-----------|
| **openness 接口清除** | 全仓库核对（含 `-SimpleMatch` 误用导致的漏检复核）确认零使用后删除：前端 `api/openness.ts`、类型 `typings/openness/openness.d.ts`、后端 `src/api/openness.ts` 与其在 `src/api/index.ts` 的挂载；连带移除只被它使用的 `SETTING_SYSTEM_APPLICATION` / `SETTING_DISCLAIMER` / `SETTING_WEB_ABOUT_DESCRIPTION`、`getSettingJson` / `setSettingJson`，以及 `0001_init.sql` 里对应的三行种子（**只影响全新库**；线上库残留的三行设置与两张历史表保留无害，见 §10.3） |
| **`onlyName` 导入导出** | 导出结构 `Icon` 增加可选 `onlyName`（向后兼容旧文件）；导出时带上、导入时提交；后端 `addMultiple` 归一化（去空白/剔非法字符/截断 50）并对「库内已占用 + 批内重复」降级为空串，把被丢弃的标识回报给前端提示；单条 `edit` 复用同一套归一化（原本只在服务端查重、不校验字符集）。自检 `scratch/only-name-import.test.ts`：**8 passed** |
| **§9.4 Cookie** | 见 §9.4 落地结果（HttpOnly + SameSite=Lax + 写操作跨站校验；持久化层不再存 token） |
| **§9.9 子请求** | 见 §9.9 落地结果（固定 3 次读取 + 分片批量更新 + `limit`/`remaining` 分批）。额外发现：**免费版每次调用只有 50 个子请求**（官方限制），因此大批量清理必须分批 —— 这正是 `limit` 与前端循环的由来 |
| **docs/ 整理** | `history/` 收纳迁移设计与早期需求清单（`migration-plan.md`、`todo.md`）；`docs/README.md` 重写为「文档地图 + 职责表 + 维护约定」；`deployment.md` 去掉与根 README 重复的技术栈/差异表；`storage.md` 新增「Cloudflare 资源与免费层额度」实测章节；待明确需求集中到 §9.10~9.12 |

---

## 附录 A：`0001_init.sql` 结构（§5.1 之后的现状）

```
-- 表 1 item_icon         id, created_at, updated_at, deleted_at, icon_json, title, url, lan_url,
--                        description, open_method, sort, item_icon_group_id, only_name(原 0003)
--                        index: idx_item_icon_group_id
-- 表 2 item_icon_group   id, created_at, updated_at, deleted_at, icon, title, description, sort,
--                        card_style(原 0002), text_color(原 0002), hide_description(原 0002)
-- 表 3 user_config       单行 id=1(CHECK), created_at, updated_at, panel_json, search_engine_json
-- 表 4 system_setting    id, config_name(UNIQUE), config_value
--                        （键: 管理员账号/密码/昵称/头像、custom_css、custom_js、auth_epoch、
--                          storage_auto_clean_unused —— 除账号四项外都是按需写入, 不在基线里预置；
--                          system_application / disclaimer / web_about_description 已随 /openness 接口删除, 见 §10.5）
-- 表 5 file              id, created_at, updated_at, deleted_at, src, file_name, method, ext
-- 表 6 login_attempt     ip(PK), fail_count, window_start   index: idx_login_attempt_window
-- 种子  system_setting ×4（admin_username/admin_password/admin_name/admin_head_image）
-- 种子  item_icon_group ×1（默认分组 APP）
-- 已移除（不再创建）: module_config、notice —— 见 §5.1；已部署库里的空表保留不动
```

> **线上实例实测（2026-09-21，`wrangler d1 execute --remote`）**：11 张表（6 张业务表 + `d1_migrations` + `sqlite_sequence` + `_cf_KV` + 历史遗留的 `module_config` / `notice`），
> `system_setting` 7 行（旧的 3 个已废弃键仍在）、`module_config` 1 行历史数据、`notice` 0 行、`item_icon` 1 / `item_icon_group` 2 / `file` 2 / `login_attempt` 0。
> 也就是说：**这个库建于 2026-09-04**，早于 §5.1（不再建表）与本轮（不再种入 3 个设置键），所以历史表与废弃键都还在 —— 代码已不访问，属于无害残留。

## 附录 B：登录限流 SQL

```sql
-- 1) 校验前读取
SELECT fail_count, window_start FROM login_attempt WHERE ip = ?;
--    isLocked: window_start + 600 > now && fail_count >= 5  →  1008

-- 2) 记录一次失败（原子；now - 600 由参数传入，滑动窗口）
INSERT INTO login_attempt (ip, fail_count, window_start) VALUES (?, 1, ?)
ON CONFLICT(ip) DO UPDATE SET
  fail_count   = CASE WHEN login_attempt.window_start < ? THEN 1
                      ELSE login_attempt.fail_count + 1 END,
  window_start = ?;
--    绑定顺序: ip, now, now-600, now

-- 3) 登录成功清除
DELETE FROM login_attempt WHERE ip = ?;

-- 4) 概率清理（1/50，与 2) 一起 db.batch 提交）
DELETE FROM login_attempt WHERE window_start < ?;   -- 绑定: now-600
```

## 附录 C：自检脚本与命令

```bash
# 前端纯逻辑自检（仓库约定：esbuild 打包 + node 运行）
node_modules/.bin/esbuild scratch/panel-filter.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/panel-filter.mjs --log-level=warning && node scratch/panel-filter.mjs
node_modules/.bin/esbuild scratch/login-rate.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/login-rate.mjs --log-level=warning && node scratch/login-rate.mjs
node_modules/.bin/esbuild scratch/upload-validate.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/upload-validate.mjs --log-level=warning && node scratch/upload-validate.mjs
node_modules/.bin/esbuild scratch/password-hash.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/password-hash.mjs --log-level=warning && node scratch/password-hash.mjs
node_modules/.bin/esbuild scratch/auth-epoch.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/auth-epoch.mjs --log-level=warning && node scratch/auth-epoch.mjs
node_modules/.bin/esbuild scratch/upload-refs.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/upload-refs.mjs --log-level=warning && node scratch/upload-refs.mjs
node_modules/.bin/esbuild scratch/group-with-items.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/group-with-items.mjs --log-level=warning && node scratch/group-with-items.mjs
node_modules/.bin/esbuild scratch/upload-clean-setting.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/upload-clean-setting.mjs --log-level=warning && node scratch/upload-clean-setting.mjs
node_modules/.bin/esbuild scratch/favicon-candidates.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/favicon-candidates.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/favicon-candidates.mjs
node_modules/.bin/esbuild scratch/i18n-audit.ts --bundle --platform=node --format=esm \
  --outfile=scratch/i18n-audit.mjs --log-level=warning && node scratch/i18n-audit.mjs
# 注意: CJS 格式不支持顶层 await, 统一用 esm + .mjs; 产物用完请删除 (未加 gitignore)
# 唯一例外: search-engine-util 需要 --loader:.svg=text 处理内置图标 (esm / cjs 均可)
node_modules/.bin/esbuild scratch/search-engine-util.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/search-engine-util.mjs --loader:.svg=text --log-level=warning && node scratch/search-engine-util.mjs
# 会话 Cookie / CSRF 防线 (§9.4)
node_modules/.bin/esbuild scratch/auth-cookie.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/auth-cookie.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/auth-cookie.mjs
# 后端路由级自检 (含浏览器/加密全局垫片):
node_modules/.bin/esbuild scratch/user-config-merge.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/merge.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/merge.mjs
node_modules/.bin/esbuild scratch/only-name-import.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/only-name.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/only-name.mjs
# 安全审查修复项 (V-02A 限流键 / V-02B JWT_SECRET / V-03 自定义代码需鉴权 /
# V-04 不回传 DB 错误原文 / V-05 请求体上限) —— 详见 docs/security.zh-CN.md
node_modules/.bin/esbuild scratch/security-fixes.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/security-fixes.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/security-fixes.mjs

# 结果速查 (最近一次实测): panel-filter 27 · login-rate 18 · upload-validate 55 · password-hash 29 ·
# auth-epoch 23 · auth-cookie 17 · upload-refs 35 · group-with-items 15 · upload-clean-setting 23 ·
# favicon-candidates 48 · user-config-merge 16 · only-name-import 8 · search-engine-util 50 · security-fixes 46 ·
# i18n-audit 缺失 0 / 不齐 0 / 死文案 0（白名单 20）

# 迁移与新库校验
npm run migrations:apply:local          # 新库: 期望一次建全 8 张业务表(含 login_attempt) + 全部列
npx wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 migrations list DB --remote   # 老库: 期望三个名字均已记录

# 质量闸门
npm run check      # 根 typecheck + 前端 type-check + eslint
npm run deploy:all # 构建 + 部署
```

## 附录 D：提交拆分建议

| PR | 内容 | 备注 |
|----|------|------|
| PR-A | §2.1 migrations 合并 + §2.3 限流迁 D1 + §2.4 移除 KV（§2.5 已取消） + 文档同步 | ✅ 已完成；代码与迁移已就绪，可直接重新部署 |
| PR-B | §3.1 上传/抓取校验 | ✅ 已完成（自检 45 passed + 端到端 curl 验证） |
| PR-C | §3.2 密码哈希升级（含 `PASSWORD_PEPPER`） | ✅ 已完成（自检 29 passed；端到端确认旧哈希登录后自动升级） |
| PR-D | §3.3 JWT 可吊销 + `exp` 缩短 | ✅ 已完成（自检 23 passed；端到端确认旧 token 返回 1001）；破坏性：老 token 失效一次 |
| PR-E | §4.1 R2 一致性 + §4.2 getListWithItems + §4.3 缓存 | ✅ 已完成（自检 22 + 15 passed；端到端验证稳定 key / 引用保护 / 删除回收 / 缓存头） |
| PR-F | §5.1 死存储清理 | ✅ 已完成（经确认后删除代码 + 新库不建表；老库空表保留） |
| PR-G | §6.x 文档与备份 + `dist/` 重建 | ✅ 已完成（新增 storage.md、deployment 增备份章节、dist 已重建并核对内容） |

---

## 变更记录

| 日期 | 内容 |
|------|------|
| 本轮 | 建立本计划；记录决策 D1–D4；完成 §7 两项前端改动 |
| 本轮（PR-A） | 完成 §2.1 / §2.3 / §2.4：`migrations/` 合并为单文件基线、限流迁 D1 并加惰性建表兜底、KV 全部移除；记录决策 D5（取消 `docs/sql/` 一次性脚本）；新增 `scratch/login-rate.test.ts`；README / docs/deployment.md / package.json 同步 |
| 本轮（PR-B/C/D） | 完成 §3.1 / §3.2 / §3.3：上传与抓取校验、密码哈希升级（PBKDF2 + 可选 pepper，决策 D6）、JWT 世代吊销（`auth_epoch` + 72h）；新增 `scratch/upload-validate.test.ts`、`scratch/password-hash.test.ts`、`scratch/auth-epoch.test.ts`；端到端验证抓到并修掉 `bumpAuthEpoch` 首次递增的 off-by-one |
| 本轮（PR-E） | 完成 §4.1 / §4.2 / §4.3：站点图标稳定 key + 引用感知的 R2 回收 + `cleanUnused` 接口与前端按钮、首页 `getListWithItems` 去 N+1、缓存头整理（决策 D7：不做 Worker 侧边缘缓存）；新增 `scratch/upload-refs.test.ts`、`scratch/group-with-items.test.ts`；自检抓到 `cleanupUploads` 会误删外链的缺陷并已修 |
| 本轮（PR-F + §5.2/5.3） | 完成 §5.1（删 `notice` / `moduleConfig` 全部代码，`0001_init.sql` 不再建这两张表；老库空表保留）、§5.2（删 `ASSETS` binding，附官方依据）、§5.3（决定不加乐观锁，改为 README「已知限制」提示）；删代码后 `tsc` / `vue-tsc` / `eslint` / 10 个自检脚本 / i18n 审计全通过，并用全新库验证基线只剩 6 张业务表（11 条语句执行成功） |
| 本轮（PR-G） | 完成 §6.1 / §6.2 / §6.3：`docs/deployment.md` 增「备份与恢复」、新增 `docs/storage.md`（资源/表/R2 布局/本地状态/结构变更约定）、`vite build` 重建 `dist/` 并核对产物内容。**改进计划全部条目结项**（§5.3 为「按决策不做」） |
| 本轮（结项后追加 + 文档答疑） | 按用户需求实现 §9.0 图片回收开关（决策 D8，含 `scratch/upload-clean-setting.test.ts` 23 断言 + 真实 D1/R2 端到端双分支验证）并重建 `dist/`；新增 §9「后续候选详细计划」（9.1~9.8）；修正 `docs/todo.md` 批次三 #3 的过时表述与附录 A 的表清单（§5.1 之后只剩 6 张表） |
| 本轮（计划调整 + 文档） | 按用户指示调整 §9：**新增 9.2「获取图标弹窗选一张」**（含后端候选解析/两个新接口、前端 `FaviconPicker.vue`、i18n、自检与端到端验证步骤）、**移除原 9.4（PBKDF2 迭代数）与原 9.7（仓库原有待确认需求）**、编号重新连续化；[storage.zh-CN.md](./storage.zh-CN.md) 新增 **§3.1「图片回收：两个入口、判定规则与开关」**（开关默认值/失败方向/按钮链路/场景对照/盲区） |
| 本轮（A1+A2+B1 落地） | 完成 §9.1（`apiErrorCode.1009` 中英各一条，登录页可见密码配置异常）、§9.5（`JWT_SECRET` 弱密钥一次性告警 + 部署文档补 `openssl rand -base64 48`）、§9.2（`extractIconCandidates` + 候选/保存两个接口 + `FaviconPicker.vue` 弹窗，旧接口保留；新增自检 `scratch/favicon-candidates.test.ts` **48 passed**）；`npm run check` 与 i18n 审计通过，`dist/` 重建 |
| 本轮（待办标记补全） | §9 顶部新增「待用户操作」清单（secrets / 部署 / 首登确认 / 可选清理）；§7 收尾的「未提交」提示更新为覆盖 §2 ~ §9 全部改动；§9.7 的 PR-I 更新为「§9.1 / §9.2 / §9.5 已完成」并补手动回归第 ⑥ 条（多候选弹窗） |
| 本轮（全仓库排查） | 新增 §10：一次系统排查后按 P0~P5 分批落地 —— 4 项高危修复（`NInputNumber` 缺失、导入导出假成功、分组静默覆盖、`saveFail` 文案）、约 25 项健壮性修复、15 个死文件与约 620 KB 未使用资源清理、依赖与配置整理（-2 依赖、4 个移入 dependencies）、文档同步与版本号统一；同时完成 §9.3（删 36 条死文案 + 审计白名单）与 §9.8（自定义 CSS/JS 纳入引用检查）；12 个自检脚本全绿，`npm run check` 0 error / 0 warning |
| 本轮（第二批） | 新增 §10.5：清除未被使用的 `/openness/*` 三个接口及其设置键、种子（前端封装与类型一并删）；`onlyName` 贯通导入导出并在后端做归一化/去重（新增 `scratch/only-name-import.test.ts` 8 断言）；§9.4 完成（HttpOnly Cookie + SameSite=Lax + 写操作跨站校验 + token 不再落盘，新增 `scratch/auth-cookie.test.ts` 17 断言）；§9.9 完成（固定 3 次引用读取 + 分片批量更新 + `limit`/`remaining` 分批，`upload-refs` 扩到 35 断言）；`docs/` 重组（`history/` 归档、索引重写、storage 增免费层额度章节、deployment 去重）；共 14 个自检脚本全绿 |
| 本轮（第四批·资源改名） | 命名基线更新：Worker → `sun-panel-on-cloudflare-worker`，D1 → `sun-panel-on-cloudflare-worker_db`，R2 → `sun-panel-on-cloudflare-worker-files`（**实测约束**：R2 桶名不允许下划线，故用连字符）；`wrangler.toml` 与 deployment.md（导入说明、访问 URL、创建与迁移命令、备份恢复）、storage.md（资源表、免费层实测）、双语 README 全部同步；`wrangler deploy --dry-run` 校验通过（`env.DB` / `env.FILES` 均正确解析） |
| 本轮（第五批·docs 全量双语） | `docs/` 下 10 份文档全部改为双语对，命名与根 README 一致：中文版为 `*.zh-CN.md`，英文版占用原文件名；每份顶部加一行语言切换入口 `[English](X.md) | [简体中文](X.zh-CN.md)`（格式同根 README，不设标题）。中文版内容未改写，仅新增切换行并把内部链接按语言分流（`./storage.md` → `./storage.zh-CN.md`、根 README → `README.zh-CN.md`）；英文版为逐节翻译，章节编号（§2.2、§9.9、附录 A/C 等）与中文版对齐，`src/*.ts` 注释里的 `docs/improvement-plan.md §x.y` 引用继续有效；`docs/README.md` 补充双语文件地图与「同语言互链」「双语一份都不许漏」约定；根 README 两版与 `history/`、`upstream/` 存档的链接同步更新；相对链接校验通过 |
| 本轮（第三批·文档与双语） | 根 README 拆为双语对：`README.md`（英文）与 `README.zh-CN.md`（中文），两者顶部带语言切换入口、许可证段落分别按 `This project is licensed under the [MIT License](LICENSE).` / `本项目采用 [MIT License](LICENSE)。` 撰写并补上游作者署名说明；**部署章节改写为 Workers Git 集成流程**（连接仓库 → 两条命令 → 补 `JWT_SECRET` → `git push` 自动部署），详细说明仍指向 deployment.md；`docs/history/` 按主题重组为 `migration/plan.md` 与 `requirements/early-todo.md` 并新增归档判定标准（`history/README.md`）；`improvement-plan.md` 经判定**保留在 `docs/` 根下**（§9/§10 仍是活跃待办且被多处按锚点引用）；`docs/README.md` 增双语同步约定与链接层级说明；12 份文档相对链接校验通过 |
| 本轮（第六批·代码注释双语化） | 全仓库代码注释统一为「英文在前、中文在后」双语注释：单行注释两语言紧邻不留空行；多行注释段内留 1 个空行，语言之间按示例 —— 单段注释留 1 个空行、多段（含分段）注释留 2 个空行。覆盖 `src/`（22 文件）、`scratch/`（14）、`frontend/src`（54）以及 `migrations/0001_init.sql`、`wrangler.toml`、`.dev.vars.example`、`frontend` 的配置与构建脚本；注释掉的代码与 `/// <reference>`、`@type` 等工具指令保持原样。校验方式：自检脚本比对「去掉注释后的代码」与 HEAD，结果 **0 处代码改动**；同时扫描纯中文/纯英文注释块，仅剩刻意保留的注释代码与指令行 |
| 本轮（安全审查） | 全仓安全审查（注入 / 权限绕过 / 数据泄露 / 输入校验 / 硬编码 / OWASP Top10）产出问题清单 `V-01`…`V-09`，并修复其中 4 组：V-02A（限流键只信任 `cf-connecting-ip`，缺失时回落共享分桶并告警）、V-02B（`JWT_SECRET` 空/空白时 fail-closed，登录/中间件/`onError` 三处 503）、V-03（`getCustomCode` 加鉴权，前端改为有 token 才注入）、V-04（新增 `internalError`，8 处不再回传存储/DB 原文）、V-05（新增 `bodyLimit` 中间件覆盖 22 个端点 + 批量/删除条数上限）；新增自检 `scratch/security-fixes.test.ts` **42 passed**；端到端验证（真实 workerd）：限流分桶按 IP 独立且伪造 `X-Forwarded-For` 无效、2 MB 登录体与 52 MB 上传均 413、仅 Cookie 会话可完成全部页面级请求、跨站写 1005。**结论与编号落库为 [security.zh-CN.md](./security.zh-CN.md)**（信任边界 + 问题清单 + 已验证性质 + 刻意不设防项），V-01 / V-08 仍待处置 |
| 本轮（V-07 A 步 + 文档收口） | 实施 V-07 的 A 步：登录响应加 `Cache-Control: no-store`，消除「中间代理回放响应体」这条唯一能靠代码单独关闭的风险。文档侧：新增双语 [security.zh-CN.md](./security.zh-CN.md) / `security.md` 并登记进 `docs/README` 的文档地图、职责表与阅读路径，明确「问题编号永不重编」；V-07 的 B+C 实施方案写入 §9.13（迁移顺序、`api_key` 表结构契约、前端四处必改点、验证清单）；`src/` 里 27 处 `V-0x` 注释全部改为指向 `docs/security.md §3`，不再依赖任何仓库外的临时报告；`docs/` 外的审查报告已删除，避免与 `docs/security.zh-CN.md` 形成第二份真相 |
| 本轮（文档微调·语言切换入口） | 去掉此前误加的 `# Language Switch` 标题：22 份双语文档（`docs/` 根、`history/`、`upstream/` 各对）顶部只保留一行 `[English](X.md) | [简体中文](X.zh-CN.md)`（有 front matter 的文档紧随其后）；同步改写 `docs/README` 的维护约定与上表「第五批」的措辞；全仓扫描确认已无 `# Language Switch` 标题，且每对文档的切换入口都还在 |
| 本轮（文档整理 + 网址收敛） | `wrangler.toml` 新增 `workers_dev = true` 与 `preview_urls = false`（关闭版本 URL：旧部署不再经 `*.workers.dev` 公开可达；若将来启用非生产分支预览构建需重新打开）；`docs/images/` 更名为 `docs/assets/`，根 README 与上游存档的图片链接同步更新；10 份内容文档头部新增轻量 YAML front matter（`title` / `status` / `audience` / `last_verified`）；`docs/README` 补充稳定路径约定（被 `src/` 注释与 `migrations/` 引用的文档路径是契约）、平铺结构决策（Diátaxis 分类放在索引里而非建子目录）、front matter 约定与 `docs/assets/` 命名规则 |
| 本轮（文档微调·切换行位置 + 严格同语言互链） | 22 份双语文档（`docs/` 根、`history/`、`upstream/` 各对）的语言切换行统一**移到 H1 标题正下方**，与根 README 完全一致（`# 标题` → 空行 → `[English](X.md) | [简体中文](X.zh-CN.md)` → 空行 → `---`），取代此前「文件第一行」的摆放；front matter 与正文未改动。同时清理切换行之外的全部跨语言链接，让「同语言互链」严格成立：根 README 两版、`docs/README`、`docs/deployment`、`docs/history/README`、`docs/improvement-plan`、`docs/upstream` 中对「另一种语言」的引用一律改为代码标注，中文侧链接文字 `docs/storage.md` 校正为 `docs/storage.zh-CN.md`。根 README 两版与 `docs/README` 维护约定里「切换入口在顶部」的表述同步改为「标题下方」；校验脚本对 22 份文档做头部结构检查（H1 → 切换行 → `---`）、相对链接存在性检查，并确认切换行之外已无任何跨语言链接 |
