import { Hono } from 'hono'
import type { Env } from '../types'
import { error, successData } from '../utils/response'
import {
  SETTING_DISCLAIMER,
  SETTING_WEB_ABOUT_DESCRIPTION,
  getSetting,
  getSettingJson,
  setSetting,
} from '../utils/settings'

export interface ApplicationSetting {
  loginCaptcha?: boolean
  register?: {
    emailSuffix?: string
    openRegister?: boolean
  }
  webSiteUrl?: string
}

const app = new Hono<{ Bindings: Env }>()

// 登录页配置
app.get('/loginConfig', async (c) => {
  const cfg = await getSettingJson<ApplicationSetting>(
    c.env.DB,
    'system_application',
    { loginCaptcha: false, register: { emailSuffix: '', openRegister: false }, webSiteUrl: '' },
  )
  return successData(c, {
    loginCaptcha: cfg.loginCaptcha ?? false,
    register: cfg.register ?? { emailSuffix: '', openRegister: false },
  })
})

// 免责声明
app.get('/getDisclaimer', async (c) => {
  const content = await getSetting(c.env.DB, SETTING_DISCLAIMER)
  if (content === null) {
    await setSetting(c.env.DB, SETTING_DISCLAIMER, '')
    return successData(c, '')
  }
  return successData(c, content)
})

// 关于页描述
app.get('/getAboutDescription', async (c) => {
  const content = await getSetting(c.env.DB, SETTING_WEB_ABOUT_DESCRIPTION)
  if (content === null) {
    await setSetting(c.env.DB, SETTING_WEB_ABOUT_DESCRIPTION, '')
    return successData(c, '')
  }
  return successData(c, content)
})

// 无对应 GET 接口, 兜底
app.post('*', c => error(c, 'Not found'))

export default app
