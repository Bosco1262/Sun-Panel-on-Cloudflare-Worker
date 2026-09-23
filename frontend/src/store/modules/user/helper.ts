import { ss } from '@/utils/storage'

const LOCAL_NAME = 'userStorage'

export interface UserState {
  userInfo: User.Info
}

export function defaultSetting(): UserState {
  return {
    userInfo: {
      // The nickname stays empty until the user info arrives; the UI decides the fallback (the old implementation used a '-- --' placeholder)
      // 昵称在拉取到用户信息前保持空, 由 UI 决定回退展示 (旧实现是 '-- --' 占位)
      name: '',
    },
  }
}

export function getLocalState(): UserState {
  const localSetting: UserState | undefined = ss.get(LOCAL_NAME)
  return { ...defaultSetting(), ...localSetting }
}

export function setLocalState(setting: UserState): void {
  ss.set(LOCAL_NAME, setting)
}
