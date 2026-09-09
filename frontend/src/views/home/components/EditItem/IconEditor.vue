<script setup lang="ts">
import { NButton, NInput, NRadioButton, NRadioGroup, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, ref } from 'vue'
import GalleryPicker from './GalleryPicker.vue'
import { SvgIcon } from '@/components/common'
import { useAuthStore } from '@/store'
import { apiRespErrMsg } from '@/utils/request/apiMessage'

const props = defineProps<{
  itemIcon: Panel.ItemIcon | null
}>()
const emit = defineEmits<{
  (e: 'update:itemIcon', visible: Panel.ItemIcon): void // 定义修改父组件（prop内）的值的事件
}>()
const authStore = useAuthStore()

const initData: Panel.ItemIcon = {
  itemType: 2,
  backgroundColor: '#2a2a2a6b',
}

const itemIconInfo = computed({
  get() {
    const v = {
      ...initData,
      ...props.itemIcon,
      backgroundColor: props.itemIcon?.backgroundColor || initData.backgroundColor,
    }
    return v
  },
  set() {
    handleChange()
  },
})

function handleIconTypeChange(type: number) {
  itemIconInfo.value.itemType = type
  handleChange()
}

function handleChange() {
  emit('update:itemIcon', itemIconInfo.value || null)
}

// 图库选择 (对齐上游: 选中后自动切换为图片模式并填充地址)
const galleryShow = ref(false)

function handleGallerySelected(file: File.Info) {
  if (file && file.src) {
    itemIconInfo.value.itemType = 2
    itemIconInfo.value.src = file.src
    handleChange()
  }
}

const handleUploadFinish = ({
  file,
  event,
}: {
  file: UploadFileInfo
  event?: ProgressEvent
}) => {
  const res = JSON.parse((event?.target as XMLHttpRequest).response)
  if (res.code === 0) {
    const imageUrl = res.data.imageUrl
    itemIconInfo.value.src = imageUrl
    emit('update:itemIcon', itemIconInfo.value || null)
  }
  else {
    apiRespErrMsg(res)
  }

  return file
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
          @input="handleChange"
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
            @input="handleChange"
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
            @input="handleChange"
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
            action="/api/file/uploadImg"
            :show-file-list="false"
            name="imgfile"
            :headers="{
              token: authStore.token as string,
            }"
            @finish="handleUploadFinish"
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
