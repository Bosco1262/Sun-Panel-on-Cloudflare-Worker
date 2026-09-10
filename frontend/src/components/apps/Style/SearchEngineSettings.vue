<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { NButton, NCheckbox, NInput, useDialog, useMessage } from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import { storeToRefs } from 'pinia'
import { RoundCardModal, SearchEngineIcon, SvgIcon } from '@/components/common'
import { SearchEngineOpenMethodEnum } from '@/enums/panel'
import { usePanelState } from '@/store'
import { t } from '@/locales'
import {
  buildSearchUrl,
  createDefaultSearchEngineConfig,
  createEmptyEngine,
  deduceTemplateFromTestUrl,
  generateEngineId,
  guessIconCandidates,
  hasPlaceholder,
  isDuplicateEngine,
  validateSearchEngine,
} from '@/utils/searchBox'

const panelState = usePanelState()
const ms = useMessage()
const dialog = useDialog()
const { searchEngine } = storeToRefs(panelState)

/** 用于推导地址模板的示例关键词 */
const SAMPLE_KEYWORD = 'sun panel'

const sortStatus = ref(false)

/** 编辑弹窗状态 */
const editor = reactive({
  show: false,
  isEdit: false,
  /** 编辑时记录原 id, 保存后要同步当前选中项 */
  editingId: '',
  engine: createEmptyEngine(),
  titleError: '',
  urlError: '',
  iconError: '',
})

const engineList = computed({
  // 直接返回 store 里的数组: 拖拽排序与增删都原地修改, 改动会被下面的 watch 自动保存
  get: () => searchEngine.value?.engineList ?? [],
  set: (value: DeskModule.SearchBox.SearchEngine[]) => {
    if (searchEngine.value)
      searchEngine.value.engineList = value
  },
})

const openMethodValue = computed({
  get: () => searchEngine.value?.openMethod === SearchEngineOpenMethodEnum.newWindow,
  set: (value: boolean) => {
    if (searchEngine.value)
      searchEngine.value.openMethod = value ? SearchEngineOpenMethodEnum.newWindow : SearchEngineOpenMethodEnum.currentPage
  },
})

const selectedId = computed(() => {
  if (engineList.value.length === 0)
    return ''
  const current = panelState.currentSearchEngine
  return current?.id ?? ''
})

const previewUrl = computed(() => {
  const url = editor.engine.url.trim()
  if (!url)
    return ''
  return buildSearchUrl(url, SAMPLE_KEYWORD)
})

// 每个引擎的站点图标候选: 用户填的图标失效时按顺序回退, 避免破图
const listIconCandidates = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {}
  for (const engine of engineList.value)
    map[engine.id] = guessIconCandidates(engine.url)
  return map
})

const editorIconCandidates = computed(() => guessIconCandidates(editor.engine.url))

const templateParam = computed(() => {
  const url = editor.engine.url.trim()
  if (!url)
    return ''
  const result = deduceTemplateFromTestUrl(url, SAMPLE_KEYWORD)
  return result?.param ?? ''
})

function handleAdd() {
  editor.show = true
  editor.isEdit = false
  editor.editingId = ''
  editor.engine = createEmptyEngine()
  editor.titleError = ''
  editor.urlError = ''
  editor.iconError = ''
}

function handleEdit(engine: DeskModule.SearchBox.SearchEngine) {
  editor.show = true
  editor.isEdit = true
  editor.editingId = engine.id
  editor.engine = { ...engine }
  editor.titleError = ''
  editor.urlError = ''
  editor.iconError = ''
}

function handleSelect(engine: DeskModule.SearchBox.SearchEngine) {
  if (searchEngine.value)
    searchEngine.value.currentEngineId = engine.id
}

function handleDelete(engine: DeskModule.SearchBox.SearchEngine) {
  dialog.warning({
    title: t('common.warning'),
    content: t('deskModule.searchEngine.deleteWarnText', { name: engine.title }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      const list = searchEngine.value?.engineList
      if (!list)
        return
      const index = list.findIndex(item => item.id === engine.id)
      if (index === -1)
        return
      list.splice(index, 1)
      // 删掉的是当前项时, 顺延到同位置的下一项 / 第一项
      if (searchEngine.value && searchEngine.value.currentEngineId === engine.id)
        searchEngine.value.currentEngineId = list[Math.min(index, list.length - 1)]?.id ?? ''
      ms.success(t('common.deleteSuccess'))
    },
  })
}

function handleRestoreBuiltin() {
  const defaults = createDefaultSearchEngineConfig().engineList
  for (const engine of defaults) {
    const existed = engineList.value.some(item => item.url.trim().toLowerCase() === engine.url.trim().toLowerCase())
    if (existed)
      continue
    // 换一个 id, 避免与已有项冲突
    searchEngine.value?.engineList.push({ ...engine, id: generateEngineId() })
  }
  ms.success(t('deskModule.searchEngine.restoreBuiltinDone'))
}

