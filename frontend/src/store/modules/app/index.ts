import { defineStore } from 'pinia'
import type { AppState, Language, Theme } from './helper'
import { defaultSetting, getLocalSetting, removeLocalState, setLocalSetting } from './helper'

export const useAppStore = defineStore('app-store', {
  state: (): AppState => getLocalSetting(),
  actions: {
    setTheme(theme: Theme) {
      this.theme = theme
      this.recordState()
    },

    setLanguage(language: Language) {
      if (this.language !== language) {
        this.language = language
        this.recordState()
      }
    },

    recordState() {
      setLocalSetting(this.$state)
    },

    /**
     * Resets to the default settings and clears the local cache (called on logout)
     *
     * 重置为默认设置并清掉本地缓存 (登出时调用)
     */
    resetAppSetting() {
      this.$state = defaultSetting()
      removeLocalState()
    },
  },
})
