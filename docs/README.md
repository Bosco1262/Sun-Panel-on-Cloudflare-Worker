# Documentation Index

[English](README.md) | [简体中文](README.zh-CN.md)

> The project front page is the root [README.md](../README.md) (the same document also exists as `README.zh-CN.md`); this directory holds the **implementation details and operations material**.
> It follows the same bilingual convention as the root README: `X.md` is English, `X.zh-CN.md` is Chinese (this page is the English `README.zh-CN.md`), and every document carries the same one-line language switch directly under its title as the root README does.
> Maintenance rules are at the bottom — new content goes into the document that owns the topic, to avoid duplication and stale copies.

## Document Map

```
docs/
├── README.md / README.zh-CN.md           # This file: index + ownership + maintenance rules
├── deployment.md / deployment.zh-CN.md   # Deployment & local development (Git integration / local wrangler, commands, FAQ, backup & restore)
├── storage.md / storage.zh-CN.md         # Data & resources: D1 tables, R2 object layout, image reclamation, Cloudflare free-tier limits
├── search-engine.md / search-engine.zh-CN.md  # Feature guide: search-engine settings (the admin area in Style Settings)
├── security.md / security.zh-CN.md       # Security posture: trust boundaries + the registry of findings with stable IDs (V-01…)
├── improvement-plan.md / .zh-CN.md       # Active plan: backlog + repo-wide audit findings + completed work log + appendices (self-check script list)
├── assets/                               # Images (logo, screenshots) referenced by the root READMEs and the upstream archive
├── history/                              # Historical archive (read-only, not the current implementation; criteria in history/README.md)
│   ├── README.md / README.zh-CN.md         # Archiving criteria + index
│   ├── migration/plan.md / plan.zh-CN.md   # Go → Cloudflare Worker migration design (technology choices, staged plan)
│   └── requirements/early-todo.md / early-todo.zh-CN.md  # Early requirements and their status (open items were merged into improvement-plan §9)
└── upstream/                             # Archived upstream material
    ├── README.md / README.zh-CN.md         # Upstream Sun-Panel README (features, screenshots, credits)
    └── CHANGELOG.md / CHANGELOG.zh-CN.md   # Upstream changelog (up to v1.1.0 only)
```

> `X.md / X.zh-CN.md` above means a bilingual pair: the two files mirror each other, so changing one requires changing the other (rule 6).

> `improvement-plan.md` **deliberately stays in the `docs/` root instead of `history/`**: its §9/§10 are still active
> backlog (§9.6, §9.7, §9.10~9.13), and `migrations/`, comments in `src/` and several documents reference it by anchor.
> Archiving criteria live in [history/README.md](./history/README.md).
>
> The finding IDs in `security.md` (`V-01`…) are **never renumbered**: comments in `src/` reference them by number,
> so changing or dropping one makes those comments unverifiable. A new finding takes the next free number, and even
> an accepted risk keeps its row.

## Document Ownership (what goes where)

| Document | Covers | Does not cover (look here instead) |
|----------|--------|-----------------------------------|
| [deployment.md](./deployment.md) | First deployment, the two deployment paths, environment variables and secrets, local development, FAQ, D1/R2 backup and restore | Table structures and R2 layout → storage.md; change plan → improvement-plan.md |
| [storage.md](./storage.md) | The six D1 business tables, R2 key shapes and reclamation rules, the image-reclamation switch and button, local `.wrangler` state, free-tier usage table | Deployment steps → deployment.md |
| [search-engine.md](./search-engine.md) | Search-engine settings UI, placeholder rules, where the config is stored, visitor-mode leftovers | Generic style settings → the Style Settings page in the code |
| [security.md](./security.md) | **Security posture**: the boundaries the code deliberately trusts, the finding registry with stable IDs (V-01…, including the reasoning for accepted risks), verified properties, and what is deliberately not defended | Deployment steps and secrets → deployment.md; work to do → improvement-plan.md §9 |
| [improvement-plan.md](./improvement-plan.md) | **The single source for open work and decisions** (§9 candidates, §10 to-dos) + process and evidence for completed rounds + self-check commands (Appendix C) | Feature usage → the matching feature doc; historical designs → history/ |
| [history/](./history/) | Read-only archive: `migration/` (migration design), `requirements/` (early requirements) + archiving criteria | Never look here for current state; the active backlog lives in improvement-plan.md |

## Suggested Reading Paths

| Who you are | Start with |
|-------------|------------|
| Deploying your own instance | Root README "Quick Start" → [deployment.md](./deployment.md) |
| Changing code / opening a PR | [improvement-plan.md](./improvement-plan.md) (self-check scripts and verification evidence) → [storage.md](./storage.md) |
| Touching authentication, uploads or rate limiting | [security.md](./security.md) — read the trust boundaries and deliberate trade-offs before changing them |
| Wanting to know where data lives and what can be deleted | [storage.md](./storage.md) |
| Looking for known limitations | Root README "Known Limitations" + [improvement-plan.md](./improvement-plan.md) §10.3 |
| Reading Chinese only | the `简体中文` entry under the title of each document, or `README.zh-CN.md` in the same directory |

## Maintenance Rules

1. **Single source of truth**: document a topic in exactly one place and link to it from everywhere else (e.g. the R2 object layout lives only in storage.md).
2. **Status levels**:
   - current behaviour → the matching feature document;
   - planned / undecided → §9 (candidates) or §10 (to-dos) of improvement-plan.md, with status and size;
   - finished → keep the conclusion and the evidence, compress the process; pure design history moves to `history/`.
3. **Three closing steps per round**: update the affected documents → add one row to the "Change log" of improvement-plan.md → run the self-check scripts from Appendix C.
4. **Do not write numbers that go stale**: quote what can be quoted (`package.json` versions, CLI commands) instead of copying it; Cloudflare quota numbers live in storage.md with the date they were verified.
5. **Use relative links**: count directory levels — `docs/*.md` uses `../` for root files, `docs/history/*/*.md` needs `../../../`; after moving a document, search the whole repo for relative links.
   **Same-language linking**: the English version links to English files (`./storage.md`) and the Chinese version to Chinese files (`./storage.zh-CN.md`); never cross-link languages (the only cross-language entry point is the language switch under the document title).
6. **Keep the bilingual pairs in sync**: every document under `docs/` is a pair — `X.md` (English) / `X.zh-CN.md` (Chinese), matching `README.md` / `README.zh-CN.md` in the repository root.
   Changing one half requires changing the other; section numbering (§9.2, Appendix C, …) and relative-link depth must match across the two languages so that code comments and other documents can keep referencing them by number.
   The language switch is the single line `[English](X.md) | [简体中文](X.zh-CN.md)` directly under the document title (identical to the root README; never add a `# Language Switch` heading).
7. **Stable paths (docs are contracts)**: file names and paths under `docs/` are referenced from `src/` comments and `migrations/` (`docs/security.md §3`, `docs/improvement-plan.md §9.9`, …), so renaming or moving a document requires a repo-wide search first — when in doubt, do not move. The topic documents deliberately stay **flat in the `docs/` root** (the Diátaxis classification — tutorial / how-to / reference / explanation — is expressed in this index's ownership table, not in subfolders) so the referenced paths stay short and stable.
8. **Front matter metadata**: every content document starts with a light YAML block — `title`, `status` (`current` | `planned` | `archived`), `audience`, `last_verified` (the date the content was last verified against the code). Update `last_verified` whenever you re-check a document's content.
9. **Assets**: images referenced by documents live in `docs/assets/`; new files are named `<topic>-<nn>.<ext>` (kebab-case) and are referenced by relative path.
