<script setup lang="ts">
import { NButton, NInput, NRadioButton, NRadioGroup, NUpload, useMessage } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { ref, watch } from 'vue'
import GalleryPicker from './GalleryPicker.vue'
import { SvgIcon } from '@/components/common'
import { useAuthStore } from '@/store'
import { apiRespErrMsg } from '@/utils/request/apiMessage'
import { t } from '@/locales'

const props = defineProps<{
  itemIcon: Panel.ItemIcon | null
}>()
const emit = defineEmits<{
  (e: 'update:itemIcon', itemIcon: Panel.ItemIcon): void
}>()
const authStore = useAuthStore()
const ms = useMessage()

const initData: Panel.ItemIcon = {
  itemType: 2,
  backgroundColor: '#2a2a2a6b',
}

// 上传接口跟随统一 API 基址 (硬编码 /api 在子路径/独立域名部署时会失效)
const uploadAction = `${import.meta.env.VITE_GLOB_API_URL || '/api'}/file/uploadImg`

/** 补齐默认值与背景色 (空背景色回退默认) */
function normalizeItemIcon(icon: Panel.ItemIcon | null | undefined): Panel.ItemIcon {
  return {
    ...initData,
    ...icon,
    backgroundColor: icon?.backgroundColor || initData.backgroundColor,
  }
}

// 本地编辑态 + 显式 commit。
// 旧实现是「往 computed 返回的临时对象上写值, 靠 computed 缓存不失效」, 一旦 computed
// 依赖变化或被改成普通函数, 图标类型/地址就会静默丢失
const itemIconInfo = ref<Panel.ItemIcon>(normalizeItemIcon(props.itemIcon))

// 切换编辑对象时重新同步
watch(() => props.itemIcon, (v) => {
  itemIconInfo.value = normalizeItemIcon(v)
})

function commit() {
  emit('update:itemIcon', { ...itemIconInfo.value })
}

function handleIconTypeChange(type: number) {
  itemIconInfo.value.itemType = type
  commit()
}

// 图库选择 (对齐上游: 选中后自动切换为图片模式并填充地址)
const galleryShow = ref(false)

function handleGallerySelected(file: File.Info) {
  if (file && file.src) {
    itemIconInfo.value.itemType = 2
    itemIconInfo.value.src = file.src
    commit()
  }
}

const handleUploadFinish = ({
  file,
  event,
}: {
  file: UploadFileInfo
  event?: ProgressEvent
}) => {
  try {
    const res = JSON.parse((event?.target as XMLHttpRequest).response)
    if (res.code === 0 && res.data?.imageUrl) {
      itemIconInfo.value.src = res.data.imageUrl
      commit()
    }
    else {
      apiRespErrMsg(res)
    }
  }
  catch {
    // 响应不是 JSON (网关错误页等): 必须提示, 否则用户以为图标已上传
    ms.error(t('common.uploadFail'))
  }

  return file
}

/** 上传请求本身失败 (网络/HTTP 错误) 时 NUpload 触发 error 事件 */
function handleUploadError() {
  ms.error(t('common.uploadFail'))
}
</script>

<template>
  <div class="w-full">
    <!-- 图标风格选项 (对齐上游: Radio 组) -->
    <div class="mb-[10px] flex items-center">
      <NRadioGroup
        :value="itemIconInfo.itemType"
        name="iconType"
        @update:value="(v: number) => handleIconTypeChange(v)"
      >
        <NRadioButton :value="1">
          {{ $t('common.text') }}
        </NRadioButton>
        <NRadioButton :value="2">
          {{ $t('common.image') }}
        </NRadioButton>
        <NRadioButton :value="3">
          {{ $t('iconItem.onlineIcon') }}
        </NRadioButton>
      </NRadioGroup>
    </div>

    <div class="w-full flex">
      <!-- 文字 -->
      <div v-if="itemIconInfo.itemType === 1">
        <div class="w-auto mr-2 whitespace-nowrap">
          {{ $t('iconItem.icon.textContent') }}
        </div>
        <NInput
          v-model:value="itemIconInfo.text"
          type="text"
          show-count
          :maxlength="10"
          clearable
          @input="commit"
        />
      </div>

      <!-- 在线图标 -->
      <div v-else-if="itemIconInfo.itemType === 3">
        <div class="w-auto mr-2">
          {{ $t('iconItem.icon.iconName') }}
        </div>
        <div class="flex">
          <NInput
            v-model:value="itemIconInfo.text"
            class="mr-1"
            type="text"
            clearable
            :placeholder="$t('iconItem.inputIconName')"
            @input="commit"
          />
          <NButton quaternary type="info">
            <a target="_blank" href="https://icon-sets.iconify.design/">{{ $t('iconItem.onlineIconLibrary') }}</a>
          </NButton>
        </div>
      </div>

      <!-- 图片 -->
      <div v-else-if="itemIconInfo.itemType === 2" class="w-full">
        <div class="w-auto whitespace-nowrap">
          {{ $t('iconItem.icon.imageUrl') }}
        </div>
        <div class="flex w-full gap-1">
          <NInput
            v-model:value="itemIconInfo.src"
            class="mr-1"
            type="text"
            style="width: 300px;"
            clearable
            :placeholder="$t('iconItem.inputIconUrlOrUpload')"
            @input="commit"
          />
          <span @click="galleryShow = true">
            <NButton size="small" type="success" ghost>
              <template #icon>
                <SvgIcon icon="material-symbols-gallery-thumbnail-outline" />
              </template>
              {{ $t('iconItem.iconLibrary') }}
            </NButton>
          </span>
          <NUpload
            :action="uploadAction"
            :show-file-list="false"
            name="imgfile"
            :headers="authStore.token ? { token: authStore.token } : {}"
            @finish="handleUploadFinish"
            @error="handleUploadError"
          >
            <NButton size="small">
              <template #icon>
                <SvgIcon icon="line-md--upload-outline" />
              </template>
              {{ $t('iconItem.selectUpload') }}
            </NButton>
          </NUpload>
        </div>
      </div>
    </div>

    <GalleryPicker v-model:visible="galleryShow" @selected="handleGallerySelected" />
  </div>
</template>
