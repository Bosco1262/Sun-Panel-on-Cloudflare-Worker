# 移植待办 / 需求清单

> 来源：移植过程中陆续收集的需求（原 `原项目/移植项目仍存在问题.txt`，该目录已改名为 `reference/upstream-sun-panel/`）。
> 「状态」一栏按当前代码核对得出，执行前请再确认一次。

## 批次一

| # | 需求 | 状态 |
|---|------|------|
| 1 | 「我的信息」重构为三个区域：**账号**区放「用户名」（合并原「账号」与「昵称」，去掉「编辑」按钮）、分隔线、**修改登录信息**（原「修改密码」，弹窗顶部增加用户名输入且不能为空）；**设置**区放原「语言」「主题」；底部「退出登录」。区域名使用与风格设置中「LOGO」一致的字体 | 部分实现<br>`frontend/src/components/apps/UserInfo/index.vue`：账号 / 设置两个卡片、退出登录置底、区域名字体与「LOGO」一致均已实现；但登录信息**未合并**——仍是独立的「修改用户名」与「修改密码」两个入口与弹窗，密码弹窗里没有用户名输入，「昵称」也不再展示 |
| 2 | 导入导出中移除「浏览器书签转换工具」 | 已实现（前端已无相关代码） |

## 批次二

| # | 需求 | 状态 |
|---|------|------|
| 1 | 自定义页脚的默认链接与名称改为 `https://github.com/Bosco1262/Sun-Panel-on-Cloudflare-Worker` 和 `Sun-Panel-on-Cloudflare-Worker` | 已实现<br>`frontend/src/store/modules/panel/helper.ts`（`defaultFooterHtml`） |
| 2 | 上传文件管理中图片的背景太花，需减少 50% 透明度 | 待确认（当前棋盘格为 `rgba(0, 0, 0, 0.03)`，位于 `frontend/src/components/apps/UploadFileManager/index.vue`；上游同样有 `.transparent-grid` 棋盘格（`#f0f0f0` / 16px），本移植版是修改了明度并在 `frontend/src/styles/global.less` 增加了白色变体） |
| 3 | 调整新建的布局 | 待确认（需求描述较模糊，需补充具体要求） |

## 批次三

| # | 需求 | 状态 |
|---|------|------|
| 1 | 重新设计「搜索引擎设置」：入口移到「风格设置 → 搜索栏组件」，做成完整管理区（增删改 / 拖拽排序 / 设为当前 / 恢复内置 / 重置 / 实时预览）；搜索框弹层只保留切换与新窗口开关 | 已实现<br>`frontend/src/components/apps/Style/SearchEngineSettings.vue`、`frontend/src/components/deskModule/SearchBox/index.vue`，详见 [search-engine.md](./search-engine.md)<br>校验提示的 i18n 命名空间问题已修（见下表） |
| 2 | 关键词占位不再强制 `%s`，兼容 `%s` / `{keyword}` / `{q}`，无占位符时自动追加，并支持粘贴真实搜索网址自动推导模板 | 已实现<br>`frontend/src/utils/searchBox/index.ts` |
| 3 | 搜索引擎配置从 `module_config` 迁移到 `user_config.search_engine_json`，并修复「改样式会清空搜索引擎配置」的 bug | 已实现<br>`src/api/panel/userConfig.ts`（未提交字段保留原值）、`frontend/src/store/modules/panel/index.ts`（含旧数据自动迁移） |

## 已修复（核对时发现，本轮已处理）

| # | 问题 | 处理 |
|---|------|------|
| 1 | 搜索引擎表单的校验提示显示为原始 key（如 `deskModule.searchBox.engineNameRequired`）：工具函数返回的 key 前缀是 `deskModule.searchBox.`，但文案只定义在 `deskModule.searchEngine.` 下 | 已修：`validateSearchEngine` 的 5 个 key 改为 `deskModule.searchEngine.*`；`scratch/search-engine-util.test.ts` 同步更新断言，并新增「5 个校验文案在 zh-CN / en-US 里都存在」的用例（两侧 53 passed） |
| 2 | 弹层管理 UI 移除后遗留了不再被引用的文案 key（`deskModule.searchBox.engineName/engineUrl/engineIconUrl/engineDeleteLastWarning/engineFormIncomplete/searchEngineManage`、`deskModule.searchEngine.sortTip`），其中拖拽提示「拖动调整搜索框中的展示顺序」实际从不显示 | 已修：7 个死文案已从 `zh-CN.json` / `en-US.json` 删除；`deskModule.searchBox.*` 与 `deskModule.searchEngine.*` 现无死文案。若之后要把「拖动排序」提示显示出来，需重新加回 `searchEngine.sortTip` 并在模板里引用 |
| 3 | 代码块「复制」按钮的文案 key `chat.copyCode` 在 locale 中不存在，界面上会显示原始 key（**初始提交即存在，非搜索引擎改造引入**） | 已修：新增 `chat.copyCode`（`复制` / `Copy`）。由 `scratch/i18n-audit.ts` 发现，现全量审计为「缺失 0 / 中英不齐 0」 |

## 已知问题（核对时发现，待修）

| # | 问题 | 位置 |
|---|------|------|
| — | 暂无（`scratch/i18n-audit.ts` 目前报缺失 0、中英不齐 0；57 条死文案均属上游遗留的未使用命名空间，如 `adminSettingUsers.*`、`common.*`，与本轮改造无关） | — |
