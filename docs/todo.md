# 移植待办 / 需求清单

> 来源：移植过程中陆续收集的需求（原 `原项目/移植项目仍存在问题.txt`，该目录已改名为 `reference/upstream-sun-panel/`）。
> 「状态」一栏按当前代码核对得出，执行前请再确认一次。

## 批次一

| # | 需求 | 状态 |
|---|------|------|
| 1 | 「我的信息」重构为三个区域：**账号**区放「用户名」（合并原「账号」与「昵称」，去掉「编辑」按钮）、分隔线、**修改登录信息**（原「修改密码」，弹窗顶部增加用户名输入且不能为空）；**设置**区放原「语言」「主题」；底部「退出登录」。区域名使用与风格设置中「LOGO」一致的字体 | 已实现<br>`frontend/src/components/apps/UserInfo/index.vue`（用户名 / 密码更新已拆分为独立流程） |
| 2 | 导入导出中移除「浏览器书签转换工具」 | 已实现（前端已无相关代码） |

## 批次二

| # | 需求 | 状态 |
|---|------|------|
| 1 | 自定义页脚的默认链接与名称改为 `https://github.com/Bosco1262/Sun-Panel-on-Cloudflare-Worker` 和 `Sun-Panel-on-Cloudflare-Worker` | 已实现<br>`frontend/src/store/modules/moduleConfig/helper.ts` |
| 2 | 上传文件管理中图片的背景太花，需减少 50% 透明度 | 待确认（当前棋盘格为 `rgba(0, 0, 0, 0.03)`；上游无此背景，为移植版新增） |
| 3 | 调整新建的布局 | 待确认（需求描述较模糊，需补充具体要求） |

## 批次三

| # | 需求 | 状态 |
|---|------|------|
| 1 | 重新设计「搜索引擎设置」：入口移到「风格设置 → 搜索栏组件」，做成完整管理区（增删改 / 拖拽排序 / 设为当前 / 恢复内置 / 重置 / 实时预览）；搜索框弹层只保留切换与新窗口开关 | 已实现<br>`frontend/src/components/apps/Style/SearchEngineSettings.vue`、`frontend/src/components/deskModule/SearchBox/index.vue`，详见 [search-engine.md](./search-engine.md) |
| 2 | 关键词占位不再强制 `%s`，兼容 `%s` / `{keyword}` / `{q}`，无占位符时自动追加，并支持粘贴真实搜索网址自动推导模板 | 已实现<br>`frontend/src/utils/searchBox/index.ts` |
| 3 | 搜索引擎配置从 `module_config` 迁移到 `user_config.search_engine_json`，并修复「改样式会清空搜索引擎配置」的 bug | 已实现<br>`src/api/panel/userConfig.ts`（未提交字段保留原值）、`frontend/src/store/modules/panel/index.ts`（含旧数据自动迁移） |
