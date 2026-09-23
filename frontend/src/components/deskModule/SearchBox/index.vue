<script setup lang="ts">
import { computed, ref } from 'vue'
import { NCheckbox, useMessage } from 'naive-ui'
import { SearchEngineIcon, SvgIcon } from '@/components/common'
import { useAuthStore, usePanelState } from '@/store'
import { VisitMode } from '@/enums/auth'
import { SearchEngineOpenMethodEnum } from '@/enums/panel'
import { buildSearchUrl, createDefaultEngines } from '@/utils/searchBox'
import { reportThrownError } from '@/utils/request/apiMessage'

const props = withDefaults(defineProps<{
  background?: string
  textColor?: string
  borderColor?: string
  placeholderColor?: string
}>(), {
  background: '#2a2a2a6b',
  textColor: 'white',
  borderColor: '',
  placeholderColor: '',
})

const emits = defineEmits(['itemSearch'])

const authStore = useAuthStore()
const panelState = usePanelState()
const ms = useMessage()

const searchTerm = ref('')
const isFocused = ref(false)
const panelShow = ref(false)

// Visitor mode: allows switching the search engine for this visit only, without writing to the cloud config
// 访客模式: 允许本次访问临时切换搜索引擎, 但不写入云端配置
const isVisitor = computed(() => authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC)

const engineList = computed<DeskModule.SearchBox.SearchEngine[]>(() => {
  if (panelState.searchEngineList.length > 0)
    return panelState.searchEngineList
  // Fallback for when the administrator deleted every engine: the search box still works
  // 管理端把引擎全部删掉时的兜底: 搜索框仍然可用
  return createDefaultEngines()
})

const currentEngine = computed<DeskModule.SearchBox.SearchEngine>(() => {
  const list = engineList.value
  return list.find(engine => engine.id === panelState.searchEngine?.currentEngineId)
    ?? list.find(engine => engine.id === panelState.currentSearchEngine?.id)
    ?? list[0]
})

/**
 * Saves the search-engine config (the panel config in the same row is submitted along with it); a failure only reports, without rolling back the local selection
 *
 * 保存搜索引擎配置 (同一行的面板配置会一并提交); 失败只提示, 不回滚本地选择
 */
function persistSearchEngine() {
  // A temporary switch in visitor mode is not persisted (in this port visitMode is always the logged-in mode, so this is an upstream leftover branch)
  // 访客模式的临时切换不落库 (本移植版 visitMode 恒为登录模式, 属上游遗留分支)
  if (isVisitor.value)
    return
  panelState.saveSearchEngine().catch(error => reportThrownError(error, text => ms.error(text), 'common.saveFail'))
}

const newWindowOpen = computed({
  get: () => panelState.searchEngine?.openMethod === SearchEngineOpenMethodEnum.newWindow,
  set: (value: boolean) => {
    if (!panelState.searchEngine)
      return
    panelState.searchEngine.openMethod = value ? SearchEngineOpenMethodEnum.newWindow : SearchEngineOpenMethodEnum.currentPage
    persistSearchEngine()
  },
})

// Theme colours are assembled here, so no magic attribute names appear in the template
// 主题色样式统一在这里拼, 避免模板里出现魔法属性名
const containerStyle = computed(() => {
  // A CSS custom property must be quoted; keeping it here also avoids triggering the quote-props rule
  // CSS 自定义属性必须带引号, 单独放在这里避免触发 quote-props 规则
  const cssVars = { '--sb-placeholder-color': props.placeholderColor || 'rgba(255, 255, 255, 0.6)' }
  return {
    background: props.background,
    color: props.textColor,
    borderColor: props.borderColor || '#cccccc',
    ...cssVars,
  }
})

const panelStyle = computed(() => ({ background: props.background }))
const textStyle = computed(() => ({ color: props.textColor }))

function handleEngineClick() {
  panelShow.value = !panelShow.value
}

function handleEngineSelect(engine: DeskModule.SearchBox.SearchEngine) {
  if (!panelState.searchEngine) {
    panelShow.value = false
    return
  }
  panelState.searchEngine.currentEngineId = engine.id
  panelShow.value = false
  panelState.recordState()
  persistSearchEngine()
}

