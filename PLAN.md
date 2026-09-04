# Sun-Panel → Cloudflare Worker 迁移计划

## 项目现状分析

Sun-Panel 是一个 **Go (Gin) + Vue 3** 的服务器导航面板应用，当前架构：

- **后端**: Go + Gin 框架，SQLite/MySQL 数据库，本地文件系统存储
- **前端**: Vue 3 + Vite + Naive UI + Pinia + TypeScript
- **部署方式**: Docker 容器，前后端编译后打包在一起

### 核心功能清单

| 功能 | 当前实现 | Worker 适配性 |
|------|---------|-------------|
| 用户登录/鉴权 | Go内存缓存+DB Token | ✅ 需改用 JWT + KV |
| 书签图标管理 (ItemIcon) | GORM CRUD | ✅ 需改用 D1/KV |
| 图标分组管理 (ItemIconGroup) | GORM CRUD | ✅ 需改用 D1/KV |
| 用户配置 (面板样式/搜索引擎) | GORM JSON字段 | ✅ 需改用 D1/KV |
| 模块配置 (时钟/搜索框等) | GORM JSON字段 | ✅ 需改用 D1/KV |
| 文件上传 (图片/文件) | 本地文件系统 | ⚠️ 需改用 R2 |
| 系统监控 (CPU/内存/磁盘) | gopsutil 本机读取 | ❌ 不适用，需移除或简化 |
| 系统设置 (SystemSetting) | GORM CRUD | ✅ 需改用 KV |
| 通知 (Notice) | GORM CRUD | ✅ 需改用 D1 |
| 验证码 | go-cache 内存 | ⚠️ 需改用 KV+简化 |
| 网站图标获取 | 网络抓取+本地下载 | ⚠️ 需改用代理获取URL |
| 公开访问模式 | 缓存公开用户Token | ✅ 需改用 JWT |

### 技术约束

- Cloudflare Worker **无本地文件系统** → 文件存储改用 R2
- Worker **无持久内存** → 缓存改用 KV / 内存仅在单次请求内有效
- Worker **单次请求有 CPU 时间限制** (免费10ms, 付费30s) → 需精简逻辑
- Worker **不支持原生 SQLite** → 使用 Cloudflare D1 (SQLite-compatible)
- Worker **不支持长连接** → 无 WebSocket，无需考虑

---

## 迁移架构设计

```
┌──────────────────────────────────────────────┐
│                Cloudflare Worker               │
│                                                │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │  前端 SPA    │  │   API 路由处理        │   │
│  │ (Vue 3 构建) │  │ (Hono 框架)          │   │
│  │ 静态资源     │  │                       │   │
│  │ /assets/*   │  │  /api/* → 业务逻辑    │   │
│  │ /index.html │  │                       │   │
│  └─────────────┘  └──────────────────────┘   │
│                                                │
│  ┌──────┐  ┌──────┐  ┌──────┐                │
│  │  D1  │  │  KV  │  │  R2  │                │
│  │数据库│  │缓存  │  │文件  │                │
│  └──────┘  └──────┘  └──────┘                │
└──────────────────────────────────────────────┘
```

**核心选型决策**：
- **API 框架**: Hono (轻量、Cloudflare Worker 原生支持、TypeScript)
- **数据库**: Cloudflare D1 (Serverless SQLite)
- **缓存/配置**: Cloudflare KV (低延迟键值存储)
- **文件存储**: Cloudflare R2 (S3-compatible 对象存储)
- **鉴权**: JWT (无状态，适合 Worker 环境)
- **ORM**: Drizzle ORM (轻量、D1 原生支持、TypeScript)

---

## 实施步骤 (分阶段)

### 阶段 1: 项目初始化与基础架构搭建

1. **创建 Worker 项目结构**
   ```
   sun-panel-worker/
   ├── src/
   │   ├── index.ts            # Worker 入口 (Hono app)
   │   ├── api/                 # API 路由
   │   │   ├── auth.ts          # 登录/鉴权
   │   │   ├── openness.ts      # 公开接口
   │   │   ├── panel/           # 面板管理
   │   │   │   ├── itemIcon.ts
   │   │   │   ├── itemIconGroup.ts
   │   │   │   ├── userConfig.ts
   │   │   │   ├── users.ts
   │   │   ├── system/          # 系统管理
   │   │   │   ├── about.ts
   │   │   │   ├── file.ts
   │   │   │   ├── moduleConfig.ts
   │   │   │   ├── notice.ts
   │   │   │   ├── user.ts
   │   ├── middleware/          # 中间件
   │   │   ├── auth.ts          # JWT 验证
   │   │   ├── admin.ts         # 管理员验证
   │   │   ├── publicMode.ts    # 公开模式
   │   ├── db/                  # 数据库层
   │   │   ├── schema.ts        # Drizzle schema
   │   │   ├── migrations/      # D1 迁移文件
   │   │   ├── client.ts        # DB 客户端
   │   ├── utils/               # 工具函数
   │   │   ├── jwt.ts           # JWT 工具
   │   │   ├── password.ts      # 密码加密
   │   │   ├── response.ts      # API 返回格式
   │   │   ├── favicon.ts       # 网站图标获取
   │   ├── types/               # TypeScript 类型
   ├── frontend/                # Vue 3 前端 (从现有代码迁移)
   │   ├── src/                 # 现有 Vue 代码
   │   ├── public/
   │   ├── package.json
   │   ├── vite.config.ts
   ├── wrangler.toml            # Cloudflare Worker 配置
   ├── package.json             # Worker 依赖
   ├── tsconfig.json
   ```

