import { defineStore } from 'pinia'
import { defaultState, defaultStatePanelConfig, getLocalState, removeLocalState, setLocalState } from './helper'
import type { PanelStateNetworkModeEnum } from '@/enums'
import { get as getUserConfig, set as setUserConfig } from '@/api/panel/userConfig'
import {
  createDefaultSearchEngineConfig,
  normalizeSearchEngineConfig,
} from '@/utils/searchBox'

export const usePanelState = defineStore('panel', {
  state: (): Panel.State => getLocalState() || defaultState(),

  getters: {
    // 云端/本地已保存的搜索引擎列表 (可能为空 = 用户主动清空)
    searchEngineList(state): DeskModule.SearchBox.SearchEngine[] {
      return state.searchEngine?.engineList ?? []
    },

    /**
     * 当前选中的搜索引擎
     * 列表为空时回退到内置默认引擎, 保证搜索框永远可用
     */
    currentSearchEngine(state): DeskModule.SearchBox.SearchEngine | null {
      const list = state.searchEngine?.engineList ?? []
      if (list.length === 0)
        return createDefaultSearchEngineConfig().engineList[0]
      return list.find(engine => engine.id === state.searchEngine?.currentEngineId) ?? list[0]
    },
  },

  actions: {
    setNetworkMode(mode: PanelStateNetworkModeEnum) {
      this.networkMode = mode
      this.recordState()
    },

    /**
     * 获取云端的面板配置与搜索引擎配置
     * 注意: 二者同属 user_config 一行数据, 保存时必须一起提交, 否则会互相覆盖
     */
    async updatePanelConfigByCloud() {
      const res = await getUserConfig<Panel.userConfig>()
      if (res.code === 0) {
        this.panelConfig = { ...defaultStatePanelConfig(), ...res.data.panel }
        this.searchEngine = normalizeSearchEngineConfig(res.data.searchEngine)
        this.recordState()
        return
      }

      // 只有「云端尚无记录」(-1) 才重置为默认。
      // 其它错误码 (1200 数据库错误等) 必须保留本地缓存配置 —— 旧实现会把用户配置
      // 连同本地缓存一起清掉, 并抛给调用方以便提示
      if (res.code === -1) {
        this.resetPanelConfig()
        this.recordState()
        return
      }

      throw new Error(res.msg || 'get user config failed')
    },

    /**
     * 面板配置与搜索引擎配置同属 user_config 一行数据, 任何保存都要一起提交,
     * 否则未提交字段可能被覆盖 (见 src/api/panel/userConfig.ts 的保留逻辑)
     */
    async persistUserConfig() {
      return await setUserConfig({
        panel: this.panelConfig,
        searchEngine: this.searchEngine,
      })
    },

    /** 保存搜索引擎配置 (与面板配置一并提交, 避免互相覆盖) */
    async saveSearchEngine() {
      return await this.persistUserConfig()
    },

    /** 保存面板配置 (与搜索引擎配置一并提交, 避免互相覆盖) */
    async savePanelConfig() {
      return await this.persistUserConfig()
    },

    /** 重置搜索引擎为内置默认值 (含名称/地址/图标/顺序/当前选中项) */
    async resetSearchEngine() {
      this.searchEngine = createDefaultSearchEngineConfig()
      this.recordState()
      return await this.saveSearchEngine()
    },

    resetPanelConfig() {
      this.panelConfig = defaultStatePanelConfig()
    },

    recordState() {
      setLocalState(this.$state)
    },

    removeState() {
      removeLocalState()
    },
  },
})
