# 更新说明（上游）

> 本文件为上游 [hslr-s/sun-panel](https://github.com/hslr-s/sun-panel) 的更新日志存档，
> 内容与上游仓库根目录的 `UPDATELOG.md` 一致，**只到 v1.1.0**（上游把 v1.2.0 起的日志放在了文档站：
> [正式版更新日志](https://doc.sun-panel.top/zh_cn/update/update_log.html)，最新发布版本 v1.8.1）。
> 本仓库（Cloudflare Worker 移植版）的改动请看 `git log`；上游原版 README 见 [README.md](./README.md)。

> 老用户版本升级需要看升级说明，并且一定提前备份好重要数据。新用户可以直接使用最新版本。


## v1.1.0
> 支持上个版本直接升级无需特殊处理

- [新增] 增加分组，拖拽排序
- [新增] 搜索框
- [新增] 应用图标支持URL外链
- [新增] 图标支持纯透明
- [新增] 壁纸背景增加遮罩设置
- [新增] 右键菜单新增打开局域网或者互联网地址
- [优化] 网址输入框增加https/http提示
- [优化] 小图标模式，鼠标悬浮显示详情，支持隐藏图标标题
- [优化] 详情图标样式，支持隐藏描述信息
- [优化] 添加用户密码时限制字符
- [其他] 新增arm版本docker支持。[DockerHub](https://hub.docker.com/r/hslr/sun-panel)直接拉取即可
- [其他] 新增多平台二进制文件运行。[Releases](https://github.com/hslr-s/sun-panel/releases)

## v1.0.0
- 首个版本