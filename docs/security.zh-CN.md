---
title: 安全姿态与问题清单
status: current
audience: developer, auditor
last_verified: 2026-09-23
---

# 安全: 信任边界与问题清单

[English](security.md) | [简体中文](security.zh-CN.md)

> 本文档负责本移植版的**安全姿态**: 代码刻意信任哪些边界、哪些取舍是深思熟虑的、以及带稳定编号的问题清单。
> 部署步骤与密钥 → [deployment.zh-CN.md](./deployment.zh-CN.md); 数据存放与回收 → [storage.zh-CN.md](./storage.zh-CN.md);
> 待办候选与决策日志 → [improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md)。

## 1. 为什么需要这份文档

全仓安全审查已完成且修复已落地 (2026-09-22); 但审查报告本身是 `docs/` 之外的工作文件。这留下一个缺口:
**代码注释会引用 `V-02A`、`V-04` 这样的审查条目号, 而这些编号需要一个仓库内的稳定归属** ——
否则后续读者无法核对注释在讲什么, 下一次审查也无法区分「仍待处置」与「已经修好」。

两条规则保证它长期有效:

1. **问题编号稳定不变。** `V-01` … `V-09` 的含义永久固定, 修复后也不重编号; 新问题取下一个未占用的号。
2. **代码注释只引用 `docs/security.md`, 不引用临时报告。** 写成
   `(安全审查 V-04, 见 docs/security.md §3)`, 而不是指向一个只在审查期间存在的文件。

## 2. 信任边界 (代码刻意的信任决策)

这些是未来的改动最容易误伤的地方。每一条都在代码里实现并有注释说明;
本清单存在的意义是避免有人把某条「简化」掉。

| 边界 | 决策 | 位置 |
|------|------|------|
| 登录限流的客户端 IP | **只**信任 `cf-connecting-ip`, 且先归一化 (取首值、限长 64、字符集白名单); 其余一律回退到共享的 `unknown` 分桶。**从不**参考 `X-Forwarded-For` —— 它由客户端控制, 信任它会让人每次请求都换一个新分桶 (V-02A) | `src/api/login.ts` |
| 请求体大小 | 每个接口都声明上限 (普通 JSON 64 KB / 大 JSON 1 MB / 上传 50 MB)。先看 `Content-Length`, 再按**真实**字节数复核 —— 头部可能缺失或撒谎 | `src/utils/bodyLimit.ts` |
| 离开服务的错误文案 | 存储/数据库错误信息永不出网: 详情进日志, 响应只带错误码对应的通用文案 | `src/utils/response.ts` (`internalError`) |
| `JWT_SECRET` | 空串或纯空白**拒绝服务** (503 + 可操作提示), 而不是用空 HMAC 密钥签发。仅仅偏短的密钥只告警不拒绝, 避免把已部署实例锁在自己的面板外 | `src/utils/jwt.ts`、`src/index.ts`、`src/middleware/auth.ts` |
| 凭证通道 | 会话承载在 `HttpOnly; SameSite=Lax` Cookie 上; `token` 头与 `Authorization: Bearer` 保留给脚本与非浏览器客户端。由此产生的代价记为 V-07 | `src/utils/authCookie.ts`、`src/middleware/auth.ts` |
| 上传内容回读 | 只接受白名单扩展名; 非图片强制 `Content-Disposition: attachment`; SVG 追加 `default-src 'none'; sandbox` 的 CSP; 始终 `nosniff` | `src/utils/file.ts`、`src/index.ts` |
| 图片回收的引用判定 | 用**字符串包含**判定, 且刻意偏保守: 最多把「没人用」判成「在用」(少删), 绝不把在用的判成可删 | `src/utils/uploadRefs.ts` |
| Cookie 认证写操作的跨站校验 | 优先 `Sec-Fetch-Site`, 其次比较 `Origin` 与 `Host` 的**主机名**; 两者都缺失时放行。Cookie 的 `SameSite=Lax` 仍是第一道防线, 这里只是纵深防御, 不是唯一闸门 | `src/middleware/auth.ts` |

## 3. 问题清单

状态含义: **已修复** = 已落地并验证; **待处置** = 需要产品或运维决策;
**已接受** = 已评估且刻意保持现状 (结论本身就是交付物)。

