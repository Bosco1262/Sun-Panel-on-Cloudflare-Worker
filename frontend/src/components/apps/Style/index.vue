<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { UploadFileInfo } from 'naive-ui'
import { NButton, NCard, NColorPicker, NGrid, NGridItem, NInput, NInputGroup, NInputNumber, NPopconfirm, NSelect, NSlider, NSwitch, NUpload, NUploadDragger, useMessage } from 'naive-ui'
import SearchEngineSettings from './SearchEngineSettings.vue'
import { useAuthStore, usePanelState } from '@/store'
import { PanelPanelConfigStyleEnum } from '@/enums/panel'
import { t } from '@/locales'
import { apiRespErrMsg, reportApiError } from '@/utils/request/apiMessage'

const authStore = useAuthStore()
const panelState = usePanelState()
const ms = useMessage()
const showWallpaperInput = ref(false)

// The upload endpoint follows the shared API base (a hardcoded /api breaks on sub-path or standalone-domain deployments)
// 上传接口跟随统一 API 基址 (硬编码 /api 在子路径/独立域名部署时会失效)
const uploadAction = `${import.meta.env.VITE_GLOB_API_URL || '/api'}/file/uploadImg`

// With an empty wallpaper URL, do not build an empty `url()`: simply set no background (the container colour shows through)
// 壁纸地址为空时不要拼 `url()` 空值, 直接不设置背景 (回退为容器底色)
const backgroundPreviewStyle = computed(() => {
  const src = panelState.panelConfig.backgroundImageSrc?.trim()
  return src ? { background: `url(${src}) no-repeat`, backgroundSize: 'cover' } : {}
})

const isSaveing = ref(false)
// Set to true when changes happen during a save, so one more save follows it and the last edit is not lost
// 保存期间又发生改动时置为 true, 保存结束后再补一次, 避免丢失最后一次修改
let savePending = false

const iconTypeOptions = [
  {
    label: t('apps.baseSettings.detailIcon'),
    value: PanelPanelConfigStyleEnum.info,
  },
  {
    label: t('apps.baseSettings.smallIcon'),
    value: PanelPanelConfigStyleEnum.icon,
  },
]

const maxWidthUnitOption = [
  {
    label: 'px',
    value: 'px',
  },
  {
    label: '%',
    value: '%',
  },
]

// Text inputs do not save on every keystroke: while a text input keeps the focus, watch-triggered saves
// are suspended and flushed once the focus leaves the inputs (clicking outside).
//
// The "editing" state is derived live from document.activeElement instead of paired focus/blur events:
// the events can fire unevenly (and are lost on unmount), so an event counter could stay unbalanced
// and suspend every save forever.
//
//
// 文本输入框不逐键保存: 任一文本输入框持有焦点期间, watch 触发的保存先挂起,
// 焦点离开输入框 (点击输入框外) 时再统一保存。
//
// 「编辑中」状态由 document.activeElement 实时推导, 不依赖 focus/blur 事件配对:
// 事件可能不成对触发 (卸载时还会丢失), 事件计数一旦失衡会让保存永久挂起。
const TEXT_HOLD_SELECTOR = '[data-hold-save]'

let dirtyWhileEditing = false

function isAnyTextInputFocused() {
  const active = document.activeElement
  return !!active && active.closest(TEXT_HOLD_SELECTOR) !== null
}

function handleTextInputBlur() {
  // Tab-switching fires the old input's blur before the new input's focus, so check after one tick
  // Tab 切换时旧输入框的 blur 先于新输入框的 focus 触发, 延迟一拍再判断是否真的离开了输入
  setTimeout(() => {
    if (isAnyTextInputFocused() || !dirtyWhileEditing)
      return
    dirtyWhileEditing = false
    scheduleSave()
  }, 0)
}

// Switching sidebar apps unmounts the inputs and can swallow the last blur, so flush any suspended
// change before unmount; the debounced save still runs afterwards (the closure survives unmount)
//
// 切换侧栏应用会卸载输入框, 最后一次 blur 可能被吞, 卸载前补交挂起的改动 (防抖保存随后仍会执行)
onBeforeUnmount(() => {
  if (dirtyWhileEditing) {
    dirtyWhileEditing = false
    scheduleSave()
  }
})

// The panel config and the search-engine config share one debounced save (they live in the same row, so they must be submitted together)
// 面板配置 / 搜索引擎配置共用一次防抖保存 (二者在同一行数据里, 必须一起提交)
function scheduleSave() {
  if (isAnyTextInputFocused()) {
    dirtyWhileEditing = true
    return
  }

  if (isSaveing.value) {
    savePending = true
    return
  }

  isSaveing.value = true
  savePending = false
  setTimeout(() => {
    panelState.recordState()// 本地记录
    isSaveing.value = false
    uploadCloud()
    // Something changed again during the save, so schedule one more
    // 保存期间又有改动, 再补一次
    if (savePending)
      scheduleSave()
  }, 1000)
}

