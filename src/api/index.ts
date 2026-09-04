import { Hono } from 'hono'
import type { Env } from '../types'
import openness from './openness'
import login from './login'
import about from './about'
import user from './user'
import notice from './notice'
import itemIcon from './itemIcon'
import itemIconGroup from './itemIconGroup'
import userConfig from './userConfig'
import moduleConfig from './moduleConfig'
import file from './file'

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

// 文件
app.route('/', file)

export default app
