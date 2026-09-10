# 搜索引擎设置使用说明

搜索框的搜索引擎不再在搜索框弹层里维护，配置入口统一在
**首页 → 应用启动器 → 风格设置 → 「搜索栏组件」卡片底部的搜索引擎管理区**。

## 功能一览

| 功能 | 说明 |
|------|------|
| 添加 / 编辑 / 删除 | 表单带校验（名称必填 ≤20 字、地址必须是 http(s)、图标地址格式校验）与重名/重复地址拦截 |
| 拖拽排序 | 点「排序」进入拖拽模式，列表顺序即搜索框中的展示顺序，点「保存排序」退出 |
| 设为当前 | 点击列表项即可切换当前使用的搜索引擎（绿色边框 + 勾选标记） |
| 恢复内置引擎 | 把缺失的 Google / 百度 / Bing 补进列表，已存在的不重复添加 |
| 重置为默认 | 二次确认后清空自定义引擎并恢复内置三项 |
| 打开方式 | 「新窗口打开」开关，配置在管理区底部，搜索框弹层里也能临时切换 |
| 图标回退 | 未填图标时自动尝试站点 `/favicon.ico` → Google favicon → 内置 svg → 名称首字母，不会再出现破图 |

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
（`q` / `wd` / `word` / `query` / `keyword` / `kw` / `search_query` / `text` / `p` / `s` / `k`）；
再找不到就取第一个参数。

## 存储与兼容

- 配置存放在 D1 的 `user_config.search_engine_json`（与面板配置同一行、同一接口）。
- `POST /api/panel/userConfig/set` 支持只提交 `panel` 或 `searchEngine`，未提交的字段保留原值，
  因此「改样式」不会再清空搜索引擎配置。
- 老版本把引擎存在 `module_config` 的 `module-deskModuleSearchBox` 里：
  首次以管理员身份进入首页时会自动迁移，迁移后写一次 `user_config.search_engine_json`
  作为「已迁移」标记，之后不再访问旧位置。
- 旧数据结构里的 `newWindowOpen`（布尔）会自动转成 `openMethod`（0=当前页面 / 1=新窗口），
  缺失的 `id` 会自动补齐。

## 访客（公开）模式

访客可以切换搜索引擎与打开方式，但**只在本次访问生效**，不会写入云端配置；
刷新页面后回到管理员配置的默认项。

## 自检脚本

`scratch/` 下有两个不依赖测试框架的自检脚本，用于验证纯逻辑与后端合并语义：

```bash
# 搜索引擎工具函数：占位符替换、模板推导、校验、旧数据归一化
node_modules/.bin/esbuild scratch/search-engine-util.test.ts \
  --bundle --platform=node --format=cjs --outfile=scratch/out.cjs \
  --loader:.svg=text --log-level=warning
node scratch/out.cjs

# userConfig/set 的字段合并语义（内存版 D1 + 真实 HTTP 调用）
node_modules/.bin/esbuild scratch/user-config-merge.test.ts \
  --bundle --platform=node --format=esm --outfile=scratch/merge.mjs --log-level=warning \
  --banner:js="import{webcrypto}from'node:crypto';globalThis.crypto??=webcrypto;"
node scratch/merge.mjs
```

两个脚本都是自包含的，退出码非 0 表示有用例失败。
