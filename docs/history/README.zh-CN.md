# 历史归档

[English](README.md) | [简体中文](README.zh-CN.md)

> 这里存放**只读存档**：内容记录的是「当时的设计与需求」，**不代表当前实现状态**。
> 想了解现状请看 [docs/README.zh-CN.md](../README.zh-CN.md)（文档索引）与根 [README.zh-CN.md](../../README.zh-CN.md)。

## 归档判定标准

一份文档**满足以下任一条**才放进本目录：

| 判定 | 说明 | 例子 |
|------|------|------|
| 设计已被实现且不再指导改动 | 计划/设计与现状不一致，只留作追溯 | `migration/plan.md`（迁移期选型，其中 Drizzle ORM、前端输出目录等与实现不符） |
| 需求已被吸收进活跃文档 | 内容仍有价值，但跟踪位置已转移 | `requirements/early-todo.md`（未完成的三条已并入 improvement-plan §9.10~9.12） |
| 已被新文档完全取代 | 避免同一件事两处维护 | —（暂无） |

**不放进本目录的**：

- 仍在跟踪的待办与决策 → [improvement-plan.zh-CN.md](../improvement-plan.zh-CN.md)（它的 §9/§10 是活跃计划，因此留在 `docs/` 根下，不做归档）；
- 功能使用说明、部署与运维资料 → 对应功能文档（`deployment` / `storage` / `search-engine`，文件名见 [docs/README.zh-CN.md](../README.zh-CN.md)）。

## 目录结构

```
docs/history/
├── README.md / README.zh-CN.md         # 本文件：归档判定标准 + 索引（英文 / 中文）
├── migration/                          # 主题：迁移与选型
│   ├── plan.md                         # Go 版 → Cloudflare Worker 的迁移设计（英文）
│   └── plan.zh-CN.md                   # 同上（中文）
└── requirements/                       # 主题：需求收集
    ├── early-todo.md                   # 移植初期的需求清单与当时的实现状态（英文）
    └── early-todo.zh-CN.md             # 同上（中文）
```

## 归档时的做法

1. 移动文件到对应主题目录（没有合适主题就新建一个，如 `incidents/`、`designs/`），**英文版与中文版一起移动**；
2. 在文件**顶部**加一段 `> [!NOTE] **历史文档**` 说明，列清「哪些内容已与实现不一致」，两个语言版本同步加；
3. 修正文件内的相对链接（多一层目录 → 多一个 `../`），并全局搜一遍引用它的地方；同语言互链（中文版只链 `*.zh-CN.md`）；
4. 在本文件的「目录结构」里补一行说明，中英两份都补。