| 编号 | 问题 | 严重度 | 状态 | 修复位置 / 决策 |
|------|------|--------|------|------------------|
| V-01 | 默认管理员凭据 `admin / 12345678` 预置在公开迁移文件中, 且没有任何机制强制首次登录后改密 | 高 | **待处置** | 需要产品决策: 首次登录强制改密, 并在默认哈希仍然生效时限制写操作。迁移里的种子本身是有意的 (全新部署必须可进入) |
| V-02A | 登录限流可被伪造的 `X-Forwarded-For` 绕过, 使 8 位默认口令的在线爆破成为现实路径 | 高 | **已修复** | `clientIp()` 只信任 `cf-connecting-ip`; 缺失时回落单一共享 `unknown` 分桶, 并打一次运维告警 |
| V-02B | `JWT_SECRET` 缺失时只打日志, 于是 token 用空 HMAC 密钥签发与校验 —— 一次完整的认证绕过 | 高 | **已修复** | `isSecretUsable()` + `MissingJwtSecretError`; 登录、中间件与应用级 `onError` 三处统一返回 503 与可操作提示 |
| V-03 | `POST /api/system/getCustomCode` 未鉴权, 把自定义 JS/CSS 的完整源码交给任意匿名访客 (内含内网域名、接口路径与运维写进去的密钥) | 中高 | **已修复** | 加上 `authMiddleware()`; 前端改为有 token 才拉取。行为变更: 登录页不再获得自定义 CSS/JS |
| V-04 | 存储/数据库错误原文被转发给客户端, 暴露表名、列名与约束名 | 中 | **已修复** | `internalError()` 把详情写日志、对外只回通用文案 (8 处); 下载失败的文案保持不变 —— 它不含内部信息且被前端与自检依赖 |
| V-05 | 请求体无上限、数组无条数上限, 匿名超大 `/login` 请求体或超大批量数组成为 CPU/内存放大器 | 中 | **已修复** | 业务接口挂上 `bodyLimit()`; `addMultiple`/`saveSort` ≤ 1000 条, 删除类 ≤ 500 个 id; 超限返回 413 + `1402` |
| V-06 | `/uploads/*` 文件凡持有 URL 者皆可读 (无签名、无过期); 仅靠 32 位哈希使枚举不可行 | 低中 | **已接受** | 已校验 key 形态 (`isValidUploadKey`), 非图片强制下载; 在需要签名 URL 之前, 把 URL 本身当作凭证 |
| V-07 | 登录响应体返回与 Cookie 相同的 JWT, 因此页面 JavaScript 可读该 token | 低 | **已接受 (A 步已实施)** | Cookie 是浏览器路径, token 不落 `localStorage`。响应现已带 `Cache-Control: no-store` (A 步, 已有自检断言覆盖)。刻意保留: CLI 与第三方客户端需要一个获取 token 的途径, `token` 头正因此存在。长期方案是独立 API Key, 已记入 [improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md) §9.13 |
| V-08 | 未配置 `PASSWORD_PEPPER` 时, 改密写入无盐三重 MD5 哈希而不是 fail-closed | 低 | **待处置** | 未配置 pepper 时拒绝改密, 或在部署期强制生成。已有安装的旧哈希必须保持可校验 |
| V-09 | CSRF 的兜底逻辑允许既无 `Sec-Fetch-Site` 也无 `Origin` 的写操作 | 低 | **已接受** | `SameSite=Lax` 已能阻断浏览器发起的跨站写; 拒绝无来源头的请求会打断用 Cookie 认证的 CLI 工具。只有当非浏览器客户端不再使用 Cookie 时才需要收紧 |

### 三条「已接受」项的说明

**V-06: URL 即凭证。** key 含 32 位 MD5 且 `isValidUploadKey()` 固定了形态, 猜测不现实, 但分享 URL 就等于分享文件。
这与面板使用图片的方式一致 (图片由面板配置引用)。若将来需要更强保护, 可选签名 URL 或受鉴权路由 ——
两者都会破坏「浏览器匿名加载头像」这一合法场景, 因此属于产品决策。

