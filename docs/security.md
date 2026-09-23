---
title: Security Posture & Finding Registry
status: current
audience: developer, auditor
last_verified: 2026-09-23
---

# Security: Trust Boundaries and Finding Registry

[English](security.md) | [简体中文](security.zh-CN.md)

> This document owns the **security posture** of this port: which boundaries the code trusts, which
> trade-offs were made deliberately, and the registry of findings with stable IDs.
> Deployment steps and secrets → [deployment.md](./deployment.md); data location and retention →
> [storage.md](./storage.md); active backlog and decision log → [improvement-plan.md](./improvement-plan.md).

## 1. Why this document exists

A security review of the whole repository was carried out and its fixes landed (2026-09-22); the review report
itself was a working file outside `docs/`. That leaves a gap: **code comments cite review item numbers such as
`V-02A` or `V-04`, and those numbers need a stable home inside the repository** — otherwise a later reader cannot
verify what the comment is talking about, and a future audit cannot tell "still open" from "already fixed".

Two rules keep it working:

1. **Finding IDs are stable.** `V-01` … `V-09` keep their meaning forever, even after a fix. Do not renumber; a
   new finding gets the next free number.
2. **Code comments cite `docs/security.md`, never a transient report.** Write `(security review V-04, see
   docs/security.md §3)` rather than pointing at a file that only existed during the review.

## 2. Trust boundaries (what the code deliberately trusts)

These are the decisions a future change is most likely to break by accident. Each one is enforced in code and
explained there; the list exists so nobody "simplifies" them away.

| Boundary | Decision | Where |
|----------|----------|-------|
| Client IP for login rate limiting | **Only** `cf-connecting-ip` is trusted; the header is normalised (first value, ≤64 chars, charset whitelist) and anything else falls back to a single shared `unknown` bucket. `X-Forwarded-For` is never consulted — it is client-controlled, and trusting it let an attacker pick a fresh bucket per request (V-02A). | `src/api/login.ts` |
| Request body size | Every endpoint declares a limit (64 KB JSON / 1 MB large JSON / 50 MB upload). The declared `Content-Length` is checked first, then the **real** byte count, because the header can be missing or false. | `src/utils/bodyLimit.ts` |
| Error text leaving the service | Storage/database error messages never reach the client: the detail goes to the log, the response carries the error code's generic text. | `src/utils/response.ts` (`internalError`) |
| `JWT_SECRET` | An empty or whitespace-only secret is **refused** (503 + actionable message) instead of signing with an empty HMAC key. A merely short secret is warned about but not refused, so an already-deployed instance is not locked out of its own panel. | `src/utils/jwt.ts`, `src/index.ts`, `src/middleware/auth.ts` |
| Credential channel | The session lives in an `HttpOnly; SameSite=Lax` cookie; the `token` header and `Authorization: Bearer` are kept for scripts and non-browser clients. The consequence — and its cost — is recorded as V-07. | `src/utils/authCookie.ts`, `src/middleware/auth.ts` |
| Uploaded content served back | Only whitelisted extensions are accepted; non-images are forced to `Content-Disposition: attachment`; SVG gets a `default-src 'none'; sandbox` CSP; `nosniff` is always set. | `src/utils/file.ts`, `src/index.ts` |
| Reference check for image reclamation | Judged by **string containment** and deliberately conservative: an unused file may be kept, an in-use file is never deleted. | `src/utils/uploadRefs.ts` |
| CSRF check for cookie-authenticated writes | `Sec-Fetch-Site` first, then an `Origin`/`Host` host-name comparison; a request with neither header is allowed. The cookie's `SameSite=Lax` remains the primary line, so this is defence in depth, not the only gate. | `src/middleware/auth.ts` |

## 3. Finding registry

Status: **fixed** = landed and verified; **open** = needs a product or operations decision;
**accepted** = examined and deliberately left as-is (the reasoning is the deliverable).

