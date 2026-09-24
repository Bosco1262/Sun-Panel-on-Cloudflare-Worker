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
    // Search engines saved in the cloud/locally (may be empty = the user cleared them on purpose)
    // 云端/本地已保存的搜索引擎列表 (可能为空 = 用户主动清空)
    searchEngineList(state): DeskModule.SearchBox.SearchEngine[] {
      return state.searchEngine?.engineList ?? []
    },

    /**
     * Currently selected search engine
     * Falls back to the built-in default engine when the list is empty, so the search box always works
     *
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
     * Loads the panel config and the search-engine config from the cloud
     * Note: both live in the same user_config row, so saving must submit them together or they overwrite each other
     *
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

      // Only "the cloud has no record yet" (-1) resets to the defaults. Any other code must keep the locally
      // cached config — the old implementation wiped the user's configuration together with the local cache.
      //
      // 只有「云端尚无记录」(-1) 才重置为默认。其它错误码必须保留本地缓存配置 ——
      // 旧实现会把用户配置连同本地缓存一起清掉
      if (res.code === -1) {
        this.resetPanelConfig()
        this.recordState()
        return
      }

      // Every response reaching this line as a normal value was already surfaced by the request layer:
      // 1000/1001 redirect to /login, 1005 warns, every translated code gets a dialog there. Reporting the
      // same failure again would push a second toast through a separate message container (the discrete API
      // vs the app's provider) — both render fixed at the same viewport position, so the two overlap and only
      // one stays readable. Failures with no surfacing at all (unknown code / non-JSON body) never reach this
      // line: the request layer rejects them, and the caller's catch (panelHome.getConfigFail) remains the
      // sole user-visible signal.
      //
      // 能以正常值走到这一行的响应都已被请求层上报: 1000/1001 会跳登录页, 1005 有 warning, 有译文的码有弹窗。
      // 同一次失败再报一遍, 会经另一个独立的消息容器 (discrete API 与应用的 provider) 弹出第二条 ——
      // 两者都固定渲染在视口同一位置, 互相重叠, 只剩一条可读。
      // 完全未被上报过的失败 (未知 code / 非 JSON 响应) 走不到这里: 请求层会 reject,
      // 调用方的 catch (panelHome.getConfigFail) 仍是唯一的用户可见信号。
      return
    },

    /**
     * The panel config and the search-engine config share the user_config row, so every save submits both,
     * otherwise an unsubmitted field could be overwritten (see the merge logic in src/api/panel/userConfig.ts)
     *
     * 面板配置与搜索引擎配置同属 user_config 一行数据, 任何保存都要一起提交,
     * 否则未提交字段可能被覆盖 (见 src/api/panel/userConfig.ts 的保留逻辑)
     */
    async persistUserConfig() {
      return await setUserConfig({
        panel: this.panelConfig,
        searchEngine: this.searchEngine,
      })
    },

    /**
     * Saves the search-engine config (submitted together with the panel config so they cannot overwrite each other)
     *
     * 保存搜索引擎配置 (与面板配置一并提交, 避免互相覆盖)
     */
    async saveSearchEngine() {
      return await this.persistUserConfig()
    },

    /**
     * Saves the panel config (submitted together with the search-engine config so they cannot overwrite each other)
     *
     * 保存面板配置 (与搜索引擎配置一并提交, 避免互相覆盖)
     */
    async savePanelConfig() {
      return await this.persistUserConfig()
    },

    /**
     * Resets the search engines to the built-in defaults (name/url/icon/order/current selection)
     *
     * 重置搜索引擎为内置默认值 (含名称/地址/图标/顺序/当前选中项)
     */
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