watch(panelState.panelConfig, scheduleSave)

// The engine list / order / current selection / open method changed
// 搜索引擎列表/排序/当前选中项/打开方式变化
watch(() => panelState.searchEngine, scheduleSave, { deep: true })

function handleUploadBackgroundFinish({
  file,
  event,
}: {
  file: UploadFileInfo
  event?: ProgressEvent
}) {
  try {
    const res = JSON.parse((event?.target as XMLHttpRequest).response)
    if (res.code === 0 && res.data?.imageUrl)
      panelState.panelConfig.backgroundImageSrc = res.data.imageUrl
    else
      apiRespErrMsg(res)
  }
  catch {
    // The response is not JSON (a gateway error page, say): it must be reported, otherwise the user assumes the upload succeeded
    // 响应不是 JSON (网关错误页等): 必须提示, 否则用户以为上传成功了
    ms.error(t('common.uploadFail'))
  }
  return file
}

/**
 * NUpload fires the error event when the upload request itself fails (network / HTTP error)
 *
 * 上传请求本身失败 (网络/HTTP 错误) 时 NUpload 触发 error 事件
 */
function handleUploadError() {
  ms.error(t('common.uploadFail'))
}

function uploadCloud() {
  // The panel and the search engine are submitted together, and the backend also preserves unsubmitted fields
  // 面板与搜索引擎一并提交, 后端也会对未提交字段做保留
  panelState.savePanelConfig().then((res) => {
    if (res.code === 0)
      ms.success(t('apps.baseSettings.configSaved'))
    else
      reportApiError(res, text => ms.error(t('apps.baseSettings.configFailed', { message: text })), 'common.saveFail')
  })
}

// Manual save: run immediately instead of waiting for the debounce, still merging with an in-flight auto save
// 手动保存: 立即执行而不等防抖, 同时与进行中的自动保存合并, 避免重复提交
function saveNow() {
  dirtyWhileEditing = false
  if (isSaveing.value) {
    savePending = true
    return
  }
  panelState.recordState()
  uploadCloud()
}

