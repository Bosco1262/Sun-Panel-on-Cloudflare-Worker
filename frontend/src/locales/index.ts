import type { App } from 'vue'
import { createI18n } from 'vue-i18n'
import enUS from './en-US.json'
import zhCN from './zh-CN.json'

/**
 * Languages currently supported (a new language must also update naive-ui's locale mapping and languageOptions)
 *
 * 当前支持的语言 (新增语言时需同步 naive-ui 的 locale 映射与 languageOptions)
 */
export type Locale = 'zh-CN' | 'en-US'

const defaultLocale: Locale = 'zh-CN'

const i18n = createI18n({
  locale: defaultLocale,
  fallbackLocale: defaultLocale,
  allowComposition: true,
  messages: {
    'en-US': enUS,
    'zh-CN': zhCN,
  },
})

export const t = i18n.global.t

// The store is deliberately not imported here, so no circular dependency can form with it
// 这里刻意不引 store, 避免与 store 形成循环依赖
export function setLocale(locale: Locale) {
  i18n.global.locale = locale
}

export function setupI18n(app: App) {
  app.use(i18n)
}

export default i18n
