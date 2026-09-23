---
title: Improvement Plan
status: current
audience: developer
last_verified: 2026-09-23
---

# Improvement Plan (backlog · completed work · self-checks)

[English](improvement-plan.md) | [简体中文](improvement-plan.zh-CN.md)

> This file is the **single source of truth for planned changes** in this repository; status columns are filled in
> once work lands.
> Historical designs (from the Go → Worker migration) are in [history/migration/plan.md](./history/migration/plan.md),
> the early requirement list in [history/requirements/early-todo.md](./history/requirements/early-todo.md) (archiving
> criteria: [history/README.md](./history/README.md)).
>
> **How to read it**:
> - looking for **work that is not done yet** → §9 "candidate backlog" (9.10~9.12 need clarification) and §10.3 "still open";
> - looking for **what a round fixed** → §10.1 / §10.2 and §10.5;
> - looking for **the evidence of that time** → the "outcome" paragraphs of §1~§8 and the self-check script list in Appendix C.
>
> **Current state**: §2 ~ §6 are all closed (§2.5 cancelled by decision D5, §5.3 decided against); in §9, 9.0 ~ 9.5, 9.8
> and 9.9 are done, 9.6 awaits confirmation (optional, operations side), 9.7 awaits execution and 9.10 ~ 9.12 need
> clarified requirements.
> Closing verification: **all 14 self-check scripts pass**, `npm run check` (tsc + vue-tsc + eslint) reports
> **0 error / 0 warning**, the i18n audit reports 0 missing / 0 zh-en mismatches / 0 dead strings, and `vite build`
> rebuilt `dist/` successfully.

**Status legend**: `done` / `to do` / `in progress` / `to confirm`

---

## 0. Decision log (confirmed this round)

| # | Decision | Immediate consequences |
|---|----------|------------------------|
| **D1** | Collapse `migrations/` into a single `0001_init.sql` | the directory keeps one file only; **cost**: structural changes on an already-deployed database must go through one-off scripts (see 2.2) |
| **D2** | Move login rate limiting from KV to D1 (single atomic UPSERT) | removes both the "read-modify-write drops counts" race and rate-limit bypasses caused by KV read lag |
| **D3** | KV is no longer used → delete the binding, types, code and documentation | one binding less in `wrangler.toml`; the automatically created cloud namespace becomes a deletable orphan |
| **D4** | Fix the "search bar searches panel items" filtering defect with option A | done, see §7 |
| **D5** | **Skip one-off upgrade scripts for old databases**: the `login_attempt` table needed by deployed databases is created by a **lazy table-creation fallback** in code (one `CREATE TABLE IF NOT EXISTS` per isolate lifetime) | the `docs/sql/` directory is no longer needed; neither old nor new databases need manual SQL, see §2.3 |
| **D6** | **The password pepper is optional: no pepper, no upgrade**; PBKDF2 iterations default to 5000 (≈2.6 ms measured; the free plan allows 10 ms CPU) and can be overridden with `PASSWORD_PBKDF2_ITERATIONS` | behaviour is identical to the old version until `PASSWORD_PEPPER` is set, so nobody locks themselves out; once set, logins upgrade hashes automatically, see §3.2 |
| **D7** | **No Worker-side edge cache** (`caches.default`), browser cache headers only: date-hashed keys use `immutable`, site icons a normal `max-age` | measurements showed the edge cache keeps serving deleted images for up to 24 hours; if an edge cache is needed, configure a Cloudflare Cache Rule and accept the same deletion delay, see §4.3 |
| **D8** | **Add an "automatically reclaim unreferenced images when deleting items/groups" switch, on by default** (`system_setting.storage_auto_clean_unused`, toggled in the upload-file manager page) | users who want to keep images for later can turn automatic reclamation off: deletion then only soft-deletes D1 and leaves R2 alone, and the "Clean unused files" button is there for manual work. A failed settings read counts as "off" (conservative), see §9.0 |

> D8 was added on user request after the plan had been closed (it was not part of the original plan); it is implemented
> and verified, see §9.0.

> D2 and D3 are two halves of one change: once rate limiting moved, KV had no purpose left in this project (a
> repository-wide check confirmed `LOGIN_RATE` only appeared in `src/api/login.ts` and `src/types.ts`), so both were
> removed together.

---

## 1. Stage overview

> The numbers are section numbers (stage one lives in §2, stage two in §3, stage three in §4, stage four in §5, stage
> five in §6).

| Stage | Item | Goal | Size | Depends on | Status |
|-------|------|------|------|------------|--------|
| 1 | **2.1** collapse migrations into one file | tidy directory + a new database built in one pass | S | pre-check (§2.1.2) | done |
| 1 | **2.3** move login rate limiting to D1 | atomic counting, unchanged behaviour | M | §2.1 | done |
| 1 | **2.4** remove KV | drop an unused binding and its documentation | S | §2.3 | done |
| 2 | **3.1** upload/fetch validation | close the "non-image stored + served same-origin" hole | S | — | done |
| 2 | **3.2** password hash upgrade | salt + pepper, automatic re-hash on login | M | needs a new secret | done |
| 2 | **3.3** revocable JWT | password change logs out every device + shorter lifetime | M | §3.2 | done |
| 3 | **4.1** R2 ↔ `file` consistency | no orphan objects, no duplicate favicons | M | — | done |
| 3 | **4.2** home page `getListWithItems` | remove the N+1 queries | M | — | done |
| 3 | **4.3** `/uploads/*` caching | fewer R2 round-trips | S | — | done (decision D7: browser cache only) |
| 4 | **5.1** dead storage cleanup | delete `module_config` / `notice` | M | §2.1 (new databases skip the tables) | done |
| 4 | **5.2** `ASSETS` binding | remove the unused binding declaration | S | — | done |
| 4 | **5.3** `user_config` optimistic lock | prevent tabs overwriting each other | S | — | decided against (documented instead) |
| 5 | **6.1** backup section | D1 + R2 backup/restore documentation | S | — | done |
| 5 | **6.2** storage documentation | tables/bindings/local WAL trio explained | S | §2.1 | done |
| 5 | **6.3** rebuild `dist/` | make frontend changes live | S | §7 | done |

---

## 2. Stage one: tidying the data layer

### 2.1 `migrations/` collapsed into a single `0001_init.sql` ✅ done

#### 2.1.1 Why the file name must stay the same

D1's bookkeeping table records **file names only**, with no content hash (measured on a local database):

```sql
CREATE TABLE "d1_migrations"(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)
```

`wrangler d1 migrations apply` decides with "file names present locally − names already recorded" = pending. Therefore:

| Approach | Deployed database | Brand-new database | Verdict |
|----------|-------------------|--------------------|---------|
| Merge the content into the file **still called `0001_init.sql`** and delete 0002/0003 | name is already recorded → skipped, zero impact | everything is created in one pass | ✅ chosen |
| Merge and rename (e.g. `0001_init_full.sql`) | treated as a new migration → `ALTER TABLE ADD COLUMN` fails with duplicate column → **deployment fails** | works | ❌ |
| Keep 0002/0003 and also write the columns into 0001 | all three are skipped | 0001 creates the columns, then 0002 runs → duplicate column | ❌ |

#### 2.1.2 Pre-check (must be done first)

```bash
# The remote database must already record all three migration names, otherwise 0002/0003 must not be deleted
npx wrangler d1 migrations list DB --remote
# Expected output includes: 0001_init.sql / 0002_item_icon_group_style.sql / 0003_item_only_name.sql
```

If an environment only ever applied 0001 (e.g. an instance that has not been deployed for a long time), **run
`wrangler d1 migrations apply DB --remote` there first to catch up on 0002/0003 before merging**, otherwise its tables
lack `card_style` / `text_color` / `hide_description` / `only_name` and runtime errors follow.

#### 2.1.3 What was merged

- **Column definitions folded in**: `card_style` / `text_color` / `hide_description` are written directly into the
  `CREATE TABLE` of `item_icon_group`, and `only_name` into `item_icon`, with no ALTER left behind (a new database is
  created in one pass and the semantics are clearer).
- The two existing indexes and the seed data (`INSERT OR IGNORE`) are kept.
- The new `login_attempt` table of this round (see 2.3) goes straight into 0001.
- The file header keeps a **merge-history comment** explaining that "this file merges 0001 + 0002 + 0003, whose content
  is folded into the CREATE statements", so nobody later thinks the history was erased.
