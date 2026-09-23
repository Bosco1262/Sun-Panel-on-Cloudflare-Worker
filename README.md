<div align=center>

<img src="./docs/assets/logo.png" width="100" height="100" />

# Sun-Panel-on-Cloudflare-Worker

[English](README.md) | [简体中文](README.zh-CN.md)

A single-user port of [Sun-Panel](https://github.com/hslr-s/sun-panel) (Vue 3 frontend + Go backend) to **Cloudflare Workers**.

Worker (Hono) + D1 + R2 + Vue 3

[![Repo](https://img.shields.io/badge/Github-123456?logo=github&labelColor=242424)](https://github.com/Bosco1262/Sun-Panel-on-Cloudflare-Worker)
[![Upstream](https://img.shields.io/badge/Upstream-sun--panel-blue?logo=github&labelColor=242424)](https://github.com/hslr-s/sun-panel)

</div>

> [!NOTE]
> This repository is a community port of the upstream project [hslr-s/sun-panel](https://github.com/hslr-s/sun-panel):
> the backend was rewritten from Go (Gin) + SQLite to Cloudflare Worker (Hono) + D1/R2, while the frontend reuses the
> upstream Vue 3 code with adaptations.
> The original upstream README is archived at [docs/upstream/README.md](./docs/upstream/README.md).
> **The in-depth docs are bilingual** (`X.md` = English, `X.zh-CN.md` = Chinese, each file carrying a language
> switch directly under its title) — enter through [docs/README.md](./docs/README.md) (documentation index).

![](./docs/assets/main-dark.png)

## ☁️ Tech Stack

| Layer | Implementation |
|-------|----------------|
| Backend | Cloudflare Worker + Hono (TypeScript), in `src/` at the repository root |
| Database | Cloudflare D1 (SQLite) |
| File storage | Cloudflare R2 (avatar, images, uploaded files; `/uploads/*` is proxied by the Worker) |
| Login rate limiting | Cloudflare D1 (max 5 failures per IP within 10 minutes, sliding window, single atomic UPSERT) |
| Frontend | Vue 3 + Vite + Naive UI + Pinia (build output goes to `dist/` at the repository root) |
| Authentication | JWT (jose, stateless, 72-hour lifetime; an `auth_epoch` generation number revokes tokens immediately on password change / logout-all-devices). The session is carried by an **HttpOnly Cookie** (`SameSite=Lax`, plus a cross-site check for write requests); the token is no longer written to localStorage. CLI tools may still use the `token` header |
| Password storage | Triple MD5 for upstream compatibility; with `PASSWORD_PEPPER` set, PBKDF2-SHA256 + random salt + pepper, and old hashes are upgraded on the next successful login |

## 🚀 Quick Start

### Local development

```bash
# 1. Install dependencies (includes the frontend workspace)
npm install

# 2. Create env files (Windows: copy;  macOS / Linux: cp)
copy frontend\.env.example frontend\.env
copy .dev.vars.example .dev.vars

# 3. Apply D1 migrations to the local database
npm run migrations:apply:local

# 4. Start the dev servers
npm run dev        # terminal 1: Worker + local D1/R2 (http://127.0.0.1:8787)
npm run dev:web    # terminal 2: frontend with HMR (http://127.0.0.1:1002)
```

Default account: `admin` / `12345678` — change it in "User Info" after signing in.

### Deploy to Cloudflare (Workers Git integration — recommended)

Connect the repository once, then every `git push` builds, deploys and applies new D1 migrations.
D1 and R2 are **created automatically** on deploy (wrangler ≥ 4.45 auto resource provisioning), so you
neither create resources by hand nor install wrangler locally.

1. **Push this repository to your own GitHub account** (fork or import it).
2. **Connect it in the dashboard**: Cloudflare Dashboard → **Workers & Pages → Create → Import a repository** →
   choose the repository. Name the Worker `sun-panel-on-cloudflare-worker` (it must match `name` in `wrangler.toml`).
3. **Fill in the two commands**:

   | Field | Value |
   |-------|-------|
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy && npx wrangler d1 migrations apply sun-panel-on-cloudflare-worker-db --remote` |

   > Do **not** write `npm install && npm run build`: Workers Builds installs dependencies before running the
   > build command, so installing again only wastes several minutes.
   > Migrations run **after** `deploy` because D1 is provisioned during deployment; running them first fails with
   > `Couldn't find an auto-provisioned D1 DB named 'sun-panel'`.
4. **Set one secret after the first successful deploy**: `JWT_SECRET` (used to sign login tokens; use a random
   value, e.g. `openssl rand -base64 48`, at least 32 characters) → Worker → **Settings → Variables and Secrets**.
   Builds cannot create secrets.

   > Also recommended: `PASSWORD_PEPPER` (the password-hash pepper). With it, new passwords are stored as
   > PBKDF2 + random salt + pepper and old hashes upgrade on the next successful login. ⚠️ Once set, never change or
   > delete it — keep it backed up together with `JWT_SECRET`.
   > The optional `PASSWORD_PBKDF2_ITERATIONS` (PBKDF2 iteration count, default 5000) and how to make the pepper
   > actually take effect are documented under "Worker Secrets" in
   > [docs/deployment.md](./docs/deployment.md#worker-secrets-keys-and-variables).
5. Done — from now on a plain `git push` is enough.

> Details (auto provisioning, D1 permissions needed by the migration step, preview builds, the local wrangler
> workflow, backup/restore and FAQ) live in **[docs/deployment.md](./docs/deployment.md)** (also available in Chinese).

## 🗂️ Repository Structure

```
├── src/                     # Worker backend (Hono)
│   ├── api/                 # Routes: panel/ and system/, mirroring the frontend src/api/
│   ├── middleware/          # JWT auth middleware (+ CSRF check for cookie-authenticated writes)
│   └── utils/               # Response format / password / JWT / files / settings / favicon
├── migrations/              # D1 migrations
├── frontend/                # Vue 3 frontend (npm workspace)
├── dist/                    # Frontend build output (gitignored, served by the Worker)
├── docs/                    # Documentation (index: docs/README.md; history/ = archive, upstream/ = upstream material)
├── reference/               # Upstream source copy for reference (gitignored, not part of the build)
├── wrangler.toml            # Worker config (D1/R2/static assets; no assets binding, see docs/improvement-plan.md §5.2)
├── .dev.vars                # Local dev secrets (gitignored, template: .dev.vars.example)
├── package.json             # Root package: Worker deps + scripts + frontend workspace
└── tsconfig.json            # Worker TypeScript config
```

## 📚 Documentation

| Document | Content |
|----------|---------|
| [docs/README.md](./docs/README.md) | **Documentation index**: document map, ownership and maintenance conventions (start here) |
| [docs/deployment.md](./docs/deployment.md) | Full deployment & local development guide, FAQ, backup and restore |
| [docs/storage.md](./docs/storage.md) | Data & resources: D1 tables, R2 layout and image reclamation, local `.wrangler` state, **Cloudflare free-tier limits vs. measured usage** |
| [docs/search-engine.md](./docs/search-engine.md) | Search-engine settings (the management area inside Style Settings) and placeholder rules |
| [docs/improvement-plan.md](./docs/improvement-plan.md) | Improvement plan: pending candidates (§9), repository-wide audit findings (§10), completed work log and the **self-check script list** (Appendix C) |
| [docs/history/](./docs/history/) | Archive: migration design (`migration/plan.md`), early requirements (`requirements/early-todo.md`) |
| [docs/upstream/README.md](./docs/upstream/README.md) | Upstream README (features, screenshots, credits) |
| [docs/upstream/CHANGELOG.md](./docs/upstream/CHANGELOG.md) | Upstream changelog |

> Every document above is a bilingual pair: `X.md` (English) / `X.zh-CN.md` (Chinese), with a language switch directly
> under the title (the same convention as this README).

## 🔀 Differences from Upstream (Sun-Panel v1.3.0)

| Feature | Notes |
|---------|-------|
| Single user | No multi-user / registration / public visitor mode; account data lives in D1 `system_setting` |
| System monitor | Removed (a Worker cannot read host metrics) |
| CAPTCHA / e-mail | Removed (password-only login) |
| File storage | Local disk → R2 (`/uploads/*` is proxied by the Worker) |
| Site icons | Fetched and stored in R2 (same bucket as manually uploaded icons) |
| Authentication | In-memory token → JWT (stateless, 72 h + `auth_epoch` revocation) with an HttpOnly Cookie carrying the session |
| Password storage | Triple MD5 → optional PBKDF2-SHA256 + random salt + pepper (enabled once `PASSWORD_PEPPER` is set; old hashes upgrade on login) |
| Login protection | CAPTCHA / e-mail → D1-backed failure rate limiting (max 5 failures per IP per 10 minutes) |
| DB migrations | `migrations/` collapsed into a single `0001_init.sql` baseline (applies to brand-new databases only; see docs/improvement-plan.md §2.2) |

> "v1.3.0" is the **last open-source release** of the upstream project: upstream went closed-source from
> v1.4.0 (latest release v1.8.1, 2025-12-31), while its README still states that v1.3.0 is the newest
> open-source version. The full upstream changelog: <https://doc.sun-panel.top/zh_cn/update/update_log.html>.

> The frontend build output always goes to `dist/` at the repository root and is served by the Worker's static
> assets; `frontend/` only contains source code.

## ⚠️ Known Limitations

| Limitation | Notes |
|------------|-------|
| Concurrent editing in multiple tabs | Panel style and search-engine config live in one JSON column (`user_config`, whole-value overwrite) — **avoid editing the same settings in two tabs**, the last save wins |
| Browser cache after deleting an image | `/uploads/*` responses carry `immutable` (up to 24 h), so a deleted file may still be served from the browser cache — hard-refresh to clear it |
| Migration baseline | `migrations/0001_init.sql` only applies to **brand-new** databases; structural changes on an existing database follow the convention in docs/improvement-plan.md §2.2 |
| Custom JS/CSS | Injected into every page by the administrator, which is effectively a self-inflicted XSS entry point — only paste code you trust |
| Session depends on cookies | The session lives in an HttpOnly Cookie, so browsers with cookies disabled (or blocking cross-site requests) cannot log in; CLI scripts can still use the `token` header |
| Security posture and accepted risks | The trust boundaries, the finding registry (V-01…, including risks that were evaluated and deliberately accepted) and the properties that are verified each round live in [docs/security.md](./docs/security.md) |

## 📄 License

This project is licensed under the [MIT License](LICENSE).

This repository is a community port of [Sun-Panel](https://github.com/hslr-s/sun-panel); the upstream project and
its original copyright notice (**© 2023 红烧猎人 / hslr-s**) are retained in [LICENSE](./LICENSE). As required by
the MIT License, that copyright notice must be preserved in any copy or derivative work — thanks to the upstream
author for the original design and implementation.
