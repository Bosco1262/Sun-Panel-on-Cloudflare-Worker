# 文档索引

> 项目门面是根目录的双语 README：[English](../README.md) / [简体中文](../README.zh-CN.md)；本目录存放**实现细节与运维资料**。
> 维护约定见文末 —— 新增内容请写进「职责」对应的那份文档，避免重复与过期。

## 文档地图

```
docs/
├── README.md              # 本文件：索引 + 文档职责 + 维护约定
├── deployment.md          # 部署与本地开发（Git 集成 / 本地 wrangler、命令、FAQ、备份恢复）
├── storage.md             # 数据与资源：D1 表、R2 对象布局、图片回收、Cloudflare 免费层额度
├── search-engine.md       # 功能说明：搜索引擎设置（风格设置里的管理区）
├── improvement-plan.md    # 活跃计划：待办候选 + 全仓库排查结论 + 已结项记录 + 附录（自检脚本清单）
├── history/               # 历史存档（只读，不代表当前实现；判定标准见 history/README.md）
│   ├── README.md            # 归档判定标准 + 索引
│   ├── migration/plan.md    # Go 版 → Cloudflare Worker 的迁移设计（选型与阶段计划）
│   └── requirements/early-todo.md  # 移植初期的需求收集与状态（未完成项已并入 improvement-plan §9）
└── upstream/              # 上游原版资料存档
    ├── README.md            # 上游 Sun-Panel README（特性、截图、致谢）
    └── CHANGELOG.md         # 上游更新日志（仅到 v1.1.0）
```

> `improvement-plan.md` **刻意留在 `docs/` 根下，不进 `history/`**：它的 §9/§10 仍是活跃待办（§9.6、§9.7、§9.10~9.12），
> 且被 `migrations/`、`src/` 注释与多份文档按锚点引用。归档判定标准见 [history/README.md](./history/README.md)。

## 文档职责（什么内容写进哪份文档）

| 文档 | 管什么 | 不管什么（去这里找） |
|------|--------|----------------------|
| [deployment.md](./deployment.md) | 首次部署、两种部署方式、环境变量与 secret、本地开发、常见问题、D1/R2 备份恢复 | 表结构与 R2 布局 → storage.md；改动计划 → improvement-plan.md |
| [storage.md](./storage.md) | D1 六张业务表用途、R2 key 形态与回收规则、图片回收开关与按钮、本地 `.wrangler` 状态、免费层额度对照 | 部署步骤 → deployment.md |
| [search-engine.md](./search-engine.md) | 搜索引擎配置的界面、占位符规则、存储位置、访客模式遗留说明 | 通用样式设置 → 代码内的风格设置页 |
| [improvement-plan.md](./improvement-plan.md) | **未完成的计划与决策记录**（§9 候选、§10 待办）+ 已完成轮次的过程与验证证据 + 自检脚本命令（附录 C） | 功能使用说明 → 对应功能文档；历史设计 → history/ |
| [history/](./history/) | 只读存档：`migration/`（迁移设计）、`requirements/`（早期需求清单）+ 归档判定标准 | 当前状态一律不看这里；活跃待办在 improvement-plan.md |

## 推荐阅读路径

| 你是谁 | 先读 |
|--------|------|
| 想部署一个自己的实例 | 根 README 的「快速开始」→ [deployment.md](./deployment.md) |
| 想改代码 / 提 PR | [improvement-plan.md](./improvement-plan.md)（含自检脚本与验证证据）→ [storage.md](./storage.md) |
| 想查数据存在哪、能不能删 | [storage.md](./storage.md) |
| 想知道有哪些已知限制 | 根 README「已知限制」+ [improvement-plan.md](./improvement-plan.md) §10.3 |

## 维护约定

1. **单一事实来源**：同一件事只在一份文档里详细写，其它地方用链接引用（例：R2 对象布局只在 storage.md 写）。
2. **状态分级**：
   - 当前有效 → 写在对应功能文档里；
   - 计划中/待决策 → 写进 improvement-plan.md 的 §9（候选）或 §10（待办），并标注状态与量级；
   - 已结项 → 保留结论与验证证据，过程细节压缩；纯历史设计移入 `history/`。
3. **每轮改动收尾三步**：更新受影响的文档 → 在 improvement-plan.md 的「变更记录」登记一行 → 跑附录 C 的自检脚本。
4. **不写会过期的数字**：能引用的（`package.json` 版本、CLI 命令）不手抄；Cloudflare 额度类数字集中放 storage.md，并注明核实日期。
5. **链接用相对路径**：按目录层级计数 —— `docs/*.md` 引用根文件用 `../`，`docs/history/*/*.md` 要用 `../../../`；移动文档后全局搜一次相对链接。
6. **双语 README 同步**：英文 [README.md](../README.md) 与中文 [README.zh-CN.md](../README.zh-CN.md) 是同一份内容的两个版本，改其中一份必须同步另一份（语言切换入口与许可证段落格式见两份文件顶部）。
