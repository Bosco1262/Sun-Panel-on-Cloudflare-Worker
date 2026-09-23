<script setup lang="ts">
import { NAlert, NButton, NButtonGroup, NCard, NEllipsis, NGrid, NGridItem, NImage, NImageGroup, NSpin, NSwitch, useDialog, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { cleanUnused, deletes, getList } from '@/api/system/file'
import { getStorageSettings, saveStorageSettings } from '@/api/system/setting'
import { RoundCardModal, SvgIcon } from '@/components/common'
import { copyToClipboard, timeFormat } from '@/utils/cmn'
import { t } from '@/locales'
import { reportApiError, reportThrownError } from '@/utils/request/apiMessage'
import { usePanelState } from '@/store'

interface InfoModalState {
  title: string
  show: boolean
  fileInfo: File.Info | null
}
const imageList = ref<File.Info[]>([])
const ms = useMessage()
const dialog = useDialog()
const panelStore = usePanelState()
const loading = ref(false)
const cleaning = ref(false)
/**
 * Whether deleting an item/group automatically reclaims unreferenced images (on by default, matching the endpoint default)
 *
 * 删除项目/分组时是否自动回收未引用图片 (默认开, 与接口默认值一致)
 */
const autoCleanUnused = ref(true)
const savingSetting = ref(false)
const infoModalState = ref<InfoModalState>({
  show: false,
  title: '',
  fileInfo: null,
})

async function getFileList() {
  loading.value = true
  try {
    const { code, data, msg } = await getList<Common.ListResponse<File.Info[]>>()
    if (code === 0 && data?.list)
      imageList.value = data.list
    else if (code !== 0)
      reportApiError({ code, msg }, text => ms.error(text), 'common.failed')
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'common.failed')
  }
  finally {
    // It must be reset: the old implementation left loading true forever when the request failed, so the page spun forever
    // 必须复位: 旧实现在请求失败时会让 loading 永远为 true, 页面一直转圈
    loading.value = false
  }
}

async function copyImageUrl(text: string) {
  const res = await copyToClipboard(text)
  if (res)
    ms.success(t('apps.uploadsFileManager.copySuccess'))

  else
    ms.error(t('apps.uploadsFileManager.copyFailed'))
}

function handleDelete(id: number) {
  dialog.warning({
    title: t('common.warning'),
    content: t('apps.uploadsFileManager.deleteWarningText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      deletesImges(id)
    },
  })
}

async function deletesImges(id: number) {
  try {
    const { code, msg } = await deletes([id])
    if (code === 0) {
      getFileList()
      ms.success(t('common.success'))
    }
    else {
      reportApiError({ code, msg }, text => ms.error(text), 'common.failed')
    }
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'common.failed')
  }
}

function handleInfoClick(fileInfo: File.Info) {
  infoModalState.value.fileInfo = fileInfo
  infoModalState.value.show = true
}

// Cleans up unreferenced files: after deleting an item/group its images become orphans (an object in R2 plus a row in the list)
// 清理未被引用的文件: 删除项目/分组后, 对应的图片会变成孤儿 (R2 里有对象、列表里还有记录)
function handleCleanUnused() {
  dialog.warning({
    title: t('common.warning'),
    content: t('apps.uploadsFileManager.cleanUnusedWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      cleanUnusedImages()
    },
  })
}

async function cleanUnusedImages() {
  cleaning.value = true
  try {
    let deletedTotal = 0

    // The backend handles one batch per call (the free plan caps subrequests per invocation), so loop until nothing is left;
    // the 50-round cap is a defensive backstop against an endless loop in a bad state
    //
    // 后端每次只处理一批 (免费版单次调用子请求有限), 这里循环到没有剩余;
    // 上限 50 轮是防御性兜底, 避免异常情况下无限循环
    for (let round = 0; round < 50; round++) {
      const { code, msg, data } = await cleanUnused<{ checked: number; deleted: number; remaining: number }>()
      if (code !== 0) {
        reportApiError({ code, msg }, text => ms.error(text), 'common.failed')
        return
      }

      deletedTotal += data?.deleted ?? 0
      if (!data?.remaining)
        break
    }

    ms.success(t('apps.uploadsFileManager.cleanUnusedDone', { count: deletedTotal }))
    getFileList()
  }
  catch (error) {
    reportThrownError(error, text => ms.error(text), 'common.failed')
  }
  finally {
    cleaning.value = false
  }
}

