<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { UploadFileInfo } from 'naive-ui'
import { NAlert, NButton, NCheckbox, NCheckboxGroup, NDivider, NSpace, NUpload, useMessage } from 'naive-ui'
import { RoundCardModal, SvgIcon } from '@/components/common'
import type { IconGroup, ImportJsonResult } from '@/utils/jsonImportExport'
import { ConfigVersionLowError, FormatError, exportJson, importJsonString } from '@/utils/jsonImportExport'
import { get as getAbout } from '@/api/system/about'
import { edit as addGroup, getList as getGroupList } from '@/api/panel/itemIconGroup'
import { addMultiple as addMultipleIcons, getListByGroupId } from '@/api/panel/itemIcon'

import { t } from '@/locales'

interface ItemGroup extends Panel.ItemIconGroup {
  items?: Panel.ItemInfo[]
}

const ms = useMessage()

const jsonData = ref<string | null>(null)
const importWarning = ref<string[]>([])
const importRoundModalShow = ref(false)
const exportRoundModalShow = ref(false)
const loading = ref(false)
const uploadLoading = ref(false)
const version = ref('') // 当前软件版本

const importObj = ref<ImportJsonResult | null> (null)

const checkedItems = ref<string[]>(['icons']) // 当前准备导入导出的项目
/** 导入时被后端丢弃的唯一标识 (重复/非法), 导入完成后提示用户 */
const droppedOnlyNames = ref<string[]>([])

// 导入图标
async function importIcons(): Promise<string | null> {
  const groups = importObj.value?.geticons()
  const batchSize = 50

  droppedOnlyNames.value = []

  if (!groups)
    return null

  try {
    for (let i = 0; i < groups.length; i++) {
      const element = groups[i]

      // 创建组得到组id
      const createGroupResponse = await addGroup<Panel.ItemIconGroup>({
        title: element.title,
        sort: element.sort,
      })

      if (createGroupResponse.code === 0) {
        const groupId = createGroupResponse.data?.id

        if (groupId) {
          let addIcons: Panel.ItemInfo[] = []

          // 批量添加子项
          for (let iconI = 0; iconI < element.children.length; iconI++) {
            const iconElement = element.children[iconI]

            addIcons.push({
              title: iconElement.title,
              sort: iconElement.sort,
              icon: iconElement.icon,
              url: iconElement.url,
              lanUrl: iconElement.lanUrl,
              description: iconElement.description,
              openMethod: iconElement.openMethod,
              itemIconGroupId: groupId,
              // 旧版本导出的文件没有 onlyName 字段, 此时为空串 (与新建项目一致)
              onlyName: (iconElement.onlyName ?? '').trim(),
            })

            // 每 batchSize 个添加一次
            if (addIcons.length === batchSize || iconI === element.children.length - 1) {
              const response = await addMultipleIcons<{ list: Panel.ItemInfo[]; droppedOnlyNames: string[] }>(addIcons)

              if (response.code !== 0)
                return response.msg

              // 后端会把「重复或非法」的唯一标识降级为空串并回报, 这里汇总后提示用户
              if (response.data?.droppedOnlyNames?.length)
                droppedOnlyNames.value.push(...response.data.droppedOnlyNames)

              addIcons = []
            }
          }
        }
      }
      else {
        return createGroupResponse.msg
      }
    }

    return null
  }
  catch (error) {
    if (error instanceof Error)
      return `${t('common.failed')}: ${error.message}`
    else
      return t('common.unknownError')
  }
}