function handleResetAll() {
  dialog.warning({
    title: t('common.warning'),
    content: t('deskModule.searchEngine.resetWarnText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const res = await panelState.resetSearchEngine()
      if (res?.code === 0)
        ms.success(t('common.saveSuccess'))
      else
        ms.error(t('common.saveFail'))
    },
  })
}

function handleChangeSort() {
  if (sortStatus.value) {
    sortStatus.value = false
    ms.success(t('common.saveSuccess'))
    return
  }
  sortStatus.value = true
}

/** 编辑框里粘贴一个能打开的搜索地址时, 自动识别关键词参数并转成模板 */
function handleUrlBlur() {
  const url = editor.engine.url.trim()
  if (!url || hasPlaceholder(url))
    return
  const result = deduceTemplateFromTestUrl(url, SAMPLE_KEYWORD)
  if (result?.matched && result.param)
    editor.engine.url = result.template
}

function handleSave() {
  const result = validateSearchEngine(editor.engine)
  editor.titleError = result.titleError ? t(result.titleError) : ''
  editor.urlError = result.urlError ? t(result.urlError) : ''
  editor.iconError = result.iconError ? t(result.iconError) : ''
  if (!result.valid)
    return

  const duplicate = isDuplicateEngine(engineList.value, editor.engine)
  if (duplicate === 'title') {
    editor.titleError = t('deskModule.searchEngine.engineNameDuplicated')
    return
  }
  if (duplicate === 'url') {
    editor.urlError = t('deskModule.searchEngine.engineUrlDuplicated')
    return
  }

  const engine: DeskModule.SearchBox.SearchEngine = {
    ...editor.engine,
    id: editor.editingId || editor.engine.id || generateEngineId(),
    title: editor.engine.title.trim(),
    url: editor.engine.url.trim(),
    iconSrc: (editor.engine.iconSrc ?? '').trim(),
    remark: (editor.engine.remark ?? '').trim(),
  }

  const list = searchEngine.value?.engineList ?? []
  const index = list.findIndex(item => item.id === engine.id)
  if (index === -1) {
    list.push(engine)
    // 新增的引擎直接设为当前使用
    if (searchEngine.value)
      searchEngine.value.currentEngineId = engine.id
  }
  else {
    // 保留原位置, 用 splice 维持响应式数组顺序
    list.splice(index, 1, engine)
    if (searchEngine.value && searchEngine.value.currentEngineId === engine.id)
      searchEngine.value.currentEngineId = engine.id
  }

  editor.show = false
  ms.success(editor.isEdit ? t('common.editSuccess') : t('common.addSuccess'))
}
</script>

