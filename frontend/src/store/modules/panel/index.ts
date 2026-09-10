import { defineStore } from 'pinia'
import { defaultState, defaultStatePanelConfig, getLocalState, removeLocalState, setLocalState } from './helper'
import { router } from '@/router'
import type { PanelStateNetworkModeEnum } from '@/enums'
import { get as getUserConfig, set as setUserConfig } from '@/api/panel/userConfig'
import { getValueByName as getModuleConfigByName } from '@/api/system/moduleConfig'
import {
  SEARCH_BOX_LEGACY_MODULE_NAME,
  createDefaultSearchEngineConfig,
  hasStoredSearchEngineConfig,
  normalizeSearchEngineConfig,
} from '@/utils/searchBox'

// 旧版搜索引擎配置迁移只在一次会话里尝试一次, 避免每次进首页都多打一个请求
let legacyEngineMigrated = false

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

    /**
     * 从旧的 module_config(deskModuleSearchBox) 迁移搜索引擎配置
     *
     * 只在云端还没有新结构配置时执行一次:
     * - 旧数据里有用户改过的引擎 -> 迁移过来
     * - 否则写入一次默认配置, 让 engineList 字段成为「已迁移」标记, 之后不再查询旧位置
     *
     * 该接口需要登录态, 调用方需自行判断 (见 views/home/index.vue)。
     */
    async migrateLegacySearchEngine() {
      if (legacyEngineMigrated)
        return
      legacyEngineMigrated = true

      try {
        const { code, data } = await getModuleConfigByName<Record<string, unknown>>(
          `module-${SEARCH_BOX_LEGACY_MODULE_NAME}`,
        )
        // 云端已有新结构配置 (含用户主动清空的情况) 时不迁移, 避免把删掉的引擎又找回来
        if (code !== 0 || !data || hasStoredSearchEngineConfig(data))
          return

        const legacyList = Array.isArray((data as Record<string, unknown>).searchEngineList)
          ? (data as Record<string, unknown>).searchEngineList as unknown[]
          : []
        if (legacyList.length > 0)
          this.searchEngine = normalizeSearchEngineConfig(data)

        // 无论是否迁移到旧数据, 都落一次库作为「已迁移」标记
        this.recordState()
        await this.saveSearchEngine()
      }
      catch {
        // 迁移失败不影响正常使用, 下次进首页会重试
        legacyEngineMigrated = false
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
