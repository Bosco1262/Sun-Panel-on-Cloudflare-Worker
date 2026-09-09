import { Hono } from 'hono'
import type { Env } from '../../types'
import { successData } from '../../utils/response'

const app = new Hono<{ Bindings: Env }>()

// 版本信息 (对应 Go 版读取 assets/version 文件: "10|1.3.0")
app.post('/about', async (c) => successData(c, {
  versionName: '1.3.0',
  versionCode: 10,
}))

export default app