| ID | Finding | Severity | Status | Fixed in / decision |
|----|---------|----------|--------|---------------------|
| V-01 | Default administrator credentials `admin / 12345678` are seeded in the public migration, and nothing forces a change on first login | High | **open** | Needs a product decision: forced password change on first login, plus blocking writes while the default hash is still in place. The migration seed itself is intentional (a fresh deploy must be reachable) |
| V-02A | Login rate limiting could be bypassed by forging `X-Forwarded-For`, making an online brute force of an 8-character default password realistic | High | **fixed** | `clientIp()` trusts only `cf-connecting-ip`, falls back to one shared `unknown` bucket, and logs a one-time operator warning |
| V-02B | A missing `JWT_SECRET` was only logged, so tokens were signed and verified with an empty HMAC key — a complete authentication bypass | High | **fixed** | `isSecretUsable()` + `MissingJwtSecretError`; login, middleware and the app-level `onError` all answer 503 with an actionable message |
| V-03 | `POST /api/system/getCustomCode` was unauthenticated, handing any anonymous visitor the full custom JS/CSS source (internal host names, endpoints, tokens stored there) | Medium-High | **fixed** | `authMiddleware()` added; the frontend fetches it only when a token exists. Behaviour change: the login page no longer receives custom CSS/JS |
| V-04 | Storage/database error text was forwarded to the client, exposing table, column and constraint names | Medium | **fixed** | `internalError()` logs the detail and answers with the code's generic text (8 call sites); the download-failure wording was kept because it carries no internals and is relied on by the frontend and self-checks |
| V-05 | No request-body limit and no array-length caps, so an anonymous oversized `/login` body or a huge batch array acted as a CPU/memory amplifier | Medium | **fixed** | `bodyLimit()` middleware on the business endpoints; `addMultiple`/`saveSort` ≤ 1000 items, delete endpoints ≤ 500 ids; 413 + `1402` |
| V-06 | `/uploads/*` files are readable by anyone who has the URL (no signature, no expiry); only the 32-char hash makes enumeration infeasible | Low-Medium | **accepted** | Key shape is validated (`isValidUploadKey`) and non-images are forced to download; treat the URL itself as the credential until signed URLs are wanted |
| V-07 | The login response body returns the same JWT that the cookie carries, so the token is readable by page JavaScript | Low | **accepted (step A implemented)** | Cookies are the browser path and the token is not persisted to `localStorage`. The response now carries `Cache-Control: no-store` (step A, covered by a self-check assertion). Deliberate: CLI/third-party clients need a way to obtain the token, which is why the `token` header exists at all. A dedicated API key is the long-term fix and is recorded in [improvement-plan.md](./improvement-plan.md) §9.13 |
| V-08 | With no `PASSWORD_PEPPER` configured, a password change writes an unsalted triple-MD5 hash instead of failing closed | Low | **open** | Refuse password changes without a pepper, or generate one during deployment. Legacy hashes must stay verifiable for existing installs |
| V-09 | The CSRF fallback allows a write request that carries neither `Sec-Fetch-Site` nor `Origin` | Low | **accepted** | `SameSite=Lax` already blocks browser-driven cross-site writes; rejecting headerless requests would break CLI tools that authenticate by cookie. Revisit only if cookie authentication is used by non-browser clients |

### Notes on the three accepted items

**V-06: the URL is the credential.** Keys contain a 32-character MD5 and `isValidUploadKey()` pins the shape, so
guessing is not practical, but sharing a URL shares the file. That matches how the panel uses the images (they are
referenced from the panel config). If this ever needs to be stronger, signed URLs or an authenticated route are the
options — both would break the legitimate anonymous case (a browser loading an avatar), so it is a product call.

