---
title: Search-Engine Settings
status: current
audience: deployer
last_verified: 2026-09-23
---

# Search Engine Settings Guide

[English](search-engine.md) | [简体中文](search-engine.zh-CN.md)

The search engines used by the search box are no longer maintained in the search-box popover; the configuration entry
now lives in one place:
**Home → app launcher → Style Settings → the search-engine area at the bottom of the "Search bar component" card**.

## Feature Overview

| Feature | Description |
|---------|-------------|
| Add / edit / delete | the form validates input (name required, ≤20 characters; URL must be http(s); icon URL format) and rejects duplicate names or URLs |
| Drag to sort | click "Sort" to enter drag mode; the list order is the order shown in the search box; click "Save order" to leave (the "Sort" button appears only with ≥2 engines) |
| Set as current | click a list entry to switch the active engine (green border + check mark) |
| Restore built-in engines | adds the missing Google / Baidu / Bing entries; existing ones are not duplicated |
| Reset to defaults | after a confirmation, clears custom engines and restores the three built-ins |
| Open method | the "Open in a new window" switch at the bottom of the area; the search-box popover can toggle it too (it writes back to the config instead of applying only for the session) |
| Icon fallback | with no icon configured, candidates are tried in order: the site's `/favicon.ico` → Google favicon → (for Google / Baidu / Bing) the built-in icon → the first letter of the name. Inside the search box no online favicon is requested; only the built-in icon and the first letter are used |

## How to Write a Search URL

**Simplest approach: paste the full URL of a real search.**

For example, searching for "sun panel" in Bing gives
`https://www.bing.com/search?q=sun+panel&form=QBLH`; paste it as-is and, on blur, the system detects the keyword
parameter and turns it into a template:

```
https://www.bing.com/search?q=%s&form=QBLH
```

Below the form you can see the "actual target URL for keyword `sun panel`" update live, so you can confirm the result
right away.

### Keyword placeholders

Three forms are supported and behave identically:

| Form | Example |
|------|---------|
| `%s` | `https://www.google.com/search?q=%s` |
| `{keyword}` | `https://example.com/search?q={keyword}` |
| `{q}` | `https://example.com/search?q={q}` |

When the template has **no placeholder at all**, the keyword is URL-encoded and appended to the end of the address
(`https://example.com/search?q=` + `sun%20panel`), so a bare address works too.

Rules for detecting the keyword parameter: prefer a parameter whose value contains the sample keyword; otherwise fall
back to common parameter names
(`q` / `wd` / `word` / `query` / `keyword` / `keywords` / `kw` / `search_query` / `text` / `p` / `s` / `k`); if none of
those match, take the first parameter.

## Storage and Compatibility

- The configuration is stored in D1 as `user_config.search_engine_json` (same row and same endpoint as the panel
  configuration).
- `POST /api/panel/userConfig/set` accepts `panel` or `searchEngine` alone; fields that are not submitted keep their
  current value, so changing the style no longer wipes the search-engine configuration.
- Older versions stored engines in `module_config` under `module-deskModuleSearchBox`: that compatibility migration was
  **removed** together with the dead code (see [improvement-plan.md](./improvement-plan.md) §5.1; the `module_config`
  table is no longer created either). If you upgrade straight from a very old version and have never opened the newer
  UI after the migration, custom engines are not restored automatically — reconfigure them under
  "Style Settings → Search bar component" (or click "Restore built-in engines").
- The local cache may still hold the old shape: `newWindowOpen` (boolean) is converted to `openMethod`
  (0 = current page / 1 = new window), and missing `id`s are filled in.

## Visitor (Public) Mode: Not Applicable to This Port

Upstream lets visitors switch the search engine and open method in public (visitor) mode, applying only to that visit.
This port is a **single-user version without a public mode** (see the root README and the "Differences from Upstream"
table in [deployment.md](./deployment.md)): the backend `POST /api/user/getAuthInfo` always returns `visitMode: 0`
(`src/api/system/user.ts:35`), so the frontend's visitor branch is never taken and switching the engine / open method
in the search box always writes back to the cloud configuration.

The visitor checks kept in the code are upstream leftovers; there are two, and neither can trigger:

| Location | Content |
|----------|---------|
| `frontend/src/components/deskModule/SearchBox/index.vue:32,55,87` | the `isVisitor` branches: switching engine/open method without persisting, plus the `visitorSwitchTip` message |
| `frontend/src/views/home/index.vue:555` | the "Go to login" button in the bottom-right corner |

They are kept to stay consistent with the `VisitMode` checks elsewhere in this port, so a future public mode would
just work. If you are sure they are not needed, they can be deleted together with the
`deskModule.searchEngine.visitorSwitchTip` string.

## Self-check Scripts

`scratch/` holds self-check scripts that need no test framework and verify pure logic plus the backend merge semantics
(run them from the repository root; **the full list and commands are in
[improvement-plan.md Appendix C](./improvement-plan.md#appendix-c-self-check-scripts-and-commands)**). The three
relevant to this page:

```bash
# Search-engine helpers: placeholder replacement, template inference, validation (including validation-message keys
# and their locale alignment), normalising old data
node_modules/.bin/esbuild scratch/search-engine-util.test.ts \
  --bundle --platform=node --format=esm --outfile=scratch/search-engine-util.mjs \
  --loader:.svg=text --log-level=warning
node scratch/search-engine-util.mjs

# Field-merge semantics of userConfig/set (in-memory D1 + real HTTP calls)
node_modules/.bin/esbuild scratch/user-config-merge.test.ts \
  --bundle --platform=node --format=esm --outfile=scratch/merge.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;"
node scratch/merge.mjs

# i18n key audit: missing keys (would show the raw key) / zh-en mismatches / dead strings (with a dynamic-key allowlist)
node_modules/.bin/esbuild scratch/i18n-audit.ts \
  --bundle --platform=node --format=esm --outfile=scratch/i18n-audit.mjs --log-level=warning
node scratch/i18n-audit.mjs
```

All three scripts are self-contained; a non-zero exit code means a case failed (delete the generated `.mjs` files
afterwards — they are not gitignored).

### Notes on the i18n Audit Script

`scratch/i18n-audit.ts` scans every literal `t(...)` / `$t(...)` key in `frontend/src` and compares it against
`zh-CN.json` / `en-US.json`, reporting four groups:

- **used but missing from a locale**: vue-i18n shows such keys to the user verbatim
- **zh-en mismatch**: keys present on only one side
- **dead strings**: present on both sides but not referenced anywhere in the code
- **namespace details**: counts and dead strings for `deskModule.searchBox.*` and `deskModule.searchEngine.*`

Known limitation: calls that pass a key held in a variable (validation messages, `apiErrorCode.${code}`) cannot be
resolved statically and are counted as dead strings. That is why the five validation messages under
`deskModule.searchEngine.*` legitimately show up as dead — the return value of `validateSearchEngine` is translated
through `t(result.titleError)` in `frontend/src/components/apps/Style/SearchEngineSettings.vue`. **This is exactly
why the audit script exists**: those five keys once had a `deskModule.searchBox.*` prefix and therefore failed to
resolve, which only surfaced through the "present on both sides but nobody references them" signal.
