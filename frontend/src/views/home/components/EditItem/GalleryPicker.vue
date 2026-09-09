<script setup lang="ts">
import { NButton, NCard, NEllipsis, NEmpty, NFlex, NImage, NInput, NModal, NSpin } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { getList } from '@/api/system/file'

interface Props {
  visible: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

interface Emit {
  (e: 'update:visible', visible: boolean): void
  (e: 'selected', file: File.Info): void
}

const PAGE_SIZE = 30
const ALLOW_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'])

const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

const imageList = ref<File.Info[]>([])
const loading = ref(false)
const keyword = ref('')
const selectedFile = ref<File.Info | null>(null)
const currentPage = ref(1)
const paginationLoading = ref(false)

const filteredList = computed<File.Info[]>(() => {
  return imageList.value.filter((item) => {
    const ext = (item.ext || '').replace(/^\./, '').toLowerCase()
    if (!ALLOW_IMAGE_EXTS.has(ext))
      return false
    if (keyword.value.trim() !== '')
      return (item.fileName || '').toLowerCase().includes(keyword.value.trim().toLowerCase())
    return true
  })
})

const countPage = computed(() => Math.ceil(filteredList.value.length / PAGE_SIZE))
const visibleList = computed<File.Info[]>(() => filteredList.value.slice(0, currentPage.value * PAGE_SIZE))

// 对齐上游: 滚动到底部附近时追加下一页 (客户端分页)
let scrollTimer: ReturnType<typeof setTimeout> | null = null
function handleScroll(event: Event) {
  const el = event.target as HTMLElement
  if (scrollTimer)
    clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50 && !paginationLoading.value && currentPage.value < countPage.value) {
      paginationLoading.value = true
      setTimeout(() => {
        currentPage.value++
        paginationLoading.value = false
      }, 200)
    }
  }, 300)
}

async function fetchList() {
  loading.value = true
  try {
    const { data } = await getList<Common.ListResponse<File.Info[]>>()
    imageList.value = data.list || []
  }
  catch (error) {
    imageList.value = []
  }
  loading.value = false
}

function resetState() {
  selectedFile.value = null
  keyword.value = ''
  currentPage.value = 1
}

watch(() => props.visible, (newValue) => {
  if (newValue) {
    resetState()
    fetchList()
  }
})

// 关键字过滤 (防抖)
let keywordTimer: ReturnType<typeof setTimeout> | null = null
watch(keyword, () => {
  if (keywordTimer)
    clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => {
    currentPage.value = 1
  }, 500)
})

function handleSelect(item: File.Info) {
  selectedFile.value = item
}

function handleUnselect() {
  selectedFile.value = null
}

function handleCancel() {
  show.value = false
}

function handleConfirm() {
  if (!selectedFile.value)
    return
  emit('selected', selectedFile.value)
  show.value = false
}
</script>

<template>
  <NModal v-model:show="show" preset="card" size="small" style="width: 600px;border-radius: 1rem;">
    <template #header>
      <NFlex align="center">
        <NInput v-model:value="keyword" size="small" clearable :placeholder="$t('common.keyword')" />
      </NFlex>
    </template>

    <div class="h-[500px] overflow-auto" @scroll="handleScroll">
      <NSpin :show="loading" style="height: 100%;">
        <div v-if="visibleList.length === 0" class="flex h-full items-center justify-center">
          <NEmpty :description="$t('apps.uploadsFileManager.nothingText')" />
        </div>
        <div
          v-else
          class="img-group"
          style="grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px;"
        >
          <NCard
            v-for="(item, index) in visibleList"
            :key="index"
            size="small"
            style="border-radius: 5px;"
            :bordered="true"
            hoverable
          >
            <template #cover>
              <div class="img-card transparent-grid" style="height: 70px;">
                <NImage lazy style="object-fit: contain;height: 100%;" :src="item.src" />
              </div>
            </template>
            <template #footer>
              <span class="text-xs">
                <NEllipsis>
                  {{ item.fileName }}
                </NEllipsis>
              </span>
              <div class="mt-2">
                <NButton
                  v-if="selectedFile?.src !== item.src"
                  size="tiny"
                  style="width: 100%;"
                  @click="handleSelect(item)"
                >
                  {{ $t('common.select') }}
                </NButton>
                <NButton v-else size="tiny" type="success" style="width: 100%;" @click="handleUnselect">
                  {{ $t('common.selected') }}
                </NButton>
              </div>
            </template>
          </NCard>
        </div>
      </NSpin>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <span v-if="currentPage < countPage" class="text-xs text-gray-400">
          {{ visibleList.length }} / {{ filteredList.length }}
        </span>
        <span v-else />
        <div class="flex items-center gap-2">
          <NButton size="small" @click="handleCancel">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton size="small" type="success" :disabled="!selectedFile" @click="handleConfirm">
            {{ $t('common.confirm') }}
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
/* 对齐上游 gallery: 卡片内容居中, 网格容器 */
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