**V-07: 一条有真实代价的兼容通道。** 读取顺序是 Cookie → `token` 头 → `Authorization: Bearer`。
后两者服务于命令行脚本与第三方工具, 它们用不了 `HttpOnly` Cookie, 因此 token 必须有地方能取到 —— 响应体是唯一之处。
残留风险在于: 同一个值也因此对页面 JavaScript 可读, 这在已经存在 XSS 时才成立
(它把「借用受害者的浏览器」升级为「离线复用凭证」)。最便宜的缓解措施 —— 登录响应加 `Cache-Control: no-store` ——
已实施; 彻底的方案 (独立 API Key, 让 Web 会话与脚本凭证无法重叠) 已列入计划。
另需注意: 持有 token **不能**改密码或用户名 (两者都要求原密码), 因此暴露窗口受 72 小时有效期与 `auth_epoch` 吊销的约束。

**V-09: 一处有记录的纵深防御缺口。** 该检查存在的意义是在 `SameSite=Lax` 之后再加一道, 而不是当唯一闸门。
收紧它意味着拒绝「完全不带来源信息」的 Cookie 认证写操作 —— 而这正是带 cookie jar 的 CLI 的样子。

## 4. 已验证的性质 (回归护栏)

以下性质经过端到端验证, 应当长期保持。对应的自检脚本见
[improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md) 附录 C。

| 性质 | 证据 |
|------|------|
| 限流按 IP 独立, 且无法用伪造头部挪动分桶 | 同一 IP 五次错误口令后锁定; 追加伪造 `X-Forwarded-For` 仍锁定; 换一个 `cf-connecting-ip` 立刻恢复干净计数 |
| `JWT_SECRET` 缺失时处处 fail-closed | `scratch/security-fixes.test.ts` 覆盖签发、校验与应用级错误处理 |
| 匿名调用方读不到自定义代码 | 返回 `1000`, 且响应体中不含 `customCss` / `customJs` 字段 |
| 数据库错误原文永不离开 Worker | 注入 `UNIQUE constraint failed: item_icon.only_name` 后返回 `1200` 且响应不含 schema 文本 |
| 头部如实或撒谎都拦得住体积超限 | 2 MB 的 `/login` 与 52 MB 的上传均返回 413; 头部声称 1 字节而实际 2 KB 的请求体同样被拒 |
| 仅 Cookie 的会话能让所有页面正常工作 | 只有 Cookie、不带 token 头时, `getAuthInfo` / `userConfig/get` / `getListWithItems` / `getCustomCode` 均返回 `0`; 跨站写被 `1005` 拒绝, 同源写通过 |
| 非浏览器客户端的令牌吊销是全有或全无 | `POST /logout {"allDevices": false}` 只清 Cookie, 令牌副本仍然有效; 只有 `{"allDevices": true}` 才递增 `auth_epoch` 使其失效。事件响应手册必须用 `allDevices: true` |
| 登出不依赖客户端自觉清理 | 服务端负责清 Cookie (全设备时还递增世代), 客户端状态残留无法维持活跃会话 |

## 5. 刻意不设防的部分

把它们列出来, 是为了避免每一轮都重新争论「为什么不顺手修一下」:

- **管理员自己的自定义 CSS/JS 能在每个页面上执行任意代码。** 这是功能本身。V-03 去掉的是匿名**可读性**, 不是这个能力。
- **面板是单用户模式。** `role` 恒为 `1`, 没有用户表, 没有权限分层。除「调用者是不是那个管理员」之外没有授权模型可加固。
- **登录限流是辅助防线。** D1 抖动时它 fail-open, 因为把管理员锁在面板外比暂时失去节流更糟。
- **`auth_epoch` 的缓存允许最长 10 秒的窗口**内已吊销 token 仍被接受。比较策略只拦**更旧**的世代, 因此新签发的 token 绝不会被过期缓存误杀。
- **面板本身未设 CSP。** 自定义 JS 是设计内的内联注入, 有意义的策略需要 nonce/hash 管道。列为加固项, 不算缺陷。

## 6. 如何新增一个问题

1. 取下一个未占用的 `V-xx` 编号, 并在 §3 加一行 —— 即便结论是「接受」也要记。理由是文档最有价值的部分;
   删掉一行, 下一个读者就会重新调研同一个问题。
2. 若它改变了信任边界, 更新 §2 以及实施该边界的代码注释。
3. 代码里引用它时写成 `(安全审查 V-xx, 见 docs/security.md §3)`。
4. 若它变成待做的工作, 把实施方案写进 [improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md) §9 (候选池), 并回链到本文。
5. 若它被修复, 补上「修复位置」列, 并把自检加入 improvement-plan 的附录 C。
