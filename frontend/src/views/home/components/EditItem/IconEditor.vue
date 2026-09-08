<script setup lang="ts">
import { NButton, NCheckbox, NColorPicker, NInput, NTooltip, NUpload } from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, defineProps, ref } from 'vue'
import { SvgIcon } from '@/components/common'
import AppIcon from '@/views/home/components/AppIcon/index.vue'
import { PanelPanelConfigStyleEnum } from '@/enums'
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

// 预览显示与画布透明
const previewShow = ref(true)
const canvasTransparent = ref(true)

// 图标风格选项
const iconStyleOptions = [
  { type: 1, label: t('common.text') },
  { type: 2, label: t('common.image') },
  { type: 3, label: t('iconItem.onlineIcon') },
]

// 默认图标背景色
const defautSwatchesBackground = [
  '#00000000',
  '#000000',
  '#ffffff',
  '#18A058',
  '#2080F0',
  '#F0A020',
  'rgba(208, 48, 80, 1)',
  '#C418D1FF',
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

// 预览用的完整项目信息（标题/描述实时跟随表单）
const previewItemInfo = computed<Panel.ItemInfo>(() => ({
  icon: itemIconInfo.value,
  title: props.title || t('common.title'),
  description: props.description,
  url: '',
  openMethod: 1,
}))

// 当前全局图标风格是否为长条形（详情图标）
const isInfoStyle = computed(() => panelState.panelConfig.iconStyle === PanelPanelConfigStyleEnum.info)

function handleIconTypeChange(type: number) {
  itemIconInfo.value.itemType = type
  handleChange()
}

function handleChange() {
  emit('update:itemIcon', itemIconInfo.value || null)
}

function handleResetBackgroundColor() {
  itemIconInfo.value.backgroundColor = initData.backgroundColor
  handleChange()
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
        {{ $t('iconItem.previewReference') }}
      </NCheckbox>
      <NCheckbox v-model:checked="canvasTransparent">
        {{ $t('iconItem.canvasTransparent') }}
      </NCheckbox>
    </div>

    <!-- 效果预览（两种卡片布局，纯展示，切换需到设置中修改） -->
    <div v-if="previewShow" class="mb-[10px]">
      <div
        class="border rounded-2xl overflow-hidden w-full h-[110px] flex justify-center items-center gap-[16px] p-[8px]"
        :class="canvasTransparent ? 'transparent-grid' : 'bg-slate-200 dark:bg-zinc-800'"
      >
        <!-- 长条形（详情图标） -->
        <div
          class="w-[210px] h-[70px] flex justify-center items-center rounded-xl border transition-all duration-200"
          :class="isInfoStyle ? 'border-[#2080f0] bg-[#e8f4ff] dark:bg-[#182848]' : 'border-transparent'"
        >
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
        <div
          class="w-[86px] flex justify-center items-center rounded-xl border transition-all duration-200"
          :class="!isInfoStyle ? 'border-[#2080f0] bg-[#e8f4ff] dark:bg-[#182848]' : 'border-transparent'"
        >
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

    <!-- 图标风格 -->
    <div class="flex items-center mb-[5px]">
      <div class="text-slate-500 font-bold mr-[5px]">
        {{ $t('iconItem.iconStyle') }}
      </div>
      <NTooltip trigger="hover" placement="top">
        <template #trigger>
          <SvgIcon icon="tabler:info-circle" class="text-slate-400" />
        </template>
        {{ $t('iconItem.iconStyleTip') }}
      </NTooltip>
    </div>

    <div class="flex gap-[10px] mb-[10px]">
      <NButton
        v-for="option in iconStyleOptions"
        :key="option.type"
        size="small"
        :type="itemIconInfo.itemType === option.type ? 'primary' : 'default'"
        :secondary="itemIconInfo.itemType !== option.type"
        @click="handleIconTypeChange(option.type)"
      >
        {{ option.label }}
      </NButton>
    </div>

    <!-- 文字 -->
    <div v-if="itemIconInfo.itemType === 1" class="mb-[10px]">
      <div class="text-slate-500 font-bold mb-[5px]">
        {{ $t('common.text') }}
      </div>
      <NInput v-model:value="itemIconInfo.text" type="text" :placeholder="$t('common.inputPlaceholder')" @input="handleChange" />
    </div>

    <!-- 图片 -->
    <div v-if="itemIconInfo.itemType === 2" class="mb-[10px]">
      <div class="text-slate-500 font-bold mb-[5px]">
        {{ $t('iconItem.imageUrl') }}
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
      <div class="text-slate-500 font-bold mb-[5px]">
        {{ $t('iconItem.onlineIcon') }}
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

    <!-- 背景颜色 -->
    <div class="flex items-center">
      <div class="w-auto text-slate-500 mr-[10px]">
        {{ $t('common.backgroundColor') }}
      </div>
      <div class="w-[150px] flex items-center mr-[10px]">
        <NColorPicker
          v-model:value="itemIconInfo.backgroundColor"
          size="small"
          :modes="['hex']"
          :swatches="defautSwatchesBackground"
          @complete="handleChange"
          @update-value="handleChange"
        />
      </div>
      <div v-if="itemIconInfo.backgroundColor !== initData.backgroundColor" class="w-auto text-slate-500 mr-[10px] cursor-pointer">
        <NButton quaternary type="info" @click="handleResetBackgroundColor">
          {{ $t('common.reset') }}
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