**V-07: a compatibility channel with a real residual cost.** Reading order is cookie → `token` header →
`Authorization: Bearer`. The last two exist for CLI scripts and third-party tools, which cannot use an `HttpOnly`
cookie, so the token has to be obtainable somewhere — the response body is the only place. The residual risk is that
the same value is therefore also readable by page JavaScript, which matters when an XSS already exists (it turns
"borrow the victim's browser" into "reuse the credential offline"). The cheapest mitigation, `Cache-Control:
no-store` on the login response, is implemented; the thorough fix (a separate API key, so the Web session and script
credentials cannot overlap) is planned. Note also that a token does **not** allow changing the password or username
(both require the current password), so the exposure window is bounded by the 72-hour token lifetime and
`auth_epoch` revocation.

**V-09: a documented gap in defence in depth.** The check exists to add a second line behind `SameSite=Lax`, not to
be the only one. Tightening it would mean rejecting cookie-authenticated writes that carry no origin information at
all, which is exactly what a CLI sending a cookie jar looks like.

## 4. Verified properties (regression guards)

These were verified end-to-end and should stay true. The matching self-checks are listed in
[improvement-plan.md](./improvement-plan.md) Appendix C.

| Property | Evidence |
|----------|----------|
| Rate limiting is per-IP and cannot be moved by a forged header | Five failed logins lock the bucket; adding a forged `X-Forwarded-For` keeps it locked; a different `cf-connecting-ip` starts clean |
| A missing `JWT_SECRET` fails closed everywhere | `scratch/security-fixes.test.ts` covers sign, verify and the app-level handler |
| Anonymous callers cannot read the custom code | Returns `1000` with no `customCss` / `customJs` fields in the body |
| Database error text never leaves the Worker | Injected `UNIQUE constraint failed: item_icon.only_name` comes back as code `1200` with no schema text |
| Body limits hold for both a declaring and a lying header | 2 MB `/login` and 52 MB upload return 413; a header claiming 1 byte over a 2 KB body is still rejected |
| Cookie-only sessions keep every page working | With a cookie and no token header, `getAuthInfo` / `userConfig/get` / `getListWithItems` / `getCustomCode` all return `0`; cross-site writes are rejected with `1005` while same-origin writes pass |
| Token revocation is all-or-nothing for non-browser clients | `POST /logout {"allDevices": false}` clears the cookie but leaves a copy of the token valid; only `{"allDevices": true}` bumps `auth_epoch` and invalidates it. Event-response playbooks must use `allDevices: true` |
| Sign-out does not depend on the client clearing state | The server clears the cookie and (for all-devices) the generation, so a stale client cannot keep a live session |

## 5. Things that are intentionally *not* defended

Listing them prevents "why don't we just fix this" from being re-litigated every round:

- **An administrator's own custom CSS/JS can execute arbitrary code on every page.** That is the feature.
  V-03 removed anonymous *readability* of it; it did not remove the capability.
- **The panel is single-user.** `role` is always `1`, there is no user table, and no permission tiers. There is no
  authorization model to harden beyond "is the caller the administrator".
- **Login rate limiting is an auxiliary defence.** It fails open when D1 has a hiccup, because locking the
  administrator out of the panel is worse than a temporary loss of throttling.
- **`auth_epoch` caching allows up to a 10 s window** in which a revoked token is still accepted. The comparison
  only rejects *older* generations, so a fresh token is never killed by a stale cache.
- **No CSP is set on the panel itself.** Custom JS is injected inline by design, so a meaningful policy needs
  nonce/hash plumbing. Tracked as a hardening item, not a bug.

## 6. How to add a finding

1. Take the next free `V-xx` number and add a row to §3 — even for an accepted risk. The reasoning is the useful
   part; a deleted row means the next reader re-investigates the same question.
2. If it changes a trust boundary, update §2 and the code comment that enforces it.
3. Cite it from code as `(security review V-xx, see docs/security.md §3)`.
4. If it becomes work to do, add the implementation plan to [improvement-plan.md](./improvement-plan.md) §9
   (candidates) and link back here.
5. If it is fixed, fill in the "Fixed in" column and add the self-check to Appendix C of the improvement plan.
