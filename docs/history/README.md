# Historical Archive

[English](README.md) | [简体中文](README.zh-CN.md)

> This directory holds **read-only archives**: they record "the design and requirements of that time" and **do not describe the current implementation**.
> For the current state see [docs/README.md](../README.md) (documentation index) and the root [README.md](../../README.md).

## Archiving Criteria

A document belongs here if it **matches any of the following**:

| Criterion | Explanation | Example |
|-----------|-------------|---------|
| The design has been implemented and no longer guides changes | The plan/design disagrees with the current state and is kept for traceability only | `migration/plan.md` (migration-era choices; Drizzle ORM, the frontend output directory and more differ from the implementation) |
| The requirements have been absorbed into an active document | The content still has value, but tracking moved elsewhere | `requirements/early-todo.md` (the three open items were merged into improvement-plan §9.10~9.12) |
| Fully superseded by a newer document | Avoids maintaining the same thing twice | — (none yet) |

**What does not belong here**:

- open to-dos and decisions → [improvement-plan.md](../improvement-plan.md) (its §9/§10 are still active, which is why it stays in the `docs/` root instead of being archived);
- feature guides, deployment and operations material → the matching feature documents (`deployment` / `storage` / `search-engine`; see the file map in [docs/README.md](../README.md)).

## Directory Structure

```
docs/history/
├── README.md / README.zh-CN.md         # This file: archiving criteria + index (English / Chinese)
├── migration/                          # Topic: migration and technology choices
│   ├── plan.md                         # Go → Cloudflare Worker migration design (English)
│   └── plan.zh-CN.md                   # Same document (Chinese)
└── requirements/                       # Topic: requirement gathering
    ├── early-todo.md                   # Requirements collected early on, with their status at the time (English)
    └── early-todo.zh-CN.md             # Same document (Chinese)
```

## How to Archive

1. Move the file into the matching topic directory (create a new topic such as `incidents/` or `designs/` if needed) — **move the English and the Chinese version together**;
2. Add a `> [!NOTE] **Historical document**` block at the **top** of the file listing "what no longer matches the implementation", in both language versions;
3. Fix the relative links inside the file (one more directory level → one more `../`) and search the whole repo for references to it; link within the same language only (the Chinese version links to `*.zh-CN.md`);
4. Add a line for it to the "Directory Structure" section of this file, in both languages.
