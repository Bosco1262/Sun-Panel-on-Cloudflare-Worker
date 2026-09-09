<script setup lang="ts">
import { NButton, NCheckbox, NInput, NRadioButton, NRadioGroup, NTooltip, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, defineProps, ref } from 'vue'
import { SvgIcon } from '@/components/common'
import AppIcon from '@/views/home/components/AppIcon/index.vue'
import { useAuthStore, usePanelState } from '@/store'
import { apiRespErrMsg } from '@/utils/request/apiMessage'
import { t } from '@/locales'

const props = defineProps<{
  itemIcon: Panel.ItemIcon | null
  title?: string
  description?: string
}>()
const emit = defineEmits<{
  (e: 'update:itemIcon', visible: Panel.ItemIcon): void // 定义修改父组件（prop内）的值的事件
}>()
const authStore = useAuthStore()
const panelState = usePanelState()

// 预览显示与画布透明（默认不透明，对齐上游）
const previewShow = ref(true)
const canvasTransparent = ref(false)

// 图标风格选项 (对齐上游: 文字 / 图片 / 在线图标)
const iconStyleOptions = [
  { type: 1, label: t('iconItem.icon.textContent') },
  { type: 2, label: t('common.image') },
  { type: 3, label: t('iconItem.onlineIcon') },
]

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

// 预览用的完整项目信息（标题/描述实时跟随表单，留空则与上游一致显示为空）
const previewItemInfo = computed<Panel.ItemInfo>(() => ({
  icon: itemIconInfo.value,
  title: props.title ?? '',
  description: props.description,
  url: '',
  openMethod: 1,
}))

function handleIconTypeChange(type: number) {
  itemIconInfo.value.itemType = type
  handleChange()
}

function handleChange() {
  emit('update:itemIcon', itemIconInfo.value || null)
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
    // ms.error(`${t('common.uploadFail')}:${res.msg}`)
  }

  return file
}
</script>

<template>
  <div>
    <!-- 预览开关 -->
    <div class="flex items-center mb-[10px]">
      <NCheckbox v-model:checked="previewShow" class="mr-[20px]">
        {{ $t('iconItem.preview') }}
      </NCheckbox>
      <NCheckbox v-model:checked="canvasTransparent">
        {{ $t('iconItem.previewTransparentCanvas') }}
      </NCheckbox>
    </div>

    <!-- 效果预览（两种卡片布局，纯展示，切换需到设置中修改；结构对齐上游 preview-box） -->
    <div v-if="previewShow" class="mb-2">
      <div
        class="preview-box rounded-xl border w-full"
        :class="canvasTransparent ? 'transparent-grid' : 'bg-[#f1f8ff]'"
      >
        <div class="flex justify-center p-2">
          <!-- 长条形（详情图标） -->
          <div class="w-[210px] mr-4 z-[-1]">
            <!-- style 必须传字面量（0=长条形/1=正方形），动态表达式会被 Vue 编译为 _normalizeStyle() 导致数字变成 undefined -->
            <AppIcon
              :item-info="previewItemInfo"
              :icon-text-color="panelState.panelConfig.iconTextColor"
              :icon-text-info-hide-description="panelState.panelConfig.iconTextInfoHideDescription || false"
              :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
              :style="0"
            />
          </div>

          <!-- 正方形（小图标） -->
          <div class="z-[-1]">
            <AppIcon
              :item-info="previewItemInfo"
              :icon-text-color="panelState.panelConfig.iconTextColor"
              :icon-text-info-hide-description="!panelState.panelConfig.iconTextInfoHideDescription"
              :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
              :style="1"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 图标风格 (对齐上游: Radio 组) -->
    <div class="flex items-center mb-[5px]">
      <div class="text-slate-500 font-bold mr-[5px]">
        {{ $t('iconItem.icon.iconStyle') }}
      </div>
      <NTooltip trigger="hover" placement="top">
        <template #trigger>
          <SvgIcon icon="tabler:info-circle" class="text-slate-400" />
        </template>
        {{ $t('iconItem.icon.iconSizeTip') }}
      </NTooltip>
    </div>

    <NRadioGroup
      :value="itemIconInfo.itemType"
      name="iconType"
      class="mb-[10px]"
      @update:value="(v: number) => handleIconTypeChange(v)"
    >
      <NRadioButton v-for="option in iconStyleOptions" :key="option.type" :value="option.type">
        {{ option.label }}
      </NRadioButton>
    </NRadioGroup>

    <!-- 文字 -->
    <div v-if="itemIconInfo.itemType === 1" class="mb-[10px]">
      <div class="text-slate-500 font-bold mb-[5px]">
        {{ $t('iconItem.icon.textContent') }}
      </div>
      <NInput v-model:value="itemIconInfo.text" type="text" show-count :maxlength="10" :placeholder="$t('common.inputPlaceholder')" @input="handleChange" />
    </div>

    <!-- 图片 -->
    <div v-if="itemIconInfo.itemType === 2" class="mb-[10px]">
      <div class="text-slate-500 font-bold mb-[5px]">
        {{ $t('iconItem.icon.imageUrl') }}
      </div>
      <div class="flex gap-[10px]">
        <NInput v-model:value="itemIconInfo.src" class="flex-1" type="text" :placeholder="$t('iconItem.inputIconUrlOrUpload')" @input="handleChange" />
        <NButton tag="a" target="_blank" href="https://icon-sets.iconify.design/">
          <template #icon>
            <SvgIcon icon="tabler:photo" />
          </template>
          {{ $t('iconItem.iconLibrary') }}
        </NButton>
        <NUpload
          action="/api/file/uploadImg"
          :show-file-list="false"
          name="imgfile"
          :headers="{
            token: authStore.token as string,
          }"
          @finish="handleUploadFinish"
        >
          <NButton>
            <template #icon>
              <SvgIcon icon="tabler:upload" />
            </template>
            {{ $t('iconItem.selectUpload') }}
          </NButton>
        </NUpload>
      </div>
    </div>

    <!-- 在线图标 -->
    <div v-if="itemIconInfo.itemType === 3" class="mb-[10px]">
      <div class="text-slate-500 font-bold mb-[5px] flex items-center">
        {{ $t('iconItem.onlineIcon') }}
        <NTooltip trigger="hover" placement="top">
          <template #trigger>
            <SvgIcon icon="tabler:info-circle" class="text-slate-400 ml-[5px]" />
          </template>
          {{ $t('iconItem.icon.iconOnlineTip') }}
        </NTooltip>
      </div>
      <div class="flex gap-[10px]">
        <NInput v-model:value="itemIconInfo.text" class="flex-1" type="text" :placeholder="$t('iconItem.inputIconName')" @input="handleChange" />
        <NButton tag="a" target="_blank" href="https://icon-sets.iconify.design/">
          <template #icon>
            <SvgIcon icon="tabler:apps" />
          </template>
          {{ $t('iconItem.onlineIconLibrary') }}
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-box {
    position: relative;
    z-index: 1;
}
.dark .preview-box {
    filter: brightness(80%);
}
.transparent-grid {
    background-image: linear-gradient(45deg, rgba(0, 0, 0, 0.04) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.04) 75%),
                      linear-gradient(45deg, rgba(0, 0, 0, 0.04) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.04) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
}
.dark .transparent-grid {
    background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.06) 75%),
                      linear-gradient(45deg, rgba(255, 255, 255, 0.06) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.06) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
}
</style>
