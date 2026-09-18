<script setup lang="ts">
import { NButton, NCard, NEllipsis, NEmpty, NFlex, NImage, NModal, NTag } from 'naive-ui'
import { computed, ref, watch } from 'vue'

interface Props {
  visible: boolean
  candidates: Panel.FaviconCandidate[]
  // 保存请求进行中 (由父组件控制; 期间禁止重复提交/关闭)
  loading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

interface Emit {
  (e: 'update:visible', visible: boolean): void
  (e: 'selected', candidate: Panel.FaviconCandidate): void
}

const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

const selectedUrl = ref('')

// https 页面加载 http 图片会被浏览器拦 (混合内容): 这类候选标注「不安全」并置灰
function isInsecure(candidate: Panel.FaviconCandidate): boolean {
  return window.location.protocol === 'https:' && candidate.url.startsWith('http://')
}

function candidateMeta(candidate: Panel.FaviconCandidate): string {
  return [candidate.sizes, candidate.type].filter(Boolean).join(' · ') || candidate.url
}

function handleSelect(candidate: Panel.FaviconCandidate) {
  if (isInsecure(candidate))
    return
  selectedUrl.value = candidate.url
}

function handleUnselect() {
  selectedUrl.value = ''
}

function handleCancel() {
  show.value = false
}

function handleConfirm() {
  const candidate = props.candidates.find(item => item.url === selectedUrl.value)
  if (!candidate)
    return
  // 由父组件保存成功后关闭弹窗 (失败时保持打开, 可换一张或重试)
  emit('selected', candidate)
}

// 每次开关都重置选中状态
watch(() => props.visible, () => {
  selectedUrl.value = ''
})
</script>

<template>
  <NModal v-model:show="show" preset="card" size="small" style="width: 600px;border-radius: 1rem;">
    <template #header>
      <NFlex align="center">
        <span>{{ $t('iconItem.faviconPickerTitle') }}</span>
      </NFlex>
    </template>

    <div class="h-[500px] overflow-auto">
      <div v-if="candidates.length === 0" class="flex h-full items-center justify-center">
        <NEmpty :description="$t('iconItem.faviconPickerEmpty')" />
      </div>
      <template v-else>
        <div class="mb-2 text-xs text-gray-400">
          {{ $t('iconItem.faviconPickerTip') }}
        </div>
        <div
          class="img-group"
          style="grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px;"
        >
          <NCard
            v-for="item in candidates"
            :key="item.url"
            size="small"
            style="border-radius: 5px;"
            :bordered="true"
            hoverable
          >
            <template #cover>
              <div class="img-card transparent-grid" style="height: 70px;">
                <NImage
                  v-if="!isInsecure(item)"
                  lazy
                  style="object-fit: contain;height: 100%;"
                  :src="item.url"
                />
                <span v-else class="px-1 text-center text-xs text-gray-400">
                  {{ $t('iconItem.faviconPickerInsecure') }}
                </span>
              </div>
            </template>
            <span class="text-xs">
              <NEllipsis>{{ candidateMeta(item) }}</NEllipsis>
            </span>
            <div class="mt-1 flex flex-wrap items-center gap-1">
              <NTag size="tiny" :type="item.source === 'link' ? 'info' : 'warning'" :bordered="false">
                {{ item.source === 'link' ? $t('iconItem.faviconPickerSourceLink') : $t('iconItem.faviconPickerSourceFallback') }}
              </NTag>
              <NTag v-if="isInsecure(item)" size="tiny" type="error" :bordered="false">
                {{ $t('iconItem.faviconPickerInsecure') }}
              </NTag>
            </div>
            <div class="mt-2">
              <NButton
                v-if="selectedUrl !== item.url"
                size="tiny"
                style="width: 100%;"
                :disabled="isInsecure(item)"
                @click="handleSelect(item)"
              >
                {{ $t('common.select') }}
              </NButton>
              <NButton v-else size="tiny" type="success" style="width: 100%;" @click="handleUnselect">
                {{ $t('common.selected') }}
              </NButton>
            </div>
          </NCard>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <NEllipsis v-if="selectedUrl" style="max-width: 320px;" class="text-xs text-gray-400">
          {{ selectedUrl }}
        </NEllipsis>
        <span v-else />
        <div class="flex items-center gap-2">
          <NButton size="small" :disabled="loading" @click="handleCancel">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton size="small" type="success" :disabled="!selectedUrl" :loading="loading" @click="handleConfirm">
            {{ $t('common.confirm') }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
/* 对齐 GalleryPicker: 卡片内容居中, 网格容器 */
.img-card {
  display: flex;
  justify-content: center;
  align-items: center;
}

.img-group {
  width: 100%;
  display: grid;
}
</style>