async function handleSetWallpaper(imgSrc: string) {
  const previous = panelStore.panelConfig.backgroundImageSrc
  panelStore.panelConfig.backgroundImageSrc = imgSrc
  try {
    const { code, msg } = await panelStore.persistUserConfig()
    if (code === 0) {
      panelStore.recordState()
      ms.success(t('apps.uploadsFileManager.setWallpaperSuccess'))
      return
    }

    // Roll back on failure, otherwise the UI shows the new wallpaper while the cloud still has the old one
    // 失败回滚, 否则界面显示新壁纸但云端仍是旧的
    panelStore.panelConfig.backgroundImageSrc = previous
    reportApiError({ code, msg }, text => ms.error(text), 'common.failed')
  }
  catch (error) {
    panelStore.panelConfig.backgroundImageSrc = previous
    reportThrownError(error, text => ms.error(text), 'common.failed')
  }
}

// Whether deleting an item/group automatically reclaims unreferenced images
// When off, the images stay in the list for reuse and "Clean unused files" is there for manual work
//
// 删除项目/分组时是否自动回收未引用的图片
// 关掉后图片保留在列表里可复用, 需要时再手动点「清理未引用文件」
async function handleAutoCleanChange(value: boolean) {
  // Ignore repeat triggers while saving, and skip the request when the value did not change
  // 保存中忽略重复触发, 值未变化时不请求
  if (savingSetting.value || value === autoCleanUnused.value)
    return

  const previous = autoCleanUnused.value
  autoCleanUnused.value = value
  savingSetting.value = true
  try {
    const { code, msg } = await saveStorageSettings<unknown>(value)
    if (code === 0) {
      ms.success(t('common.saveSuccess'))
    }
    else {
      autoCleanUnused.value = previous
      reportApiError({ code, msg }, text => ms.error(text), 'common.failed')
    }
  }
  catch (error) {
    autoCleanUnused.value = previous
    reportThrownError(error, text => ms.error(text), 'common.failed')
  }
  finally {
    savingSetting.value = false
  }
}

// Clicking the explanatory text is equivalent to clicking the switch
// 点击文字说明区与点击开关等效
function handleToggleAutoCleanUnused() {
  handleAutoCleanChange(!autoCleanUnused.value)
}

async function loadStorageSettings() {
  try {
    const { code, data } = await getStorageSettings<{ autoCleanUnused: boolean }>()
    if (code === 0 && typeof data?.autoCleanUnused === 'boolean')
      autoCleanUnused.value = data.autoCleanUnused
  }
  catch {
    // A failed read keeps the default (on), matching the endpoint's default
    // 读取失败保持默认(开), 与接口侧默认值一致
  }
}

