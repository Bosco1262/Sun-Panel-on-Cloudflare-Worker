<script setup lang="ts">
import { NAlert, NButton, NButtonGroup, NCard, NEllipsis, NGrid, NGridItem, NImage, NImageGroup, NSpin, NSwitch, useDialog, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { cleanUnused, deletes, getList } from '@/api/system/file'
import { getStorageSettings, saveStorageSettings } from '@/api/system/setting'
import { set as savePanelConfig } from '@/api/panel/userConfig'
import { RoundCardModal, SvgIcon } from '@/components/common'
import { copyToClipboard, timeFormat } from '@/utils/cmn'
import { t } from '@/locales'
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
/** 删除项目/分组时是否自动回收未引用图片 (默认开, 与接口默认值一致) */
const autoCleanUnused = ref(true)
const savingSetting = ref(false)
const infoModalState = ref<InfoModalState>({
  show: false,
  title: '',
  fileInfo: null,
})

async function getFileList() {
  loading.value = true
  const { data } = await getList<Common.ListResponse<File.Info[]>>()
  imageList.value = data.list
  loading.value = false
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
      ms.error(`${t('common.failed')}:${msg}`)
    }
  }
  catch (error) {
    ms.error(t('common.failed'))
  }
}

function handleInfoClick(fileInfo: File.Info) {
  infoModalState.value.fileInfo = fileInfo
  infoModalState.value.show = true
}

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
    const { code, msg, data } = await cleanUnused<{ checked: number; deleted: number }>()
    if (code === 0) {
      ms.success(t('apps.uploadsFileManager.cleanUnusedDone', { count: data?.deleted ?? 0 }))
      getFileList()
    }
    else {
      ms.error(`${t('common.failed')}:${msg}`)
    }
  }
  catch {
    ms.error(t('common.failed'))
  }
  finally {
    cleaning.value = false
  }
}

function handleSetWallpaper(imgSrc: string) {
  panelStore.panelConfig.backgroundImageSrc = imgSrc
  savePanelConfig({ panel: panelStore.panelConfig })
}

// 删除项目/分组时是否自动回收未引用的图片
// 关掉后图片保留在列表里可复用, 需要时再手动点「清理未引用文件」
async function handleAutoCleanChange(value: boolean) {
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
      ms.error(`${t('common.failed')}:${msg}`)
    }
  }
  catch {
    autoCleanUnused.value = previous
    ms.error(t('common.failed'))
  }
  finally {
    savingSetting.value = false
  }
}

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
          <NGridItem v-for=" item, index in imageList" :key="index">
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
