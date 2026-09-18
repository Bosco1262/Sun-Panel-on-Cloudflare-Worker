import { defineStore } from 'pinia'
import { defaultState, defaultStatePanelConfig, getLocalState, removeLocalState, setLocalState } from './helper'
import { router } from '@/router'
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
    setLeftSiderCollapsed(Collapsed: boolean) {
      this.leftSiderCollapsed = Collapsed
      // this.recordState()
    },

    setRightSiderCollapsed(Collapsed: boolean) {
      this.rightSiderCollapsed = Collapsed
      // this.recordState()
    },

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
      }
      else {
        this.resetPanelConfig() // 重置恢复默认
        this.recordState()
      }
    },

    /** 保存搜索引擎配置 (与面板配置一并提交, 避免互相覆盖) */
    async saveSearchEngine() {
      return await setUserConfig({
        panel: this.panelConfig,
        searchEngine: this.searchEngine,
      })
    },

    /** 保存面板配置 (与搜索引擎配置一并提交, 避免互相覆盖) */
    async savePanelConfig() {
      return await setUserConfig({
        panel: this.panelConfig,
        searchEngine: this.searchEngine,
      })
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

    // async refreshSpaceNoteList(spaceId: string) {
    //   await getListBySpaceNoteId<Common.ListResponse<SNote.InfoTree[]>>(spaceId).then((res) => {
    //     this.notesList = res.data.list
    //   })
    // },

    async reloadRoute(id?: number) {
      // this.recordState()
      await router.push({ name: 'AppletDialog', params: { aiAppletId: id } })
    },

    recordState() {
      setLocalState(this.$state)
    },

    removeState() {
      removeLocalState()
    },
  },
})