onMounted(() => {
  getFileList()
  loadStorageSettings()
})
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 p-2 h-full flex flex-col gap-2">
    <NAlert type="info" :bordered="false" class="shrink-0">
      {{ $t('apps.uploadsFileManager.alertText') }}
    </NAlert>

    <!-- Toolbar: automatic-cleanup settings on the left (clicking the text toggles the switch), the manual cleanup button on the right -->
    <!-- 工具栏: 左侧自动清理设置(点击文字同开关), 右侧手动清理按钮 -->
    <div class="shrink-0 flex items-center flex-wrap gap-x-4 gap-y-2 px-3 py-2 bg-white dark:bg-zinc-800 rounded-xl">
      <div class="flex flex-1 items-center gap-2 min-w-0">
        <NSwitch
          :value="autoCleanUnused"
          size="small"
          :loading="savingSetting"
          @update:value="handleAutoCleanChange"
        />
        <div class="min-w-0 cursor-pointer select-none" @click="handleToggleAutoCleanUnused">
          <div class="text-sm leading-tight">
            {{ $t('apps.uploadsFileManager.autoCleanUnused') }}
          </div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-[2px]">
            {{ $t('apps.uploadsFileManager.autoCleanUnusedTip') }}
          </div>
        </div>
      </div>

      <NButton size="small" secondary :loading="cleaning" @click="handleCleanUnused">
        <template #icon>
          <SvgIcon icon="material-symbols:delete-outline-rounded" />
        </template>
        {{ $t('apps.uploadsFileManager.cleanUnused') }}
      </NButton>
    </div>

    <!-- File list: flex-1 fills the remaining height and scrolls internally -->
    <!-- 文件列表: flex-1 自适应剩余高度, 内部滚动 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <div v-if="loading" class="h-full flex items-center justify-center">
        <NSpin size="small" />
      </div>
      <div v-else-if="imageList.length === 0" class="h-full flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        {{ $t('apps.uploadsFileManager.nothingText') }}
      </div>
      <NImageGroup v-else>
        <NGrid cols="2 300:2 600:4 900:6 1100:9" :x-gap="5" :y-gap="5">
          <NGridItem v-for=" item in imageList" :key="item.id">
            <NCard size="small" style="border-radius: 5px;" :bordered="true">
              <template #cover>
                <div class="card transparent-grid">
                  <NImage :lazy="true" style="object-fit: contain;height: 100%;" :src="item.src" />
                </div>
              </template>
              <template #footer>
                <span class="text-xs">
                  <NEllipsis>
                    {{ item.fileName }}
                  </NEllipsis>
                </span>
                <div class="flex justify-center mt-[10px]">
                  <NButtonGroup>
                    <NButton size="tiny" tertiary style="cursor: pointer;" :title="$t('apps.uploadsFileManager.copyLink')" @click="copyImageUrl(item.src)">
                      <template #icon>
                        <SvgIcon icon="ion-copy" />
                      </template>
                    </NButton>
                    <NButton size="tiny" tertiary style="cursor: pointer;" :title="timeFormat(item.createTime)" @click="handleInfoClick(item)">
                      <template #icon>
                        <SvgIcon icon="mdi-information-box-outline" />
                      </template>
                    </NButton>
                    <NButton size="tiny" tertiary style="cursor: pointer;" :title="$t('apps.uploadsFileManager.setWallpaper')" @click="handleSetWallpaper(item.src)">
                      <template #icon>
                        <SvgIcon icon="lucide:wallpaper" />
                      </template>
                    </NButton>
                    <NButton size="tiny" tertiary type="error" style="cursor: pointer;" :title="$t('common.delete')" @click="handleDelete(item.id as number)">
                      <template #icon>
                        <SvgIcon icon="material-symbols-delete" />
                      </template>
                    </NButton>
                  </NButtonGroup>
                </div>
              </template>
            </NCard>
          </NGridItem>
        </NGrid>
      </NImageGroup>
    </div>

    <RoundCardModal v-model:show="infoModalState.show" style="max-width: 300px;" size="small" :title="$t('apps.uploadsFileManager.infoTitle')">
      <div>
        <div>
          <div class="mb-2">
            <span class="text-slate-500">
              {{ $t('apps.uploadsFileManager.fileName') }}
            </span>
            <div class="text-xs">
              {{ infoModalState.fileInfo?.fileName }}
            </div>
          </div>
          <div class="mb-2">
            <span class="text-slate-500">
              {{ $t('apps.uploadsFileManager.path') }}
            </span>
            <div class="text-xs">
              {{ infoModalState.fileInfo?.src }}
            </div>
          </div>
          <div class="mb-2">
            <span class="text-slate-500">
              {{ $t('apps.uploadsFileManager.uploadTime') }}
            </span>
            <div class="text-xs">
              {{ timeFormat(infoModalState.fileInfo?.createTime) }}
            </div>
          </div>
        </div>
      </div>
    </RoundCardModal>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 80px;
}

.transparent-grid {
  background-image: linear-gradient(45deg, rgba(0, 0, 0, 0.03) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.03) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.03) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.03) 75%);
  background-size: 12px 12px;
  background-position: 0 0, 6px 6px;
}
</style>
