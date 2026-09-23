# Sun-Panel → Cloudflare Worker Migration Plan

[English](plan.md) | [简体中文](plan.zh-CN.md)

> [!NOTE]
> **Historical document**: this design was written before the migration started and records the technology choices and
> the staged plan of that time. It does **not** describe the current implementation.
> Known differences from the implementation:
> - the plan used Drizzle ORM + `src/db/schema.ts`; the implementation uses D1's native `prepare/bind` (no ORM dependency)
> - the plan output the frontend build to `frontend/dist/`; it actually goes to `dist/` at the repository root (served through `[assets]` in `wrangler.toml`)
> - the plan kept multi-user / registration / public visitor mode; the implementation is single-user
> - the plan stored system settings in KV; they live in the D1 `system_setting` table (see `src/utils/settings.ts`, `migrations/0001_init.sql`)
> - the plan had site icons "return the favicon URL only"; they are actually downloaded into R2 (see `getSiteFavicon` in `src/api/panel/itemIcon.ts`)
>
> The current structure and deployment are governed by the root [README](../../../README.md) (Chinese version:
> `README.zh-CN.md`) and [deployment.md](../../deployment.md);
> the documentation index is [docs/README.md](../../README.md).

## Analysis of the Starting Point

Sun-Panel is a **Go (Gin) + Vue 3** server navigation panel; the architecture at the time:

- **Backend**: Go + Gin, SQLite/MySQL, local filesystem storage
- **Frontend**: Vue 3 + Vite + Naive UI + Pinia + TypeScript
- **Deployment**: a Docker container bundling the compiled backend and frontend

### Core Feature Inventory

| Feature | Implementation then | Fit for a Worker |
|---------|---------------------|------------------|
| User login / auth | Go in-memory cache + DB token | ✅ needs JWT + KV |
| Bookmark icon management (ItemIcon) | GORM CRUD | ✅ needs D1/KV |
| Icon group management (ItemIconGroup) | GORM CRUD | ✅ needs D1/KV |
| User config (panel style / search engine) | GORM JSON column | ✅ needs D1/KV |
| Module config (clock / search box, …) | GORM JSON column | ✅ needs D1/KV |
| File upload (images/files) | local filesystem | ⚠️ needs R2 |
| System monitor (CPU/memory/disk) | gopsutil reading the host | ❌ not applicable, remove or simplify |
| System settings (SystemSetting) | GORM CRUD | ✅ needs KV |
| Notifications (Notice) | GORM CRUD | ✅ needs D1 |
| CAPTCHA | go-cache in memory | ⚠️ needs KV + simplification |
| Site favicon fetching | fetch over the network + store locally | ⚠️ needs a proxy that returns the URL |
| Public access mode | cached public-user token | ✅ needs JWT |

### Technical Constraints

- A Worker has **no local filesystem** → file storage moves to R2
- A Worker has **no persistent memory** → caches move to KV / memory is only valid within a single request
- A Worker has a **CPU time limit per request** (10 ms free, 30 s paid) → logic must be lean
- A Worker **does not support native SQLite** → use Cloudflare D1 (SQLite-compatible)
- A Worker **does not support long-lived connections** → no WebSocket, nothing to consider

---

## Migration Architecture

```
┌──────────────────────────────────────────────┐
│                Cloudflare Worker               │
│                                                │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │  Frontend   │  │  API route handling  │   │
│  │  SPA        │  │  (Hono framework)    │   │
│  │  (Vue build)│  │                      │   │
│  │  static     │  │  /api/* → business   │   │
│  │  /assets/*  │  │          logic       │   │
│  │  /index.html│  │                      │   │
│  └─────────────┘  └──────────────────────┘   │
│                                                │
│  ┌──────┐  ┌──────┐  ┌──────┐                │
│  │  D1  │  │  KV  │  │  R2  │                │
│  │  DB  │  │cache │  │files │                │
│  └──────┘  └──────┘  └──────┘                │
└──────────────────────────────────────────────┘
```

**Key technology decisions**:
- **API framework**: Hono (lightweight, native to Cloudflare Workers, TypeScript)
- **Database**: Cloudflare D1 (serverless SQLite)
- **Cache/config**: Cloudflare KV (low-latency key/value store)
- **File storage**: Cloudflare R2 (S3-compatible object storage)
- **Auth**: JWT (stateless, a good fit for Workers)
- **ORM**: Drizzle ORM (lightweight, native D1 support, TypeScript)

---

## Implementation Steps (staged)

### Stage 1: Project bootstrap and base architecture

