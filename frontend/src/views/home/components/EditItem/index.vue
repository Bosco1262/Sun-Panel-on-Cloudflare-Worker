<script setup lang="ts">
import { computed, defineEmits, defineProps, nextTick, ref, watch } from 'vue'
import type { FormInst, FormRules } from 'naive-ui'
import { NAlert, NButton, NCheckbox, NColorPicker, NFlex, NForm, NFormItem, NGrid, NGridItem, NInput, NInputGroup, NModal, NSelect, NSpace, NTooltip, useMessage } from 'naive-ui'
import IconEditor from './IconEditor.vue'
import FaviconPicker from './FaviconPicker.vue'
import AppIcon from '@/views/home/components/AppIcon/index.vue'
import { SvgIcon } from '@/components/common'
import { edit, getSiteFaviconCandidates, saveSiteFavicon } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { t } from '@/locales'
import { reportApiError, reportThrownError } from '@/utils/request/apiMessage'

interface Props {
  visible: boolean
  itemInfo: Panel.Info | null
  itemGroupId?: number
  /**
   * The parent's already loaded group list (the home page's items, unfiltered).
   *
   * Filling the dropdown from it the moment the dialog opens removes both the bare id (naive-ui renders the raw value
   * when no option matches) and the window where the group cannot be switched yet. The dialog still refreshes the list
   * in the background, so a rename / deletion made on another device is corrected as soon as it answers.
   *
   *
   * 父组件已加载的完整分组列表 (首页 items, 未经过滤)。
   *
   * 打开瞬间即用它填满下拉: 既不会显示裸 id (naive-ui 找不到匹配项时会直接渲染原始值),
   * 也不存在"接口回来前不能切换分组"的窗口。弹窗仍会在后台刷新一次列表,
   * 其它设备上的改名 / 删除会在响应回来后自动纠正。
   */
  itemGroups?: Panel.ItemIconGroup[]
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()
const ms = useMessage()
const submitLoading = ref(false)
const getIconLoading = ref([false, false])
const itemIconGroupOptions = ref<{
  label: string
  value: number
}[]>([])

/**
 * Group list state
 *
 * `loading` / `failed` only happen when there is no usable list at all (the parent list is empty *and* the dialog's own
 * request has not answered yet); with a list in hand a failed refresh stays silent and the select keeps working.
 *
 *
 * 分组列表状态
 *
 * 只有在完全没有可用列表时才会出现 loading / failed (父列表为空 且 弹窗自己的请求还没结果);
 * 手里有列表时刷新失败保持静默, 下拉照常可用。
 */
type GroupListState = 'loading' | 'ready' | 'failed'
const groupListState = ref<GroupListState>('loading')
const groupSelectDisabled = computed(() => groupListState.value !== 'ready')
const groupListFailed = computed(() => groupListState.value === 'failed')

// "More options" collapse area (aligned with upstream: card background colour / group / unique identifier, without the card type)
// 更多选项折叠区 (对齐上游: 卡片背景色 / 分组 / 唯一标识, 不含卡片类型)
const showMoreOptions = ref(false)

// Live preview (aligned with upstream: the preview sits above the form and does not scroll with it)
// 效果预览 (对齐上游: 预览区固定在表单上方, 不随表单滚动)
const previewShow = ref(true)
const canvasTransparent = ref(false)

const restoreDefault: Panel.Info = {
  icon: null,
  title: '',
  url: '',
  lanUrl: '',
  description: '',
  openMethod: 2,
  onlyName: '',
}

interface Emit {
  (e: 'update:visible', visible: boolean): void
  (e: 'done', item: Panel.Info): void// 创建完成
}

const model = ref<Panel.Info>(props.itemInfo ? { ...props.itemInfo } : { ...restoreDefault })
const formRef = ref<FormInst | null>(null)

const rules: FormRules = {
  title: {
    required: true,
    trigger: 'blur',
    message: t('form.required'),
  },
  url: {
    required: true,
    trigger: 'blur',
    type: 'string',
    message: t('form.required'),
  },
  itemIconGroupId: {
    required: true,
    trigger: ['blur', 'change'],
    message: t('form.required'),
    /**
     * The group id is a number, so it cannot be left to async-validator's type inference.
     *
     * A rule that carries any key besides `required` (here: `trigger`) no longer takes async-validator's
     * "required only" shortcut: it falls back to the `string` validator, which rejects a number as a type error
     * and reports it with the rule's own `message` — so a correctly selected group still showed "必填项" and the
     * item could never be saved. Declaring the accepted shapes explicitly fixes that and mirrors the backend,
     * which also treats 0 / missing as "no group" (error code 1404, see src/api/panel/itemIcon.ts).
     *
     *
     * 分组 id 是数字, 不能交给 async-validator 做类型推断。
     *
     * 规则里只要出现 `required` 以外的键 (这里是 `trigger`), async-validator 就不再走「仅 required」的快捷
     * 分支, 而是退回 `string` 校验器: 数字会被判成类型错误, 并按该规则的 `message` 报出来 —— 于是明明选好了
     * 分组也一直提示「必填项」, 项目根本无法保存。这里显式声明可接受的值形态, 并与后端保持一致:
     * 0 / 缺失都视为「没有分组」(错误码 1404, 见 src/api/panel/itemIcon.ts)。
     */
    validator: (_rule, value) => {
      // A numeric string is accepted as well (imported data can carry the id as text)
      // 同时接受数字字符串 (导入的数据里 id 可能是文本)
      const id = typeof value === 'string' ? Number(value) : value
      return (typeof id === 'number' && Number.isFinite(id) && id > 0)
        ? true
        : new Error(t('form.required'))
    },
  },
}

const options = [
  {
    default: true,
    label: t('iconItem.currentPageOpen'),
    value: 1,
  },
  {
    label: t('iconItem.newWindowOpen'),
    value: 2,
  },
  {
    label: t('iconItem.currentPageLayerOpen'),
    value: 3,
  },
]

// Write the value back to the parent's prop
// 更新值父组件传来的值
const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

// Complete item information for the preview (title / description follow the form live)
// 预览用的完整项目信息 (标题/描述实时跟随表单)
const previewItemInfo = computed<Panel.ItemInfo>(() => ({
  icon: model.value.icon,
  title: model.value.title,
  description: model.value.description,
  url: '',
  openMethod: 1,
}))

// Card background colour (aligned with upstream: #2a2a2a6b by default)
// 卡片背景色 (对齐上游: 默认 #2a2a2a6b)
const defaultBackground = '#2a2a2a6b'
const backgroundColorValue = computed<string>({
  get: () => model.value.icon?.backgroundColor || defaultBackground,
  set: (v: string) => {
    if (!model.value.icon)
      model.value.icon = { itemType: 2, backgroundColor: v }
    else
      model.value.icon.backgroundColor = v
  },
})

// URL scheme hint (aligned with upstream's urlNoHttpStartWarn)
// 地址协议提醒 (对齐上游 urlNoHttpStartWarn)
function isNonHttpUrl(url?: string) {
  return !!url && !/^https?:\/\//i.test(url)
}
const showUrlWarn = computed(() => isNonHttpUrl(model.value.url))
const showLanUrlWarn = computed(() => isNonHttpUrl(model.value.lanUrl))

// The unique identifier accepts only letters, digits, underscores and hyphens
// 唯一标识仅允许英文/数字/下划线/中划线
watch(() => model.value.onlyName, (v) => {
  if (v && /[^A-Za-z0-9_-]/.test(v))
    model.value.onlyName = v.replace(/[^A-Za-z0-9_-]/g, '')
})

async function editApi() {
  // The loading flag is owned by the submit flow (it also covers the pre-save group re-check)
  // loading 由提交流程统一管理 (它还要覆盖保存前的分组复查)
  try {
    const { code, data, msg } = await edit<Panel.ItemInfo>(model.value)
    if (code === 0) {
      show.value = false
      model.value = { ...restoreDefault }

      emit('done', data)
    }
    else {
      // 1401 (duplicate unique name) and the other codes are reported by the request layer with their translation
      // 1401 (唯一标识被占用) 等错误码由请求层带译文提示
      reportApiError({ code, msg }, text => ms.error(text), 'common.saveFail')
    }
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'common.saveFail')
  }
}