<template>
  <div class="w-full">
    <!-- 操作区: 拆成两行留出间距, 破坏性的「重置」单独放到底部, 避免按钮挤在一起 -->
    <div class="flex flex-col gap-[8px]">
      <div class="flex items-center flex-wrap gap-[8px]">
        <NButton v-if="!sortStatus" size="small" type="success" @click="handleAdd">
          {{ $t('deskModule.searchEngine.addEngine') }}
        </NButton>
        <NButton v-else size="small" type="warning" @click="handleChangeSort">
          {{ $t('common.saveSort') }}
        </NButton>
      </div>

      <div v-if="!sortStatus" class="flex items-center flex-wrap gap-[8px]">
        <NButton v-if="engineList.length > 1" size="small" @click="sortStatus = true">
          {{ $t('common.sort') }}
        </NButton>

        <NButton size="small" @click="handleRestoreBuiltin">
          {{ $t('deskModule.searchEngine.restoreBuiltin') }}
        </NButton>
      </div>
    </div>

    <!-- 列表为空: 搜索框仍在用内置默认引擎, 这里给出说明 -->
    <div v-if="engineList.length === 0" class="mt-[10px] text-[13px] text-slate-500 dark:text-slate-400">
      {{ $t('deskModule.searchEngine.emptyTip') }}
    </div>

    <div v-else class="mt-[10px]">
      <VueDraggable
        v-model="engineList"
        item-key="id"
        :animation="200"
        :disabled="!sortStatus"
        class="flex flex-col gap-[5px]"
      >
        <div
          v-for="item in engineList"
          :key="item.id"
          class="flex items-center rounded-[10px] px-[10px] py-[6px] border transition-colors"
          :class="[
            sortStatus ? 'cursor-move' : 'cursor-pointer',
            item.id === selectedId
              ? 'border-[#18A058] bg-[#18A05814]'
              : 'border-slate-200 dark:border-zinc-700 hover:border-[#18A05880]',
          ]"
          @click="!sortStatus && handleSelect(item)"
        >
          <span class="mr-[8px] flex items-center">
            <SvgIcon v-if="sortStatus" class="text-[16px] opacity-60" icon="material-symbols:drag-indicator" />
            <SearchEngineIcon
              v-else
              :icon-src="item.iconSrc"
              :title="item.title"
              :size="20"
              :fallback-candidates="listIconCandidates[item.id]"
            />
          </span>

          <div class="flex-1 min-w-0">
            <div class="text-[13px] truncate">
              {{ item.title }}
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate" :title="item.url">
              {{ item.url }}
            </div>
          </div>

          <SvgIcon
            v-if="item.id === selectedId && !sortStatus"
            class="mr-[6px] text-[16px] text-[#18A058]"
            icon="material-symbols:check-circle-outline-rounded"
          />

          <template v-if="!sortStatus">
            <NButton size="tiny" quaternary type="info" @click.stop="handleEdit(item)">
              <template #icon>
                <SvgIcon icon="basil:edit-solid" />
              </template>
            </NButton>
            <NButton size="tiny" quaternary type="error" @click.stop="handleDelete(item)">
              <template #icon>
                <SvgIcon icon="material-symbols:delete" />
              </template>
            </NButton>
          </template>
        </div>
      </VueDraggable>
    </div>

    <div class="flex items-center mt-[12px]">
      <span class="mr-[10px]">{{ $t('deskModule.searchEngine.openMethod') }}</span>
      <NCheckbox v-model:checked="openMethodValue">
        {{ $t('deskModule.searchBox.openWithNewOpen') }}
      </NCheckbox>
    </div>

    <!-- 破坏性操作单独放到底部, 与上方按钮拉开距离 -->
    <div class="mt-[12px] pt-[12px] border-t border-slate-200 dark:border-zinc-700">
      <NButton size="small" quaternary type="error" @click="handleResetAll">
        {{ $t('deskModule.searchEngine.resetAll') }}
      </NButton>
    </div>

    <RoundCardModal
      v-model:show="editor.show"
      size="small"
      type="small"
      :title="editor.isEdit ? $t('deskModule.searchEngine.editEngine') : $t('deskModule.searchEngine.addEngine')"
      style="width: 460px;"
    >
      <div class="flex flex-col gap-[10px]">
        <div>
          <div class="mb-[4px] text-[13px]">
            {{ $t('deskModule.searchEngine.engineName') }}
          </div>
          <NInput
            v-model:value="editor.engine.title"
            type="text"
            :maxlength="20"
            show-count
            :status="editor.titleError ? 'error' : undefined"
            :placeholder="$t('deskModule.searchEngine.engineNamePlaceholder')"
          />
          <div v-if="editor.titleError" class="mt-[4px] text-[12px] text-[#d03050]">
            {{ editor.titleError }}
          </div>
        </div>

        <div>
          <div class="mb-[4px] text-[13px]">
            {{ $t('deskModule.searchEngine.engineUrl') }}
          </div>
          <NInput
            v-model:value="editor.engine.url"
            type="text"
            :status="editor.urlError ? 'error' : undefined"
            :placeholder="$t('deskModule.searchEngine.engineUrlPlaceholder')"
            @blur="handleUrlBlur"
          />
          <div v-if="editor.urlError" class="mt-[4px] text-[12px] text-[#d03050]">
            {{ editor.urlError }}
          </div>
          <div class="mt-[4px] text-[12px] text-slate-500 dark:text-slate-400">
            {{ $t('deskModule.searchEngine.engineUrlTip') }}
          </div>
          <div v-if="previewUrl" class="mt-[6px] rounded-[8px] bg-slate-100 dark:bg-zinc-800 px-[8px] py-[6px] text-[12px] break-all">
            <span class="text-slate-500 dark:text-slate-400">
              {{ $t('deskModule.searchEngine.previewTip', { keyword: SAMPLE_KEYWORD }) }}
            </span>
            <span v-if="templateParam" class="ml-[6px] text-[#18A058]">
              {{ $t('deskModule.searchEngine.matchedParam', { param: templateParam }) }}
            </span>
            <div class="mt-[2px] text-[#2080F0]">
              {{ previewUrl }}
            </div>
          </div>
        </div>

        <div>
          <div class="mb-[4px] text-[13px]">
            {{ $t('deskModule.searchEngine.engineIconUrl') }}
          </div>
          <div class="flex items-center">
            <NInput
              v-model:value="editor.engine.iconSrc"
              type="text"
              :status="editor.iconError ? 'error' : undefined"
              :placeholder="$t('deskModule.searchEngine.engineIconPlaceholder')"
            />
            <span class="ml-[8px] flex w-[24px] justify-center">
              <SearchEngineIcon
                :icon-src="editor.engine.iconSrc"
                :title="editor.engine.title"
                :size="20"
                :fallback-candidates="editorIconCandidates"
              />
            </span>
          </div>
          <div v-if="editor.iconError" class="mt-[4px] text-[12px] text-[#d03050]">
            {{ editor.iconError }}
          </div>
        </div>

        <div>
          <div class="mb-[4px] text-[13px]">
            {{ $t('deskModule.searchEngine.engineRemark') }}
          </div>
          <NInput
            v-model:value="editor.engine.remark"
            type="text"
            :maxlength="30"
            :placeholder="$t('deskModule.searchEngine.engineRemarkPlaceholder')"
          />
        </div>
      </div>

      <template #footer>
        <NButton size="small" class="mr-[10px]" @click="editor.show = false">
          {{ $t('common.cancel') }}
        </NButton>
        <NButton size="small" type="success" @click="handleSave">
          {{ $t('common.confirm') }}
        </NButton>
      </template>
    </RoundCardModal>
  </div>
</template>
