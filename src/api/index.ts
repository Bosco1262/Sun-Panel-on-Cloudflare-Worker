import { Hono } from 'hono'
import type { Env } from '../types'
// Login (top-level route)
// 登录 (顶层路由)
import login from './login'
// Panel management (mirrors the frontend src/api/panel/)
// 面板管理 (对应前端 src/api/panel/)
import itemIcon from './panel/itemIcon'
import itemIconGroup from './panel/itemIconGroup'
import userConfig from './panel/userConfig'
// System management (mirrors the frontend src/api/system/)
// 系统管理 (对应前端 src/api/system/)
import about from './system/about'
import file from './system/file'
import systemSetting from './system/setting'
import user from './system/user'

const app = new Hono<{ Bindings: Env }>()

// Login / logout / version
// 登录/登出/版本
app.route('/', login)
app.route('/', about)

// User
// 用户
app.route('/', user)

// Panel management
// 面板管理
app.route('/panel', itemIcon)
app.route('/panel', itemIconGroup)
app.route('/panel', userConfig)

// System management
// 系统管理
app.route('/system', systemSetting)

// Files
// 文件
app.route('/', file)

export default app