// Icon validity check (aligned with upstream's selectOneIcon)
// 图标有效性校验 (对齐上游 selectOneIcon)
function validateIcon(): boolean {
  const icon = model.value.icon
  if (!icon)
    return false
  if (icon.itemType === 1 || icon.itemType === 3)
    return !!icon.text?.trim()
  if (icon.itemType === 2)
    return !!icon.src?.trim()
  return false
}

const handleValidateButtonClick = (e: MouseEvent) => {
  e.preventDefault()
  if (submitLoading.value)
    return
  // Covers the whole chain (form validation → icon check → group re-check → save), so the button never looks idle
  // 覆盖整条链路 (表单校验 → 图标校验 → 分组复查 → 写入), 中途按钮不会看起来闲置
  submitLoading.value = true

  formRef.value?.validate(async (errors) => {
    try {
      if (errors)
        return
      if (!validateIcon()) {
        ms.error(t('iconItem.selectOneIcon'))
        return
      }

      // Pre-save re-check: fetch the list again (which also refreshes the dropdown)
      // 保存前复查: 重新拉一次分组列表 (顺带刷新下拉)
      if (await loadGroupOptions() === 'failed') {
        // The list is unreachable: block the save rather than writing into a group that may already be gone
        // 列表不可用: 阻断保存, 不做"可能写进已删除分组"的猜测
        ms.error(t('iconItem.getGroupFailRetry'))
        return
      }

      // The value did not survive the re-check: clear it, reveal the field and show the field-level error
      // 复查后值已失效: 清空 + 展开分组字段 + 字段级「必填项」
      if (enforceGroupInvariant(true))
        return

      await editApi()
    }
    finally {
      submitLoading.value = false
    }
  })
}

