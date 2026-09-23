---
title: Deployment & Local Development
status: current
audience: deployer
last_verified: 2026-09-23
---

# Deployment & Local Development

[English](deployment.md) | [简体中文](deployment.zh-CN.md)

> This document continues the "🚀 Quick Start" section of the root [README.md](../README.md) (also available as `README.zh-CN.md`) and is the complete guide to deployment and local development.
> Target shape: **a single Cloudflare Worker serving both the API and the frontend static assets**.

## Tech Stack

The tech stack and the differences from upstream are collected in the root [README tech-stack table](../README.md#️-tech-stack) (single source of truth, so they are not maintained in two places).
The only thing you need to know for deployment: **default account `admin` / `12345678`** (change it in "User Info" right after the first sign-in).

## Repository Structure

```
├── src/                     # Worker backend source (Hono)
│   ├── api/                 # Routes: panel/ and system/, mirroring the frontend src/api/
│   ├── middleware/          # JWT auth middleware
│   └── utils/               # Response format / password / JWT / files / settings / favicon
├── migrations/              # D1 migrations
├── frontend/                # Vue 3 frontend (npm workspace)
├── dist/                    # Frontend build output (gitignored, served by the Worker)
├── docs/                    # Documentation (index: docs/README.md; history/ = archive, upstream/ = upstream material)
├── scratch/                 # Self-check scripts (14: password / rate limit / upload / icons / filtering / engines / cookies / i18n …; see improvement-plan Appendix C)
├── reference/               # Upstream source copy for reference (gitignored, not part of the build)
├── wrangler.toml            # Worker config (D1/R2/static assets)
├── .dev.vars                # Local dev secrets (gitignored, template: .dev.vars.example)
├── package.json             # Root package: Worker deps + scripts + frontend workspace
└── tsconfig.json            # Worker TypeScript config
```

## Prerequisites

1. Create a [Cloudflare](https://dash.cloudflare.com) account
2. Install [Node.js](https://nodejs.org) **22+** and [Wrangler](https://developers.cloudflare.com/workers/wrangler/):
  ```bash
  npm install -g wrangler
  wrangler login
  ```

> The version floor comes from wrangler itself: the repository pins `wrangler ^4.45.0`, and 4.x requires Node ≥ 22
> (installing under an older Node prints `Wrangler requires at least Node.js v22.0.0`; Node 18 is EOL).
> Path one (Workers Git integration) needs no local Node — Cloudflare's build image uses Node 24 by default.

## Path 1: Workers Git integration (recommended; resources and migrations are automatic)

No manual D1/R2 creation and no local wrangler install:

1. Open the Cloudflare Dashboard → **Workers & Pages → Create → Import a repository** and pick this repository
   (the Worker name must match `name = "sun-panel-on-cloudflare-worker"` in `wrangler.toml`)
2. **Build command**: `npm run build`
   > Do **not** write `npm install && npm run build`: Workers Builds **installs dependencies automatically** before
   > running the build command (`SKIP_DEPENDENCY_INSTALL` disables that behaviour according to the official docs), so
   > installing again just wastes several minutes (the install step alone measured about 8 minutes).
3. **Deploy command**:
   ```bash
   npx wrangler deploy && npx wrangler d1 migrations apply sun-panel-on-cloudflare-worker-db --remote
   ```
   - `deploy` first, migrations second: when `wrangler.toml` has no `database_id`, D1 is created during deployment by
     automatic resource provisioning, and the migration command can only act on an existing database (swapping the
     order fails with
     `Couldn't find an auto-provisioned D1 DB named 'sun-panel-on-cloudflare-worker-db' for binding 'DB'. Run 'wrangler deploy' to provision it...`)
   - During deployment, wrangler (>= 4.45) detects D1/R2 resources that do not exist yet and **creates and binds them
     automatically** ([automatic resource provisioning](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/), Open Beta)
   - `wrangler deploy` works with the API token injected into the build environment, but the token Workers Builds
     creates automatically only carries Workers Scripts / R2 (edit) and **no D1** permissions, so remote migrations may
     fail with an authentication error. If that happens, replace (or create) the token under the Worker →
     **Settings → Build → API token** with one that can edit D1
4. After the first successful deploy, set the JWT secret once (secrets cannot be created by builds):
   use a random value for `JWT_SECRET` (`openssl rand -base64 48`, at least 32 characters; a shorter one makes the
   Worker log a weak-key warning): Worker → Settings → Variables and Secrets → add `JWT_SECRET`
   (or run `npx wrangler secret put JWT_SECRET` locally)
5. (optional but strongly recommended) also set `PASSWORD_PEPPER` (the password-hash pepper): new passwords are then
   stored as PBKDF2 + random salt + pepper, and old triple-MD5 hashes upgrade on the next successful login. How to
   configure it, when it takes effect, and why it must never be changed afterwards are covered in
   [Worker Secrets](#worker-secrets-keys-and-variables) below.

From then on every `git push` builds, deploys and applies new D1 migrations automatically.

> **No environment files need to be committed**: `frontend/.env` is excluded by `.gitignore`, and the build script
> `frontend/add-frontend-version.js` generates one from `frontend/.env.example` when `.env` is missing, writing
> `VITE_APP_VERSION` into it — so Workers Builds never fails over a missing `.env`.
> At runtime only `VITE_GLOB_API_URL=/api` is used; `VITE_APP_API_BASE_URL` is for the local dev proxy only. The
> defaults work directly for a hosted deployment; configure the environment variables in the build environment if you
> need to override them.

## Path 2: Deploying with local wrangler

### Creating cloud resources

> wrangler >= 4.45 supports automatic resource provisioning: when `wrangler.toml` has no id, `wrangler deploy` creates
> D1/R2 and links them to the Worker. The manual steps below only exist for older versions and are optional.

```bash
# 1. Create the D1 database
npx wrangler d1 create sun-panel-on-cloudflare-worker-db

# 2. Create the R2 bucket
npx wrangler r2 bucket create sun-panel-on-cloudflare-worker-files
```

After creating them manually, add the printed `database_id` to `[[d1_databases]]` in `wrangler.toml`
(that field is currently left empty).
Creating them by hand is not required: automatic provisioning creates them during deployment, and an interactive
local `wrangler deploy` even writes the generated id back into the config file (keep it or discard it); CI does not
write back, yet later deployments work all the same.

## Build & Deploy

```bash
# 1. Install dependencies (single install, includes the frontend workspace)
npm install

# 2. Build the frontend (outputs to dist/, served by the Worker)
npm run build

# 3. Set the JWT secret (signs login tokens, required; use a random value ≥32 chars, e.g. `openssl rand -base64 48`)
npx wrangler secret put JWT_SECRET

# 3b. (optional but strongly recommended) set the password pepper: new passwords are then stored as
#     PBKDF2 + random salt + pepper; old triple-MD5 hashes can still log in and are upgraded after a successful login.
#     ⚠️ once set, never change or delete it: old hashes can no longer be verified (you get an explicit 1009
#     message instead of "wrong password"), so back it up together with JWT_SECRET.
npx wrangler secret put PASSWORD_PEPPER

# 3c. (optional) PBKDF2 iteration count, default 5000 (≈2.6 ms CPU measured on this machine).
#     The free plan allows 10 ms CPU per request, so a much larger value makes login fail with 1102;
#     after upgrading to Workers Paid you can raise it to 210000.
# npx wrangler secret put PASSWORD_PBKDF2_ITERATIONS

# 4. Deploy (the first deploy creates and binds D1/R2 as described in wrangler.toml)
npm run deploy

# 5. Apply database migrations (remote D1; needs the database to exist, hence after deploy)
npm run migrations:apply
```

> **Do not swap the order**: without a `database_id`, D1 is created by the first `wrangler deploy`, so running
> `npm run migrations:apply` first fails because the database cannot be found.
> If you already created D1 manually as described above, migrating before deploying also works.

Once deployed, open the printed URL (e.g. `https://sun-panel-on-cloudflare-worker.xxx.workers.dev`) and sign in with
the default account `admin` / `12345678`.

> `npm run deploy:all` combines "build the frontend + deploy" in one step (migrations still run separately).

## Worker Secrets (Keys and Variables)

The Worker reads three settings from the environment (the types are in `Env` in `src/types.ts`); the full resource
inventory is in [storage.md §1](./storage.md#1-cloudflare-side-resources):

| Name | Recommended type | Required | Purpose |
|------|------------------|----------|---------|
| `JWT_SECRET` | **Secret** | yes | Signing key for login tokens (HS256). When missing or blank, login and auth fail closed with 503 |
| `PASSWORD_PEPPER` | **Secret** | optional, strongly recommended | Password-hash pepper (half of the PBKDF2 key material), see the next section |
| `PASSWORD_PBKDF2_ITERATIONS` | a plain variable is fine | optional | PBKDF2 iteration count, default 5000, clamped to 1000–1000000 |

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put PASSWORD_PEPPER
```

You can also use Dashboard → Worker → **Settings → Variables and Secrets** (pick the Secret type).
`PASSWORD_PBKDF2_ITERATIONS` is just an iteration count with nothing secret in it, so a plain variable (`[vars]` in
`wrangler.toml` or the Text type in the dashboard) works too.

> Builds cannot create secrets: set them by hand once after the first deploy. Every automatic deploy triggered by a
> later `git push` keeps the existing secrets — it never overwrites or clears them.

### PASSWORD_PEPPER: the password-hash pepper

**What it buys you**: someone who only has the D1 database (or a backup export) cannot brute-force the admin password
offline.

- **Without it**, passwords are stored as **unsalted triple MD5** (`md5(md5(md5(pwd)))`, compatible with upstream
  Sun-Panel). Those hashes are in public rainbow tables (`12345678` is a direct hit), and even without a table an
  8-digit numeric password falls to a GPU in seconds.
- **With it**, new passwords use PBKDF2-SHA256 + random salt + pepper, i.e.
  `hash = PBKDF2-SHA256(pepper ‖ password, salt, iterations)`, and the hash string is self-describing:
  `pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>$<pepperId>` (implementation in `src/utils/password.ts`).
  An attacker must obtain the database **and** the pepper (which lives only in the Worker environment) before any
  candidate password can even be tested.

**⚠️ Once set, keep it exactly as it is**: after the pepper is replaced, no `pbkdf2$…` hash can be verified and login
returns an explicit `1009` message instead of "wrong password" — the `pepperId` at the end of the hash string (the
first 8 hex digits of `sha256(pepper)`) exists precisely to detect that case. Store it in your password manager
together with `JWT_SECRET`. The reverse also holds: **do not delete** it after configuring it, or password changes
fall back to writing triple MD5 (with nothing but a `console.warn`), taking the security level down with them.

**It only takes effect after "one login or one password change"**: setting the secret alone does not rewrite any
existing hash — as long as the stored value is still in the old format (`^[0-9a-f]{32}$`), `checkPassword()` takes
the triple-MD5 branch and the pepper plays no part at all. To make it real:

- **sign in once** with the current password: `needsRehash()` hits and the hash is rewritten in place as `pbkdf2$…`
  right after the successful login (`src/api/login.ts`);
- or **change the password once** under "User Info", which writes a v2 hash directly (`src/api/system/user.ts`).

To verify:

```bash
npx wrangler d1 execute sun-panel-on-cloudflare-worker-db --remote \
  --command "SELECT substr(config_value, 1, 45) FROM system_setting WHERE config_name = 'admin_password'"
```

A value starting with `pbkdf2$sha256$` means it took effect; if it is still `579646aad11fae4dd295812fb4526245`
(the triple MD5 of `12345678`, the migration seed), nothing has been recomputed yet.

**If the pepper is lost, or you need to reset the password**: write `admin_password` back to the legacy format, log in
once as `12345678` so the system recomputes it with the *current* pepper, then immediately change it to your own
password:

```bash
npx wrangler d1 execute sun-panel-on-cloudflare-worker-db --remote \
  --command "UPDATE system_setting SET config_value = '579646aad11fae4dd295812fb4526245' WHERE config_name = 'admin_password'"
```

> This fallback works because legacy hashes verify without any pepper; but it only upgrades the hash to v2 when the
> server **has** a pepper configured, so set the pepper first.

### PASSWORD_PBKDF2_ITERATIONS: the PBKDF2 iteration count

- Default **5000**. Measured with WebCrypto on this machine: 5k ≈ 2.6 ms, 10k ≈ 4.5 ms, 100k ≈ 43 ms,
  210k ≈ 85 ms of CPU.
- **The free tier's hard limit is 10 ms CPU per request**; exceeding it fails with Error 1102 (login breaks). The
  default deliberately keeps a 3–4× margin; do not push it into the 100k range on the free tier — reaching 210000
  requires Workers Paid first (CPU limit becomes 30 s per request). See
  [storage.md §7](./storage.md).
- `resolveIterations()` clamps the value to `[1000, 1000000]` and falls back to the default 5000 when it is invalid
  or out of range.
- **You can change it at any time**: the iteration count is part of the hash string, so raising it still verifies old
  hashes and they are recomputed with the new value on the next successful login (the exact opposite of the pepper's
  "set once, never touch" rule).
- It **only means anything once a pepper is configured**: without a pepper no v2 hash is ever produced, so the
  iteration count never comes into play.

## Local Development & Testing

```bash
# 1. Install dependencies (single install, includes the frontend workspace)
npm install

# 2. Copy the frontend environment file (once; CI generates it from .env.example)
copy frontend\.env.example frontend\.env

# 3. Copy the Worker local environment file (once; the template gives JWT_SECRET a value and lists
#    PASSWORD_PEPPER / PASSWORD_PBKDF2_ITERATIONS as comments)
copy .dev.vars.example .dev.vars

# 4. Apply migrations to the local database (first time)
npm run migrations:apply:local

# Terminal 1: Worker + local D1/R2 emulation (http://127.0.0.1:8787)
npm run dev

# Terminal 2: frontend dev server with HMR (http://127.0.0.1:1002)
npm run dev:web
```

## Code Checks

```bash
npm run check   # full check: Worker typecheck + frontend typecheck + frontend lint
npm run build   # build the frontend (outputs to dist/)
```

> Note: the frontend dev server proxies `/api` and `/uploads` to the Worker
> (`VITE_APP_API_BASE_URL=http://127.0.0.1:8787/` in `frontend/.env`).
> To test the Worker together with the build output only, run `npm run build` first and open `http://127.0.0.1:8787`.
> The local development secrets live in `.dev.vars` (`JWT_SECRET`, optionally `PASSWORD_PEPPER` /
> `PASSWORD_PBKDF2_ITERATIONS`); for production use `npx wrangler secret put <NAME>`
> (see [Worker Secrets](#worker-secrets-keys-and-variables)).
> Without a pepper, local development takes the same compatible triple-MD5 path as production; you only need it to
> exercise the PBKDF2 behaviour. The local D1 is a separate database, so it does **not** have to reuse the production
> pepper.

## Backup & Restore

Data lives in two places: **D1** (all business data) and **R2** (uploaded images/files + site icons).
The in-app "Import/Export" only covers icons and style configuration and **does not include images**, so for
self-hosting you should back up both as described below.

### D1 (business data)

```bash
# Export as SQL (written to the current directory by default, named like <db-name>-<timestamp>.sql)
npx wrangler d1 export sun-panel-on-cloudflare-worker-db --remote --output=backup/$(date +%Y%m%d)-db.sql

# Data only (no CREATE statements): use this when the target database already has the schema
npx wrangler d1 export sun-panel-on-cloudflare-worker-db --remote --no-schema --output=backup/data.sql
```

Restore: run the exported SQL against an empty database
(`npx wrangler d1 execute sun-panel-on-cloudflare-worker-db --remote --file=backup/xxx.sql`), then confirm that the
schema matches the current code as described in [storage.md §5](./storage.md#5-structure-change-policy-single-file-baseline).

> D1 Time Travel also helps in an emergency: check the rollback points in the dashboard or with
> `npx wrangler d1 time-travel info sun-panel-on-cloudflare-worker-db`
> (30 days by default; check the official docs for the free-plan retention).

### R2 (images and files)

R2 has no "export to a single file" command, so there are two approaches:

```bash
# Option A: rclone (recommended, supports incremental sync) — configure the S3-compatible endpoint with `rclone config` first
rclone sync r2:sun-panel-on-cloudflare-worker-files ./backup/r2 --progress

# Option B: download objects one by one (fine for a small number of objects)
npx wrangler r2 object get sun-panel-on-cloudflare-worker-files/<key> --file=./backup/r2/<key>
```

The two object-key shapes are described in [storage.md §3](./storage.md#3-r2-object-layout-and-reclamation); to
restore, upload the objects back into the bucket under the same keys
(`rclone sync ./backup/r2 r2:sun-panel-on-cloudflare-worker-files`).

> Note: the `file` table stores paths as `./uploads/<key>`, so "D1 + R2" must be backed up and restored together —
> restoring only one side leaves either list entries whose images 404, or images that no list shows.

### Secrets

`JWT_SECRET` and `PASSWORD_PEPPER` (if configured) cannot be read back from Cloudflare, so keep them in your password
manager:
- losing `JWT_SECRET` → everyone has to sign in again;
- losing `PASSWORD_PEPPER` → new password hashes can no longer be verified (login returns an explicit 1009 message)
  and the password must be reset.

`PASSWORD_PBKDF2_ITERATIONS` needs **no backup**: it holds nothing secret, can be changed at any time, and raising it
still verifies old hashes (they are recomputed on the next login).

Also, **the D1 backup and `PASSWORD_PEPPER` must be kept together**: a database restored from a backup holds
`pbkdf2$…` hashes, so a missing pepper means "the password is right but login fails with 1009". See
[Worker Secrets](#worker-secrets-keys-and-variables).

## FAQ

**Build fails: `Error: ENOENT: no such file or directory, open '.env'`**

```
> sun-panel-frontend@1.3.0 add-version
> node ./add-frontend-version.js
Error: ENOENT: no such file or directory, open '.env'
```

Cause: the build script `frontend/add-frontend-version.js` reads and writes `frontend/.env`, but `.env` is excluded
by `.gitignore`, so a fresh CI clone only has `.env.example`; the script calls `readFileSync` and crashes, which
`run-p` propagates to `type-check` and `vite build`.

Fix: the current code already handles this — when `.env` is missing the script generates it from
`frontend/.env.example` before writing `VITE_APP_VERSION`; the `build` script also runs `add-version` first in
sequence so vite never reads a `.env` with a stale version. Simply update to the latest code.

**Build takes too long (the install step appears twice, ten-plus minutes in total)**

Workers Builds installs dependencies before running the build command, so writing `npm install` in the Build command
installs them twice. Change the Build command from `npm install && npm run build` to `npm run build`.

**`npm run migrations:apply` cannot find the database locally / on first deploy**

```
Couldn't find an auto-provisioned D1 DB named 'sun-panel-on-cloudflare-worker-db' for binding 'DB'.
Run 'wrangler deploy' to provision it, or add 'database_name' / 'database_id' to your config.
```

Cause: without a `database_id`, D1 is created by `wrangler deploy`, and the migration command only acts on an
existing database. Run `npm run deploy` first, then `npm run migrations:apply`.

**The Deploy command in Workers Builds fails with an authentication error at the migration step**

The automatically created build token has no D1 permissions. Replace it under Worker →
**Settings → Build → API token** with a token that can edit D1 and rebuild.

**Login returns 1009: `PASSWORD_PEPPER` missing or not matching the stored hashes**

The API answers with these two messages (quoted verbatim; the server texts are Chinese):

```
服务端未配置 PASSWORD_PEPPER，无法校验当前密码哈希，请执行 wrangler secret put PASSWORD_PEPPER 后重试
PASSWORD_PEPPER 与当前密码哈希不匹配，请恢复原有 secret 后重试
```

Cause: `system_setting.admin_password` holds a `pbkdf2$sha256$…` hash, but the Worker has no pepper configured, or
the configured pepper does not match the `pepperId` recorded at the end of the hash string (the pepper was replaced
or removed). Both cases fail closed with an explicit error instead of pretending the password is wrong.

Fix: restore the pepper that was configured (`npx wrangler secret put PASSWORD_PEPPER`). If it is truly gone, follow
the reset steps in [Worker Secrets](#worker-secrets-keys-and-variables) (write the legacy hash back → sign in as
`12345678` → the system recomputes with the current pepper → change the password immediately).

## Differences from Upstream

See the root [README "Differences from Upstream (Sun-Panel v1.3.0)" table and "Known Limitations"](../README.md#-differences-from-upstream-sun-panel-v130) (including how the v1.3.0 baseline is defined).

> The frontend build output always goes to `dist/` at the repository root and is served by the Worker's static
> assets; `frontend/` only contains source code.

> Where data lives, what can be deleted, and whether the free tier is enough — see [storage.md](./storage.md)
> (including usage measured on 2026-09-21).
