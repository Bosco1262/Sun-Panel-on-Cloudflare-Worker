import type { AuthState } from './index'
import { ss } from '@/utils/storage'

const LOCAL_NAME = 'AUTH_TOKEN'

export function setStorage(state: AuthState) {
  // token 不落盘 (改进计划 §9.4): 会话由 HttpOnly Cookie 承担 ——
  // localStorage 里的 token 一旦页面存在 XSS (例如自定义 JS) 就会被直接读走。
  // 内存里仍保留 token, 用于同一会话内 Cookie 不可用时的请求头回退。
  return ss.set(LOCAL_NAME, { ...state, token: null })
}

export function getStorage(): AuthState | null {
  return ss.get(LOCAL_NAME)
}

export function removeToken() {
  return ss.remove(LOCAL_NAME)
}