// ===================== Fetching site icons =====================
// ===================== 获取站点图标 =====================

// One fetch returns the candidate list: a single candidate is stored directly; with ≥2 a dialog picks one (only the chosen one is stored)
// 一次抓取返回候选列表: 1 个直接保存; ≥2 个弹窗选一张 (只保存选中的)
const faviconPickerVisible = ref(false)
const faviconCandidates = ref<Panel.FaviconCandidate[]>([])
const faviconPageUrl = ref('')
const saveFaviconLoading = ref(false)

async function getIconByUrl(url: string, loadingIndex: number) {
  getIconLoading.value[loadingIndex] = true
  try {
    const { code, msg, data } = await getSiteFaviconCandidates<{ candidates: Panel.FaviconCandidate[] }>(url)
    if (code !== 0) {
      reportApiError({ code, msg }, text => ms.error(text), 'iconItem.geticonFail')
      return
    }

    const candidates = data.candidates ?? []
    if (candidates.length === 0) {
      ms.error(t('iconItem.geticonFail'))
      return
    }

    // A single candidate keeps the one-click flow; several candidates open the picker dialog
    // 1 个候选保持「一键获取」; 多个候选弹窗让用户选一张
    if (candidates.length === 1) {
      await saveFavicon(candidates[0], url)
      return
    }

    faviconCandidates.value = candidates
    faviconPageUrl.value = url
    faviconPickerVisible.value = true
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'iconItem.geticonFail')
  }
  finally {
    getIconLoading.value[loadingIndex] = false
  }
}

// Save the choice made in the dialog (the dialog stays open on failure so another image can be picked)
// 弹窗选中后保存 (保存失败时保持弹窗打开, 可换一张重试)
async function handleFaviconSelected(candidate: Panel.FaviconCandidate) {
  const ok = await saveFavicon(candidate, faviconPageUrl.value)
  if (ok)
    faviconPickerVisible.value = false
}

async function saveFavicon(candidate: Panel.FaviconCandidate, pageUrl: string): Promise<boolean> {
  saveFaviconLoading.value = true
  try {
    const { code, msg, data } = await saveSiteFavicon<{ iconUrl: string }>(candidate.url, pageUrl)
    if (code === 0 && data?.iconUrl) {
      model.value.icon = {
        itemType: 2,
        src: data.iconUrl,
      }
      return true
    }
    reportApiError({ code, msg }, text => ms.error(text), 'iconItem.geticonFail')
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'iconItem.geticonFail')
  }
  finally {
    saveFaviconLoading.value = false
  }
  return false
}