1. **Create the Worker project structure**
   ```
   sun-panel-worker/
   ├── src/
   │   ├── index.ts            # Worker entry (Hono app)
   │   ├── api/                 # API routes
   │   │   ├── auth.ts          # login / auth
   │   │   ├── openness.ts      # public endpoints
   │   │   ├── panel/           # panel management
   │   │   │   ├── itemIcon.ts
   │   │   │   ├── itemIconGroup.ts
   │   │   │   ├── userConfig.ts
   │   │   │   ├── users.ts
   │   │   ├── system/          # system management
   │   │   │   ├── about.ts
   │   │   │   ├── file.ts
   │   │   │   ├── moduleConfig.ts
   │   │   │   ├── notice.ts
   │   │   │   ├── user.ts
   │   ├── middleware/          # middleware
   │   │   ├── auth.ts          # JWT verification
   │   │   ├── admin.ts         # admin check
   │   │   ├── publicMode.ts    # public mode
   │   ├── db/                  # database layer
   │   │   ├── schema.ts        # Drizzle schema
   │   │   ├── migrations/      # D1 migrations
   │   │   ├── client.ts        # DB client
   │   ├── utils/               # helpers
   │   │   ├── jwt.ts           # JWT helpers
   │   │   ├── password.ts      # password hashing
   │   │   ├── response.ts      # API response shape
   │   │   ├── favicon.ts       # site favicon fetching
   │   ├── types/               # TypeScript types
   ├── frontend/                # Vue 3 frontend (ported from the existing code)
   │   ├── src/                 # existing Vue code
   │   ├── public/
   │   ├── package.json
   │   ├── vite.config.ts
   ├── wrangler.toml            # Cloudflare Worker config
   ├── package.json             # Worker dependencies
   ├── tsconfig.json
   ```

2. **Install the core dependencies**
   - `hono` — API framework
   - `@cloudflare/d1` / `drizzle-orm` + `drizzle-kit` — database ORM
   - `jose` — JWT library (Worker-compatible)
   - `@cloudflare/workers-types` — Worker typings

3. **Configure wrangler.toml**
   - D1 database binding
   - KV namespace binding
   - R2 bucket binding
   - routing rules (SPA fallback + API)

### Stage 2: Database schema and migrations

4. **Define the D1 schema (Drizzle ORM)**
   Translate the Go GORM models into a Drizzle schema:
   - `users` table (id, username, password, name, head_image, status, role, mail, referral_code, token)
   - `item_icons` table (id, icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id, user_id)
   - `item_icon_groups` table (id, icon, title, description, sort, user_id)
   - `user_configs` table (id, user_id, panel_json, search_engine_json)
   - `module_configs` table (id, user_id, name, value_json)
   - `system_settings` table (id, config_name, config_value)
   - `files` table (id, user_id, file_name, src, method, ext)
   - `notices` table (id, title, content, display_type, one_read, url, is_login, user_id)

5. **Generate and apply D1 migrations**
   with `drizzle-kit generate` + `wrangler d1 migrations apply`

### Stage 3: Rebuilding authentication

6. **JWT authentication**
   - sign/verify JWTs with the `jose` library
   - token payload: `{ userId, role, exp }`
   - the secret lives in KV or a Worker environment variable
   - login: POST `/api/login` → returns a JWT
   - logout: POST `/api/logout` → KV blacklist (optional)

7. **Middleware**
   - `authMiddleware`: verify the JWT and put the user into the context
   - `adminMiddleware`: check `role === 1`
   - `publicModeMiddleware`: allow token-less access using the public user id (read from the KV system settings)

### Stage 4: Implementing the API routes one by one

8. **Public endpoints (openness)**
   - GET `/api/loginConfig` → read system settings from KV
   - GET `/api/getDisclaimer` → read from KV
   - GET `/api/getAboutDescription` → read from KV

9. **Login endpoints**
   - POST `/api/login` → verify username/password, issue a JWT
   - POST `/api/logout` → clear the token (optional KV blacklist)

10. **Panel endpoints (panel)** — all require authentication
   - POST `/api/panel/itemIcon/edit` → D1 CRUD
   - POST `/api/panel/itemIcon/deletes` → D1 delete
   - POST `/api/panel/itemIcon/saveSort` → D1 batch reorder
   - POST `/api/panel/itemIcon/addMultiple` → D1 batch create
   - POST `/api/panel/itemIcon/getSiteFavicon` → fetch the favicon URL over the network
   - POST `/api/panel/itemIcon/getListByGroupId` → D1 query (public mode)
   - POST `/api/panel/itemIconGroup/edit` → D1 CRUD
   - POST `/api/panel/itemIconGroup/deletes` → D1 delete
   - POST `/api/panel/itemIconGroup/saveSort` → D1 batch reorder
   - POST `/api/panel/itemIconGroup/getList` → D1 query (public mode)
   - POST `/api/panel/userConfig/set` → D1 write
   - POST `/api/panel/userConfig/get` → D1 query (public mode)
   - POST `/api/panel/users/create` → D1 create (admin)
   - POST `/api/panel/users/update` → D1 update (admin)
   - POST `/api/panel/users/getList` → D1 paged query (admin)
   - POST `/api/panel/users/deletes` → D1 delete (admin)
   - POST `/api/panel/users/getPublicVisitUser` → KV/D1 read
   - POST `/api/panel/users/setPublicVisitUser` → KV/D1 write

