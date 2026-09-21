import { ss } from '@/utils/storage'

const LOCAL_NAME = 'appSetting'

export type Theme = 'light' | 'dark' | 'auto'

export type Language = 'zh-CN' | 'en-US'

export interface AppState {
  theme: Theme
  language: Language
}

export function defaultSetting(): AppState {
  // navigator 在非浏览器环境 (SSR / 单测) 不存在, 直接取会 ReferenceError
  const lan = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase()
  const language: Language = lan.includes('zh') ? 'zh-CN' : 'en-US'

  return { theme: 'auto', language }
}

export function getLocalSetting(): AppState {
  const localSetting: AppState | undefined = ss.get(LOCAL_NAME)
  return { ...defaultSetting(), ...localSetting }
}

export function setLocalSetting(setting: AppState): void {
  ss.set(LOCAL_NAME, setting)
}

export function removeLocalState() {
  ss.remove(LOCAL_NAME)
}
