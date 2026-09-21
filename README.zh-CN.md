# Language Switch

[English](README.md) | [简体中文](README.zh-CN.md)

---

<div align=center>

<img src="./docs/images/logo.png" width="100" height="100" />

# Sun-Panel-on-Cloudflare-Worker

把 [Sun-Panel](https://github.com/hslr-s/sun-panel)（Vue 3 前端 + Go 后端）移植到 **Cloudflare Workers** 的单用户版本。

Worker (Hono) + D1 + R2 + Vue 3

[![Repo](https://img.shields.io/badge/Github-123456?logo=github&labelColor=242424)](https://github.com/Bosco1262/Sun-Panel-on-Cloudflare-Worker)
[![Upstream](https://img.shields.io/badge/Upstream-sun--panel-blue?logo=github&labelColor=242424)](https://github.com/hslr-s/sun-panel)

</div>

> [!NOTE]
> 本仓库是上游 [hslr-s/sun-panel](https://github.com/hslr-s/sun-panel) 的社区移植版本：
> 后端由 Go (Gin) + SQLite 改写为 Cloudflare Worker (Hono) + D1/R2，前端沿用上游 Vue 3 代码并做适配。
> 上游 README 原文见 [docs/upstream/README.md](./docs/upstream/README.md)。
> 深入文档从 [docs/README.md](./docs/README.md)（文档索引）进入。

![](./docs/images/main-dark.png)

## ☁️ 技术栈

| 层 | 实现 |
|----|------|
| 后端 | Cloudflare Worker + Hono (TypeScript)，位于根目录 `src/` |
| 数据库 | Cloudflare D1 (SQLite) |
| 文件存储 | Cloudflare R2（头像、图片、文件上传，`/uploads/*` 由 Worker 代理） |
| 登录限流 | Cloudflare D1（同一 IP 10 分钟内最多失败 5 次，滑动窗口；单条 UPSERT 原子计数） |
| 前端 | Vue 3 + Vite + Naive UI + Pinia（构建产物输出到根目录 `dist/`） |
| 鉴权 | JWT（jose，无状态，72 小时有效期；`auth_epoch` 世代号支持改密/退出所有设备即刻吊销）。会话承载在 **HttpOnly Cookie**（`SameSite=Lax`，写操作另有跨站校验），token 不再写入 localStorage；命令行工具仍可用 `token` 请求头 |
| 密码存储 | 默认兼容上游三重 MD5；配置 `PASSWORD_PEPPER` 后使用 PBKDF2-SHA256 + 随机盐 + pepper，旧哈希登录时自动升级 |

## 🚀 快速开始

### 本地开发

```bash
# 1. 安装依赖 (含 frontend workspace)
npm install

# 2. 复制环境变量 (Windows 用 copy; macOS / Linux 用 cp)
copy frontend\.env.example frontend\.env
copy .dev.vars.example .dev.vars

# 3. 初始化本地数据库
npm run migrations:apply:local

# 4. 启动开发环境
npm run dev        # 终端 1: Worker + 本地 D1/R2 (http://127.0.0.1:8787)
npm run dev:web    # 终端 2: 前端热更新 (http://127.0.0.1:1002)
```

默认账号 `admin` / `12345678`，登录后可在「用户信息」中修改。

### 部署到 Cloudflare（Workers Git 集成，推荐）

只需要**连一次仓库**，之后每次 `git push` 都会自动构建、部署并应用新增的 D1 迁移。
D1 与 R2 会在部署时**自动创建并绑定**（wrangler ≥ 4.45 的自动资源供应），既不用手动建资源，也不用在本地安装 wrangler。

1. **把本仓库推送到你自己的 GitHub 账号**（Fork 或导入皆可）。
2. **在控制台连接仓库**：Cloudflare Dashboard → **Workers & Pages → Create → Import a repository** → 选择该仓库。
   Worker 名称填 `sun-panel-on-cloudflare-worker`（必须与 `wrangler.toml` 里的 `name` 一致）。
3. **填写两条命令**：

   | 配置项 | 值 |
   |--------|-----|
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy && npx wrangler d1 migrations apply sun-panel-on-cloudflare-worker_db --remote` |

   > 构建命令**不要**写成 `npm install && npm run build`：Workers Builds 在执行构建命令前会自动安装依赖，
   > 再装一遍只会白花几分钟。
   > 迁移命令必须放在 `deploy` **之后**：D1 是在部署阶段被自动创建出来的，顺序颠倒会报
   > `Couldn't find an auto-provisioned D1 DB named 'sun-panel'`。
4. **首次部署成功后补一个 Secret**：`JWT_SECRET`（登录签名用，随机值，例如 `openssl rand -base64 48`，长度 ≥32 字符）
   → Worker → **Settings → Variables and Secrets** 添加。Secret 无法由构建流程创建。
5. 完成 —— 此后只需 `git push`。

> 细节（自动资源供应、迁移步骤所需的 D1 权限、预览环境、本地 wrangler 部署方式、备份恢复与常见问题）
> 见 **[docs/deployment.md](./docs/deployment.md)**。

## 🗂️ 仓库结构

```
├── src/                     # Worker 后端源码 (Hono)
│   ├── api/                 # 路由: panel/ 与 system/ 分层，与前端 src/api/ 一一对应
│   ├── middleware/          # JWT 鉴权中间件 (+ Cookie 认证写操作的跨站校验)
│   └── utils/               # 响应格式 / 密码 / JWT / 文件 / 系统设置 / 站点图标
├── migrations/              # D1 数据库迁移
├── frontend/                # Vue 3 前端 (npm workspace)
├── dist/                    # 前端构建产物 (gitignored, 由 Worker 静态托管)
├── docs/                    # 项目文档 (索引见 docs/README.md; history/ 为历史存档, upstream/ 为上游资料)
├── reference/               # 上游源码对照副本 (gitignored, 不参与构建)
├── wrangler.toml            # Worker 配置 (D1/R2/静态资源; 无 assets binding, 见 docs/improvement-plan.md §5.2)
├── .dev.vars                # 本地开发环境变量 (gitignored, 模板见 .dev.vars.example)
├── package.json             # 根包: Worker 依赖 + 脚本 + frontend workspace
└── tsconfig.json            # Worker TypeScript 配置
```

## 📚 文档

| 文档 | 内容 |
|------|------|
| [docs/README.md](./docs/README.md) | **文档索引**：文档地图、职责划分与维护约定（从这里进） |
| [docs/deployment.md](./docs/deployment.md) | 部署与本地开发完整说明、常见问题、备份与恢复 |
| [docs/storage.md](./docs/storage.md) | 数据与资源：D1 各表用途、R2 对象布局与回收、本地 `.wrangler` 状态、**Cloudflare 免费层额度与实测用量** |
| [docs/search-engine.md](./docs/search-engine.md) | 搜索引擎设置（风格设置管理区）使用说明、占位符规则 |
| [docs/improvement-plan.md](./docs/improvement-plan.md) | 改进计划：待办候选（§9）、全仓库排查结论（§10）、已结项记录与**自检脚本清单**（附录 C） |
| [docs/history/](./docs/history/) | 历史存档：迁移设计（`migration/plan.md`）、早期需求清单（`requirements/early-todo.md`） |
| [docs/upstream/README.md](./docs/upstream/README.md) | 上游原版 README（特性、截图、致谢） |
| [docs/upstream/CHANGELOG.md](./docs/upstream/CHANGELOG.md) | 上游更新日志 |

## 🔀 与上游 (Sun-Panel v1.3.0) 的差异

| 功能 | 说明 |
|------|------|
| 单用户 | 无多用户/注册/公开访客模式，账号信息存于 D1 `system_setting` |
| 系统监控 | 已移除（Worker 无法读取宿主机信息） |
| 图形验证码/邮件 | 已移除（仅密码登录） |
| 文件存储 | 本地磁盘 → R2（路径 `/uploads/*` 由 Worker 代理） |
| 站点图标 | 抓取后下载存至 R2（与手动上传的图标统一存放于 R2） |
| 鉴权 | 内存 Token → JWT (无状态, 72 小时有效期 + `auth_epoch` 世代可吊销) + HttpOnly Cookie 承载会话 |
| 密码存储 | 三重 MD5 → 可选 PBKDF2-SHA256 + 随机盐 + pepper（配了 `PASSWORD_PEPPER` 才启用，登录时自动升级旧哈希） |
| 登录保护 | 验证码/邮件 → D1 级失败限流 (同一 IP 10 分钟内最多失败 5 次) |
| 数据库迁移 | `migrations/` 合并为单个 `0001_init.sql` 基线（只对全新库生效，约定见 docs/improvement-plan.md §2.2） |

> 「v1.3.0」指本移植版所基于的上游**最后一个开源代码版本**：上游自 v1.4.0 起转为闭源发布
> （最新发布版本 v1.8.1，2025-12-31），其 README 至今仍写明「目前开源最新版本为 v1.3.0」。
> 上游完整更新日志见 <https://doc.sun-panel.top/zh_cn/update/update_log.html>。

> 前端构建产物统一输出到根目录 `dist/`，由 Worker 静态资源托管；`frontend/` 仅存放源码。

## ⚠️ 已知限制

| 限制 | 说明 |
|------|------|
| 多标签页同时改配置 | 面板样式与搜索引擎配置存在 `user_config` 的整份 JSON 里（覆盖写），**请避免多个标签页同时修改**，否则后保存的会覆盖先保存的 |
| 删除图片后的浏览器缓存 | `/uploads/*` 的上传文件带 `immutable`（最长 24 小时），删掉文件后同一 URL 仍可能命中浏览器缓存，硬刷新即可 |
| 迁移基线 | `migrations/0001_init.sql` 只对**全新库**生效；已部署库的结构变化需按 `docs/improvement-plan.md` §2.2 的约定处理 |
| 自定义 JS/CSS | 由管理员自己填写并注入所有页面，等同于给自己开了一个 XSS 入口，请只粘贴可信代码 |
| 会话依赖 Cookie | 登录态存放在 HttpOnly Cookie 里，浏览器禁用 Cookie（或跨站策略拦截）会无法登录；命令行脚本仍可用 `token` 请求头 |

## 📄 许可证

本项目采用 [MIT License](LICENSE)。

本仓库是上游 [Sun-Panel](https://github.com/hslr-s/sun-panel) 的社区移植版本：原始版权声明（**© 2023 红烧猎人 / hslr-s**）
保留在 [LICENSE](./LICENSE) 中。依照 MIT 协议，二次分发与衍生作品必须保留该版权声明 —— 感谢上游作者的原始设计与实现。
