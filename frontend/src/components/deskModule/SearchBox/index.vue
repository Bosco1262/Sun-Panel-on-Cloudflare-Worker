<script setup lang="ts">
import { defineEmits, onMounted, ref } from 'vue'
import { NAvatar, NButton, NCheckbox, NInput, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useModuleConfig } from '@/store/modules'
import { useAuthStore } from '@/store'
import { VisitMode } from '@/enums/auth'
import { t } from '@/locales'

import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

withDefaults(defineProps<{
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

interface State {
  currentSearchEngine: DeskModule.SearchBox.SearchEngine
  searchEngineList: DeskModule.SearchBox.SearchEngine[]
  newWindowOpen: boolean
}

const moduleConfigName = 'deskModuleSearchBox'
const moduleConfig = useModuleConfig()
const authStore = useAuthStore()
const ms = useMessage()
const searchTerm = ref('')
const isFocused = ref(false)
const searchSelectListShow = ref(false)
const engineManageShow = ref(false)
const defaultSearchEngineList = ref<DeskModule.SearchBox.SearchEngine[]>([
  {
    iconSrc: SvgSrcGoogle,
    title: 'Google',
    url: 'https://www.google.com/search?q=%s',
  },
  {
    iconSrc: SvgSrcBaidu,
    title: 'Baidu',
    url: 'https://www.baidu.com/s?wd=%s',
  },
  {
    iconSrc: SvgSrcBing,
    title: 'Bing',
    url: 'https://www.bing.com/search?q=%s',
  },
])

const defaultState: State = {
  currentSearchEngine: defaultSearchEngineList.value[0],
  searchEngineList: defaultSearchEngineList.value,
  newWindowOpen: false,
}

const state = ref<State>({ ...defaultState })

// 新增搜索引擎表单
const newEngine = ref<DeskModule.SearchBox.SearchEngine>({
  iconSrc: '',
  title: '',
  url: '',
})

const onFocus = (): void => {
  isFocused.value = true
}

const onBlur = (): void => {
  isFocused.value = false
}

function handleEngineClick() {
  // 访客模式不允许修改
  if (authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC)
    return
  searchSelectListShow.value = !searchSelectListShow.value
}

function saveState() {
  moduleConfig.saveToCloud(moduleConfigName, state.value)
}

function handleEngineUpdate(engine: DeskModule.SearchBox.SearchEngine) {
  state.value.currentSearchEngine = engine
  saveState()
  searchSelectListShow.value = false
}

function handleEngineAdd() {
  const title = newEngine.value.title.trim()
  const url = newEngine.value.url.trim()
  if (!title || !url) {
    ms.warning(t('deskModule.searchBox.engineFormIncomplete'))
    return
  }

  const engine: DeskModule.SearchBox.SearchEngine = {
    iconSrc: newEngine.value.iconSrc?.trim() || '',
    title,
    url,
  }
  state.value.searchEngineList.push(engine)
  state.value.currentSearchEngine = engine
  newEngine.value = { iconSrc: '', title: '', url: '' }
  saveState()
}

function handleEngineDelete(engine: DeskModule.SearchBox.SearchEngine) {
  if (state.value.searchEngineList.length <= 1) {
    ms.warning(t('deskModule.searchBox.engineDeleteLastWarning'))
    return
  }

  const index = state.value.searchEngineList.indexOf(engine)
  if (index === -1)
    return
  state.value.searchEngineList.splice(index, 1)

  // 若删除的是当前使用的引擎，切换到第一个
  if (state.value.currentSearchEngine === engine)
    state.value.currentSearchEngine = state.value.searchEngineList[0]
  saveState()
}

function handleEngineReset() {
  state.value.searchEngineList = [...defaultSearchEngineList.value]
  state.value.currentSearchEngine = state.value.searchEngineList[0]
  saveState()
}

function handleSearchClick() {
  const url = state.value.currentSearchEngine.url
  const keyword = searchTerm
  // 如果网址中存在 %s，则直接替换为关键字
  const fullUrl = replaceOrAppendKeywordToUrl(url, keyword.value)
  handleClearSearchTerm()
  if (state.value.newWindowOpen)
    window.open(fullUrl)
  else
    window.location.href = fullUrl
}

function replaceOrAppendKeywordToUrl(url: string, keyword: string) {
  // 如果网址中存在 %s，则直接替换为关键字
  if (url.includes('%s'))
    return url.replace('%s', encodeURIComponent(keyword))

  // 如果网址中不存在 %s，则将关键字追加到末尾
  return url + (keyword ? `${encodeURIComponent(keyword)}` : '')
}

const handleItemSearch = () => {
  emits('itemSearch', searchTerm.value)
}

function handleClearSearchTerm() {
  searchTerm.value = ''
  emits('itemSearch', searchTerm.value)
}

// 搜索引擎头像: 有图标用图标, 否则显示首字母
function getEngineInitial(engine: DeskModule.SearchBox.SearchEngine) {
  return engine.title.charAt(0).toUpperCase()
}

onMounted(() => {
  moduleConfig.getValueByNameFromCloud<State>('deskModuleSearchBox').then(({ code, data }) => {
    if (code === 0) {
      state.value = data || defaultState
      // 兼容旧数据: 引擎列表为空时回退默认
      if (!state.value.searchEngineList || state.value.searchEngineList.length === 0)
        state.value.searchEngineList = [...defaultSearchEngineList.value]
      if (!state.value.currentSearchEngine)
        state.value.currentSearchEngine = state.value.searchEngineList[0]
    }
    else {
      state.value = defaultState
    }
  })
})
</script>

<template>
  <div class="search-box w-full" @keydown.enter="handleSearchClick" @keydown.esc="handleClearSearchTerm">
    <div
      class="search-container flex rounded-2xl items-center justify-center text-white w-full"
      :style="{ background, color: textColor, borderColor: borderColor || '#cccccc', '--sb-placeholder-color': placeholderColor || 'rgba(255, 255, 255, 0.6)' }"
      :class="{ focused: isFocused }"
    >
      <div class="search-box-btn-engine w-[40px] flex justify-center cursor-pointer" @click="handleEngineClick">
        <NAvatar v-if="state.currentSearchEngine.iconSrc" :src="state.currentSearchEngine.iconSrc" style="background-color: transparent;" :size="20" />
        <NAvatar v-else style="background-color: transparent;" :size="20">
          {{ getEngineInitial(state.currentSearchEngine) }}
        </NAvatar>
      </div>

      <input v-model="searchTerm" :placeholder="$t('deskModule.searchBox.inputPlaceholder')" @focus="onFocus" @blur="onBlur" @input="handleItemSearch">

      <div v-if="searchTerm !== ''" class="search-box-btn-clear w-[25px] mr-[10px] flex justify-center cursor-pointer" @click="handleClearSearchTerm">
        <SvgIcon style="width: 20px;height: 20px;" icon="line-md:close-small" />
      </div>
      <div class="search-box-btn-search w-[25px] flex justify-center cursor-pointer" @click="handleSearchClick">
        <SvgIcon style="width: 20px;height: 20px;" icon="iconamoon:search-fill" />
      </div>
    </div>

    <!-- 搜索引擎选择 -->
    <div v-if="searchSelectListShow" class="w-full mt-[10px] rounded-xl p-[10px]" :style="{ background }">
      <div class="flex items-center flex-wrap">
        <div class="flex items-center flex-wrap">
          <div
            v-for="item, index in state.searchEngineList"
            :key="index"
            :title="item.title"
            class="w-[40px] h-[40px] mr-[10px] mb-[2px] cursor-pointer bg-[#ffffff] flex items-center justify-center rounded-xl"
            @click="handleEngineUpdate(item)"
          >
            <NAvatar v-if="item.iconSrc" :src="item.iconSrc" style="background-color: transparent;" :size="20" />
            <NAvatar v-else style="background-color: transparent;" :size="20">
              {{ getEngineInitial(item) }}
            </NAvatar>
          </div>
        </div>
      </div>

      <div class="mt-[10px]">
        <NCheckbox v-model:checked="state.newWindowOpen" @update-checked="saveState">
          <span :style="{ color: textColor }">
            {{ $t('deskModule.searchBox.openWithNewOpen') }}
          </span>
        </NCheckbox>
      </div>

      <!-- 搜索引擎管理 -->
      <div class="mt-[8px] flex justify-end">
        <NButton size="tiny" quaternary type="info" @click="engineManageShow = !engineManageShow">
          {{ $t('deskModule.searchBox.searchEngineManage') }}
        </NButton>
      </div>

      <div v-if="engineManageShow" class="mt-[5px] rounded-xl p-[10px] bg-black/20">
        <div v-for="item, index in state.searchEngineList" :key="index" class="flex items-center mb-[5px]">
          <NAvatar v-if="item.iconSrc" :src="item.iconSrc" style="background-color: transparent;" :size="20" class="mr-[8px]" />
          <NAvatar v-else style="background-color: transparent;" :size="20" class="mr-[8px]">
            {{ getEngineInitial(item) }}
          </NAvatar>
          <span class="flex-1 text-[13px] truncate" :style="{ color: textColor }">
            {{ item.title }}
          </span>
          <SvgIcon
            v-if="state.currentSearchEngine === item"
            class="mr-[8px] text-[16px] text-[#18A058]"
            icon="material-symbols:check-circle-outline-rounded"
          />
          <SvgIcon class="cursor-pointer text-[16px] opacity-70 hover:opacity-100" icon="material-symbols:delete-outline-rounded" @click="handleEngineDelete(item)" />
        </div>

        <div class="mt-[10px]">
          <NInput v-model:value="newEngine.title" size="small" :placeholder="$t('deskModule.searchBox.engineName')" />
          <NInput v-model:value="newEngine.url" size="small" class="mt-[5px]" :placeholder="$t('deskModule.searchBox.engineUrl')" />
          <NInput v-model:value="newEngine.iconSrc" size="small" class="mt-[5px]" :placeholder="$t('deskModule.searchBox.engineIconUrl')" />
          <div class="flex mt-[8px]">
            <NButton size="tiny" type="success" :disabled="!newEngine.title.trim() || !newEngine.url.trim()" @click="handleEngineAdd">
              {{ $t('common.add') }}
            </NButton>
            <NButton size="tiny" class="ml-[8px]" @click="handleEngineReset">
              {{ $t('common.reset') }}
            </NButton>
          </div>
        </div>
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