// 导出图标
// 失败时抛错由调用方提示: 旧实现静默返回空数组/跳过失败分组, 会导出缺数据的文件却提示「导出成功」
async function exportIcons(): Promise<IconGroup[]> {
  const { code, msg, data } = await getGroupList<Common.ListResponse<ItemGroup[]>>()
  if (code !== 0 || !data?.list)
    throw new Error(msg || t('common.failed'))

  const missingGroups: string[] = []
  const iconGroups = await Promise.all(data.list.map(async (element) => {
    const group: IconGroup = {
      title: element.title as string,
      sort: element.sort as 0,
      children: [],
    }

    const res = await getListByGroupId<Common.ListResponse<Panel.ItemInfo[]>>(element.id)

    if (res.code === 0 && res.data?.list) {
      for (const iconElement of res.data.list) {
        group.children.push({
          icon: iconElement.icon,
          sort: iconElement.sort || 99999,
          title: iconElement.title,
          url: iconElement.url,
          lanUrl: iconElement.lanUrl || '',
          description: iconElement.description || '',
          openMethod: iconElement.openMethod || 1,
          onlyName: iconElement.onlyName || '',
        })
      }
    }
    else {
      missingGroups.push(element.title as string)
    }

    return group
  }))

  if (missingGroups.length > 0)
    throw new Error(`${t('apps.exportImport.exportMissingGroups')}: ${missingGroups.join(', ')}`)

  return iconGroups
}

onMounted(() => {
  interface Version {
    versionName: string
    versionCode: number
  }

  getAbout<Version>().then((res) => {
    if (res.code === 0)
      version.value = res.data.versionName
  })
})

function handleFileChange(options: { file: UploadFileInfo; fileList: Array<UploadFileInfo> }) {
  const file = options.file.file
  if (!file)
    return

  uploadLoading.value = true
  const reader = new FileReader()
  reader.onload = () => {
    if (reader.result) {
      jsonData.value = reader.result as string
      importCheck()
    }
    else {
      ms.error(`${t('common.failed')}: ${t('common.repeatLater')}`)
    }
    uploadLoading.value = false
  }
  // 读取失败也必须复位 loading, 否则导入按钮会一直处于 loading
  reader.onerror = () => {
    uploadLoading.value = false
    ms.error(`${t('common.failed')}: ${t('common.repeatLater')}`)
  }
  reader.readAsText(file)
}

// 验证导入文件
function importCheck() {
  importWarning.value = []
  if (jsonData.value) {
    try {
      importObj.value = importJsonString(jsonData.value)
      if (importObj.value) {
        if (!importObj.value.isPassCheckMd5())
          importWarning.value.push(t('apps.exportImport.fileModified'))

        if (!importObj.value.isPassCheckConfigVersionOld())
          importWarning.value.push(t('apps.exportImport.warnConfigFileLow'))

        if (!importObj.value.isPassCheckConfigVersionNew())
          importWarning.value.push(t('apps.exportImport.softwareVersionLow'))

        // 通过了验证,打开弹窗
        importRoundModalShow.value = !importRoundModalShow.value
      }
    }
    catch (error) {
      if (error instanceof ConfigVersionLowError) {
        ms.error(t('apps.exportImport.errorConfigFileLow'))
      }
      else if (error instanceof FormatError) {
        ms.error(t('apps.exportImport.errorConfigFileFormat'))
      }
      else {
        // 非预期异常 (如导入文件顶层是 null / 数字时的 TypeError) 也必须给出提示
        console.error('import config failed', error)
        ms.error(t('apps.exportImport.errorConfigFileFormat'))
      }
    }
  }
  else {
    ms.error(t('apps.exportImport.errorConfigFileFormat'))
  }
}

// 开始导出
async function handleStartExport() {
  loading.value = true
  try {
    // 获取软件版本号
    const exportResult = exportJson(version.value)
    if (checkedItems.value.includes('icons')) {
      const iconGroups = await exportIcons()
      exportResult.addIconsData(iconGroups)
    }

    jsonData.value = exportResult.string()
    exportResult.exportFile()
    exportRoundModalShow.value = false
  }
  catch (error) {
    ms.error(error instanceof Error ? `${t('apps.exportImport.exportFail')}: ${error.message}` : t('apps.exportImport.exportFail'))
  }
  finally {
    loading.value = false
  }
}

