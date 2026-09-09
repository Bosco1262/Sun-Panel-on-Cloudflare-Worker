import { Hono } from 'hono'
import type { Env } from '../types'
// 公开 / 登录 / 通知 (顶层路由)
import openness from './openness'
import login from './login'
import notice from './notice'
// 面板管理 (对应前端 src/api/panel/)
import itemIcon from './panel/itemIcon'
import itemIconGroup from './panel/itemIconGroup'
import userConfig from './panel/userConfig'
// 系统管理 (对应前端 src/api/system/)
import about from './system/about'
import file from './system/file'
import moduleConfig from './system/moduleConfig'
import systemSetting from './system/setting'
import user from './system/user'

const app = new Hono<{ Bindings: Env }>()

// 开放接口
app.route('/openness', openness)

// 登录/登出/版本
app.route('/', login)
app.route('/', about)

// 用户
app.route('/', user)

// 通知
app.route('/', notice)

// 面板管理
app.route('/panel', itemIcon)
app.route('/panel', itemIconGroup)
app.route('/panel', userConfig)

// 系统管理
app.route('/system', moduleConfig)
app.route('/system', systemSetting)

// 文件
app.route('/', file)

export default app