2. **安装核心依赖**
   - `hono` — API 框架
   - `@cloudflare/d1` / `drizzle-orm` + `drizzle-kit` — 数据库 ORM
   - `jose` — JWT 库 (Worker 兼容)
   - `@cloudflare/workers-types` — Worker 类型定义

3. **配置 wrangler.toml**
   - D1 数据库绑定
   - KV 命名空间绑定
   - R2 存储桶绑定
   - 路由规则 (SPA fallback + API)

### 阶段 2: 数据库 Schema 与迁移

4. **定义 D1 Schema (Drizzle ORM)**
   将 Go GORM 模型翻译为 Drizzle schema：
   - `users` 表 (id, username, password, name, head_image, status, role, mail, referral_code, token)
   - `item_icons` 表 (id, icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id, user_id)
   - `item_icon_groups` 表 (id, icon, title, description, sort, user_id)
   - `user_configs` 表 (id, user_id, panel_json, search_engine_json)
   - `module_configs` 表 (id, user_id, name, value_json)
   - `system_settings` 表 (id, config_name, config_value)
   - `files` 表 (id, user_id, file_name, src, method, ext)
   - `notices` 表 (id, title, content, display_type, one_read, url, is_login, user_id)

5. **生成并执行 D1 迁移**
   使用 `drizzle-kit generate` + `wrangler d1 migrations apply`

### 阶段 3: 鉴权系统重构

6. **JWT 鉴权实现**
   - 使用 `jose` 库签发/验证 JWT
   - Token 结构: `{ userId, role, exp }`
   - 密钥存储于 KV 或 Worker 环境变量
   - 登录接口: POST `/api/login` → 返回 JWT
   - 登出接口: POST `/api/logout` → KV 黑名单 (可选)

7. **中间件实现**
   - `authMiddleware`: 验证 JWT，提取用户信息到 context
   - `adminMiddleware`: 检查 role === 1
   - `publicModeMiddleware`: 允许无 Token 访问，使用公开用户 ID (从 system_settings KV 获取)

### 阶段 4: API 路由逐一实现

8. **公开接口 (openness)**
   - GET `/api/loginConfig` → KV 读取系统设置
   - GET `/api/getDisclaimer` → KV 读取
   - GET `/api/getAboutDescription` → KV 读取

9. **登录接口**
   - POST `/api/login` → 验证用户名密码，签发 JWT
   - POST `/api/logout` → 清除 Token (可选 KV 黑名单)

10. **面板接口 (panel)** — 全部需要鉴权
   - POST `/api/panel/itemIcon/edit` → D1 CRUD
   - POST `/api/panel/itemIcon/deletes` → D1 删除
   - POST `/api/panel/itemIcon/saveSort` → D1 批量更新排序
   - POST `/api/panel/itemIcon/addMultiple` → D1 批量创建
   - POST `/api/panel/itemIcon/getSiteFavicon` → 网络抓取 favicon URL
   - POST `/api/panel/itemIcon/getListByGroupId` → D1 查询 (公开模式)
   - POST `/api/panel/itemIconGroup/edit` → D1 CRUD
   - POST `/api/panel/itemIconGroup/deletes` → D1 删除
   - POST `/api/panel/itemIconGroup/saveSort` → D1 批量更新排序
   - POST `/api/panel/itemIconGroup/getList` → D1 查询 (公开模式)
   - POST `/api/panel/userConfig/set` → D1 保存
   - POST `/api/panel/userConfig/get` → D1 查询 (公开模式)
   - POST `/api/panel/users/create` → D1 创建 (管理员)
   - POST `/api/panel/users/update` → D1 更新 (管理员)
   - POST `/api/panel/users/getList` → D1 分页查询 (管理员)
   - POST `/api/panel/users/deletes` → D1 删除 (管理员)
   - POST `/api/panel/users/getPublicVisitUser` → KV/D1 读取
   - POST `/api/panel/users/setPublicVisitUser` → KV/D1 保存

11. **系统接口 (system)**
   - POST `/api/about` → 返回版本信息
   - POST `/api/user/getInfo` → D1 查询当前用户
   - POST `/api/user/updatePassword` → D1 更新密码
   - POST `/api/user/updateInfo` → D1 更新信息
   - POST `/api/user/getReferralCode` → D1 查询
   - POST `/api/user/getAuthInfo` → 公开模式
   - POST `/api/notice/getListByDisplayType` → D1 查询
   - POST `/api/system/moduleConfig/save` → D1 保存
   - POST `/api/system/moduleConfig/getByName` → D1 查询 (公开模式)
   - POST `/api/file/uploadImg` → R2 上传图片
   - POST `/api/file/uploadFiles` → R2 上传文件
   - POST `/api/file/getList` → D1 查询文件列表
   - POST `/api/file/deletes` → R2 + D1 删除文件

