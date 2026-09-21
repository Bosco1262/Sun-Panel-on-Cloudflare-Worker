import { Hono } from 'hono'
import type { Env } from '../../types'
import { successData } from '../../utils/response'
import { version } from '../../../package.json'

const app = new Hono<{ Bindings: Env }>()

// 版本信息 (对应 Go 版读取 assets/version 文件: "10|1.3.0")
// versionName 统一取自根 package.json, 避免与 package.json / 前端 VITE_APP_VERSION 三处各写一份
app.post('/about', async (c) => successData(c, {
  versionName: version,
  versionCode: 10,
}))

export default app
