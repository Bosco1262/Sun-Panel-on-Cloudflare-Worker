<script setup lang="ts">
import { computed, defineEmits, defineProps, ref, watch } from 'vue'
import type { FormInst, FormRules } from 'naive-ui'
import { NAlert, NButton, NCheckbox, NColorPicker, NFlex, NForm, NFormItem, NGrid, NGridItem, NInput, NInputGroup, NModal, NSelect, NSpace, NTooltip, useMessage } from 'naive-ui'
import IconEditor from './IconEditor.vue'
import AppIcon from '@/views/home/components/AppIcon/index.vue'
import { SvgIcon } from '@/components/common'
import { edit, getSiteFavicon } from '@/api/panel/itemIcon'
import { getList as getGroupList } from '@/api/panel/itemIconGroup'
import { t } from '@/locales'

interface Props {
  visible: boolean
  itemInfo: Panel.Info | null
  itemGroupId?: number
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

// 更多选项折叠区 (对齐上游: 卡片背景色 / 分组 / 唯一标识, 不含卡片类型)
const showMoreOptions = ref(false)

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

// 更新值父组件传来的值
const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

// 预览用的完整项目信息 (标题/描述实时跟随表单)
const previewItemInfo = computed<Panel.ItemInfo>(() => ({
  icon: model.value.icon,
  title: model.value.title,
  description: model.value.description,
  url: '',
  openMethod: 1,
}))

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

// 地址协议提醒 (对齐上游 urlNoHttpStartWarn)
function isNonHttpUrl(url?: string) {
  return !!url && !/^https?:\/\//i.test(url)
}
const showUrlWarn = computed(() => isNonHttpUrl(model.value.url))
const showLanUrlWarn = computed(() => isNonHttpUrl(model.value.lanUrl))

// 唯一标识仅允许英文/数字/下划线/中划线
watch(() => model.value.onlyName, (v) => {
  if (v && /[^A-Za-z0-9_-]/.test(v))
    model.value.onlyName = v.replace(/[^A-Za-z0-9_-]/g, '')
})

async function editApi() {
  submitLoading.value = true
  try {
    const { code, data, msg } = await edit<Panel.ItemInfo>(model.value)
    if (code === 0) {
      show.value = false
      model.value = { ...restoreDefault }

      emit('done', data)
    }
    else {
      if (code === 1401)
        ms.error(t('iconItem.onlyNameExisted'))
      else
        ms.error(`${t('common.saveFail')}:${msg}`)
    }
  }
  catch (error) {
    ms.error(t('common.saveFail'))
  }
  submitLoading.value = false
}

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
  formRef.value?.validate((errors) => {
    if (errors)
      return
    if (!validateIcon()) {
      ms.error(t('iconItem.selectOneIcon'))
      return
    }
    editApi()
  })
}

async function getIconByUrl(url: string, loadingIndex: number) {
  getIconLoading.value[loadingIndex] = true
  try {
    const { code, data } = await getSiteFavicon<{ iconUrl: string }>(url)
    if (code === 0) {
      model.value.icon = {
        itemType: 2,
        src: data.iconUrl,
      }
    }
    else {
      ms.error(t('iconItem.geticonFail'))
    }
  }
  catch (error) {
    ms.error(t('iconItem.geticonFail'))
  }
  getIconLoading.value[loadingIndex] = false
}

watch(() => props.visible, (newValue) => {
  if (newValue === true) {
    model.value = props.itemInfo ? { ...props.itemInfo } : { ...restoreDefault }
    if (props.itemGroupId)
      model.value.itemIconGroupId = props.itemGroupId
  }

  getGroupListOptions()
})

function getGroupListOptions() {
  getGroupList<Common.ListResponse<Panel.ItemIconGroup[]>>().then(({ data, code, msg }) => {
    if (code === 0) {
      itemIconGroupOptions.value = []

      for (let i = 0; i < data.list.length; i++) {
        const element = data.list[i]
        if (i === 0 && !model.value.itemIconGroupId) {
          model.value.itemIconGroupId = element.id
          restoreDefault.itemIconGroupId = element.id
        }

        itemIconGroupOptions.value.push({
          value: element.id as number,
          label: element.title as string,
        })
      }
    }
    else {
      ms.error(`${t('iconItem.getGroupFail')}:${msg}`)
    }
  })
}
</script>

<template>
  <NModal v-model:show="show" preset="card" size="small" style="width: 600px;border-radius: 1rem;" :title="itemInfo?.id ? t('iconItem.edit') : t('iconItem.add')">
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
            <!-- style 必须传字面量（0=长条形/1=正方形），动态表达式会被 Vue 编译为 _normalizeStyle() 导致数字变成 undefined -->
            <AppIcon
              :item-info="previewItemInfo"
              :icon-text-info-hide-description="false"
              :icon-text-icon-hide-title="false"
              :style="0"
            />
          </div>
          <div class="z-[-1]">
            <AppIcon
              :item-info="previewItemInfo"
              icon-text-color="#000"
              :icon-text-info-hide-description="false"
              :icon-text-icon-hide-title="false"
              :style="1"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="h-[500px] overflow-auto p-[5px]">
      <NForm ref="formRef" :model="model" :rules="rules" size="small" label-placement="top">
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

        <!-- 打开方式 -->
        <NFormItem path="openMethod">
          <template #label>
            <span class="font-bold">{{ $t('iconItem.openMethod') }}</span>
          </template>
          <NSelect v-model:value="model.openMethod" :options="options" />
        </NFormItem>

        <!-- 更多选项 (卡片背景色 , 分组 , 唯一标识) -->
        <div v-if="showMoreOptions">
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
                <NSelect v-model:value="model.itemIconGroupId" :options="itemIconGroupOptions" />
              </NFormItem>
            </NGridItem>
          </NGrid>

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
/* 对齐上游: 预览容器层级与暗色模式亮度 */
.preview-box {
  position: relative;
  z-index: 1;
}

.dark .preview-box {
  filter: brightness(80%);
}
</style>