// 开始导入
async function handleStartImport() {
  loading.value = true
  try {
    if (checkedItems.value.includes('icons')) {
      const errMsg = await importIcons()
      if (errMsg !== null) {
        // 失败: 保持弹窗打开, 用户可修正后重试 (旧实现用 ms.success 报错且照样提示「操作成功」)
        ms.error(`${t('common.failed')}: ${errMsg}`)
        return
      }
    }

    // 唯一标识被降级时提示 (导入本身成功, 只是这些项目的标识为空)
    if (droppedOnlyNames.value.length > 0) {
      const preview = droppedOnlyNames.value.slice(0, 3).join(', ')
      ms.warning(t('apps.exportImport.onlyNameDropped', {
        count: droppedOnlyNames.value.length,
        names: droppedOnlyNames.value.length > 3 ? `${preview} …` : preview,
      }))
    }

    importRoundModalShow.value = false
    ms.success(`${t('common.success')}, ${t('common.refreshPage')}`)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="pt-2">
    <NAlert type="info" :bordered="false">
      <p>{{ $t('apps.exportImport.tip') }}</p>
    </NAlert>
    <div class="flex justify-center m-[50px]">
      <div class="m-[10px]">
        <NUpload
          accept=".sun-panel.json,.sunpanel.json"
          directory-dnd
          :default-upload="false"
          :show-file-list="false"
          @change="handleFileChange"
        >
          <NButton type="info" size="large" :loading="uploadLoading">
            <template #icon>
              <SvgIcon icon="fa6:solid-file-import" />
            </template>
            {{ $t('apps.exportImport.import') }}
          </NButton>
        </NUpload>
      </div>
      <div class="m-[10px]">
        <NButton type="info" size="large" @click="exportRoundModalShow = !exportRoundModalShow">
          <template #icon>
            <SvgIcon icon="fa6:solid-file-export" />
          </template>
          {{ $t('apps.exportImport.export') }}
        </NButton>
      </div>
    </div>

    <RoundCardModal v-model:show="importRoundModalShow" style="max-width: 400px;" :title=" $t('apps.exportImport.import')">
      <div v-if="importWarning.length > 0">
        <NAlert :title="$t('common.warning')" type="warning">
          <div v-for="(text, index) in importWarning " :key="index">
            {{ text }}
          </div>
        </NAlert>
      </div>
      <NDivider title-placement="left">
        {{ $t('apps.exportImport.selectImportData') }}
      </NDivider>

      <NSpace justify="center" style="margin-top: 20px;">
        <NCheckboxGroup v-model:value="checkedItems">
          <NCheckbox value="icons" :label="$t('apps.exportImport.moduleIcon')" />
        </NCheckboxGroup>
      </NSpace>
      <NSpace justify="center">
        <div class="mt-[50px]">
          <NButton type="success" :disabled="checkedItems.length === 0" :loading="loading" @click="handleStartImport">
            {{ $t('common.continue') }}
          </NButton>
        </div>
      </NSpace>
    </RoundCardModal>

    <RoundCardModal v-model:show="exportRoundModalShow" style="max-width: 400px;" :title=" $t('apps.exportImport.export')">
      <NDivider title-placement="left">
        {{ $t('apps.exportImport.selectExportData') }}
      </NDivider>

      <NSpace justify="center" style="margin-top: 20px;">
        <NCheckboxGroup v-model:value="checkedItems">
          <NCheckbox value="icons" :label="$t('apps.exportImport.moduleIcon')" />
        </NCheckboxGroup>
      </NSpace>
      <NSpace justify="center">
        <div class="mt-[50px]">
          <NButton type="success" :disabled="checkedItems.length === 0" :loading="loading" @click="handleStartExport">
            {{ $t('common.continue') }}
          </NButton>
        </div>
      </NSpace>
    </RoundCardModal>
  </div>
</template>