11. **System endpoints (system)**
   - POST `/api/about` → version information
   - POST `/api/user/getInfo` → D1 query for the current user
   - POST `/api/user/updatePassword` → D1 password update
   - POST `/api/user/updateInfo` → D1 info update
   - POST `/api/user/getReferralCode` → D1 query
   - POST `/api/user/getAuthInfo` → public mode
   - POST `/api/notice/getListByDisplayType` → D1 query
   - POST `/api/system/moduleConfig/save` → D1 write
   - POST `/api/system/moduleConfig/getByName` → D1 query (public mode)
   - POST `/api/file/uploadImg` → upload an image to R2
   - POST `/api/file/uploadFiles` → upload a file to R2
   - POST `/api/file/getList` → D1 query for the file list
   - POST `/api/file/deletes` → delete from R2 + D1

### Stage 5: Moving file storage

12. **R2 uploads**
   - image upload: receive multipart → store in R2 → record in D1
   - file upload: receive multipart → store in R2 → record in D1
   - file access: proxy R2 through the Worker or use a public R2 domain
   - site favicon: return the favicon URL only (no download to the server)

### Stage 6: Frontend adaptation

13. **Reworking the frontend API layer**
   - `src/utils/request/axios.ts`: baseURL becomes `/api`
   - token passing: from `headers.token` to `headers.Authorization: Bearer xxx`
   - drop the dev proxy configuration (the Worker handles the API directly)
   - remove the system-monitor components (a Worker cannot read system information)

14. **Routing / component adjustments**
   - remove the system-monitor panel (CPU/memory/disk) or show Cloudflare status instead
   - remove the CAPTCHA component (password-only login)
   - keep: bookmark management, group management, panel style, search-engine configuration

15. **Frontend build integration**
   - build output goes to `frontend/dist/`
   - the Worker entry serves `dist/` as static assets
   - SPA fallback: every non-`/api` path returns `index.html`

### Stage 7: Removing features that do not apply

16. **Features to remove or replace**
   - ❌ **System monitor**: CPU/memory/disk → an "unavailable" message or a removed component
   - ❌ **CAPTCHA cache**: in-memory cache → remove the CAPTCHA or simplify it (stateless Worker)
   - ❌ **Redis**: everything moves to KV
   - ❌ **Sending e-mail**: a Worker cannot send mail directly → Cloudflare Email Workers or removal
   - ❌ **Local file reads/writes**: everything moves to R2 + D1
   - ❌ **INI config files**: wrangler.toml environment variables + KV

### Stage 8: Deployment and testing

17. **Local development environment**
   - `wrangler dev` starts the local Worker
   - local D1 emulation
   - local KV emulation
   - local R2 emulation (Miniflare)

18. **Deployment flow**
   - `pnpm run build:frontend` → build the frontend
   - `wrangler d1 migrations apply` → apply database migrations
   - `wrangler deploy` → deploy the Worker

19. **Initial data**
   - create the default admin user (admin@sun.cc / 12345678)
   - initialise the system settings (KV)
   - initialise the public-visit user settings

---

## Summary of Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| API framework | Hono | lightweight, native to Workers, TypeScript, routing style close to Express/Gin |
| Database | D1 + Drizzle ORM | D1 is Cloudflare's official SQLite service; Drizzle is the best TypeScript ORM |
| Auth | JWT (jose) | no in-memory cache in Workers, stateless JWT, jose runs on the Workers runtime |
| Cache | KV | low latency, a good fit for system settings / token blacklists |
| Files | R2 | S3-compatible, no egress fees, a good fit for images/files |
| Language | TypeScript | native to Workers, the frontend is TS too, one language stack |

## Keep vs Remove

| Feature | Decision |
|---------|----------|
| User login / registration | ✅ keep (rebuilt with JWT) |
| Bookmark icon management | ✅ keep (D1 storage) |
| Icon group management | ✅ keep (D1 storage) |
| Panel style configuration | ✅ keep (D1 storage) |
| Search-engine configuration | ✅ keep (D1 storage) |
| Module config (clock/search) | ✅ keep (D1 storage) |
| File upload | ✅ keep (R2 storage) |
| Multi-account isolation | ✅ keep |
| Public access mode | ✅ keep (JWT + KV) |
| Site favicon fetching | ✅ keep (returns the URL only) |
| Notifications | ✅ keep (D1 storage) |
| System monitor | ❌ remove (a Worker cannot read host information) |
| CAPTCHA | ⚠️ simplify (drop the image CAPTCHA) |
| E-mail password reset | ❌ remove (Workers environment limits) |
| Redis cache | ❌ remove (moves to KV) |

## Risks and Notes

1. **D1 performance**: D1 has some latency limits and the first query can be slow; use KV to cache hot data sensibly
2. **Worker CPU time**: the paid plan's 30 s is plenty, but the free plan's 10 ms may not be enough → a paid Workers plan is recommended
3. **R2 file access**: requires a public access domain or a Worker proxy
4. **Frontend compatibility**: a Vue SPA in hash-routing mode works fine on Workers; switching to history mode needs a fallback configuration
5. **Data migration**: if existing SQLite data must move to D1, a migration script has to be written
