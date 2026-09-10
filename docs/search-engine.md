# 搜索引擎设置使用说明

搜索框的搜索引擎不再在搜索框弹层里维护，配置入口统一在
**首页 → 应用启动器 → 风格设置 → 「搜索栏组件」卡片底部的搜索引擎管理区**。

## 功能一览

| 功能 | 说明 |
|------|------|
| 添加 / 编辑 / 删除 | 表单带校验（名称必填 ≤20 字、地址必须是 http(s)、图标地址格式校验）与重名/重复地址拦截 |
| 拖拽排序 | 点「排序」进入拖拽模式，列表顺序即搜索框中的展示顺序，点「保存排序」退出（引擎数 ≥2 时才显示「排序」按钮） |
| 设为当前 | 点击列表项即可切换当前使用的搜索引擎（绿色边框 + 勾选标记） |
| 恢复内置引擎 | 把缺失的 Google / 百度 / Bing 补进列表，已存在的不重复添加 |
| 重置为默认 | 二次确认后清空自定义引擎并恢复内置三项 |
| 打开方式 | 「新窗口打开」开关，配置在管理区底部；搜索框弹层里也能直接切换（会写回配置，不是临时生效） |
| 图标回退 | 未填图标时按候选逐个回退：管理区列表里依次尝试站点 `/favicon.ico` → Google favicon →（名称为 Google / 百度 / Bing 时的）内置图标 → 名称首字母；搜索框内不请求在线 favicon，只回退内置图标与首字母 |

## 搜索地址怎么写

**最简单的用法：把一次真实搜索的网址整段粘进去。**

例如在 Bing 里搜「sun panel」，地址栏是
`https://www.bing.com/search?q=sun+panel&form=QBLH`，
直接粘贴即可，失焦时系统会自动识别出关键词参数并转成模板：

```
https://www.bing.com/search?q=%s&form=QBLH
```

表单下方会实时显示「关键词 `sun panel` 的实际跳转地址」，可以直接确认结果对不对。

### 关键词占位符

同时支持三种写法，效果完全一致：

| 写法 | 示例 |
|------|------|
| `%s` | `https://www.google.com/search?q=%s` |
| `{keyword}` | `https://example.com/search?q={keyword}` |
| `{q}` | `https://example.com/search?q={q}` |

模板里**没有任何占位符**时，关键词会做 URL 编码后追加到地址末尾
（`https://example.com/search?q=` + `sun%20panel`），因此填空地址也能用。

识别关键词参数的规则：优先取参数值里包含示例关键词的参数；找不到时回退到常见参数名
（`q` / `wd` / `word` / `query` / `keyword` / `keywords` / `kw` / `search_query` / `text` / `p` / `s` / `k`）；
再找不到就取第一个参数。

## 存储与兼容

- 配置存放在 D1 的 `user_config.search_engine_json`（与面板配置同一行、同一接口）。
- `POST /api/panel/userConfig/set` 支持只提交 `panel` 或 `searchEngine`，未提交的字段保留原值，
  因此「改样式」不会再清空搜索引擎配置。
- 老版本把引擎存在 `module_config` 的 `module-deskModuleSearchBox` 里：
  首次以管理员身份进入首页时会自动迁移，迁移后写一次 `user_config.search_engine_json`
  作为「已迁移」标记，之后不再访问旧位置。
  （只有查旧配置的接口报错、或云端已有新结构配置时才不写标记；这两种情况都不需要迁移。）
- 旧数据结构里的 `newWindowOpen`（布尔）会自动转成 `openMethod`（0=当前页面 / 1=新窗口），
  缺失的 `id` 会自动补齐。

## 访客（公开）模式：本移植版不适用

上游在公开（访客）模式下允许切换搜索引擎与打开方式，且只在本次访问生效。
本移植版是**单用户版本，没有公开模式**（见根 README 与 [deployment.md](./deployment.md)
的「与上游的差异」表）：后端 `POST /api/user/getAuthInfo` 固定返回 `visitMode: 0`
（`src/api/system/user.ts:35`），前端的访客分支永远不会命中，
所以搜索框里切换引擎 / 打开方式都会正常写回云端配置。

代码中保留的访客判断属上游遗留逻辑，共有两处，都不会触发：

| 位置 | 内容 |
|------|------|
| `frontend/src/components/deskModule/SearchBox/index.vue:32,55,87` | `isVisitor` 分支：切换引擎/打开方式时不落库，以及提示文案 `visitorSwitchTip` |
| `frontend/src/views/home/index.vue:555` | 右下角「前往登录」按钮 |

保留原因：与本移植版其他位置的 `VisitMode` 判断保持一致，日后若补上公开模式可直接生效。
若确认不再需要，可以连同上述代码与 `deskModule.searchEngine.visitorSwitchTip` 文案一起删除。

## 自检脚本

`scratch/` 下有不依赖测试框架的自检脚本，用于验证纯逻辑与后端合并语义
（在仓库根目录执行）：

```bash
# 搜索引擎工具函数：占位符替换、模板推导、校验（含校验文案 key 与 locales 对齐）、旧数据归一化
node_modules/.bin/esbuild scratch/search-engine-util.test.ts \
  --bundle --platform=node --format=cjs --outfile=scratch/out.cjs \
  --loader:.svg=text --log-level=warning
node scratch/out.cjs

# userConfig/set 的字段合并语义（内存版 D1 + 真实 HTTP 调用）
node_modules/.bin/esbuild scratch/user-config-merge.test.ts \
  --bundle --platform=node --format=esm --outfile=scratch/merge.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;"
node scratch/merge.mjs

# i18n key 审计：缺失 key（会直接显示原始 key）/ 中英不齐 / 死文案
node_modules/.bin/esbuild scratch/i18n-audit.ts \
  --bundle --platform=node --format=cjs --outfile=scratch/i18n-audit.cjs --log-level=warning
node scratch/i18n-audit.cjs
```

三个脚本都是自包含的，退出码非 0 表示有用例失败
（前两个当前实测：`53 passed, 0 failed` 与 `16 passed, 0 failed`）。

### i18n 审计脚本说明

`scratch/i18n-audit.ts` 会扫描 `frontend/src` 里所有 `t(...)` / `$t(...)` 的字面量 key，
与 `zh-CN.json` / `en-US.json` 对比后输出四类结果：

- **使用了但 locale 缺失**：这类 key 会被 vue-i18n 原样显示给用户
- **中英两侧不齐**：只有一侧存在的 key
- **死文案**：两侧都有但代码里没有任何引用
- **命名空间明细**：`deskModule.searchBox.*` 与 `deskModule.searchEngine.*` 的条数与死文案

已知局限：key 存在变量里再传给 `t()` 的调用（如校验错误文案、`apiErrorCode.${code}`）
无法静态解析，会被统计成「死文案」。因此 `deskModule.searchEngine.*` 下
5 个校验文案出现在死文案列表里属正常现象 —— 工具函数 `validateSearchEngine` 的返回值
在 `frontend/src/components/apps/Style/SearchEngineSettings.vue` 里通过
`t(result.titleError)` 翻译。**这正是引入该审计脚本的原因**：这 5 个 key 曾因前缀写成
`deskModule.searchBox.*` 而真的取不到文案，只能靠「两侧都有却无人引用」这个信号暴露出来。
