# Porting To-Do / Requirements (Historical Archive)

[English](early-todo.md) | [简体中文](early-todo.zh-CN.md)

> **Historical document**: this list is the record of requirements collected while porting started; the "done" entries
> only serve as traceability.
> The three requirements still **open / undecided** were merged into
> [improvement-plan.md §9](../../improvement-plan.md) (9.10 ~ 9.12) — track them there from now on instead of adding to
> this file.
>
> Source: requirements collected during the port (originally `原项目/移植项目仍存在问题.txt`; that directory has been
> renamed to `reference/upstream-sun-panel/`).
> The "status" column was derived by checking the code at the time.

## Batch one

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Rework "My Info" into three areas: an **Account** area holding "Username" (merging the former "Account" and "Nickname", without the "Edit" button), a separator, and **Change login info** (formerly "Change password", with a required username field added at the top of the dialog); a **Settings** area holding the former "Language" and "Theme"; "Sign out" at the bottom. Area titles use the same typeface as "LOGO" in Style Settings | Partially implemented<br>`frontend/src/components/apps/UserInfo/index.vue`: the Account / Settings cards, the sign-out at the bottom, and the area titles matching "LOGO" are all in place; but the login information was **not merged** — "Change username" and "Change password" are still two separate entries and dialogs, the password dialog has no username field, and "Nickname" is no longer shown |
| 2 | Remove the "browser bookmark converter" from Import/Export | Implemented (no such code left in the frontend) |

## Batch two

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Change the default link and name of the custom footer to `https://github.com/Bosco1262/Sun-Panel-on-Cloudflare-Worker` and `Sun-Panel-on-Cloudflare-Worker` | Implemented<br>`frontend/src/store/modules/panel/helper.ts` (`defaultFooterHtml`) |
| 2 | The image background in the upload-file manager is too busy; reduce its opacity by 50% | To be confirmed (the checkerboard is currently `rgba(0, 0, 0, 0.03)` in `frontend/src/components/apps/UploadFileManager/index.vue`; upstream also has a `.transparent-grid` checkerboard (`#f0f0f0` / 16px), and this port changed the lightness and added a white variant in `frontend/src/styles/global.less`) |
| 3 | Adjust the layout of "New" (create) | To be confirmed (the requirement is vague; specifics are needed) |

## Batch three

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Redesign "Search engine settings": move the entry to "Style Settings → Search bar component" and turn it into a full management area (add/edit/delete, drag to sort, set as current, restore built-ins, reset, live preview); the search-box popover keeps only the engine switch and the new-window switch | Implemented<br>`frontend/src/components/apps/Style/SearchEngineSettings.vue`, `frontend/src/components/deskModule/SearchBox/index.vue`, see [search-engine.md](../../search-engine.md)<br>The i18n namespace problem of the validation messages was fixed (see the table below) |
| 2 | The keyword placeholder is no longer forced to `%s`: support `%s` / `{keyword}` / `{q}`, append automatically when there is no placeholder, and infer the template when a real search URL is pasted | Implemented<br>`frontend/src/utils/searchBox/index.ts` |
| 3 | Move the search-engine config from `module_config` to `user_config.search_engine_json` and fix the "changing the style wipes the search-engine config" bug | Implemented<br>`src/api/panel/userConfig.ts` (fields that are not submitted keep their value).<br>⚠️ Later change (see [improvement-plan.md](../../improvement-plan.md) §5.1): the one-off `module_config` migration read was **removed** with the dead-code cleanup and the `module_config` table is no longer created; instances upgraded straight from a very old version that never opened the migrated UI must reconfigure their engines under "Style Settings → Search bar component" |

## Fixed (found while reviewing, handled in that round)

| # | Problem | Handling |
|---|---------|----------|
| 1 | The search-engine form showed raw keys as validation messages (e.g. `deskModule.searchBox.engineNameRequired`): the helper returned keys prefixed `deskModule.searchBox.` while the strings were only defined under `deskModule.searchEngine.` | Fixed: the five keys of `validateSearchEngine` became `deskModule.searchEngine.*`; `scratch/search-engine-util.test.ts` was updated accordingly and gained a case asserting that all five validation strings exist in both `zh-CN` and `en-US` (53 passed on both sides) |
| 2 | Removing the popover management UI left unreferenced message keys (`deskModule.searchBox.engineName/engineUrl/engineIconUrl/engineDeleteLastWarning/engineFormIncomplete/searchEngineManage`, `deskModule.searchEngine.sortTip`), and the drag hint "drag to reorder the search box" never appeared | Fixed: the seven dead strings were removed from `zh-CN.json` / `en-US.json`; `deskModule.searchBox.*` and `deskModule.searchEngine.*` now have no dead strings. If the drag hint should be shown later, re-add `searchEngine.sortTip` and reference it in the template |
| 3 | The message key `chat.copyCode` of the code-block "Copy" button did not exist in the locales, so the UI showed the raw key (**present since the initial commit, not introduced by the search-engine rework**) | Fixed: `chat.copyCode` was added (`复制` / `Copy`). Found by `scratch/i18n-audit.ts`; the full audit now reports "0 missing / 0 zh-en mismatches" |

## Known issues (found while reviewing, still open)

| # | Problem | Location |
|---|---------|----------|
| — | None for now (`scratch/i18n-audit.ts` reports 0 missing and 0 zh-en mismatches; the 57 dead strings all belong to unused upstream namespaces such as `adminSettingUsers.*`, `common.*`, unrelated to the rework) | — |
