import { Hono } from 'hono'
import type { Env } from '../../types'
import { successData } from '../../utils/response'
import { REQUEST_BODY_LIMIT, bodyLimit } from '../../utils/bodyLimit'
import { version } from '../../../package.json'

const app = new Hono<{ Bindings: Env }>()

// Version information (mirrors the Go version reading the assets/version file: "10|1.3.0")
// versionName always comes from the root package.json so it is not written in three places
// (package.json / the frontend VITE_APP_VERSION / here).
//
// 版本信息 (对应 Go 版读取 assets/version 文件: "10|1.3.0")
// versionName 统一取自根 package.json, 避免与 package.json / 前端 VITE_APP_VERSION 三处各写一份
app.post('/about', bodyLimit(REQUEST_BODY_LIMIT.small), async (c) => successData(c, {
  versionName: version,
  versionCode: 10,
}))

export default app