### 阶段 5: 文件存储迁移

12. **R2 文件上传**
   - 图片上传: 接收 multipart → 存入 R2 → 记录 D1
   - 文件上传: 接收 multipart → 存入 R2 → 记录 D1
   - 文件访问: 通过 Worker 代理 R2 URL 或直接公开 R2 域名
   - 网站图标获取: 仅返回 favicon URL (不再下载到服务器)

### 阶段 6: 前端适配

13. **前端 API 层改造**
   - `src/utils/request/axios.ts`: baseURL 改为 `/api`
   - Token 传递: 从 `headers.token` 改为 `headers.Authorization: Bearer xxx`
   - 移除开发代理配置 (Worker 直接处理 API)
   - 移除系统监控相关组件 (Worker 无法读取系统信息)

14. **前端路由/组件调整**
   - 移除系统监控面板 (CPU/Memory/Disk) 或改为仅显示 Cloudflare 状态
   - 移除验证码组件 (简化为密码登录)
   - 保留: 书签管理、分组管理、面板样式、搜索引擎配置

15. **前端构建集成**
   - 构建输出到 `frontend/dist/`
   - Worker 入口将 `dist/` 作为静态资源服务
   - SPA fallback: 所有非 `/api` 路径返回 `index.html`

### 阶段 7: 移除不适用的功能

16. **需要移除或替换的功能**
   - ❌ **系统监控**: CPU/Memory/Disk 信息 → 改为"不可用"提示或移除组件
   - ❌ **验证码缓存**: 内存缓存 → 移除验证码或简化 (无状态 Worker)
   - ❌ **Redis**: 全部改用 KV
   - ❌ **邮件发送**: Worker 无法直接发邮件 → 可用 Cloudflare Email Workers 或移除
   - ❌ **本地文件读写**: 全部改用 R2 + D1
   - ❌ **INI 配置文件**: 改用 wrangler.toml 环境变量 + KV

### 阶段 8: 部署与测试

17. **本地开发环境**
   - `wrangler dev` 启动本地 Worker
   - D1 本地模拟
   - KV 本地模拟
   - R2 本地模拟 (Miniflare)

18. **部署流程**
   - `pnpm run build:frontend` → 构建前端
   - `wrangler d1 migrations apply` → 应用数据库迁移
   - `wrangler deploy` → 部署 Worker

19. **初始数据**
   - 创建默认管理员用户 (admin@sun.cc / 12345678)
   - 初始化系统设置 (KV)
   - 初始化公开访问用户设置

---

## 关键技术决策总结

| 决策点 | 选择 | 原因 |
|-------|------|------|
| API框架 | Hono | 轻量、Worker原生、TypeScript、与Express/Gin路由风格接近 |
| 数据库 | D1 + Drizzle ORM | D1是Cloudflare官方SQLite服务、Drizzle是最佳TypeScript ORM |
| 鉴权 | JWT (jose库) | Worker无内存缓存、JWT无状态、jose兼容Worker运行时 |
| 缓存 | KV | 低延迟、适合系统设置/Token黑名单 |
| 文件 | R2 | S3兼容、无出口费、适合图片/文件存储 |
| 语言 | TypeScript | Worker原生支持、前端也是TS、统一语言栈 |

## 保留与移除功能对照

| 功能 | 决策 |
|------|------|
| 用户登录/注册 | ✅ 保留 (JWT改造) |
| 书签图标管理 | ✅ 保留 (D1存储) |
| 图标分组管理 | ✅ 保留 (D1存储) |
| 面板样式配置 | ✅ 保留 (D1存储) |
| 搜索引擎配置 | ✅ 保留 (D1存储) |
| 模块配置(时钟/搜索) | ✅ 保留 (D1存储) |
| 文件上传 | ✅ 保留 (R2存储) |
| 多账户隔离 | ✅ 保留 |
| 公开访问模式 | ✅ 保留 (JWT+KV) |
| 网站Favicon获取 | ✅ 保留 (改为仅返回URL) |
| 通知系统 | ✅ 保留 (D1存储) |
| 系统监控 | ❌ 移除 (Worker无法读取宿主机信息) |
| 验证码 | ⚠️ 简化 (移除图形验证码) |
| 邮件重置密码 | ❌ 移除 (Worker环境限制) |
| Redis缓存 | ❌ 移除 (改用KV) |

## 风险与注意事项

1. **D1 性能**: D1 目前有一定延迟限制，首次查询可能较慢；需要合理使用 KV 缓存热数据
2. **Worker CPU 时间**: 付费版 30s 限制足够，但免费版 10ms 限制可能不够用 → 建议使用付费 Workers
3. **R2 文件访问**: 需要配置公开访问域名或通过 Worker 代理
4. **前端兼容性**: Vue SPA hash路由模式在 Worker 下可正常工作；如果改为 history 模式需要 fallback 配置
5. **数据迁移**: 如果有现有 SQLite 数据需要迁移到 D1，需要编写迁移脚本