- The schema inventory is in [Appendix A](#appendix-a-state-of-0001_initsql-after-51).

#### 2.1.4 Steps

1. Complete the remote pre-check of 2.1.2;
2. rewrite `migrations/0001_init.sql` (content = Appendix A);
3. delete `migrations/0002_item_icon_group_style.sql` and `migrations/0003_item_only_name.sql`;
4. **local verification (new-database path)**: move the local D1 state directory aside → `npm run migrations:apply:local`
   → assert that the 8 business tables and all columns exist (commands in [Appendix C](#appendix-c-self-check-scripts-and-commands));
5. **local verification (old-database path)**: move the state directory back → run `npm run migrations:apply:local`
   again → expect "No migrations to apply" and no error;
6. commit; CI's `wrangler d1 migrations apply --remote` becomes a no-op for deployed databases (see the policy in 2.2).

#### 2.1.5 Rollback

Pure file change: `git revert` is enough, **no database rollback needed** (old databases never executed the new content).

#### 2.1.6 Outcome (measured this round)

| Verification | Command | Result |
|--------------|---------|--------|
| A new database is built in one pass | `wrangler d1 migrations apply DB --local --persist-to scratch/.tmp-d1-fresh` | `0001_init.sql ✅`, **14 commands executed successfully**; the 8 business tables + `only_name`/`card_style`/`text_color`/`hide_description` + the `login_attempt` index + seed data all present |
| An old database is a no-op | `wrangler d1 migrations apply DB --local` (existing state) | `✅ No migrations to apply!`, **no error from the deleted 0002/0003 files** |

Artefacts: `migrations/` now holds only `0001_init.sql` (5.5 KB) and the other two files are gone; `migrations_dir` in
`wrangler.toml` is unchanged.

### 2.2 Long-term policy under the single-file baseline (important)

> **Rule**: `0001_init.sql` always describes the **final schema as of now** and only applies to **brand-new
> databases**; because the name `0001_init.sql` is already recorded, a **deployed database** needs a different route for
> structural change:
>
> | Kind of change | What to do for a deployed database |
> |----------------|------------------------------------|
> | **New table** | a **lazy creation fallback** in code works (`CREATE TABLE IF NOT EXISTS`, once per isolate) and needs no manual SQL — `login_attempt` does exactly that this round (decision D5) |
> | **Changing an existing table** (add column / change constraint / drop table) | there is no runtime fallback: write a one-off `docs/sql/<date>_<purpose>.sql` and run it **before deploying the code** |

Consequences (accept the trade-off, otherwise go back to append-only):

- `wrangler d1 migrations apply` in CI is essentially a no-op from now on; real schema upgrades happen through lazy
  table creation or `docs/sql/` scripts;
- write one-off scripts idempotently (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) so they can be
  re-run;
- **re-baseline on every major version**: fold historical changes into `0001_init.sql`, move executed scripts into
  `docs/sql/archive/`, so that 0001 and the script ledger do not drift apart.

### 2.3 Moving login rate limiting to D1 (formerly 0-2) ✅ done

**Behaviour preserved**: the same IP is locked after **5 failures within 10 minutes**, sliding window (counted from the
last failure), error codes unchanged (`1003` wrong credentials / `1008` locked), no frontend change needed.

**Table structure** (goes into `0001_init.sql`)

```sql
CREATE TABLE IF NOT EXISTS login_attempt (
  ip           TEXT PRIMARY KEY,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0   -- Unix seconds: time of the most recent failure
);
CREATE INDEX IF NOT EXISTS idx_login_attempt_window ON login_attempt (window_start);
```

**Three statements** (the full text is in [Appendix B](#appendix-b-login-rate-limit-sql))

| Timing | Statement | Notes |
|--------|-----------|-------|
| start of the request (before verification) | `SELECT fail_count, window_start FROM login_attempt WHERE ip = ?` | a hit on "window not expired and `fail_count >= 5`" → return `1008` immediately |
| wrong credentials | a single `INSERT … ON CONFLICT(ip) DO UPDATE SET fail_count = CASE WHEN login_attempt.window_start < ? THEN 1 ELSE login_attempt.fail_count + 1 END, window_start = ?` | **atomic**, concurrent requests cannot lose counts (the core gain over KV) |
| successful login | `DELETE FROM login_attempt WHERE ip = ?` | same as the existing behaviour |

**Cleanup strategy**: D1 has no TTL, so when recording a failure a `DELETE FROM login_attempt WHERE window_start < ?`
is run **with probability 1/50** (anything outside the sliding window is expired), submitting both statements in one
`db.batch` to keep the table bounded. The alternative would be a Cron Trigger cleaning once a day (one more handler and
more configuration — not worth introducing unless necessary).

**Robustness requirement**: every rate-limit related D1 read/write **fails open** — catch the exception, `console.warn`
and continue with password verification as if not locked. Rationale: rate limiting is a brute-force defence layer and
must never lock the administrator out of their own panel because of a missing table or a D1 hiccup; the password is the
real defence.

**Code organisation** (to make self-checks easy)

- new `src/utils/loginRate.ts`: `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` / `isLocked(row, now)` (pure) /
  `readAttempt()` / `recordFail()` / `clearFails()`;
- `src/api/login.ts` keeps call sites only and loses the KV helpers.

**Tests**

- pure logic: `isLocked()` window boundaries (expired/not expired, at the limit, exactly 5);
- integration (local real D1): six wrong logins in a row → the 6th returns `1008`; the 7th is still `1008`; a correct
  login clears the counter;
- new `scratch/login-rate.test.ts` (following the repository's "esbuild bundle + node run" self-check style, see Appendix C).

**Outcome (measured this round)**

- new `src/utils/loginRate.ts` (constants + the `isLocked` pure function + `readAttempt`/`recordFail`/`clearFails` +
  the lazy `ensureLoginAttemptTable` fallback); `src/api/login.ts` now uses three fail-open wrappers
  (`isRateLimited` / `recordFailSafe` / `clearFailsSafe`) and all KV helpers are gone.
- `scratch/login-rate.test.ts`: **18 passed, 0 failed** (the in-memory D1 emulator only accepts the real SQL from
  `loginRate.ts`, so changing the SQL breaks the test instead of drifting silently).
- end-to-end (`wrangler dev --persist-to <copy of an old database>`, i.e. a database **without** the `login_attempt`
  table): five wrong passwords return `1003` → **the 6th returns `1008`** → the 7th stays `1008`; no fail-open warnings
  in the server log; afterwards the `login_attempt` table had been created by the lazy fallback.
- the price of the lazy fallback: only one `CREATE TABLE IF NOT EXISTS` per isolate lifetime, a no-op when the table exists.

### 2.4 Removing KV (the tail of the former 0-2) ✅ done

| Location | Change |
|----------|--------|
| `wrangler.toml` | drop the whole `[[kv_namespaces]]` section (`binding = "LOGIN_RATE"`) |
| `src/types.ts` | remove `LOGIN_RATE: KVNamespace` from `Env` |
| `src/api/login.ts` | delete `loginFailCount` / `recordLoginFail` / `clearLoginFails` and `RATE_KEY_PREFIX` |
| `package.json` | drop `KV` from `description` (`Hono + D1 + R2`) |
| `README.md` | tech-stack line `Worker (Hono) + D1 + KV + R2 + Vue 3` → remove KV; the "login rate limiting" row now says D1 |
| `docs/deployment.md` | tech-stack table and the "differences from upstream" table updated |
| cloud cleanup (optional) | Dashboard → Workers & Pages → KV → delete the automatically created namespace (rate-limit counters only, no business data) |
| local cleanup (optional) | delete `.wrangler/state/v3/kv` (gitignored) |

**Impact on §3.3 (revocable JWT)**: the token-generation cache becomes an **in-process module-level cache** (5–10 s TTL)
instead of KV; latency within one isolate is zero, and across isolates it is at most the TTL, which is acceptable.

**Verification**: `grep -rn "LOGIN_RATE\|KVNamespace" src/` should be empty; `npm run typecheck` passes; the local
`npm run dev` startup log no longer mentions `env.LOGIN_RATE`.

**Outcome (measured this round)**: every row above is done; `src/` no longer contains `LOGIN_RATE` / `KVNamespace`;
`tsc --noEmit` passes; the binding list in the `wrangler dev` startup log is down to `env.DB` / `env.FILES` /
`env.ASSETS` / `env.JWT_SECRET` (**KV is gone**). The KV descriptions in README / docs/deployment.md / package.json are
updated (the README "differences from upstream" table gained a row about the single-file baseline policy).

### 2.5 One-off upgrade scripts (`docs/sql/`) ❌ cancelled (decision D5)

The plan used to include `docs/sql/2026xx_login_attempt.sql` for deployed databases. According to this round's decision
it is **no longer needed**: `login_attempt` is a "new table" and is covered by the lazy `ensureLoginAttemptTable()`
fallback (§2.3), so neither old nor new databases need manual SQL.

This entry is kept only as a record: **if a "change an existing table" case appears later (add column / drop table),
the one-off `docs/sql/` script plus "run before deploying" flow is mandatory again** (see the rule table in §2.2).
Deployment order also goes back to the simplest form:

- **deployed database**: deploy the code (the first request creates the table) → verify that 6 wrong logins are locked out;
- **fresh deployment**: `wrangler deploy` → `wrangler d1 migrations apply --remote` (0001 creates all tables).

---

## 3. Stage two: security hardening

### 3.1 Upload and fetch validation (formerly 0-1) ✅ done

| Change | File |
|--------|------|
| `uploadFiles` gains an extension whitelist (reusing `IMG_AGREE_EXTS`, plus a separate set of allowed non-image types); rejected files go into `errFiles` | `src/api/system/file.ts` |
| After downloading a favicon, validate that `content-type` starts with `image/`, otherwise discard it (SVG behind its own switch); the 1 MB cap and the timeout stay | `src/utils/favicon.ts`, `src/api/panel/itemIcon.ts` |
| `/uploads/*` gains `X-Content-Type-Options: nosniff`; non-`image/*` responses get `Content-Disposition: attachment`; SVG additionally gets `Content-Security-Policy: default-src 'none'; …; sandbox`; key validation `^\d{4}/\d{1,2}/\d{1,2}/[0-9a-f]{32}(\.[a-z0-9]{1,10})?$` (the extension is optional to stay compatible with early extension-less objects, but `/`, `..` and similar escapes are rejected) | `src/index.ts` |

**Outcome (measured this round)**

- `src/utils/file.ts` gains `isAllowedExt()` (images + `.txt/.pdf/.zip/.json`), `normalizeIconContentType()` (returns
  empty for non-images → discarded) and `isValidUploadKey()`; `isImageExt/isAllowedExt` normalise with `toLowerCase()`.
- `downloadFavicon()` now validates the Content-Type: `text/html` and `application/javascript` are always discarded
  (even when the URL ends in `.png`); `application/octet-stream` is accepted only as a fallback when the URL extension
  is an image.
- `scratch/upload-validate.test.ts`: **45 passed, 0 failed**.
- end-to-end (wrangler dev + curl): a `.png` uploads fine and returns a key; `.html` through `uploadImg` →
  `1301 Unsupported file format`; `uploadFiles` with `.txt` + `.html` → the `.txt` is stored and the `.html` lands in
  `errFiles`; `/uploads/<png>` carries `x-content-type-options: nosniff` and no attachment; `/uploads/<txt>`
  additionally carries `Content-Disposition: attachment`; invalid keys (`not-a-valid-key.png`, `2026/9/10/short.png`) → 404.

### 3.2 Password hash upgrade (PR-1 of the former 0-3) ✅ done

- Self-describing hash strings: `pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>$<pepperId>`; `^[0-9a-f]{32}$` is
  recognised as the old triple MD5.
- New `checkPassword()` / `hashPassword()` / `needsRehash()` / `resolveIterations()` (`src/utils/password.ts`),
  WebCrypto PBKDF2-SHA256 with a **constant-time comparison**.
- **The pepper is an env secret** (`PASSWORD_PEPPER`): hash = PBKDF2(pepper ‖ password), so even a leaked D1 dump
  cannot be attacked offline.
- **Measured iteration cost** (Node/BoringSSL, same origin as workerd): 5k ≈ 2.6 ms, 10k ≈ 4.5 ms, 100k ≈ 43 ms,
  210k ≈ 85 ms. The free plan allows only 10 ms CPU per request, hence the default **5000**; it can be overridden with
  `PASSWORD_PBKDF2_ITERATIONS` (max 1,000,000, min 1000), and the count is stored in the hash string → **after raising
  it, old hashes still verify and are recomputed automatically on the next login**.
- Anti-lockout design (decision note): **no v2 hash is generated while no pepper is configured** (old formats verify as
  before, re-hashing is skipped and a warning is logged), so running `wrangler secret put PASSWORD_PEPPER` at any time
  cannot lock you out; once configured, a replaced pepper returns an explicit `1009` message instead of pretending the
  password is wrong.
- On a successful login with `needsRehash()` → the hash is rewritten to v2 in place; the change-password endpoint
  writes v2 when a pepper is configured and keeps the old behaviour with a `console.warn` otherwise.

**Outcome (measured this round)**

- `scratch/password-hash.test.ts`: **29 passed, 0 failed** (including the old seed-hash fixture
  `579646aad11fae4dd295812fb4526245` ↔ `12345678`, random salts, distinguishable results for a missing/changed pepper,
  iteration clamping, and a CPU-budget assertion: a default-iteration verification takes ≈2.2 ms).
- end-to-end: after starting with `--var PASSWORD_PEPPER=…`, logging in with the old hash succeeds (`code=0`) → the
  database `system_setting.admin_password` becomes `pbkdf2$sha256$…` and the old seed hash is gone; logging in again
  afterwards still works.

### 3.3 Revocable JWT (PR-2 of the former 0-3) ✅ done

- New `src/utils/authEpoch.ts`: `auth_epoch` lives in `system_setting` and is read with a **10-second in-process cache**
  (no KV); the JWT payload gains `epoch`, the middleware compares it and returns `1001` when the token is behind (the
  frontend already handles "session expired → go to login", so no change was needed).
- The generation is bumped when the password changes, the username changes, or `/logout { allDevices: true }` is called.
- The comparison only **blocks older tokens**: a lagging cache can keep an old token alive for at most 10 extra
  seconds, but never kills a freshly issued one.
- `exp` shrinks from 7 days to **72 hours**.
- Breaking change: tokens issued before this change (no `epoch` field, treated as 0) are invalid once after rollout;
  just log in again.
- Optional follow-up: move the token from `localStorage` to an `HttpOnly + SameSite=Lax` cookie (needs CSRF
  protection), a separate project.

**Outcome (measured this round)**

- `scratch/auth-epoch.test.ts`: **23 passed, 0 failed** (including the regression "a token issued with the default
  generation becomes invalid immediately").
- end-to-end: `getInfo=0` before logout → `/logout {allDevices:true}` returns 0 → **the same token now returns `1001`**
  → logging in again restores normal behaviour.
- 🐞 end-to-end testing caught a real bug: the first `bumpAuthEpoch` wrote the seed value as generation 1, which is a
  no-op (a missing row already means generation 1). It now seeds `DEFAULT + 1`, with a matching self-check assertion.

---

## 4. Stage three: consistency and cost

### 4.1 R2 ↔ `file` table consistency (formerly 1-1) ✅ done

**Outcome**

- Site icons gained a **stable per-site key**: `icons/<md5(host)>.<ext>` (`buildIconKey`), so fetching again
  overwrites the same object; the `file` table is UPSERTed per site (reusing the old row, updating `src` and deleting
  the old object when the extension changes). Key validation in `/uploads` accepts the `icons/` shape too.
- New `src/utils/uploadRefs.ts`: `normalizeUploadSrc` / `srcFromIconJson` / `isUploadSrcReferenced` (checks item
  `icon_json`, panel `background_json`, the avatar) / `cleanupUploads` (deletes only unreferenced objects, logs failures).
- `itemIcon/deletes` and `itemIconGroup/deletes` call `cleanupUploads` after soft-deleting;
  new `POST /api/system/file/cleanUnused` plus a **clean unused files** button (with confirmation) in the upload-file
  manager.
- Self-check `scratch/upload-refs.test.ts`: **22 passed** (including "an in-use image is kept" and "an external link is
  never deleted as if it were an R2 object" — the latter was a real defect found by the check and fixed by normalising
  in `cleanupUploads`).
- end-to-end: create an item referencing an icon → `cleanUnused` returns `deleted=0` (protected) → delete that item →
  the icon GET becomes **404** and the `file` row is gone; an unreferenced upload → `cleanUnused` `deleted=1` → GET 404.

> Note: `cleanUnused` also counts a freshly uploaded image that nothing references yet as unreferenced, which is why the
> button asks for confirmation; this step is manual and never runs automatically.

### 4.2 Removing the home-page N+1 (formerly 1-2) ✅ done

**Outcome**

- New `POST /api/panel/itemIconGroup/getListWithItems`: one query for the groups + one for all items, grouped by
  `item_icon_group_id` inside the Worker; on an empty database the default group is created and orphan items are
  claimed **before** the items are queried (the reverse order loses those items). `itemIcon/getListByGroupId` is kept
  (leaving sort/filter mode still refreshes a single group).
- The frontend `home/index.vue` `getList()` now makes a single call, with the matching API added in
  `frontend/src/api/panel/itemIconGroup.ts`.
- Self-check `scratch/group-with-items.test.ts`: **15 passed**, one of which asserts that the **number of SQL statements
  is fixed at 3** (1 epoch + 2 data queries) regardless of the group count.
- end-to-end: on real D1 `code=0 groups=1 first group=APP`, and the items of the group are delivered correctly.

### 4.3 `/uploads/*` caching (formerly 1-3) ✅ done (decision D7)

- Cache headers: date-hashed uploads `public, max-age=86400, immutable`; site icons `public, max-age=86400` (they get
  overwritten, so they must not be immutable).
- **No `caches.default` edge cache**: end-to-end testing showed that the edge cache keeps serving deleted images for up
  to 24 hours (a GET after deleting an item still returned 200), and the confusion of "deleted but still reachable"
  outweighs the saved R2 reads.
- If an edge cache is wanted (optional, operations side): configure a Cache Rule for `<domain>/uploads/*` in Cloudflare
  with a custom Edge TTL and accept the same deletion delay; R2 Class B includes 10 million free reads per month, so a
  personal site normally needs no extra cache.
- End-to-end verification covered the cache headers of both key types and the 404 behaviour after deletion (see 4.1).

---

## 5. Stage four: structural cleanup

### 5.1 Dead storage cleanup (formerly 2-1) ✅ done (decision: delete the code now + new databases skip the tables)

**Outcome**

- Backend: removed `src/api/notice.ts` and `src/api/system/moduleConfig.ts` and unmounted them in `src/api/index.ts`.
- Frontend: removed `api/notice.ts`, `api/system/moduleConfig.ts`, `store/modules/notice/*`,
  `store/modules/moduleConfig/*`, `typings/notice.d.ts`; `noticeCreate` / `getNotice` in `utils/cmn/index.ts` went with
  them; `migrateLegacySearchEngine` and its call site on the home page were deleted;
  the `searchBox` helper keeps only the local-cache normalisation of "old built-in engines / old field names"
  (`hasStoredSearchEngineConfig` and `SEARCH_BOX_LEGACY_MODULE_NAME` are gone).
- Schema baseline: `0001_init.sql` no longer creates `module_config` and `notice` (with that history recorded in the
  file header); **the two empty tables in already-deployed databases are left untouched** (the code no longer touches
  them, no manual SQL is needed, matching the single-file policy of decision D5).
- Documentation: the "storage and compatibility" section of `docs/search-engine.md` now says the migration was removed
  and warns users upgrading from very old versions to reconfigure their engines.
- Blast radius (worth knowing): users upgrading straight from a very old version who never opened the post-migration UI
  do not get their custom engines back (they fall back to the three built-ins); the repository currently has a single
  self-hosted instance, so this was accepted.

### 5.2 `ASSETS` binding (formerly 2-2) ✅ done

`binding = "ASSETS"` was removed from `wrangler.toml` while `[assets] directory = "dist"` stays.

Rationale (Cloudflare docs <https://developers.cloudflare.com/workers/static-assets/binding/>): an assets binding is
**optional** and only used to call `env.ASSETS.fetch()` from the Worker; static assets use the default "assets first"
routing (`run_worker_first` defaults to false) and are served without declaring the binding. This Worker only
implements `/api/*` and `/uploads/*` and never reads assets, so the binding was pure surplus; the `Env` type never had
it either (only `wrangler.toml` declared it), and after removal the dev startup log no longer lists `env.ASSETS`.

### 5.3 `user_config` whole-value overwrite (formerly 2-3) ❌ decided against (documented instead)

No optimistic lock, as requested: with a single user the chance of two tabs editing the style at once is very low, and
locking would require touching two save call sites in the frontend plus a conflict UI — a poor trade.
Instead the README "Known Limitations" warns: **avoid editing the style / search-engine configuration in several tabs
at once**, otherwise the last save wins (`user_config` is overwritten as a whole JSON value).

---

## 6. Stage five: documentation and backup

| # | Content |
|---|---------|
| 6.1 | ✅ done: `docs/deployment.md` gained "Backup & Restore" — D1 `export` (including `--no-schema`) and restore, R2 via `rclone sync` / `wrangler r2 object get`, the note that D1 and R2 must be backed up as a pair, Time Travel as a safety net, and that the two secrets cannot be read back and must be kept elsewhere |
| 6.2 | ✅ done: new [`docs/storage.md`](./storage.md) — Cloudflare resources and bindings, the purpose and delete semantics of the six D1 tables, the two R2 key shapes and the reference-aware reclamation rules, the WAL trio and multiple-hash files under `.wrangler/state/v3`, and the structure-change policy of the single-file baseline |
| 6.3 | ✅ done: `vite build` rebuilt `dist/` (3207 modules, 21.3 s); the new output contains "clean unused files / cleanUnused / filteringTip / getListWithItems" and no longer contains `moduleConfig/getByName` or `notice/getListByDisplayType` |

---

## 7. Completed work (summary)

| Item | Content | Verification |
|------|---------|--------------|
| **§2.1 single-file migrations baseline** | `0001_init.sql` folds in the columns from 0002/0003 and adds `login_attempt`; 0002/0003 deleted; the header records the merge history and the policy | a new database is built in one pass; an old database reports `No migrations to apply!` (re-verified after §5.1: 11 statements, 6 business tables) |
| **§2.3 login rate limiting on D1** | new `src/utils/loginRate.ts` (atomic UPSERT + probabilistic cleanup + lazy table creation); three fail-open wrappers in `src/api/login.ts` | `scratch/login-rate.test.ts` 18 passed; real-D1 end-to-end: 5×`1003` → 6th `1008` → 7th still `1008` |
| **§2.4 removing KV** | `wrangler.toml` / `src/types.ts` / `src/api/login.ts` / README / docs/deployment.md / package.json | `tsc --noEmit` passes; the dev binding list has no KV |
| **§3.1 upload/fetch validation** | extension whitelist, icon Content-Type validation, `/uploads/*` nosniff + attachment download + key validation | `upload-validate` 55 passed; end-to-end: `.html`→1301, txt→attachment, invalid key→404 |
| **§3.2 password hash upgrade** | PBKDF2 + random salt + optional pepper (with a pepperId to avoid false negatives); automatic re-hash on login | `password-hash` 29 passed; end-to-end: after logging in with the old hash the row becomes `pbkdf2$…` |
| **§3.3 revocable JWT** | `auth_epoch` generation + in-process cache + 72 h; bumped on password change / username change / logout everywhere | `auth-epoch` 23 passed; end-to-end: an old token returns `1001` immediately |
| **§4.1 R2 ↔ file consistency** | stable keys for site icons, reference-aware reclamation, the `cleanUnused` endpoint and frontend button | `upload-refs` 22 passed; end-to-end: `deleted=0` while referenced, object reclaimed and 404 after deleting the item |
| **§4.2 home-page N+1** | `getListWithItems` (one group query + one item query) | `group-with-items` 15 passed (including the fixed 3 SQL statements); real-D1 end-to-end passes |
| **§4.3 cache headers** | uploads `immutable`, icons `max-age` only (decision D7: no Worker-side edge cache) | end-to-end check of both response headers and the 404 after deletion |
| **§5.1 dead storage cleanup** | all `notice` / `moduleConfig` code removed; new databases skip both tables (empty tables in old databases are kept) | grep for leftover references is empty; `tsc`/`vue-tsc`/`eslint` pass; a fresh database runs 11 statements and ends with 6 business tables |
| **§5.2 `ASSETS` binding** | the unused binding was removed from `wrangler.toml` | backed by the official docs; the dev startup binding list no longer contains `env.ASSETS` |
| **§6.1 / §6.2 documentation** | `docs/deployment.md` gained "Backup & Restore"; `docs/storage.md` was added | the documentation index is updated |
| **§6.3 rebuilding `dist/`** | `vite build` (3207 modules / 21.3 s) | the output contains the new feature strings and no removed dead code |
| Engine-settings buttons on one row | "Add search engine / Sort / Restore built-in engines" merged into one row that wraps on narrow screens; the destructive "Reset" stays at the bottom on its own | `frontend/src/components/apps/Style/SearchEngineSettings.vue` |
| Filtering defect fix (option A) | the filtered view now carries the **original group object**, interaction callbacks take a group object instead of an index, `filterItems` became a `computed`, `:key` uses a stable id, filter and "no results" hints were added, sorting is disabled while filtering and sort mode exits when filtering starts | `frontend/src/utils/panelFilter/index.ts` (new), `frontend/src/views/home/index.vue`, two locales, `scratch/panel-filter.test.ts` (27 passed) |

**Closing status**: every change from §2 ~ §9 is **committed** (the current baseline is in `git log`); `dist/` was rebuilt
with each round; later increments are in §10 "repo-wide audit findings (this round)".
**Deployment reminder**: `dist/` is gitignored and the hosted artefact is produced by the build pipeline — either
`npm run deploy:all` locally or `npm run build` inside Cloudflare Workers Builds.

---

## 8. Risk register

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| R1 | An environment only applied 0001 and loses columns when 0002/0003 are deleted | runtime errors | ✅ closed: `migrations list --remote` is required before merging; the user confirmed "redeploy the new version", so the old-database path no longer applies |
| R2 | The new code goes live before the `login_attempt` table exists | D1 errors on login | ✅ closed: lazy table creation + fail-open rate limiting (measured: the table was created automatically on a copy of an old database) |
| R3 | Forgetting to handle structural change under the single-file policy | an old database lagging behind the code | see the rule table in §2.2: new tables use the lazy fallback, changing an existing table requires a `docs/sql/` script run before deploy |
| R4 | References to KV remain after its removal | failed deploy / type errors | ✅ closed: `grep -rn "LOGIN_RATE\|KVNamespace" src/` is empty; `tsc --noEmit` passes; the dev binding list has no KV |
| R5 | Too many PBKDF2 iterations trigger `1102` | login fails | ✅ closed: default 5000 (≈2.6 ms measured), adjustable via `PASSWORD_PBKDF2_ITERATIONS`, and the count is stored in the hash so old hashes still verify after raising it |
| R6 | `PASSWORD_PEPPER` is lost or replaced | passwords can no longer be verified | ✅ closed: no v2 hash is generated while the pepper is unset (no lock-out); replacing a configured pepper returns an explicit `1009` instead of "wrong password"; the docs require backing it up with `JWT_SECRET` |
| R7 | Deleting `module_config` / `notice` while old users have not migrated | custom engines lost | check version coverage before doing it; documented in the README |

---

## 9. Candidate backlog in detail

> §2 ~ §6 are all closed; this section lists the **not yet implemented** follow-ups (including gaps found while
> implementing and requirements added by the user), ordered by suggested priority.
> Format per item: goal / prerequisites / steps / files / verification / risks / size (S = about half an hour,
> M = about half a day, L = more than a day).
> When executing one, fill its status back into the `status` line of the item.
>
> **Changes to this section (per user instruction)**: **9.2 "pick one icon in a dialog when several candidates
> exist"** was added; the former 9.4 (raising the PBKDF2 iteration count) and 9.7 (repository-wide open requirements)
> were **removed**; numbering was re-compacted, with 9.0 being the completed reclamation switch.
>
> **Progress**: 9.0 ~ 9.5, 9.8 and 9.9 are done; 9.6 awaits confirmation (optional, operations side); 9.7 awaits
> execution (commit split and manual regression); 9.10 ~ 9.13 need clarified requirements / a decision
> (**9.13** = the security review's V-07 package, recommended as one piece).
>
> **Waiting for the user (does not block development; see [deployment.md](./deployment.md))**:
> ① configure the secrets (`JWT_SECRET` required; `PASSWORD_PEPPER` recommended, **never change or delete it once set**);
> ② `npm run build` + `wrangler deploy` (on a new database also run `wrangler d1 migrations apply DB --remote`);
> ③ after the first login confirm that the old password hash was upgraded automatically
> (`system_setting.admin_password` becomes `pbkdf2$…`);
> ④ optional: delete the orphan KV namespace in the cloud (left over from removing KV in §2.4);
> ⑤ **cleaning up old resources**: the naming baseline is Worker `sun-panel-on-cloudflare-worker`, D1
> `sun-panel-on-cloudflare-worker-db`, R2 `sun-panel-on-cloudflare-worker-files`; once deployed that way and verified,
> delete the unused old Worker (`sun-panel`), old D1 (`sun-panel`), old R2 (`sun-panel-files`) and the orphan KV from
> the dashboard.

### 9.0 Image reclamation switch (**implemented**, decision D8; kept as the format reference)

- **Goal**: make "reclaim unreferenced images when deleting an item/group" a toggle, on by default.
- **Implementation**: `system_setting.storage_auto_clean_unused` (`'1'`/`'0'`, missing = on); endpoints
  `POST /api/system/getStorageSettings` / `saveStorageSettings` (`src/api/system/setting.ts`);
  reading and parsing in `src/utils/settings.ts` (`SETTING_AUTO_CLEAN_UNUSED` / `parseBoolSetting` /
  `getAutoCleanUnused`, **a failed read counts as "off"**);
  the two delete routes (`itemIcon/deletes`, `itemIconGroup/deletes`) and the cleanup of the old object when a site
  icon changes extension all require it and additionally run the reference check;
  the frontend switch sits at the top of the upload-file manager page (`UploadFileManager/index.vue` +
  `api/system/setting.ts` + two locales).
- **Verification**: `scratch/upload-clean-setting.test.ts` **23 passed** (including route level: on by default → the R2
  object is deleted; set to `'0'` → R2 untouched while the item is still soft-deleted);
  real D1+R2 end-to-end: off → delete the item → the image still returns HTTP 200 and the `file` row survives;
  on → delete the item → the image returns HTTP 404 and the `file` row is gone; the setting persists ✓.
- **Related documentation**: [storage.md](./storage.md) §3 has a dedicated "Image reclamation: two entry points,
  decision rules and the switch" section recording the behaviour, scenarios and blind spots of the switch and the
  button item by item (added on user request).
- **Status**: done.

### 9.1 Making `1009` visible in the frontend (a newly found gap) — size S

- **Problem**: when `PASSWORD_PEPPER` is missing or mismatched the backend returns `1009`, but the frontend
  `apiRespErrMsg` (`frontend/src/utils/request/apiMessage.ts:22-26`) finds no `apiErrorCode.1009` in the locales →
  returns `false` → the interceptor does `Promise.reject` and **shows no message at all**, while the login page only
  `console.log`s. What users see is "clicking sign-in does nothing", with the reason visible only in the browser
  console and the Worker log.
- **Steps**: ① add `"1009"` under `apiErrorCode` in both locales with actionable wording (e.g. "Server-side password
  configuration problem: PASSWORD_PEPPER is missing or changed, check the Worker secret");
  ② no interceptor change needed (a locale hit triggers `message.error` automatically); ③ `npm run build` to rebuild `dist/`.
- **Files**: `frontend/src/locales/zh-CN.json`, `en-US.json`, `dist/` (build output).
- **Verification**: `scratch/i18n-audit.ts` reports 0 missing / 0 zh-en mismatches; start dev locally (deliberately
  without `PASSWORD_PEPPER` and with `admin_password` set to a v2 string) → the login page should show the message.
- **Risk**: low. ⚠️ Do not add `1009` to the backend `ERROR_CODE_MAP`, otherwise `errorByCodeAndMsg` would use it to
  override the specific message (`src/utils/response.ts:49-52`).
- **Status**: done.
- **Outcome (measured this round)**: `"1009"` was added under `apiErrorCode` in both locales (the Chinese text:
  「服务端密码配置异常：PASSWORD_PEPPER 未配置或已变更，请检查 Worker Secret」), with no change to the interceptor or
  `ERROR_CODE_MAP`; re-running `scratch/i18n-audit.ts`: 0 missing / 0 zh-en mismatches (1009 appearing in the "dead
  strings" list is the known false positive for dynamic keys, see §9.3); `dist/` was rebuilt with this round.

### 9.2 Fetching an icon: let the user pick one when several candidates exist — size M (confirmed by the user)

- **Current behaviour (why this is needed)**: `POST /api/panel/itemIcon/getSiteFavicon` chains "fetch the page → take
  the **first** `<link>` whose `rel` contains `icon` → fall back to `/favicon.ico` → fall back to icon.horse" and
  **downloads and stores exactly one**; when the page declares several sizes or rel values
  (`icon` / `shortcut icon` / `apple-touch-icon` / `mask-icon`), which one wins depends on **which appears first in
  the HTML**, and the user has no say.
- **Goal**: one fetch returns a **candidate list** (with size and source); with ≥2 candidates a dialog lets the user
  pick one and **only the chosen image is downloaded and stored**; with exactly 1 candidate the current one-click
  behaviour stays (no dialog).

**Backend steps**

1. New pure function `extractIconCandidates(html, baseUrl)` in `src/utils/favicon.ts`: collect the `href` + `sizes` +
   `type` of every `<link>` whose `rel` contains `icon` (including `shortcut icon`, `apple-touch-icon`, `mask-icon`);
   skip `data:` and non-http(s); deduplicate by absolute URL; keep document order; **cap at 12 entries**.
   Fallback candidates: `<origin>/favicon.ico` (only when a HEAD returns 200, `source: 'favicon.ico'`) and icon.horse
   (only when nothing above was accepted, `source: 'icon-horse'`).
   Keep the existing `getSiteFaviconUrl()` (internally "first entry of the candidate list") so old callers keep working.
2. New endpoint `POST /api/panel/itemIcon/getSiteFaviconCandidates { url }` → `{ candidates: [{ url, sizes?, type?, source }] }`
   (auth required; same 8 s timeout and 1 MB HTML truncation; return an empty array rather than an error when there is
   no candidate).
3. New endpoint `POST /api/panel/itemIcon/saveSiteFavicon { url, pageUrl }`: `url` = the chosen candidate, `pageUrl` =
   the site address the user entered (used to derive the host for the stable key and `file_name`).
   Internally it reuses the existing logic: `downloadFavicon(url)` (≤1 MB, must be `image/*`) → `buildIconKey(host, ext)`
   overwrite → `file` row UPSERT → reclaim the old-extension object (**protected by both the reclamation switch and the
   reference check**) → return `{ iconUrl }`.
   ⚠️ No "proxy any URL": only images that pass content validation are stored, the same trust model as the existing fetch.
4. Keep the old endpoint `getSiteFavicon` (internally = first candidate + store) for old frontends/scripts.

**Frontend steps**

1. New `frontend/src/views/home/components/EditItem/FaviconPicker.vue` (a sibling of `GalleryPicker.vue`, reusing
   `RoundCardModal` and the grid styling): the grid shows the candidates with their size and a source badge; clicking
   selects and confirms → `emit('selected', candidate)`.
2. `getIconByUrl(url, loadingIndex)` in `EditItem/index.vue` (lines 178-196; the entry points are the fetch buttons next
   to "URL / LAN URL" on lines 319 / 335) becomes:
   call `getSiteFaviconCandidates` first → 0 → report `iconItem.geticonFail`; 1 → call `saveSiteFavicon` directly (keep
   the one-click flow); ≥2 → open `FaviconPicker` and call `saveSiteFavicon` after the selection.
3. Preview with the candidate's original URL (`<img>` needs no CORS); if the panel is https while a candidate is http,
   browsers block the mixed content → mark such candidates as "insecure (http)" in the dialog and disable them (or use
   the optional enhancement below).
4. Optional enhancement: add `POST /api/panel/itemIcon/previewFavicon { url }` where the Worker fetches the image bytes
   and returns them as-is (≤1 MB, content-type validated, 10 s timeout), and let the dialog preview through it — which
   also solves mixed content and third-party tracking.

**i18n**: `iconItem.faviconPickerTitle` / `faviconPickerTip` / `faviconPickerEmpty` / `faviconPickerSourceLink` /
`faviconPickerSourceFallback` / `faviconPickerInsecure` (one entry each in zh and en, kept aligned).

**Verification**

- New self-check `scratch/favicon-candidates.test.ts`: HTML fixtures covering "rel/href in reverse order",
  "`sizes="32x32"`", "`apple-touch-icon`", "`data:` skipped", "relative path resolution", "duplicate href
  deduplication", "truncation beyond 12 entries", "fallback when no link exists".
- End-to-end: a local page returning three icon links → the candidate endpoint returns 3 → save the second → the `file`
  table holds exactly one `icons/` row and `/uploads/<key>` returns 200.
- `vue-tsc` + `eslint` + `npm run check` + rebuild `dist/`.

**Risk**: medium. ① regex parsing may miss candidates on oddly written sites (there is a fallback chain);
② the dialog adds one interaction step (only with several candidates); ③ fetching again still overwrites the same
stable key (as intended).

**Status**: done (implemented this round).
**Outcome (measured this round)**:
- Backend: `src/utils/favicon.ts` gained the pure function `extractIconCandidates(html, baseUrl)` (collects links whose
  rel contains icon, with `sizes`/`type`; skips `data:` and non-http(s); deduplicates by absolute URL after dropping
  query parameters; keeps document order; caps at 12 entries) and `getSiteFaviconCandidates(pageUrl)` (when page
  extraction is empty, tries HEAD on `/favicon.ico` → `icon.horse`; returns an empty array when nothing is found);
  `getSiteFaviconUrl()` now returns the first candidate (old callers unchanged).
  `src/api/panel/itemIcon.ts`: the storing logic was extracted into `storeFavicon()`; new
  `POST /panel/itemIcon/getSiteFaviconCandidates` and `POST /panel/itemIcon/saveSiteFavicon` (download + validate →
  `buildIconKey` overwrite → `file` row UPSERT → reclaim the old-extension object, protected by the switch and the
  reference check); the old `getSiteFavicon` endpoint is kept (internally = first candidate + store).
- Frontend: new `frontend/src/views/home/components/EditItem/FaviconPicker.vue` (candidate grid + size/type + source
  badge; http candidates are marked "insecure" and disabled on an https page);
  `getIconByUrl()` in `EditItem/index.vue` became "0 → error / 1 → store directly / ≥2 → pick in the dialog and store";
  the `Panel.FaviconCandidate` type and two API wrappers were added; six `iconItem.faviconPicker*` strings (zh/en aligned).
- Self-check: new `scratch/favicon-candidates.test.ts` **48 passed, 0 failed**: 8 HTML fixture classes for the pure
  function + mocked-fetch fallback chain (candidates present → no fallback, no link → favicon.ico, then icon.horse,
  nothing → empty, invalid URL → no request, the old function taking the first entry)
  + route level (auth 1000, missing parameter 1400, three candidates, empty array when there is none, storing writes R2
  + INSERTs the file row, a second fetch for the same site overwrites via UPDATE, a non-image is rejected, the old
  endpoint takes the first entry).
- Quality gate: `npm run check` passes (0 error / 4 pre-existing warnings); `scratch/i18n-audit.ts` 0 missing /
  0 zh-en mismatches; `dist/` rebuilt.

### 9.3 Removing 57 upstream i18n dead strings — size S/M

- **Goal**: bring the "dead strings" reported by `scratch/i18n-audit.ts` down to 0 (or whitelist the ones deliberately kept).
- **Current state**: 57, mostly unused upstream namespaces (`adminSettingUsers.*` 12, `common.*` 22,
  `apiErrorCode.*` 15, …). Note that the `apiErrorCode.*` entries and the five `deskModule.searchEngine.*` ones are
  **false positives**: the code uses them through dynamic keys (`apiErrorCode.${code}`, `t(result.titleError)`) — do not delete them.
- **Steps**: ① first add a "deliberately kept" whitelist to `i18n-audit.ts` (dynamic keys + upstream reserves) so the
  output only contains what can really go; ② delete the keys with no reference on either side from `zh-CN.json` /
  `en-US.json` namespace by namespace; ③ run the audit after each batch to confirm "0 missing / 0 mismatches".
- **Verification**: the audit prints "0 dead strings (whitelist N)"; `vue-tsc` passes (locales are JSON, types come from
  key literals, and a wrong deletion shows the raw key on the page immediately — so click through a few pages).
- **Risk**: medium (a wrong deletion makes the UI show raw keys). Commit in small namespace-sized steps so rollback is easy.
- **Status**: done.
- **Outcome (measured this round)**: `scratch/i18n-audit.ts` gained `DYNAMIC_KEY_WHITELIST` (15 `apiErrorCode.*`
  entries + the five `deskModule.searchEngine` validation strings, all used through dynamic keys), and its output became
  "dead strings (whitelist excluded) + whitelist details";
  **36** genuinely unreferenced strings were deleted from each locale (`adminSettingUsers.*` 12, `common.*` 21,
  `apps.baseSettings.*` 4, …) together with the empty objects left behind; the string count went from 298 to 262
  (both sides equal).
  Re-running the audit: **0 missing / 0 zh-en mismatches / 0 dead strings (whitelist 20)**; `npm run check`
  (tsc + vue-tsc + eslint) passes.

### 9.4 Moving the token from localStorage to an HttpOnly cookie — size L

- **Goal**: stop exposing the JWT to JavaScript (so XSS cannot steal it) while keeping "password change / logout
  everywhere revokes immediately" (already provided by `auth_epoch`).
- **Prerequisites**: confirm HTTPS is enabled on the custom domain (a `Secure` cookie needs it); confirm no third-party
  script depends on the `token` header (keep the header for compatibility if one does).
- **Design**:
  1. On successful login `Set-Cookie: token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=259200` (72 h,
     matching the JWT); `/logout` clears the cookie (`Max-Age=0`).
  2. `authMiddleware` read order: cookie → `token` header → `Authorization: Bearer` (the latter two are kept for
     scripts and the transition period).
  3. CSRF: `SameSite=Lax` already stops cross-site POSTs from carrying the cookie; add an `Origin` / `Sec-Fetch-Site`
     check (same-site only) as a second line.
  4. Frontend: `authStore` no longer persists the token (memory only), the `request` interceptor drops the `token`
     header, and the `1000/1001` redirect-to-login logic is unchanged.
  5. Transition: the server accepts cookie **and** header first (old frontends unaffected), and the frontend is changed
     once that is stable; rolling back only needs the frontend reverted.
- **Files**: `src/api/login.ts`, `src/middleware/auth.ts`, `frontend/src/utils/request/index.ts`,
  `frontend/src/store/modules/auth/*`, `docs/deployment.md` (cookie notes for local dev).
- **Verification**: `document.cookie` cannot read the token after login; requests with the cookie work; cross-site
  POSTs are rejected (`curl -H 'Origin: https://evil.example'`); after a password change / logout everywhere the old
  cookie fails with 1001.
- **Risk**: medium-high. Watch the `Secure` cookie behaviour under local `wrangler dev` (http://127.0.0.1) and the
  cookie scope when workers.dev and a custom domain are mixed.
- **Status**: **done**.
- **Outcome (measured this round)**:
  - new `src/utils/authCookie.ts`: `setAuthCookie` / `clearAuthCookie` / `readAuthToken`; the attributes are
    `Path=/; HttpOnly; SameSite=Lax; Max-Age=259200` (matching the 72 h JWT), with **`Secure` added only over https**
    (local dev is http, and adding it there makes browsers drop the cookie).
  - `src/middleware/auth.ts`: the read order is now **cookie → `token` header → `Authorization: Bearer`**; cookie
    authentication performs a cross-site check for write requests (POST/PUT/PATCH/DELETE) — preferring
    `Sec-Fetch-Site` and falling back to comparing the **host names** of `Origin` and `Host` (cookies ignore ports, and
    comparing host names is what lets the local Vite proxy :1002 → :8787 work).
  - `src/api/login.ts`: a successful login sets the cookie; `/logout` clears it (`allDevices` still bumps the
    generation, invalidating cookies on other devices too).
  - Frontend: `setStorage` in `store/modules/auth/helper.ts` **no longer writes the token to storage** (localStorage
    keeps only user info and visitMode); the request header is only added while a token exists in memory; the `token`
    in the login response body remains for CLI scripts.
  - Self-check `scratch/auth-cookie.test.ts`: **17 passed** (cookie authentication / cross-site write 1005 / cross-site
    read allowed / header authentication compatible / no credentials 1000 / expired generation 1001 / same host on a
    different port allowed / cookie attributes and no `Secure` over http).

### 9.5 `JWT_SECRET` strength warning — size S

- **Background (measured in this session)**: jose 5.10 does **not** validate HMAC key length — an empty string, one
  character or eight characters all sign and verify fine, so a weak configuration never errors, it is just silently insecure.
- **Steps**: ① add a one-off check in `src/utils/jwt.ts` or the login route: `console.warn` when `JWT_SECRET` is
  shorter than 32 characters (**do not** fail closed, which would lock deployed instances out);
  ② add a generation command (e.g. `openssl rand -base64 48`) to the secret step in `docs/deployment.md`.
- **Verification**: the log warns on startup with a short secret and stays silent with a proper one; login is unaffected.
- **Risk**: very low (a log line and documentation).
- **Status**: done.
- **Outcome (measured this round)**: `src/utils/jwt.ts` gained `warnIfSecretWeak()` (checked at the `signToken` /
  `verifyToken` entry points, warning once when the length is < 32; an empty or missing value warns too; no fail
  closed); the two secret steps in `docs/deployment.md` now mention `openssl rand -base64 48` and the length requirement.

### 9.6 `/uploads/*` edge cache (optional, operations side) — size S

- **Background**: decision D7 rules out a Worker-side cache (deleted objects would still be served for 24 h). If R2
  reads really need to be saved, configure a Cache Rule on the Cloudflare side.
- **Steps**: ① Dashboard → Caching → Cache Rules → new rule matching
  `http.request.uri.path matches "^/uploads/"`; ② set an Edge TTL (one hour, say — not too long); ③ when the "deleted
  but still reachable" confusion appears, purge the URL or lower the TTL.
- **Verification**: the second request shows `cf-cache-status: HIT`; after deleting an object it may still hit for up to
  an hour (the known trade-off).
- **Risk**: low (pure operations configuration, the rule can be deleted at any time). R2 Class B includes 10 million
  free reads per month, so a personal site normally does not need this.
- **Status**: to confirm (optional).

### 9.7 Project wrap-up — size S

- **Suggested commit split** (§2 ~ §9.5 are committed; the §10 changes of this round are best kept as a separate PR,
  see §10.4): PR-A (§2 data layer) → PR-B (§3.1) → PR-C (§3.2) → PR-D (§3.3) → PR-E (§4) → PR-F (§5) → PR-G (§6 docs)
  → PR-H (§9.0 switch + related docs) → PR-I (§9.1 / §9.2 / §9.5 / §9.3 / §9.8).
  Run `npm run check` (root typecheck + frontend type-check + lint) before each batch; `dist/` is gitignored and needs
  no commit.
- **Manual regression list** (browser; interaction is beyond the scripts' reach): ① login / change password / log out
  everywhere; ② the home page's "no filter → filter → clear the keyword" sequence (hover buttons, sorting, drag-save,
  context menu, navigation, "+" landing in the right group);
  ③ whether the three engine-settings buttons share a row; ④ the upload-file manager: toggling the switch and cleaning
  unused files; ⑤ clicking "fetch icon" twice for the same site should reuse the same URL;
  ⑥ "fetch icon" with several icons declared on the page should open the picker (and store only the chosen one), while a
  single candidate stores directly without a dialog.
- **Status**: to do.

### 9.8 Including `custom_css` / `custom_js` in the reference check — size S (**to confirm**)

- **Problem**: `isUploadSrcReferenced()` only checks three places (item icons, `user_config.panel_json`, the avatar). If
  you reference an `uploads/...` image from "Global settings → custom CSS/JS", it is not considered "in use" and can be
  deleted by a manual "Clean unused files".
- **Steps**: add one query to `isUploadSrcReferenced()` fetching the `custom_css` and `custom_js` rows together
  (`config_name IN (?, ?)`); a hit on `includes(bare)` keeps the file.
- **Files**: `src/utils/uploadRefs.ts` (+ move the constants from `src/api/system/setting.ts` to `src/utils/settings.ts`
  to avoid a circular dependency), `scratch/upload-refs.test.ts`.
- **Verification**: extra self-check assertions; end-to-end: put an image URL into the custom JS → `cleanUnused`
  returns `deleted=0`.
- **Risk**: very low (one more query, a more conservative decision).
- **Status**: **done**.
- **Outcome (measured this round)**: the `SETTING_CUSTOM_CSS` / `SETTING_CUSTOM_JS` constants moved from
  `src/api/system/setting.ts` to `src/utils/settings.ts` (avoiding a utils ↔ api cycle);
  `isUploadSrcReferenced()` gained a `config_name IN (?, ?)` query whose hit keeps the file, and the header comment plus
  the check list in [storage.md](./storage.md) §3.1 were updated to four items.
  `scratch/upload-refs.test.ts` gained 3 assertions (kept when referenced from CSS / kept when referenced from JS /
  no longer kept after clearing them), **25 passed** (up from 22);
  the in-memory D1 of `scratch/upload-clean-setting.test.ts` gained the missing `.all()` contract, **23 passed**.

### 9.9 Subrequest optimisation of the cleanup flow (stability as the library grows) — size S/M (**to confirm**)

- **Problem**: `cleanupUploads` does up to 3 reference queries + 1 R2 delete + 1 `file` row update **per** candidate;
  with dozens or hundreds of images both subrequests and latency grow linearly
  (the free plan caps subrequests per request, see the Workers limits; that cap cannot be reproduced locally, so the fix
  is preventive, following the official figures).
- **Approach**: query each of the reference sources **once** (all `item_icon.icon_json`, `panel_json`, the avatar,
  optionally custom_css/js) to build the set of "still referenced bare paths" in memory, then merge the `file` row
  updates into one `UPDATE ... WHERE src IN (...)` → subrequests drop from about `5M` to about `M + 4`; if that is still
  too much, add "process N images per call + loop from the frontend".
- **Files**: `src/utils/uploadRefs.ts`, `src/api/system/file.ts` (optional `limit` parameter),
  `UploadFileManager/index.vue` (optional loop), `scratch/upload-refs.test.ts`.
- **Verification**: self-checks covering "reference-set construction + batch update"; end-to-end with 20 images in one
  cleanup, checking `checked`/`deleted` and the duration.
- **Risk**: low (pure internal refactor), but the conservative "might be referenced → keep" semantics must stay intact.
- **Status**: **done**.
- **Outcome (measured this round)**: `src/utils/uploadRefs.ts` was refactored to "one read + in-memory comparison":
  - `loadReferenceTexts()` always issues **3 queries** (live `item_icon.icon_json`, `user_config.panel_json`, the
    avatar + custom CSS/JS keys of `system_setting`), **independent of** the candidate count;
  - `isSrcReferenced()` is a pure string-containment decision (same conservative semantics) and
    `isUploadSrcReferenced()` reuses it (the single-object case of an icon changing extension also needs only 3 queries);
  - `file` rows are updated with a **chunked batch UPDATE** (90 bound parameters per chunk, D1's cap is 100);
  - a new `limit` parameter and `remaining` return value: `/file/cleanUnused` processes at most **30** candidates per
    call by default (the free plan allows 50 subrequests per invocation and each object deletion takes one), and the
    frontend "Clean unused files" loops until `remaining === 0` (capped at 50 rounds as a safety net).
  - Self-check `scratch/upload-refs.test.ts`: **35 passed**, asserting among others that "2 candidates and 24 candidates
    both take 4 statements" (the old implementation was 4N) and the batching semantics (with limit=2: 2/3 → 2/1 → 1/0).

### 9.10 Merging the login information in "My Info" — size S (**requirements to clarify**)

- **Background**: the original requirement was "the Account area holds Username (merging the former 'Account' and
  'Nickname', dropping the 'Edit' button) → separator → Change login info (a required username field at the top of the
  dialog)". The current implementation still has separate "Change username" and "Change password" entries, the password
  dialog has no username field, and "Nickname" is no longer shown.
- **To confirm**: should the two dialogs merge into one "Change login info" form (username + current password + new
  password + confirm new password, where leaving a field empty means "do not change it")? Should "Nickname" be shown
  and editable again (the backend `admin_name` and `/user/updateInfo` both still exist)?
- **Files**: `frontend/src/components/apps/UserInfo/index.vue`; the backend `/user/updateUsername` and
  `/user/updatePassword` (merging the endpoints must keep the `auth_epoch` bump semantics unchanged).

### 9.11 Opacity of the image background (checkerboard) in the upload-file manager — size S (**requirements to clarify**)

- **Background**: the request was "the image background is too busy, reduce its opacity by 50%". The checkerboard is
  currently `rgba(0, 0, 0, 0.03)` (`.transparent-grid` in
  `frontend/src/components/apps/UploadFileManager/index.vue`), while upstream uses `#f0f0f0` / 16px.
- **To confirm**: should the target be `rgba(0, 0, 0, 0.015)` (an exact halving) or a more neutral light grey (e.g.
  `#f7f7f7`)? One sentence is enough to implement it.

### 9.12 Layout adjustment of "New" — size ? (**requirements to clarify**)

- **Background**: the request was only "adjust the layout of New", which does not say which screen is meant (the
  "New group" dialog of group management? The "New item" dialog on the home page? The launcher layout?).
- **To confirm**: the exact screen + the expected result (a screenshot or a description both work).

### 9.13 Separating script credentials from the Web session (security review V-07, steps B + C) — size M/L (**to confirm: do it as one package?**)

- **Background**: the login response returns the same JWT that the cookie carries, because the middleware keeps
  `token` / `Authorization: Bearer` for CLI scripts and third-party tools — clients that cannot use an `HttpOnly`
  cookie, and therefore need a way to *obtain* the token. That makes the token readable by page JavaScript, which
  matters once an XSS exists: it turns "borrow the victim's browser" into "reuse the credential offline" for up to
  72 hours. Full analysis, the residual-risk list and why it is rated Low: [security.md](./security.md) §3 (V-07).
- **Step A (implemented)**: the login response carries `Cache-Control: no-store`, so an intermediate proxy can never
  replay a session. One line, no compatibility cost — this closes the only risk in that list that code alone can close.
- **Step B (make the token opt-in)**: stop returning `token` on an ordinary browser login; return it only when the
  caller asks for it (`withToken: true` in the request body, or a separate `POST /login/token`). Scripts keep working
  by asking; a normal browser login simply never puts a credential into a page-readable body.
  - ⚠️ **A partial B is worse than it looks**: it removes the *incidental* exposure (proxy caches, HAR exports,
    response-logging SDKs) but not the *deliberate* one, because an attacker's script can call `POST /api/login`
    itself. The real gain only arrives with C.
  - ⚠️ **Frontend must change in the same commit**, otherwise custom CSS/JS injection silently stops: the trigger is
    currently `watch(() => authStore.token, …, { immediate: true })` in `frontend/src/App.vue:69-76`, and
    `authStore.setToken()` is called only from the login page.
- **Step C (separate the credential)**: keep the Web session on cookies only, and give scripts a credential of their
  own that can be revoked and audited independently.
  - **Storage**: a new `api_key` table — `id`, `name` (a note for the operator), `key_hash` (**store a hash, never
    the key**), `prefix` (the visible first characters, so the UI can list entries), `created_at`, `last_used_at`,
    `revoked_at`. Those columns are the contract; nothing else is needed.
  - **Endpoints**: `POST /api/system/apiKey/create` (returns the plaintext key **once**), `/list`, `/revoke`.
    Accept a key with `Authorization: Bearer sp_<key>` (a `sp_` prefix makes keys greppable in logs and reviews),
    resolved by hashing and looking it up in `api_key`; revoked or missing → `1001`.
  - **Interaction with `auth_epoch`**: bumping the generation must **not** invalidate API keys (otherwise a password
    change silently breaks every automated job), and revoking a key must not log the Web session out. Keep the two
    credential types on separate validation paths so neither can affect the other.
  - **When C lands, B becomes worth doing**: the login endpoint can drop the token unconditionally, and the
    `api_key` path takes over for scripts.
- **Migration order (do not skip)**: ① land B behind `withToken` and keep returning the token for callers that ask →
  ② update the scripts/CLI clients to ask for it → ③ land C → ④ remove the token from the login response and update
  [deployment.md](./deployment.md) + this document. Reverting is possible at every step.
- **Frontend changes for B + C** (the part that must not be forgotten):
  `frontend/src/store/modules/auth/index.ts` (drop `token` / `setToken`, keep an authenticated flag),
  `frontend/src/views/login/index.vue` (call `updateLocalUserInfo()` after login — it fills `userInfo` through
  `getAuthInfo` and does not need the token), `frontend/src/utils/request/index.ts` (drop the `headers.token`
  fallback), `frontend/src/App.vue` (trigger injection off the authenticated flag instead of `authStore.token`).
- **Verification**: with cookies but no token header, every page-level request must still return `0`
  (`getAuthInfo` / `userConfig/get` / `getListWithItems` / `getCustomCode` — already measured, see
  [security.md](./security.md) §4); a normal browser login must not put a token in the response body; custom CSS/JS
  must still be injected after a fresh login **and** after a page reload; a script logging in with `withToken: true`
  must still get a usable token; a revoked API key must return `1001` while the Web session keeps working; a password
  change must invalidate sessions but **not** API keys. Add a self-check covering the four frontend-trigger paths,
  because a missing trigger is silent (nothing errors — the CSS just does not appear).
- **Risk**: medium-high, mostly on the frontend side. The failure mode is a silent loss of custom CSS/JS injection
  rather than a crash, so the manual checks above matter as much as the self-check script.
- **Decision needed from the user**: whether to do B and C as one package (recommended — B alone buys little and
  still costs the frontend migration), and whether the `api_key` endpoints belong under `/api/system/` or a new
  `/api/key/` mount.

---

## 10. Repo-wide audit findings (this round)

> Trigger: a systematic sweep of the whole repository for "defects / error handling / performance / deprecated
> content", evaluated item by item and landed in batches.
> This section records only the **conclusions and verdicts**; the per-item evidence and evaluation tables live in the
> audit report produced at the time (not part of the repository).

### 10.1 Fixes that landed (by batch)

| Batch | Content |
|-------|---------|
| P0 critical | `Style/index.vue` gained the missing `NInputNumber` import (the "panel max width" input was unusable); a failed `ImportExport` no longer reports "success" and a partial failure no longer claims success; `ItemGroupManage` resets the form before "Add" (it used to silently overwrite the group being edited) and editing uses a shallow copy; the `zh-CN` string `common.saveFail` changed from "保存成功" (saved successfully) to "保存失败" (save failed) |
| P1 robustness | home-page `jumpUrl` null fallback (it could navigate to `/undefined`); drag `item-key` switched to `id` and the local `sort` is synced after saving; `RoundCardModal` lost `:style="$parent"`; a non-object JSON import now reports a message (instead of failing silently); the request layer's `failHandler` type was fixed and shows the server `msg` (error toast 50 s → 8 s) and GETs carry headers too; `updatePanelConfigByCloud` gained a catch and only resets on `code -1`, with the save action merged into one entry point; `reloadRoute` pointing at a non-existent route was deleted; the drag handle uses an icon that actually exists locally (it used to be blank); `getFileList` resets code/exception/loading; setting a wallpaper awaits the result and rolls back on failure; an export failure no longer silently loses data; upload callbacks gained `JSON.parse` protection and `@error`; saving the search box gained a catch; `max-[400px]` → `max-w-[400px]`; the login page's inline style gained units; `add-frontend-version.js` derives the version date in Beijing time; `AppIcon`'s `style` prop was renamed `cardStyle`; `IconEditor` dropped the fragile "pass values through a computed cache" approach; `useLanguage` became watch-driven; `AppStarter`'s app list became a `computed` (language switches apply instantly) and no longer force-overwrites the collapsed state |
| P2 cleanup | 15 whole dead files (`utils/is`, `utils/format`, `utils/functions`, `utils/crypto`, …) and 3 empty directories removed; about 20 leftover comments cleaned up; 8 unused SVG icons and 4 unused large images deleted (≈620 KB, `avatar.png` kept); dead actions/fields/types in `store/modules/app`, `panel` and `auth` removed |
| P3 dependencies | `vuedraggable` (zero references) and `rimraf` removed; `axios` / `crypto-js` / `@iconify/vue` / `markdown-it-link-attributes` moved from devDependencies to dependencies; the ineffective `terserOptions.drop_console` deleted; a type declaration for `VITE_APP_VERSION` added and unused env variables removed |
| P4 documentation | stale notes such as "uncommitted" corrected; the `scratch/` description and self-check commands unified; `/about` reads the version from the root `package.json` (removing three hardcoded copies); the about page links to this repository |
| P5 extras | §9.3 dead-string cleanup (36) + audit-script whitelist; §9.8 custom CSS/JS included in the reference check; the backend `addMultiple` accepts a passed-in `sort` (import order preserved); the always-hidden debug UI and the dead "style configuration" checkbox were removed from `ImportExport` |

### 10.2 Evaluated and deliberately left alone (avoiding collateral damage)

- `useOsTheme()` in `apiMessage` does **not** leak listeners (naive-ui counts internally with `usedCount`, and the root component already holds an instance).
- The request layer keeps `code === -1` silent: each caller reports its own message, and a central toast would duplicate them.
- Virtual scrolling on the home page / file list and the two deep watches on panel/engines: not worth it at the current scale (<100 items + a 1 s debounce).
- `1001` only clears the auth store: an explicit logout clears every store, and keeping caches on a passive expiry is the better experience.
- Fail-open rate limiting/fetching and frontend roles being display-only: intentional trade-offs, explained in comments and documentation.
- `github-markdown.less` / `highlight.less` / the markdown dependencies are **not removed yet** (keeping the option of markdown rendering, and custom CSS may reference `.markdown-body` / `.hljs`).

### 10.3 Still open (needs a decision or is an operations action)

| Item | Notes |
|------|-------|
| Local leftovers | `.wrangler/state/v3/kv`, an orphan D1 file from August (4 KB, seed data only) and 5 empty directories were cleaned up; **only the two development logs `.dev-web.log` / `.dev-worker.log` in the root remain** (the tool's safe delete was refused, so delete them by hand; both are covered by `.gitignore`) |
| Cloud leftovers | the orphan KV namespace `sun-panel-login-rate` — **0 keys** measured, a pure cleanup item (delete it in the dashboard); the hosted D1 still has the historical `module_config` / `notice` tables, with **1 historical row in `module_config`** (an old search-box config the code no longer reads); back up before dropping tables |
| §9.6 | `/uploads/*` edge cache (optional, operations side; trade-offs in §9.6) |
| §9.10 ~ 9.13 | requirements that need clarification or a decision (see the end of §9; **9.13** is the security review's V-07 package B+C) |
| Security review, still open | V-01 (forced password change away from the seeded default) and V-08 (refuse a password change without `PASSWORD_PEPPER`); V-06 / V-07 (B+C in §9.13) / V-09 were evaluated and accepted — the reasoning is in [security.md](./security.md) §3 |

### 10.4 Commit suggestions

This round touches frontend, backend and documentation, so four commits are suggested: P0+P1 (behaviour fixes) →
P2+P3 (cleanup and dependencies) → P4+P5 (documentation and extras) → P6 (the second batch of this round, see §10.5);
run `npm run check` and every self-check script from Appendix C before each commit; `dist/` is gitignored and produced
by the build pipeline before deployment.

### 10.5 The second batch of this round (added after the audit findings landed)

> Trigger: the user asked to "verify the unused openness endpoints → remove them; finish `onlyName` import/export;
> evaluate and optimise §9.4 / §9.9; tidy up docs/".

| Topic | Conclusion and outcome |
|-------|------------------------|
| **Removing the openness endpoints** | A repo-wide check (including a re-check for misses caused by a misused `-SimpleMatch`) confirmed zero usage, so they were deleted: the frontend `api/openness.ts`, the types in `typings/openness/openness.d.ts`, the backend `src/api/openness.ts` and its mount in `src/api/index.ts`; the settings they alone used went with them — `SETTING_SYSTEM_APPLICATION` / `SETTING_DISCLAIMER` / `SETTING_WEB_ABOUT_DESCRIPTION`, `getSettingJson` / `setSettingJson`, and the three matching seed rows in `0001_init.sql` (**only affects brand-new databases**; the three leftover settings rows and two historical tables in the hosted database are harmless, see §10.3) |
| **`onlyName` import/export** | The exported `Icon` structure gained an optional `onlyName` (backwards compatible with old files); it is included on export and submitted on import; the backend `addMultiple` normalises it (trim, drop invalid characters, truncate at 50) and downgrades collisions ("already used in the database + duplicated within the batch") to an empty string, reporting the discarded identifiers back to the frontend; the single-item `edit` reuses the same normalisation (it only checked for duplicates server-side and never validated the character set). Self-check `scratch/only-name-import.test.ts`: **8 passed** |
| **§9.4 cookies** | see the §9.4 outcome (HttpOnly + SameSite=Lax + cross-site checks for writes; the persistence layer no longer stores the token) |
| **§9.9 subrequests** | see the §9.9 outcome (a fixed 3 reads + chunked batch updates + `limit`/`remaining` batching). One extra finding: **the free plan allows only 50 subrequests per invocation** (official limit), so large cleanups must be batched — which is where `limit` and the frontend loop come from |
| **Tidying `docs/`** | `history/` took in the migration design and the early requirement list (`migration-plan.md`, `todo.md`); `docs/README.md` was rewritten as "document map + ownership table + maintenance rules"; `deployment.md` dropped the tech-stack/differences tables duplicated from the root README; `storage.md` gained a measured "Cloudflare resources and free-tier usage" section; requirements needing clarification were collected into §9.10~9.12 |

---

## Appendix A: state of `0001_init.sql` (after §5.1)

```
-- table 1 item_icon        id, created_at, updated_at, deleted_at, icon_json, title, url, lan_url,
--                          description, open_method, sort, item_icon_group_id, only_name (formerly 0003)
--                          index: idx_item_icon_group_id
-- table 2 item_icon_group  id, created_at, updated_at, deleted_at, icon, title, description, sort,
--                          card_style (formerly 0002), text_color (formerly 0002), hide_description (formerly 0002)
-- table 3 user_config      single row id=1 (CHECK), created_at, updated_at, panel_json, search_engine_json
-- table 4 system_setting   id, config_name (UNIQUE), config_value
--                          (keys: admin account/password/nickname/avatar, custom_css, custom_js, auth_epoch,
--                           storage_auto_clean_unused — apart from the four account keys these are written on
--                           demand and not pre-seeded in the baseline;
--                           system_application / disclaimer / web_about_description were removed with the
--                           /openness endpoints, see §10.5)
-- table 5 file             id, created_at, updated_at, deleted_at, src, file_name, method, ext
-- table 6 login_attempt    ip (PK), fail_count, window_start   index: idx_login_attempt_window
-- seed   system_setting ×4 (admin_username/admin_password/admin_name/admin_head_image)
-- seed   item_icon_group ×1 (default group APP)
-- removed (no longer created): module_config, notice — see §5.1; empty tables in deployed databases are kept
```

> **Measured on the hosted instance (2026-09-21, `wrangler d1 execute --remote`)**: 11 tables (the 6 business tables +
> `d1_migrations` + `sqlite_sequence` + `_cf_KV` + the historical `module_config` / `notice`),
> `system_setting` 7 rows (the three deprecated keys are still there), `module_config` 1 historical row, `notice` 0 rows,
> `item_icon` 1 / `item_icon_group` 2 / `file` 2 / `login_attempt` 0.
> In other words: **that database was created on 2026-09-04**, before §5.1 (no longer creating the tables) and before
> this round (no longer seeding the three settings keys), so the historical tables and deprecated keys are still present
> — the code no longer touches them and they are a harmless leftover.

## Appendix B: login rate-limit SQL

```sql
-- 1) read before verification
SELECT fail_count, window_start FROM login_attempt WHERE ip = ?;
--    isLocked: window_start + 600 > now && fail_count >= 5  →  1008

-- 2) record one failure (atomic; now - 600 is passed in as a parameter, sliding window)
INSERT INTO login_attempt (ip, fail_count, window_start) VALUES (?, 1, ?)
ON CONFLICT(ip) DO UPDATE SET
  fail_count   = CASE WHEN login_attempt.window_start < ? THEN 1
                      ELSE login_attempt.fail_count + 1 END,
  window_start = ?;
--    bind order: ip, now, now-600, now

-- 3) clear on a successful login
DELETE FROM login_attempt WHERE ip = ?;

-- 4) probabilistic cleanup (1/50, submitted together with 2) via db.batch)
DELETE FROM login_attempt WHERE window_start < ?;   -- bind: now-600
```

## Appendix C: self-check scripts and commands

```bash
# Frontend pure-logic self-checks (repository convention: esbuild bundle + node run)
node_modules/.bin/esbuild scratch/panel-filter.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/panel-filter.mjs --log-level=warning && node scratch/panel-filter.mjs
node_modules/.bin/esbuild scratch/login-rate.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/login-rate.mjs --log-level=warning && node scratch/login-rate.mjs
node_modules/.bin/esbuild scratch/upload-validate.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/upload-validate.mjs --log-level=warning && node scratch/upload-validate.mjs
node_modules/.bin/esbuild scratch/password-hash.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/password-hash.mjs --log-level=warning && node scratch/password-hash.mjs
node_modules/.bin/esbuild scratch/auth-epoch.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/auth-epoch.mjs --log-level=warning && node scratch/auth-epoch.mjs
node_modules/.bin/esbuild scratch/upload-refs.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/upload-refs.mjs --log-level=warning && node scratch/upload-refs.mjs
node_modules/.bin/esbuild scratch/group-with-items.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/group-with-items.mjs --log-level=warning && node scratch/group-with-items.mjs
node_modules/.bin/esbuild scratch/upload-clean-setting.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/upload-clean-setting.mjs --log-level=warning && node scratch/upload-clean-setting.mjs
node_modules/.bin/esbuild scratch/favicon-candidates.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/favicon-candidates.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/favicon-candidates.mjs
node_modules/.bin/esbuild scratch/i18n-audit.ts --bundle --platform=node --format=esm \
  --outfile=scratch/i18n-audit.mjs --log-level=warning && node scratch/i18n-audit.mjs
# Note: CJS does not support top-level await, so use esm + .mjs everywhere; delete the artefacts when done (not gitignored)
# The one exception: search-engine-util needs --loader:.svg=text for the built-in icons (esm / cjs both work)
node_modules/.bin/esbuild scratch/search-engine-util.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/search-engine-util.mjs --loader:.svg=text --log-level=warning && node scratch/search-engine-util.mjs
# Session cookie / CSRF defences (§9.4)
node_modules/.bin/esbuild scratch/auth-cookie.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/auth-cookie.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/auth-cookie.mjs
# Backend route-level self-checks (with browser/crypto globals shimmed):
node_modules/.bin/esbuild scratch/user-config-merge.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/merge.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/merge.mjs
node_modules/.bin/esbuild scratch/only-name-import.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/only-name.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/only-name.mjs
# Security-review fixes (V-02A rate-limit key / V-02B JWT_SECRET / V-03 custom code needs auth /
# V-04 no raw DB text on the wire / V-05 body limits) — see docs/security.md
node_modules/.bin/esbuild scratch/security-fixes.test.ts --bundle --platform=node --format=esm \
  --outfile=scratch/security-fixes.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;" && node scratch/security-fixes.mjs

# Results at a glance (most recent run): panel-filter 27 · login-rate 18 · upload-validate 55 · password-hash 29 ·
# auth-epoch 23 · auth-cookie 17 · upload-refs 35 · group-with-items 15 · upload-clean-setting 23 ·
# favicon-candidates 48 · user-config-merge 16 · only-name-import 8 · search-engine-util 50 · security-fixes 46 ·
# i18n-audit 0 missing / 0 mismatches / 0 dead strings (whitelist 20)

# Migrations and new-database verification
npm run migrations:apply:local          # new database: expects all 8 business tables (including login_attempt) + all columns in one pass
npx wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 migrations list DB --remote   # old database: expects all three names to be recorded

# Quality gates
npm run check      # root typecheck + frontend type-check + eslint
npm run deploy:all # build + deploy
```

## Appendix D: suggested commit split

| PR | Content | Notes |
|----|---------|-------|
| PR-A | §2.1 merging migrations + §2.3 moving rate limiting to D1 + §2.4 removing KV (§2.5 cancelled) + documentation | ✅ done; code and migrations are ready to redeploy |
| PR-B | §3.1 upload/fetch validation | ✅ done (45 self-check assertions passed + end-to-end curl verification) |
| PR-C | §3.2 password hash upgrade (including `PASSWORD_PEPPER`) | ✅ done (29 self-check assertions passed; end-to-end confirmed an old hash is upgraded on login) |
| PR-D | §3.3 revocable JWT + shorter `exp` | ✅ done (23 self-check assertions passed; end-to-end confirmed an old token returns 1001); breaking: old tokens fail once |
| PR-E | §4.1 R2 consistency + §4.2 getListWithItems + §4.3 caching | ✅ done (22 + 15 self-check assertions passed; end-to-end verified stable keys / reference protection / reclamation on delete / cache headers) |
| PR-F | §5.1 dead storage cleanup | ✅ done (code deleted after confirmation + new databases skip the tables; empty tables in old databases are kept) |
| PR-G | §6.x documentation and backup + rebuilding `dist/` | ✅ done (storage.md added, a backup section added to deployment, dist/ rebuilt and its content verified) |

---

## Change log

| Date | Content |
|------|---------|
| round | plan created; decisions D1–D4 recorded; the two §7 frontend changes done |
| round (PR-A) | §2.1 / §2.3 / §2.4 done: `migrations/` collapsed into a single-file baseline, rate limiting moved to D1 with a lazy table-creation fallback, KV fully removed; decision D5 recorded (one-off `docs/sql/` scripts cancelled); `scratch/login-rate.test.ts` added; README / docs/deployment.md / package.json synced |
| round (PR-B/C/D) | §3.1 / §3.2 / §3.3 done: upload and fetch validation, password hash upgrade (PBKDF2 + optional pepper, decision D6), JWT generation revocation (`auth_epoch` + 72 h); `scratch/upload-validate.test.ts`, `scratch/password-hash.test.ts` and `scratch/auth-epoch.test.ts` added; end-to-end testing caught and fixed the off-by-one in the first `bumpAuthEpoch` increment |
| round (PR-E) | §4.1 / §4.2 / §4.3 done: stable keys for site icons + reference-aware R2 reclamation + the `cleanUnused` endpoint and frontend button, home-page `getListWithItems` removing the N+1, cache headers tidied (decision D7: no Worker-side edge cache); `scratch/upload-refs.test.ts` and `scratch/group-with-items.test.ts` added; the self-check caught `cleanupUploads` deleting external links and it was fixed |
| round (PR-F + §5.2/5.3) | §5.1 done (all `notice` / `moduleConfig` code deleted, `0001_init.sql` no longer creates the two tables, empty tables in old databases kept), §5.2 (the `ASSETS` binding removed, with official references), §5.3 (no optimistic lock; a README "known limitations" note instead); after the deletions `tsc` / `vue-tsc` / `eslint` / 10 self-check scripts / the i18n audit all pass, and a fresh database verified that the baseline is down to 6 business tables (11 statements executed successfully) |
| round (PR-G) | §6.1 / §6.2 / §6.3 done: `docs/deployment.md` gained "Backup & Restore", `docs/storage.md` was added (resources/tables/R2 layout/local state/structure-change policy), `vite build` rebuilt `dist/` and its content was verified. **Every item of the improvement plan is closed** (§5.3 being "decided against") |
| round (post-closure additions + documentation Q&A) | §9.0 image reclamation switch implemented on user request (decision D8, with `scratch/upload-clean-setting.test.ts` at 23 assertions + real D1/R2 end-to-end verification of both branches) and `dist/` rebuilt; the §9 "candidate backlog in detail" section (9.1~9.8) added; the stale wording in `docs/todo.md` batch three #3 and the table list in Appendix A corrected (only 6 tables remain after §5.1) |
| round (plan adjustment + documentation) | §9 adjusted per user instruction: **9.2 "pick one icon in a dialog"** added (backend candidate parsing / two new endpoints, frontend `FaviconPicker.vue`, i18n, self-check and end-to-end verification steps), the former 9.4 (PBKDF2 iterations) and 9.7 (pre-existing open requirements) **removed**, numbering re-compacted; [storage.md](./storage.md) gained **§3.1 "Image reclamation: two entry points, decision rules and the switch"** (default value / failure direction / button flow / scenario matrix / blind spots) |
| round (A1+A2+B1 landed) | §9.1 done (`apiErrorCode.1009` in both locales, so the login page shows the password-configuration problem), §9.5 (`JWT_SECRET` weak-key one-off warning + `openssl rand -base64 48` added to the deployment doc), §9.2 (`extractIconCandidates` + the candidate/save endpoints + the `FaviconPicker.vue` dialog, old endpoint kept; new self-check `scratch/favicon-candidates.test.ts` **48 passed**); `npm run check` and the i18n audit pass, `dist/` rebuilt |
| round (backlog markers completed) | the "waiting for the user" list (secrets / deploy / first-login check / optional cleanup) added at the top of §9; the "uncommitted" note closing §7 updated to cover all of §2 ~ §9; §9.7's PR-I updated to "§9.1 / §9.2 / §9.5 done" with a sixth manual regression item (the multi-candidate dialog) |
| round (repo-wide audit) | §10 added: after a systematic review, work landed in P0~P5 batches — 4 critical fixes (missing `NInputNumber`, fake import success, silent group overwrite, the `saveFail` string), about 25 robustness fixes, 15 dead files and about 620 KB of unused assets removed, dependencies and configuration tidied (-2 dependencies, 4 moved to dependencies), documentation synced and version numbers unified; §9.3 (36 dead strings removed + audit whitelist) and §9.8 (custom CSS/JS included in the reference check) completed as well; 12 self-check scripts green, `npm run check` 0 error / 0 warning |
| round (second batch) | §10.5 added: the three unused `/openness/*` endpoints removed together with their settings keys and seeds (frontend wrappers and types too); `onlyName` threaded through import/export with backend normalisation/deduplication (new `scratch/only-name-import.test.ts`, 8 assertions); §9.4 done (HttpOnly cookie + SameSite=Lax + cross-site checks for writes + the token no longer persisted, new `scratch/auth-cookie.test.ts`, 17 assertions); §9.9 done (a fixed 3 reference reads + chunked batch updates + `limit`/`remaining` batching, `upload-refs` grown to 35 assertions); `docs/` reorganised (`history/` archive, index rewritten, a free-tier section added to storage, deployment deduplicated); 14 self-check scripts green |
| round (fourth batch · resource rename) | naming baseline updated: Worker → `sun-panel-on-cloudflare-worker`, D1 → `sun-panel-on-cloudflare-worker_db`, R2 → `sun-panel-on-cloudflare-worker-files` (**measured constraint**: R2 bucket names reject underscores, hence hyphens); `wrangler.toml` and deployment.md (import instructions, access URL, create and migration commands, backup/restore), storage.md (resource table, measured free-tier usage) and both READMEs all synced; `wrangler deploy --dry-run` passes (`env.DB` / `env.FILES` resolve correctly) |
| round (third batch · documentation and bilingual) | the root README split into a bilingual pair: `README.md` (English) and `README.zh-CN.md` (Chinese), both carrying a language switch at the top, with the licence section written as `This project is licensed under the [MIT License](LICENSE).` / `本项目采用 [MIT License](LICENSE)。` respectively plus a note crediting the upstream author; **the deployment section was rewritten as the Workers Git integration flow** (connect the repository → two commands → add `JWT_SECRET` → automatic deploys on `git push`), with the details still pointing at deployment.md; `docs/history/` was reorganised by topic into `migration/plan.md` and `requirements/early-todo.md` with new archiving criteria (`history/README.md`); `improvement-plan.md` was judged to **stay in the `docs/` root** (§9/§10 are still active backlog and referenced by anchor in several places); `docs/README.md` gained the bilingual-sync rule and the link-depth explanation; relative links in 12 documents verified |
| round (fifth batch · all docs bilingual) | all 10 documents under `docs/` became bilingual pairs using the root README's naming: the Chinese versions are `*.zh-CN.md` and the English versions take the original file names; every document opens with the same one-line language switch as the root README (`[English](X.md) | [简体中文](X.zh-CN.md)`, no heading). The Chinese content was not rewritten — only the switch line was added and internal links were split by language (`./storage.md` → `./storage.zh-CN.md`, root README → `README.zh-CN.md`); the English versions are section-by-section translations whose numbering (§2.2, §9.9, Appendix A/C, …) matches the Chinese versions, so the `docs/improvement-plan.md §x.y` references in `src/*.ts` comments stay valid; `docs/README.md` gained the bilingual file map plus the "same-language links only" and "never update one half of a pair" rules; the links in both root READMEs and in the `history/` and `upstream/` archives were updated accordingly; relative links verified |
| round (sixth batch · bilingual comments) | every code comment in the repository now follows the "English first, Chinese second" bilingual rule: a single-line comment pair sits next to each other (no blank line); inside a multi-line comment sections are separated by one blank comment line, and between the two languages there is one blank line for a single-section comment and two blank lines for a multi-section comment. Covers `src/` (22 files), `scratch/` (14), `frontend/src` (54) plus `migrations/0001_init.sql`, `wrangler.toml`, `.dev.vars.example` and the frontend config/build scripts. Commented-out code and tool directives (`/// <reference>`, `@type`) are left untouched. Verification: a self-check script comparing comment-stripped code against HEAD reports **0 code changes**, and a scan for mono-lingual comment blocks leaves only the deliberately kept commented-out code and directives |
| round (security review) | a repo-wide security review (injection / access control / data exposure / input validation / hardcoded secrets / OWASP Top 10) produced findings `V-01`…`V-09` and fixed four of them: V-02A (the rate-limit key trusts only `cf-connecting-ip`, falling back to a shared bucket plus an operator warning), V-02B (`JWT_SECRET` empty/whitespace now fails closed — 503 from login, the middleware and `onError`), V-03 (`getCustomCode` requires authentication and the frontend only injects when a token exists), V-04 (`internalError` added; eight call sites stop forwarding storage/DB text) and V-05 (a `bodyLimit` middleware across 22 endpoints plus array-length caps). New self-check `scratch/security-fixes.test.ts` **42 passed**; end-to-end on real workerd: rate-limit buckets are per-IP and a forged `X-Forwarded-For` changes nothing, a 2 MB login body and a 52 MB upload both return 413, a cookie-only session completes every page-level request, and a cross-site write returns 1005. **Conclusions and IDs now live in [security.md](./security.md)** (trust boundaries + registry + verified properties + what is deliberately not defended); V-01 / V-08 remain open |
| round (V-07 step A + documentation close-out) | step A of V-07 implemented: the login response carries `Cache-Control: no-store`, closing the only risk in that list that code alone can close (an intermediate proxy replaying the response body). Documentation: the bilingual [security.md](./security.md) / `security.zh-CN.md` pair added and registered in the `docs/README` document map, ownership table and reading paths, with the "finding IDs are never renumbered" rule stated explicitly; the V-07 B+C plan written into §9.13 (migration order, the `api_key` table contract, the four frontend changes, the verification list); all 27 `V-0x` comments in `src/` now point at `docs/security.md §3`, so nothing depends on a report outside the repository; the review report outside `docs/` was deleted so it cannot become a second source of truth |
| round (docs polish · language switch) | the `# Language Switch` heading that had been placed above the switch was removed from all 22 bilingual documents (the `docs/` root, `history/` and `upstream/` pairs); what remains is the single-line switch `[English](X.md) | [简体中文](X.zh-CN.md)` at the very top of each file (right below the front matter where there is one). The maintenance rule in `docs/README` and the "fifth batch" row above were reworded to describe the format without the heading; a repo-wide scan confirms that no `# Language Switch` heading is left and that every pair still carries its switch line |
| round (docs housekeeping + URL surface) | `wrangler.toml` gained `workers_dev = true` and `preview_urls = false` (version URLs disabled: old deployments are no longer publicly reachable under `*.workers.dev`; re-enable if non-production branch preview builds are ever used); `docs/images/` renamed to `docs/assets/` with the root READMEs and the upstream archive links updated; light YAML front matter (`title` / `status` / `audience` / `last_verified`) added to the 10 content documents; `docs/README` gained the stable-path rule (paths referenced by `src/` comments and `migrations/` are contracts), the flat-structure decision (Diátaxis mapping in the index instead of subfolders), the front-matter convention and the `docs/assets/` naming rule |
| round (docs polish · switch placement + strict same-language links) | the language switch now sits **directly under the H1 title** in all 22 bilingual documents (the `docs/` root, `history/` and `upstream/` pairs), exactly like the root README (`# Title` → blank → `[English](X.md) | [简体中文](X.zh-CN.md)` → blank → `---`), replacing the previous "very first line" placement; front matter and bodies are unchanged. Every cross-language link outside the switch line was removed so that "same-language linking" holds strictly: the root README pair, `docs/README`, `docs/deployment`, `docs/history/README`, `docs/improvement-plan` and `docs/upstream` now mention the other language with code spans instead of links, and the Chinese link text `docs/storage.md` was corrected to `docs/storage.zh-CN.md`. The wording about the switch position was updated in both root READMEs and in the `docs/README` maintenance rules (`under the title`, not `at the top`); verified by a script checking the head structure of all 22 documents (H1 → switch → `---`), the existence of every relative link, and that no cross-language link survives outside the switch line |