watch(() => props.visible, (newValue) => {
  // Initialise / fetch data only when opening; the old implementation sent one more group-list request when closing the dialog
  // 只在打开时初始化/拉取数据; 旧实现在关闭弹窗时也会多发一次分组列表请求
  if (newValue !== true)
    return

  // Rebuild the model. The icon is copied one level deep so the background colour picked here only affects the preview
  // inside the dialog — the home page card changes when the save succeeds, and only then (cancel / failure leave it be).
  //
  // 重建模型。icon 做一层浅拷贝: 这里改的背景色只影响弹窗内的预览,
  // 首页卡片要等保存成功后才跟着变 (取消 / 保存失败都不影响它)。
  model.value = props.itemInfo
    ? { ...props.itemInfo, icon: props.itemInfo.icon ? { ...props.itemInfo.icon } : null }
    : { ...restoreDefault }
  if (props.itemGroupId)
    model.value.itemIconGroupId = props.itemGroupId

  // Reset the three switches on every open: the preview is on, the transparent canvas is off, and the collapse area
  // only opens for an item that already carries a unique identifier or a custom background colour
  //
  // 每次打开都复位三个开关: 预览默认开、画布透明默认关;
  // 更多选项只在"已设置唯一标识或自定义背景色"时展开。
  previewShow.value = true
  canvasTransparent.value = false
  showMoreOptions.value = hasCustomBackground() || !!model.value.onlyName

  // Seed from the parent's list first (usable immediately), then refresh in the background
  // 先用父列表播种 (打开瞬间可用), 再在后台刷新一次
  seedOptionsFromInherited()
  groupListState.value = hasGroupOptions() ? 'ready' : 'loading'
  enforceGroupInvariant()

  loadGroupOptions()
})

/**
 * Whether a custom card background colour is set
 *
 * The default counts as "not set": IconEditor fills an empty colour with the default and writes it back on every
 * commit, so merely editing an icon (or editing any existing item) leaves the default value in place.
 *
 *
 * 是否设置了自定义卡片背景色
 *
 * 默认值视为"未设置": IconEditor 会把空背景色补成默认值并在每次 commit 时写回,
 * 所以只要编辑过图标 (或编辑任何既有项目), 背景色都会等于默认值。
 */
function hasCustomBackground(): boolean {
  // An absent colour counts as "not set" — it must not be compared against the default as if it were a value
  // 没有背景色视为"未设置" —— 不能拿空值去和默认值比较
  const bg = model.value.icon?.backgroundColor
  return !!bg && bg.toLowerCase() !== defaultBackground.toLowerCase()
}

function hasGroupOptions(): boolean {
  return itemIconGroupOptions.value.length > 0
}

/**
 * Whether the current value matches one of the available options (the group invariant)
 *
 * 当前分组值能否匹配到可用列表中的某一项 (分组值不变量)
 */
function isGroupValueValid(): boolean {
  return itemIconGroupOptions.value.some(option => option.value === model.value.itemIconGroupId)
}

/**
 * Fills the options from the parent's list, so the dropdown works the moment the dialog opens
 *
 * 用父组件传来的列表填满下拉选项: 打开瞬间即可显示正确分组名并切换
 */
function seedOptionsFromInherited() {
  itemIconGroupOptions.value = (props.itemGroups ?? [])
    .filter(group => typeof group.id === 'number')
    .map(group => ({ value: group.id as number, label: group.title ?? '' }))
}

/**
 * Value handed to the group select
 *
 * With no usable list at all the model may hold an id that no option can render, and naive-ui would then print the raw
 * number on screen. Only the display is suppressed — the model keeps the value, so the preselection is not thrown away
 * and the very same value renders as its group name again as soon as a list arrives.
 *
 *
 * 交给分组下拉的显示值
 *
 * 完全没有可用列表时, 模型里的 id 没有任何选项可渲染, naive-ui 会直接把数字显示在界面上。
 * 这里只屏蔽显示、不动模型: 预选不会丢, 列表一到, 同一份值就会重新渲染成组名。
 */
const groupSelectValue = computed<number | undefined>({
  get: () => (hasGroupOptions() ? model.value.itemIconGroupId : undefined),
  set: (value) => {
    model.value.itemIconGroupId = value
  },
})