function handleSearchClick() {
  const url = currentEngine.value?.url
  if (!url)
    return

  const fullUrl = buildSearchUrl(url, searchTerm.value.trim())
  if (!fullUrl)
    return

  handleClearSearchTerm()
  if (newWindowOpen.value)
    window.open(fullUrl, '_blank', 'noopener')
  else
    window.location.href = fullUrl
}

const handleItemSearch = () => {
  emits('itemSearch', searchTerm.value)
}

function handleClearSearchTerm() {
  searchTerm.value = ''
  emits('itemSearch', searchTerm.value)
}
</script>

<template>
  <div class="search-box w-full" @keydown.enter="handleSearchClick" @keydown.esc="handleClearSearchTerm">
    <div
      class="search-container flex rounded-2xl items-center justify-center text-white w-full"
      :style="containerStyle"
      :class="{ focused: isFocused }"
    >
      <div class="search-box-btn-engine w-[40px] flex justify-center cursor-pointer" @click="handleEngineClick">
        <SearchEngineIcon :icon-src="currentEngine?.iconSrc" :title="currentEngine?.title" :size="20" />
      </div>

      <input
        v-model="searchTerm"
        :placeholder="$t('deskModule.searchBox.inputPlaceholder')"
        @focus="isFocused = true"
        @blur="isFocused = false"
        @input="handleItemSearch"
      >

      <div v-if="searchTerm !== ''" class="search-box-btn-clear w-[25px] mr-[10px] flex justify-center cursor-pointer" @click="handleClearSearchTerm">
        <SvgIcon style="width: 20px;height: 20px;" icon="line-md:close-small" />
      </div>
      <div class="search-box-btn-search w-[25px] flex justify-center cursor-pointer" @click="handleSearchClick">
        <SvgIcon style="width: 20px;height: 20px;" icon="iconamoon:search-fill" />
      </div>
    </div>

    <!-- Search-engine selection: switching only; the configuration is managed in "Style Settings → Search bar component" -->
    <!-- 搜索引擎选择: 只做切换, 配置统一在「风格设置 → 搜索栏组件」里管理 -->
    <div v-if="panelShow" class="w-full mt-[10px] rounded-xl p-[10px]" :style="panelStyle">
      <div class="flex items-center flex-wrap gap-[10px]">
        <div
          v-for="item in engineList"
          :key="item.id"
          :title="item.title"
          class="w-[40px] h-[40px] cursor-pointer flex items-center justify-center rounded-xl border transition-colors"
          :class="item.id === currentEngine?.id
            ? 'border-[#18A058] bg-[#18A05833]'
            : 'border-white/20 bg-white/10 hover:border-[#18A05880]'"
          @click="handleEngineSelect(item)"
        >
          <SearchEngineIcon :icon-src="item.iconSrc" :title="item.title" :size="20" />
        </div>
      </div>

      <div v-if="panelState.searchEngineList.length === 0" class="mt-[6px] text-[12px] opacity-70" :style="textStyle">
        {{ $t('deskModule.searchBox.builtinEngineTip') }}
      </div>

      <div class="mt-[10px]">
        <NCheckbox v-model:checked="newWindowOpen">
          <span :style="textStyle">
            {{ $t('deskModule.searchBox.openWithNewOpen') }}
          </span>
        </NCheckbox>
      </div>

      <div v-if="isVisitor" class="mt-[6px] text-[12px] opacity-70" :style="textStyle">
        {{ $t('deskModule.searchEngine.visitorSwitchTip') }}
      </div>
      <div v-else class="mt-[6px] text-[12px] opacity-70" :style="textStyle">
        {{ $t('deskModule.searchEngine.manageTip') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-container {
  border: 1px solid #ccc;
  transition: box-shadow 0.5s,backdrop-filter 0.5s;
  padding: 2px 10px;
  backdrop-filter:blur(2px)
}

.focused, .search-container:hover {
  box-shadow: 0px 0px 30px -5px rgba(41, 41, 41, 0.45);
  -webkit-box-shadow: 0px 0px 30px -5px rgba(0, 0, 0, 0.45);
  -moz-box-shadow: 0px 0px 30px -5px rgba(0, 0, 0, 0.45);
  backdrop-filter:blur(5px)
}

.before {
  left: 10px;
}

.after {
  right: 10px;
}

input {
  background-color: transparent;
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 10px 5px;
  border: none;
  outline: none;
  font-size: 17px;
}

input::placeholder {
  color: var(--sb-placeholder-color, rgba(255, 255, 255, 0.6));
}
</style>
