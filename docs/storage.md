---
title: Data & Resources (D1 / R2 / Free Tier)
status: current
audience: developer
last_verified: 2026-09-23
---

# Storage & Resources

[English](storage.md) | [简体中文](storage.zh-CN.md)

> This document describes which Cloudflare resources this Worker uses, where data lives, and how local development
> state is handled.
> Backup and restore steps are in [deployment.md](./deployment.md#backup--restore); the schema-change policy is in
> [improvement-plan.md](./improvement-plan.md) §2.2.

## 1. Cloudflare-side resources

| Resource | Binding | Name | Purpose | Notes |
|----------|---------|------|---------|-------|
| D1 | `DB` | `sun-panel-on-cloudflare-worker-db` | All business data (see section 2) | created automatically on deploy with wrangler ≥ 4.45 |
| R2 | `FILES` | `sun-panel-on-cloudflare-worker-files` | Uploaded images/files + fetched site icons | `/uploads/*` is proxied by the Worker |
| Static assets | (no binding) | `dist/` | Frontend build output | an assets binding is optional; this project does not use `env.ASSETS` |
| Secret | `JWT_SECRET` | — | JWT signing key | **required**, `wrangler secret put JWT_SECRET` |
| Secret | `PASSWORD_PEPPER` | — | password-hash pepper (part of the PBKDF2 key material) | optional but recommended; once set, never change or delete it |
| Secret | `PASSWORD_PBKDF2_ITERATIONS` | — | PBKDF2 iteration count | optional, default 5000 |

> **History**: KV (binding name `LOGIN_RATE`) used to throttle failed logins; it has moved to the D1 `login_attempt`
> table and the binding was removed (see [improvement-plan.md](./improvement-plan.md) §2.3 / §2.4). The automatically
> created KV namespace in the cloud is now an orphan (it only holds rate-limit counters) and can be deleted from the
> dashboard.

## 2. D1 tables

| Table | Purpose | Key content | Delete semantics |
|-------|---------|-------------|------------------|
| `item_icon` | Items on the panel | `title` / `url` / `lan_url` / `description` / `open_method` / `sort` / `item_icon_group_id` / `only_name`, with the icon in `icon_json` | soft delete (`deleted_at`) |
| `item_icon_group` | Groups | `title` / `sort` / `card_style` / `text_color` / `hide_description` | soft delete; deleting a group soft-deletes its items too |
| `user_config` | Panel and search configuration (**single row** `id = 1`) | `panel_json` (the whole style/background/footer config), `search_engine_json` (engine list + current engine + open method) | **whole-value overwrite**: avoid editing it from two tabs at once |
| `system_setting` | System key/value pairs | admin account/password hash/nickname/avatar, `custom_css`, `custom_js`, `auth_epoch` (token generation), `storage_auto_clean_unused` (image reclamation switch) | overwritten directly |
| `file` | Metadata for uploads and site icons | `src` (`./uploads/...`), `file_name`, `ext` | soft delete; the R2 object is deleted along with it |
| `login_attempt` | Login failure rate limiting | `ip` (primary key), `fail_count`, `window_start` | no soft delete; expired rows are reclaimed by probabilistic cleanup |

> **Removed** (no longer created, see [improvement-plan.md](./improvement-plan.md) §5.1 and §10.5): `module_config`
> (old search-box config, including the last migration read) and `notice` (notifications, no frontend caller left);
> on the settings side `system_application` / `disclaimer` / `web_about_description` were deleted together with the
> `/openness/*` endpoints and are no longer seeded.
>
> **Measured on the hosted instance (2026-09-21)**: that database was created on 2026-09-04, before the two cleanups
> above, so it still contains the `module_config` (**1 historical row**) and `notice` (0 rows) tables plus three
> deprecated settings keys. The code no longer touches them and keeping them is harmless; to remove them completely,
> back up first and confirm the schema as described in
> [improvement-plan.md Appendix A](./improvement-plan.md#appendix-a-state-of-0001_initsql-after-51).

## 3. R2 object layout and reclamation

| Key shape | Source | Overwrite behaviour |
|-----------|--------|---------------------|
| `yyyy/M/d/<md5>.<ext>` | `/api/file/uploadImg`, `/api/file/uploadFiles` | every upload is a new object (the key contains a timestamp hash) |
| `icons/<md5(host)>.<ext>` | `/api/panel/itemIcon/getSiteFavicon` | **stable per site**: fetching again overwrites the same object; the old object is deleted when the extension changes |

- Reads always go through `/uploads/*`: key whitelist validation (invalid keys 404 immediately),
  `X-Content-Type-Options: nosniff`, non-images forced to `Content-Disposition: attachment`, SVG additionally gets a
  `sandbox` CSP; uploads carry an `immutable` cache header.
- When a site icon changes extension (re-fetched), the old object is cleaned up — but it must pass the switch and the
  reference checks below, so an icon that is still in use is never deleted.

### 3.1 Image reclamation: two entry points, decision rules and the switch

> This section covers two user-visible things: the **switch at the top of the upload-file manager page** and the
> **"Clean unused files" button on the same page**.
> Implementation: `src/utils/uploadRefs.ts` (decision + deletion), `src/utils/settings.ts` (switch read/write),
> `src/api/panel/itemIcon.ts` / `itemIconGroup.ts` (triggered on delete), `src/api/system/file.ts` (manual cleanup
> endpoint).

**How the two entry points differ**

| Trigger | Controlled by the switch | Candidate set (which images are checked) |
|---------|--------------------------|------------------------------------------|
| Deleting an **item** | ✅ | the deleted item's `icon_json.src` |
| Deleting a **group** | ✅ | `icon_json.src` of every item in that group (deleting a group soft-deletes its items) |
| Re-fetching a site icon with a changed extension | ✅ | the object behind that site's old key |
| Clicking the **"Clean unused files" button** | ❌ **No** (it is your explicit action and always available) | every non-deleted row in the `file` table |

**How "still referenced" is decided**: after normalising the path to `uploads/...`, these checks run in order (any hit keeps the file):

1. does the `icon_json` of any **live** (`deleted_at IS NULL`) `item_icon` row contain that path;
2. does `user_config.panel_json` (the whole config: panel background, footer HTML, …) contain that path;
3. does `system_setting.admin_head_image` (the avatar) contain that path;
4. do `system_setting.custom_css` / `custom_js` (custom code in the global settings) contain that path.

The check uses **string containment** (not exact JSON matching) and errs on the safe side: at worst an unused file is
treated as used (slightly fewer deletions), but a file that *is* in use is **never** treated as unused.

**Switch: reclaim unreferenced images when deleting an item/group**

| Item | Value |
|------|-------|
| UI location | top of the upload-file manager page (switch + explanation on the left, "Clean unused files" button on the right) |
| Storage | `system_setting.storage_auto_clean_unused`: `'1'` = on, `'0'` = off |
| Default | **on** (a missing row means on, matching the behaviour before the switch existed) |
| Values that mean "off" | `0` / `false` / `off` / `no` (case-insensitive, surrounding whitespace ignored); any other non-empty value means on |
| Read failure (D1 hiccup, …) | **treated as "off"** and logged — one fewer deletion only leaves files behind, while a wrong deletion removes images you still want to reuse |
| Effect when off | deleting an item/group **only soft-deletes the D1 row and leaves R2 untouched**; the images stay in the list and can be reused or cleaned up manually |

**Button: "Clean unused files"**

```
click → confirmation dialog (spelling out the decision rule)
     → repeatedly call POST /api/system/file/cleanUnused (default max 30 candidates per call)
         → backend: read all non-deleted rows of the file table → one read + in-memory comparison for the reference check
                unreferenced → delete the R2 object (batched) and soft-delete the file row
         → returns { checked: total rows, deleted: deleted in this call, remaining: still deletable }
     → until remaining === 0 (capped at 50 rounds as a safety net)
     → the frontend reports "cleaned up N unused files" and refreshes the list
```

- **Why batching**: the Workers free tier allows **at most 50 subrequests per invocation**, and every object costs one
  R2 delete. The reference check itself is a fixed 3 queries (independent of the candidate count), so deletions are
  the real bottleneck; with batching a single invocation stays within "30 + 4" subrequests no matter how large the
  library grows.
- `checked` is the number of rows scanned and `deleted` the number actually removed; a large gap between them is normal.
- A failed object deletion is only logged (`[uploads] cleanup failed for …`), does not affect other objects and does
  not fail the request; the next cleanup retries it.
- Because only rows with `deleted_at IS NULL` are processed, clicking repeatedly is idempotent.

**Scenario matrix**

| Scenario | Switch on | Switch off |
|----------|-----------|------------|
| The image is used only by item A and A is deleted | object deleted + `file` row soft-deleted | both kept |
| The image is shared by items A and B, only A is deleted | kept (B still uses it) | kept |
| The image is both an item icon and the panel background | kept (`panel_json` hit) | kept |
| The image is set as the avatar | kept (`head_image` hit) | kept |
| Freshly uploaded, not used anywhere yet | deleting an item does not touch it; **the button deletes it** | same (the button still deletes it) |
| The icon is an external URL `https://…` | never deleted (not an object of this site) | same |
| The R2 delete fails | skip that entry, keep the `file` row, log a warning | — |

**Two boundaries you must know**

1. **The reference check is string containment, not exact parsing**: it errs on the safe side (at worst keeping an
   unused file), but conversely, if an image path happens to appear as a substring somewhere else (rare), it is kept
   as well — use the single-card delete in the file manager when you want a manual cleanup.
2. **The per-card delete button does no reference checking**: the delete in the top-right corner of each card in the
   file-manager list (`POST /file/deletes`) is "you said delete, so it deletes" — it neither checks references nor
   respects the switch, so deleting an image that items still use breaks those items. Use "Clean unused files" for
   bulk cleanup.

> History: `custom_css` / `custom_js` were once outside the check (improvement-plan §9.8) and are now included
> (check 4 above).

## 4. Local development state (`.wrangler/state/v3/`, gitignored)

```
.wrangler/state/v3/
├── d1/miniflare-D1DatabaseObject/
│   ├── <hash>.sqlite          each local D1 database = one real SQLite file
│   ├── <hash>.sqlite-wal      write-ahead log (committed but not yet checkpointed transactions)
│   ├── <hash>.sqlite-shm      shared-memory index for the WAL (safe to delete, rebuilt automatically)
│   └── metadata.sqlite        miniflare bookkeeping (binding name ↔ database id), not business data
├── r2/                        local R2 objects
├── cache/                     local Cache API storage
├── observability/             local traces etc.
└── kv/                        leftovers of the old rate limiter (unused, safe to delete)
```

- **One logical database is three files** (`.sqlite` / `-wal` / `-shm`), which is the normal shape of SQLite WAL mode,
  not three databases. Do not copy only the `.sqlite` file when backing up; for a clean snapshot stop `wrangler dev`
  first (a normal exit checkpoints).
- The `<hash>` in the file name is derived from the database identity: changing `database_name`, having set a
  `database_id` in the past, or a wrangler upgrade can all produce a new `<hash>.sqlite` while the old one stays
  around. The quickest way to tell which one is in use is the modification time, or
  `wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table'"`.
- **Resetting local data**: stop `wrangler dev` → delete `.wrangler/state/v3/d1` (or the whole `state`) →
  `npm run migrations:apply:local`. This only affects local state, never the hosted instance.

## 5. Structure change policy (single-file baseline)

- `migrations/` now contains only `0001_init.sql`, which describes the **final schema as of now** and **only applies
  to brand-new databases**.
- Why a deployed database does not re-run it: D1's `d1_migrations` table records **file names only** (no content
  hash), and the name `0001_init.sql` is already recorded, so editing its content changes nothing.
- Therefore, for a deployed database:
  - **new table** → a lazy fallback in code is acceptable (`CREATE TABLE IF NOT EXISTS`, once per isolate);
    `login_attempt` does exactly that;
  - **changing an existing table** (adding a column, changing a constraint, dropping a table) → there is no runtime
    fallback; write a one-off `docs/sql/<date>_<purpose>.sql` and run it **before deploying the code**.
- Do not edit an already-applied migration and expect it to re-run; also do not rename the merged file (it would be
  treated as a new migration and `ADD COLUMN` would fail with a duplicate-column error).

## 6. Backup and restore

See [deployment.md "Backup & Restore"](./deployment.md#backup--restore): D1 via `wrangler d1 export`, R2 via
`rclone sync` (or `wrangler r2 object get`). Note that the in-app "Import/Export" only covers icons and style
configuration and **does not include images**.

## 7. Cloudflare free-tier limits and current usage (measured 2026-09-21)

> This project runs on the **Workers free tier** (single user, personal site). The tables below put "official limits"
> next to "measured usage" so you can tell whether it can keep running for free. Limits come from the official
> Limits / Pricing pages (D1, Workers, R2, KV); usage comes from `wrangler d1 list/info`,
> `wrangler d1 execute --remote`, `wrangler r2 bucket list`, `wrangler kv namespace list` and a local `dist/` count.
> The numbers change over time — **re-verify before changing infrastructure** (do not treat this table as a
> long-term conclusion).

### 7.1 Compute and requests

| Resource | Current usage (measured) | Free-tier limit | Verdict |
|----------|--------------------------|-----------------|---------|
| Worker requests | not counted per day (the CLI cannot read it; see Dashboard → Workers → Metrics); D1 saw only 93 read queries in 24 h, and at 5~10 API calls per page that is tens to hundreds per day | **100,000/day** (Error 1027 above that) | three orders of magnitude of headroom |
| Worker CPU time | the heaviest single request is login (PBKDF2 with the default 5000 iterations ≈ 2.6 ms measured); everything else is single-digit milliseconds | **10 ms/request** | the default iteration count leaves a 3–4× margin; do **not** raise `PASSWORD_PBKDF2_ITERATIONS` beyond ~100k (that returns 1102) |
| Subrequests | home page: 3 queries (§4.2); cleaning unused files: ≤ 30 objects + 4 queries per call | **50/call** | batching was implemented around this constraint (§9.9) |
| Static assets | `dist/`: **99 files / 3.15 MB**, largest file 0.71 MB | **20,000 files / 25 MiB per file** | plenty of headroom |
| Environment variables and secrets | ≤ 3 (`JWT_SECRET` required, `PASSWORD_PEPPER`, `PASSWORD_PBKDF2_ITERATIONS` optional) | **64 per Worker** | plenty of headroom |

### 7.2 D1

| Item | Current usage (measured) | Free-tier limit | Verdict |
|------|--------------------------|-----------------|---------|
| Database storage | `sun-panel-on-cloudflare-worker-db` **77.8 kB** (6 business tables + historical ones) | **500 MB** per database, 5 GB per account | three orders of magnitude of headroom |
| Databases per account | 4 (`sun-panel-on-cloudflare-worker-db` / m365-copilot2api / inkstone-db / cloud-mail, about 1.3 MB in total) | **10 per account** | 6 left (a rename transition leaves one extra old database; delete it to recover) |
| Rows read | **104 rows** in 24 h | **5,000,000 rows/day** | huge headroom |
| Rows written | **15 rows** in 24 h | **100,000 rows/day** | huge headroom |
| Queries per invocation | home page 3; cleanup 3 + batches | **50/call** | already handled |
| Bound parameters per statement | 90 per batch in the cleanup flow | **100** | room left below the cap |
| Time Travel | unused (enabled by default) | 7 days on the free plan | useful for rolling back accidental deletes |

> D1 bills in **rows**, not bytes: `SELECT` counts only the rows scanned and writes count the rows touched by
> `INSERT/UPDATE/DELETE`. Every query in this project either uses an index or touches very few rows
> (`item_icon_group_id` is indexed, `user_config` is a single row, `system_setting` is read by primary key), so even
> long-term operation stays well within the limits.

### 7.3 R2

| Item | Current usage | Free-tier limit | Verdict |
|------|---------------|-----------------|---------|
| Buckets | 2 (`sun-panel-on-cloudflare-worker-files` + `inkstone-files` from another project) | the free tier does not limit buckets | — |
| Objects and size | corresponds to `file` table rows (**2 rows online**: 1 upload + 1 site icon), each object in the hundreds of KB | **10 GB-month/month** | huge headroom |
| Class A (writes/list) | one `PutObject` per upload, single digits per day | **1,000,000/month** | huge headroom |
| Class B (reads) | one `GetObject` per `/uploads/*` request (browsers cache for 24 h) | **10,000,000/month** | huge headroom |
| Egress | — | **free** | — |

> Note: `DeleteObject` is a **free operation** in R2 billing, so "Clean unused files" consumes no Class A/B quota.
> The authoritative object count lives in Dashboard → R2 → `sun-panel-on-cloudflare-worker-files` → Metrics (the CLI
> has no list command yet).

### 7.4 KV

This project **no longer uses KV** (rate limiting moved to D1, see [improvement-plan.md §2.3 / §2.4](./improvement-plan.md)).
The old `sun-panel-login-rate` namespace is still in the account with **0 keys** measured; it is an orphan you can
delete at any time, so the KV free tier (100k reads/day, 1,000 writes/day, 1 GB storage) is **not used at all** by
this project.

### 7.5 Conclusion

- Every resource sits **below one thousandth** of its free-tier allowance, so staying on the free tier is fine;
- the numbers that actually matter are not the totals but the **hard per-invocation constraints**:
  `50 subrequests/call`, `10 ms CPU/request`, `50 D1 queries/call`; the code guards against them by removing the
  home-page N+1, batching and chunking the cleanup flow, and keeping PBKDF2 at the default 5000 iterations;
- there is exactly one trigger for upgrading to Workers Paid: wanting to raise `PASSWORD_PBKDF2_ITERATIONS` into the
  200k range (stronger brute-force resistance), at which point the CPU limit becomes 30 s per request.