/**
 * Group invariant: with a usable list at hand the value must match one of its entries, otherwise it is cleared
 *
 * It never invents a group (the old "fall back to the first one" behaviour is gone) and never leaves a bare id on
 * screen. With the collapse area closed the clearing stays silent and the save flow is the one that reports it; with
 * the area open — or when the save flow asks for it — the field-level "required" error is rendered right away.
 *
 *
 * 分组值不变量: 只要有可用列表, 值就必须匹配其中一项, 否则清空。
 *
 * 既不臆造分组 (旧的"没有分组就落到第一个分组"已移除), 也不让裸 id 留在界面上。
 * 折叠区关闭时静默清空, 由保存流程负责提示; 折叠区展开 (或保存流程要求时) 立即渲染字段级「必填项」。
 *
 * @returns whether the value was cleared / 是否发生了清空
 */
function enforceGroupInvariant(expandSection = false): boolean {
  if (!hasGroupOptions() || isGroupValueValid())
    return false

  model.value.itemIconGroupId = undefined

  if (expandSection || showMoreOptions.value) {
    showMoreOptions.value = true
    // naive-ui only validates mounted form items: wait for the field to render, then validate so the message appears
    // naive-ui 只校验已挂载的表单项: 等字段渲染出来再校验, 提示才会出现
    nextTick(() => {
      // Called with a callback: without one validate() rejects and leaves an unhandled rejection behind
      // 用回调形式调用: 不传 callback 时 validate() 会 reject, 留下未处理的 promise 拒绝
      formRef.value?.validate(() => {})
    })
  }
  return true
}

/**
 * Failure handling for a group-list request
 *
 * With a list already available the refresh failure stays silent — the list keeps working, so a message would only be
 * noise. With nothing available at all the select is disabled and explained inline instead.
 *
 *
 * 分组列表请求失败时的分流
 *
 * 手里已有列表时静默降级 —— 列表照常可用, 再弹提示只是噪音;
 * 完全无列表可用时禁用下拉, 并在字段下方给出一行解释。
 */
function markGroupLoadFailure() {
  if (hasGroupOptions()) {
    console.warn('[EditItem] 分组列表刷新失败, 继续使用已有列表')
    groupListState.value = 'ready'
  }
  else {
    groupListState.value = 'failed'
  }
}

/**
 * Fetches the group list: the background refresh when the dialog opens, and the pre-save re-check
 *
 * @returns 'failed' as well when a list is already available — the caller decides whether that blocks anything
 */
async function loadGroupOptions(): Promise<'ok' | 'failed'> {
  try {
    const { data, code, msg } = await getGroupList<Common.ListResponse<Panel.ItemIconGroup[]>>()
    if (code !== 0) {
      // A code with a translation was already reported by the request layer (reportApiError skips those)
      // 有译文的 code 已由请求层提示过 (reportApiError 会跳过这类)
      reportApiError({ code, msg }, text => ms.error(text), 'iconItem.getGroupFail')
      markGroupLoadFailure()
      return 'failed'
    }

    // Success without a list is a malformed response: treated as a failure, without a second message of its own
    // 成功但没有 list 属于响应结构异常: 按失败处理, 不再单独多弹一条提示
    if (!data?.list) {
      markGroupLoadFailure()
      return 'failed'
    }

    itemIconGroupOptions.value = data.list
      .filter(element => typeof element.id === 'number')
      .map(element => ({ value: element.id as number, label: element.title ?? '' }))
    groupListState.value = 'ready'
    // A value that no longer exists in the fresh list is cleared (and reported when the field is visible)
    // 值已不在最新列表中时清空 (字段可见时顺带提示)
    enforceGroupInvariant()
    return 'ok'
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'iconItem.getGroupFail')
    markGroupLoadFailure()
    return 'failed'
  }
}
</script>

