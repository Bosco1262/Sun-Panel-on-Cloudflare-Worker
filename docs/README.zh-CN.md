# 文档索引

[English](README.md) | [简体中文](README.zh-CN.md)

> 项目门面是根目录的 [README.zh-CN.md](../README.zh-CN.md)（同一份文档另有英文版 `README.md`）；本目录存放**实现细节与运维资料**。
> 本目录沿用根 README 的双语约定：`X.md` 是英文版、`X.zh-CN.md` 是中文版（本页即 `README.md` 的中文版），每份文档标题下都有一行语言切换入口（与根 README 相同，不设标题）。
> 维护约定见文末 —— 新增内容请写进「职责」对应的那份文档，避免重复与过期。

## 文档地图

```
docs/
├── README.md / README.zh-CN.md           # 本文件：索引 + 文档职责 + 维护约定
├── deployment.md / deployment.zh-CN.md   # 部署与本地开发（Git 集成 / 本地 wrangler、命令、FAQ、备份恢复）
├── storage.md / storage.zh-CN.md         # 数据与资源：D1 表、R2 对象布局、图片回收、Cloudflare 免费层额度
├── search-engine.md / search-engine.zh-CN.md  # 功能说明：搜索引擎设置（风格设置里的管理区）
├── security.md / security.zh-CN.md       # 安全姿态：信任边界 + 带稳定编号（V-01…）的问题清单与验证证据
├── improvement-plan.md / .zh-CN.md       # 活跃计划：待办候选 + 全仓库排查结论 + 已结项记录 + 附录（自检脚本清单）
├── assets/                               # 图片（logo、截图）：根 README 与上游存档引用的图片资源
├── history/                              # 历史存档（只读，不代表当前实现；判定标准见 history/README.zh-CN.md）
│   ├── README.md / README.zh-CN.md         # 归档判定标准 + 索引
│   ├── migration/plan.md / plan.zh-CN.md   # Go 版 → Cloudflare Worker 的迁移设计（选型与阶段计划）
│   └── requirements/early-todo.md / early-todo.zh-CN.md  # 移植初期的需求收集与状态（未完成项已并入 improvement-plan §9）
└── upstream/                             # 上游原版资料存档
    ├── README.md / README.zh-CN.md         # 上游 Sun-Panel README（特性、截图、致谢）
    └── CHANGELOG.md / CHANGELOG.zh-CN.md   # 上游更新日志（仅到 v1.1.0）
```

> 上表里 `X.md / X.zh-CN.md` 表示同名双语对：两个文件内容一一对应，改一份必须同步另一份（见文末约定 6）。

> `improvement-plan.md` **刻意留在 `docs/` 根下，不进 `history/`**：它的 §9/§10 仍是活跃待办（§9.6、§9.7、§9.10~9.13），
> 且被 `migrations/`、`src/` 注释与多份文档按锚点引用。归档判定标准见 [history/README.zh-CN.md](./history/README.zh-CN.md)。
>
> `security.md` 里的问题编号（`V-01`…）**永不重编**：`src/` 注释按编号引用它，编号一旦改动/删除，
> 那些注释就无法对证。新增问题取下一个未占用编号，即使结论是「接受」也要留一行。

## 文档职责（什么内容写进哪份文档）

| 文档 | 管什么 | 不管什么（去这里找） |
|------|--------|----------------------|
| [deployment.zh-CN.md](./deployment.zh-CN.md) | 首次部署、两种部署方式、环境变量与 secret、本地开发、常见问题、D1/R2 备份恢复 | 表结构与 R2 布局 → storage.zh-CN.md；改动计划 → improvement-plan.zh-CN.md |
| [storage.zh-CN.md](./storage.zh-CN.md) | D1 六张业务表用途、R2 key 形态与回收规则、图片回收开关与按钮、本地 `.wrangler` 状态、免费层额度对照 | 部署步骤 → deployment.zh-CN.md |
| [search-engine.zh-CN.md](./search-engine.zh-CN.md) | 搜索引擎配置的界面、占位符规则、存储位置、访客模式遗留说明 | 通用样式设置 → 代码内的风格设置页 |
| [security.zh-CN.md](./security.zh-CN.md) | **安全姿态**：代码刻意信任的边界、带稳定编号的问题清单（V-01…，含「已接受」的取舍理由）、已验证性质与刻意不设防的部分 | 部署步骤与 secret → deployment.zh-CN.md；待做方案 → improvement-plan.zh-CN.md §9 |
| [improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md) | **未完成的计划与决策记录**（§9 候选、§10 待办）+ 已完成轮次的过程与验证证据 + 自检脚本命令（附录 C） | 功能使用说明 → 对应功能文档；历史设计 → history/ |
| [history/](./history/) | 只读存档：`migration/`（迁移设计）、`requirements/`（早期需求清单）+ 归档判定标准 | 当前状态一律不看这里；活跃待办在 improvement-plan.zh-CN.md |

