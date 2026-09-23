<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NLayout, NLayoutContent, NLayoutSider, NSpace } from 'naive-ui'
import { AppLoader, RoundCardModal, SvgIcon } from '@/components/common'
import { t } from '@/locales'

interface App {
  name: string
  componentName: string
  icon: string
}
const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', visible: boolean): void
}>()

const componentName = ref('UserInfo')
const collapsed = ref(false)
const screenWidth = ref(0)
const isSmallScreen = ref(false)
const defaultTitle = t('appLauncher.title')
const height = '500px'
/**
 * Once the user expanded the sidebar manually on a small screen, a resize no longer forces it to collapse
 *
 * 用户在小屏下手动展开过侧栏后, 不再被 resize 强制折叠
 */
const userToggledCollapsed = ref(false)

// A computed rather than a ref, so app names follow a language switch
// computed 而非 ref: 语言切换时应用名要跟着变
const apps = computed<App[]>(() => [
  {
    name: t('apps.userInfo.appName'),
    componentName: 'UserInfo',
    icon: 'material-symbols-person-edit-outline-rounded',
  },
  {
    name: t('apps.baseSettings.appName'),
    componentName: 'Style',
    icon: 'ion-color-palette-outline',
  },
  {
    name: t('apps.itemGroupManage.appName'),
    componentName: 'ItemGroupManage',
    icon: 'material-symbols-ad-group-outline-rounded',
  },
  {
    name: t('apps.uploadsFileManager.appName'),
    componentName: 'UploadFileManager',
    icon: 'tabler:file-upload',
  },
  {
    name: t('apps.globalSetting.appName'),
    componentName: 'GlobalSetting',
    icon: 'ic:outline-build-circle',
  },
  {
    name: t('apps.exportImport.appName'),
    componentName: 'ImportExport',
    icon: 'icon-park-outline-import-and-export',
  },
  {
    name: t('apps.about.appName'),
    componentName: 'About',
    icon: 'lucide-info',
  },
])

const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => {
    emit('update:visible', visible)
  },
})

function handleClickApp(item: App) {
  componentName.value = item.componentName
  if (isSmallScreen.value)
    collapsed.value = true
}

function getScreenWidth() {
  return window.innerWidth
}

function handleResize() {
  screenWidth.value = getScreenWidth()
  if (screenWidth.value < 640) {
    // Collapse only on the first small-screen entry, otherwise every resize would overwrite the state the user expanded manually
    // 只在首次进入小屏时折叠, 否则每次 resize 都会覆盖用户手动展开的状态
    if (!isSmallScreen.value && !userToggledCollapsed.value)
      collapsed.value = true
    isSmallScreen.value = true
  }
  else {
    collapsed.value = false
    isSmallScreen.value = false
    userToggledCollapsed.value = false
  }
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  if (isSmallScreen.value)
    userToggledCollapsed.value = true
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
  handleResize()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div>
    <RoundCardModal
      v-model:show="show"
      style="max-width: 900px;"
      size="small"
    >
      <template #header>
        <div class="flex items-center select-none" @click="toggleCollapsed">
          <div class="text-3xl cursor-pointer" style="color:var(--n-color-target)">
            <SvgIcon class=" transition-all duration-500" :icon="collapsed ? 'tabler-layout-sidebar-right-collapse-filled' : 'tabler-layout-sidebar-left-collapse-filled'" />
          </div>
          <div class="ml-1">
            {{ defaultTitle }}
          </div>
        </div>
      </template>
      <div class="w-full h-full app-starter-modal-content">
        <NSpace vertical size="large" style="height: 100%;width: 100%;">
          <NLayout has-sider style="border-radius:0.75rem;">
            <NLayoutSider
              v-model:collapsed="collapsed"
              collapse-mode="width"
              :collapsed-width="0"
              :width="isSmallScreen ? '100%' : 240"
              style="height: 100%;"
              content-style="overflow: hidden"
            >
              <div class="w-full h-full dark:bg-[#2c2c32]">
                <div
                  class="p-[5px] bg-slate-200 dark:bg-zinc-900 rounded-xl overflow-auto"
                  :style="{
                    width: isSmallScreen ? '100%' : '220px',
                    minWidth: '200px',
                    height,
                  }"
                >
                  <div
                    v-for="item in apps"
                    :key="item.componentName"
                    :style="{ color: componentName === item.componentName ? 'var(--n-color-target)' : '' }"
                    @click="handleClickApp(item)"
                  >
                    <div
                      class="bg-white dark:bg-zinc-800 p-[10px] rounded-lg mb-[5px] font-bold cursor-pointer flex items-center hover:bg-slate-50 focus:bg-slate-50"
                    >
                      <div class="flex items-center justify-center">
                        <div class="text-lg">
                          <SvgIcon :icon="item.icon" />
                        </div>
                        <span class="ml-2">{{ item.name }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </NLayoutSider>
            <NLayoutContent :content-style="{ height }">
              <div class="rounded-2xl h-full overflow-auto transition-all duration-500 min-w-[300px] h-full" :class="(isSmallScreen && !collapsed) ? 'opacity-0' : 'opacity-100'">
                <AppLoader :component-name="componentName" class="h-full" />
              </div>
            </NLayoutContent>
          </NLayout>
        </NSpace>
      </div>
    </RoundCardModal>
  </div>
</template>

<style scoped>
.text-shadow {
  text-shadow: 0px 0px 5px gray;
}
</style>

<style>
.dark .app-starter-modal-content .n-layout{
    background-color: #2c2c32;
}
</style>