function resetPanelConfig() {
  // Resetting replaces panelConfig as a whole and triggers the deep watch below, which performs the debounced save;
  // calling uploadCloud here as well would write to the database twice for one reset
  //
  // 重置会整体替换 panelConfig 并触发下面的 deep watch, 由它统一做防抖保存;
  // 这里再调一次 uploadCloud 会导致同一次重置写库两次
  panelState.resetPanelConfig()
}
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 rounded-[10px] p-[8px] overflow-auto">
    <NCard style="border-radius:10px" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        LOGO
      </div>

      <div>
        <div>
          {{ $t('apps.baseSettings.textContent') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NInput v-model:value="panelState.panelConfig.logoText" data-hold-save type="text" show-count :maxlength="20" :placeholder="$t('common.inputPlaceholder')" @blur="handleTextInputBlur" />
        </div>
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.clock') }}
      </div>
      <div class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.clockSecondShow') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.clockShowSecond" />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.searchBar') }}
      </div>
      <div class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('common.show') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.searchBoxShow" />
      </div>
      <div v-if="panelState.panelConfig.searchBoxShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.searchBarSearchItem') }}</span>
        <NSwitch v-model:value="panelState.panelConfig.searchBoxSearchIcon" />
      </div>
      <div v-if="panelState.panelConfig.searchBoxShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.searchBarBorderColor') }}</span>
        <NColorPicker
          v-model:value="panelState.panelConfig.searchBoxBorderColor"
          class="max-w-[200px]"
          :show-alpha="false"
          size="small"
          :modes="['hex']"
          :swatches="['#cccccc', '#000000', '#ffffff', '#2080F0']"
        />
      </div>
      <div v-if="panelState.panelConfig.searchBoxShow" class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.searchBarPlaceholderColor') }}</span>
        <NColorPicker
          v-model:value="panelState.panelConfig.searchBoxPlaceholderColor"
          class="max-w-[200px]"
          :show-alpha="false"
          size="small"
          :modes="['hex']"
          :swatches="['#cccccc', '#000000', '#ffffff', '#F0A020']"
        />
      </div>
      <div class="mt-[12px] pt-[12px] border-t border-slate-200 dark:border-zinc-700">
        <SearchEngineSettings />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('common.icon') }}
      </div>
      <div class="mt-[5px]">
        <div>
          {{ $t('common.style') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NSelect v-model:value="panelState.panelConfig.iconStyle" :options="iconTypeOptions" />
        </div>
      </div>

      <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.info" class="mt-[5px]">
        <div>
          {{ $t('apps.baseSettings.hideDescription') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NSwitch v-model:value="panelState.panelConfig.iconTextInfoHideDescription" />
        </div>
      </div>

      <div v-if="panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.icon" class="mt-[5px]">
        <div>
          {{ $t('apps.baseSettings.hideTitle') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NSwitch v-model:value="panelState.panelConfig.iconTextIconHideTitle" />
        </div>
      </div>

      <div class="mt-[5px]">
        <div>
          {{ $t('common.textColor') }}
        </div>
        <div class="flex items-center mt-[5px]">
          <NColorPicker
            v-model:value="panelState.panelConfig.iconTextColor"
            :show-alpha="false"
            size="small"
            :modes="['hex']"
            :swatches="[
              '#000000',
              '#ffffff',
              '#18A058',
              '#2080F0',
              '#F0A020',
            ]"
          />
        </div>
      </div>
    </NCard>
    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.wallpaper') }}
      </div>
      <NUpload
        :action="uploadAction"
        :show-file-list="false"
        name="imgfile"
        :headers="authStore.token ? { token: authStore.token } : {}"
        :directory-dnd="true"
        @finish="handleUploadBackgroundFinish"
        @error="handleUploadError"
      >
        <NUploadDragger style="width: 100%;">
          <div
            class="h-[200px] w-full border bg-slate-100 flex justify-center items-center cursor-pointer rounded-[10px]"
            :style="backgroundPreviewStyle"
          >
            <div class="text-shadow text-white">
              {{ $t('apps.baseSettings.uploadOrDragText') }}
            </div>
          </div>
        </NUploadDragger>
      </NUpload>

      <div class="flex items-center mt-[5px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.customImageAddress') }}</span>
        <NSwitch v-model:value="showWallpaperInput" />
      </div>
      <div v-if="showWallpaperInput" class="mt-1">
        <NInput v-model:value="panelState.panelConfig.backgroundImageSrc" data-hold-save type="text" size="small" clearable @blur="handleTextInputBlur" />
      </div>

      <div class="flex items-center mt-[10px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.vague') }}</span>
        <NSlider v-model:value="panelState.panelConfig.backgroundBlur" class="max-w-[200px]" :step="2" :max="20" />
      </div>

      <div class="flex items-center mt-[10px]">
        <span class="mr-[10px]">{{ $t('apps.baseSettings.mask') }}</span>
        <NSlider v-model:value="panelState.panelConfig.backgroundMaskNumber" class="max-w-[200px]" :step="0.1" :max="1" />
      </div>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.contentArea') }}
      </div>

      <NGrid cols="2">
        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[5px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.netModeChangeButtonShow') }}</span>
            <NSwitch v-model:value="panelState.panelConfig.netModeChangeButtonShow" />
          </div>
        </NGridItem>

        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.maxWidth') }}</span>
            <div class="flex">
              <NInputGroup>
                <NInputNumber v-model:value="panelState.panelConfig.maxWidth" data-hold-save size="small" :style="{ width: '100px' }" placeholder="1200" @blur="handleTextInputBlur" />
                <NSelect v-model:value="panelState.panelConfig.maxWidthUnit" :style="{ width: '80px' }" :options="maxWidthUnitOption" size="small" />
              </NInputGroup>
            </div>
          </div>
        </NGridItem>
        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.leftRightMargin') }}</span>
            <NSlider v-model:value="panelState.panelConfig.marginX" class="max-w-[200px]" :step="1" :max="100" />
          </div>
        </NGridItem>
        <NGridItem span="12 400:12">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.topMargin') }} (%)</span>
            <NSlider v-model:value="panelState.panelConfig.marginTop" class="max-w-[200px]" :step="1" :max="50" />
          </div>
        </NGridItem>
        <NGridItem span="12 400:6">
          <div class="flex items-center mt-[10px]">
            <span class="mr-[10px]">{{ $t('apps.baseSettings.bottomMargin') }} (%)</span>
            <NSlider v-model:value="panelState.panelConfig.marginBottom" class="max-w-[200px]" :step="1" :max="50" />
          </div>
        </NGridItem>
      </NGrid>
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('apps.baseSettings.customFooter') }}
      </div>

      <NInput
        v-model:value="panelState.panelConfig.footerHtml"
        data-hold-save
        type="textarea"
        clearable
        @blur="handleTextInputBlur"
      />
    </NCard>

    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <NPopconfirm
        @positive-click="resetPanelConfig"
      >
        <template #trigger>
          <NButton size="small" quaternary type="error">
            {{ $t('common.reset') }}
          </NButton>
        </template>
        {{ $t('apps.baseSettings.resetWarnText') }}
      </NPopconfirm>

      <NButton size="small" quaternary type="success" class="ml-[10px]" @click="saveNow">
        {{ $t('common.save') }}
      </NButton>
    </NCard>
  </div>
</template>

<style scoped>
.text-shadow{
  text-shadow: 0px 0px 5px gray;
}
</style>