## 推荐阅读路径

| 你是谁 | 先读 |
|--------|------|
| 想部署一个自己的实例 | 根 README 的「快速开始」→ [deployment.zh-CN.md](./deployment.zh-CN.md) |
| 想改代码 / 提 PR | [improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md)（含自检脚本与验证证据）→ [storage.zh-CN.md](./storage.zh-CN.md) |
| 想动认证 / 上传 / 限流相关逻辑 | [security.zh-CN.md](./security.zh-CN.md)（信任边界与刻意取舍，先读再改） |
| 想查数据存在哪、能不能删 | [storage.zh-CN.md](./storage.zh-CN.md) |
| 想知道有哪些已知限制 | 根 README「已知限制」+ [improvement-plan.zh-CN.md](./improvement-plan.zh-CN.md) §10.3 |
| 只想看英文 | 每份文档标题下的 `English` 入口，或同目录的 `README.md`（英文索引） |

## 维护约定

1. **单一事实来源**：同一件事只在一份文档里详细写，其它地方用链接引用（例：R2 对象布局只在 storage.zh-CN.md 写）。
2. **状态分级**：
   - 当前有效 → 写在对应功能文档里；
   - 计划中/待决策 → 写进 improvement-plan.zh-CN.md 的 §9（候选）或 §10（待办），并标注状态与量级；
   - 已结项 → 保留结论与验证证据，过程细节压缩；纯历史设计移入 `history/`。
3. **每轮改动收尾三步**：更新受影响的文档 → 在 improvement-plan.zh-CN.md 的「变更记录」登记一行 → 跑附录 C 的自检脚本。
4. **不写会过期的数字**：能引用的（`package.json` 版本、CLI 命令）不手抄；Cloudflare 额度类数字集中放 storage.zh-CN.md，并注明核实日期。
5. **链接用相对路径**：按目录层级计数 —— `docs/*.md` 引用根文件用 `../`，`docs/history/*/*.md` 要用 `../../../`；移动文档后全局搜一次相对链接。
   **同语言互链**：中文版链到中文版（`./storage.zh-CN.md`），英文版链到英文版（`./storage.md`），不要跨语言互链（跨语言入口只用标题下的语言切换）。
6. **双语文档同步**：`docs/` 下每份文档都是 `X.md`（英文）/ `X.zh-CN.md`（中文）一对，与根目录的 `README.md` / `README.zh-CN.md` 同一约定。
   改其中一份必须同步另一份；章节编号（§9.2、附录 C 等）与相对链接层级两个语言版本保持一致，便于代码注释与其它文档按编号引用。
   语言切换入口是文档标题下的一行 `[English](X.md) | [简体中文](X.zh-CN.md)`（与根 README 相同，不要写 `# Language Switch` 标题）。
7. **路径即契约**：`docs/` 下的文件名与路径被 `src/` 注释和 `migrations/` 引用（`docs/security.md §3`、`docs/improvement-plan.md §9.9` 等），改名或移动前必须全仓搜索 —— 拿不准就不要动。主题文档刻意**平铺在 `docs/` 根下**（Diátaxis 四分类 —— 教程 / 操作指南 / 参考 / 阐释 —— 体现在本索引的职责表里，不建子目录），让被引用的路径保持简短稳定。
8. **front matter 元数据**：每份内容文档以轻量 YAML 开头 —— `title`、`status`（`current` | `planned` | `archived`）、`audience`、`last_verified`（内容最后一次对照代码核实的日期）。重新核实过内容后要更新 `last_verified`。
9. **图片资源**：文档引用的图片放 `docs/assets/`；新文件命名 `<topic>-<序号>.<扩展名>`（kebab-case），一律相对路径引用。