<template>
  <NModal v-model:show="show" preset="card" size="small" style="width: 600px;border-radius: 1rem;" :title="itemInfo?.id ? t('iconItem.edit') : t('iconItem.add')">
    <!-- Live preview (aligned with upstream: fixed above the form; small-icon text is always black) -->
    <!-- 效果预览 (对齐上游: 固定在表单上方; 小图标文字固定为黑色) -->
    <div class="mb-2">
      <span class="flex mb-1">
        <NCheckbox v-model:checked="previewShow" size="small">
          {{ $t('iconItem.preview') }}
        </NCheckbox>
        <NCheckbox v-if="previewShow" v-model:checked="canvasTransparent" size="small">
          {{ $t('iconItem.previewTransparentCanvas') }}
        </NCheckbox>
      </span>
      <div
        v-if="previewShow"
        class="preview-box rounded-xl border"
        :class="canvasTransparent ? 'transparent-grid' : 'bg-[#f1f8ff]'"
      >
        <div class="flex justify-center p-2">
          <div class="w-[210px] mr-4 z-[-1]">
            <!-- cardStyle: 0 = bar (detail) / 1 = square (small icon) -->
            <!-- cardStyle: 0=长条形(详情) / 1=正方形(小图标) -->
            <AppIcon
              :item-info="previewItemInfo"
              :icon-text-info-hide-description="false"
              :icon-text-icon-hide-title="false"
              :card-style="0"
            />
          </div>
          <div class="z-[-1]">
            <AppIcon
              :item-info="previewItemInfo"
              icon-text-color="#000"
              :icon-text-info-hide-description="false"
              :icon-text-icon-hide-title="false"
              :card-style="1"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="h-[500px] overflow-auto p-[5px]">
      <NForm ref="formRef" :model="model" :rules="rules" size="small" label-placement="top">
        <!-- Icon (the icon style + preview switches live in the label, the editor is the body) -->
        <!-- 图标（图标风格 + 预览开关在 label, 编辑器为主体） -->
        <NFormItem path="icon">
          <template #label>
            <NFlex align="center">
              <span class="font-bold">{{ $t('iconItem.icon.iconStyle') }}</span>
              <NTooltip trigger="hover" placement="top">
                <template #trigger>
                  <SvgIcon icon="fa-solid--info-circle" class="cursor-pointer" />
                </template>
                <p>{{ $t('iconItem.icon.iconSizeTip') }}</p>
                <p>{{ $t('iconItem.icon.iconOnlineTip') }}</p>
              </NTooltip>
            </NFlex>
          </template>
          <IconEditor v-model:item-icon="model.icon" class="w-full" />
        </NFormItem>

        <!-- Title / description -->
        <!-- 标题 / 描述信息 -->
        <NGrid cols="2" :x-gap="10" item-responsive>
          <NGridItem span="2 500:1">
            <NFormItem path="title">
              <template #label>
                <span class="font-bold">{{ $t('common.title') }}</span>
              </template>
              <NInput v-model:value="model.title" type="text" show-count :maxlength="20" clearable :placeholder="$t('common.inputPlaceholder')" />
            </NFormItem>
          </NGridItem>
          <NGridItem span="2 500:1">
            <NFormItem path="description">
              <template #label>
                <span class="font-bold">{{ $t('common.description') }}</span>
              </template>
              <NInput v-model:value="model.description" type="text" show-count :maxlength="100" clearable :placeholder="$t('common.inputPlaceholder')" />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <!-- Default URL -->
        <!-- 默认地址 -->
        <NFormItem path="url">
          <template #label>
            <span class="font-bold">{{ $t('iconItem.defaultUrl') }}</span>
          </template>
          <NInputGroup>
            <NInput v-model:value="model.url" type="text" :maxlength="1000" placeholder="http(s)://" />
            <NButton :disabled="!model.url" :loading="getIconLoading[0]" @click="getIconByUrl(model.url, 0)">
              {{ $t('iconItem.getIcon') }}
            </NButton>
          </NInputGroup>
        </NFormItem>
        <NAlert v-if="showUrlWarn" type="warning" :show-icon="false" class="mb-[10px]" style="border-radius: 10px;">
          {{ $t('iconItem.urlNoHttpStartWarn') }}
        </NAlert>

        <!-- LAN URL -->
        <!-- 内网地址 -->
        <NFormItem path="lanUrl">
          <template #label>
            <span class="font-bold">{{ $t('iconItem.lanUrl') }}</span>
          </template>
          <NInputGroup>
            <NInput v-model:value="model.lanUrl" type="text" :maxlength="1000" :placeholder="$t('iconItem.lanUrlInputPlaceholder')" />
            <NButton :disabled="!model.lanUrl" :loading="getIconLoading[1]" @click="getIconByUrl(model.lanUrl || '', 1)">
              {{ $t('iconItem.getIcon') }}
            </NButton>
          </NInputGroup>
        </NFormItem>
        <NAlert v-if="showLanUrlWarn" type="warning" :show-icon="false" class="mb-[10px]" style="border-radius: 10px;">
          {{ $t('iconItem.urlNoHttpStartWarn') }}
        </NAlert>

        <!-- Open method -->
        <!-- 打开方式 -->
        <NFormItem path="openMethod">
          <template #label>
            <span class="font-bold">{{ $t('iconItem.openMethod') }}</span>
          </template>
          <NSelect v-model:value="model.openMethod" :options="options" />
        </NFormItem>

        <!-- More options (card background colour, group, unique identifier) -->
        <!-- 更多选项 (卡片背景色 , 分组 , 唯一标识) -->
        <div v-if="showMoreOptions">
          <!-- The card background colour and the group each take half the row -->
          <!-- 卡片背景色 / 分组 各占一半 -->
          <NGrid cols="2" :x-gap="10" item-responsive>
            <NGridItem span="2 500:1">
              <NFormItem path="cardBackground">
                <template #label>
                  <span class="font-bold">{{ $t('iconItem.cardBackground') }}</span>
                </template>
                <NColorPicker
                  v-model:value="backgroundColorValue"
                  :show-alpha="false"
                  size="small"
                  :modes="['hex']"
                  :swatches="['#2a2a2a6b', '#000000', '#ffffff', '#18A058', '#2080F0', '#F0A020']"
                />
              </NFormItem>
            </NGridItem>
            <NGridItem span="2 500:1">
              <NFormItem path="itemIconGroupId">
                <template #label>
                  <span class="font-bold">{{ t('iconItem.iconGroup') }}</span>
                </template>
                <!-- Bound to `groupSelectValue` (not the model field directly): with no usable list the raw id would be
                     rendered on screen — the model keeps the value either way -->
                <!-- 绑定 groupSelectValue (而非直接绑模型字段): 没有任何可用列表时, 直接绑会把裸 id 渲染到界面上;
                     两种绑定下模型里的值都不变 -->
                <NSelect
                  v-model:value="groupSelectValue"
                  :options="itemIconGroupOptions"
                  :disabled="groupSelectDisabled"
                />
                <!-- Only shown when there is no usable list at all; a failed refresh with a list in hand stays silent -->
                <!-- 只在完全没有可用列表时出现; 手里有列表时刷新失败是静默降级 -->
                <div v-if="groupListFailed" class="mt-[4px] text-xs text-slate-400">
                  {{ $t('iconItem.getGroupFail') }}
                </div>
              </NFormItem>
            </NGridItem>
          </NGrid>

          <!-- Unique identifier -->
          <!-- 唯一标识 -->
          <NFormItem path="onlyName" :show-feedback="false">
            <template #label>
              <span class="font-bold">{{ $t('iconItem.onlyName') }}</span>
            </template>
            <NInput v-model:value="model.onlyName" type="text" show-count :maxlength="20" :placeholder="$t('common.inputPlaceholder')" />
          </NFormItem>
          <div class="text-slate-400 text-xs mb-[10px]">
            {{ $t('iconItem.onlyNameTip') }}
          </div>
        </div>

        <NCheckbox v-model:checked="showMoreOptions" size="small" class="mb-2">
          {{ $t('iconItem.moreOptions') }}
          <span class="text-xs text-gray-400">
            ({{ $t('iconItem.cardBackground') }} , {{ $t('iconItem.iconGroup') }} , {{ $t('iconItem.onlyName') }})
          </span>
        </NCheckbox>
      </NForm>
    </div>

    <!-- With several candidates, the dialog picks one (and only that one is stored) -->
    <!-- 多候选时弹窗选一张 (只保存选中的这张) -->
    <FaviconPicker
      v-model:visible="faviconPickerVisible"
      :candidates="faviconCandidates"
      :loading="saveFaviconLoading"
      @selected="handleFaviconSelected"
    />

    <template #footer>
      <NSpace justify="end">
        <NButton type="success" :loading="submitLoading" style="float: right;" @click="handleValidateButtonClick">
          {{ $t('common.save') }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
/* Aligned with upstream: preview container layering and dark-mode brightness
   对齐上游: 预览容器层级与暗色模式亮度 */
.preview-box {
  position: relative;
  z-index: 1;
}

.dark .preview-box {
  filter: brightness(80%);
}
</style>
