<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'
import { NBackTop, NButton, NButtonGroup, NDropdown, NModal, NSkeleton, NSpin, useDialog, useMessage } from 'naive-ui'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AppIcon, AppStarter, EditItem } from './components'
import { Clock, SearchBox } from '@/components/deskModule'
import { SvgIcon } from '@/components/common'
import { deletes, getListByGroupId, saveSort } from '@/api/panel/itemIcon'
import { getListWithItems as getGroupListWithItems } from '@/api/panel/itemIconGroup'

import { setTitle, updateLocalUserInfo } from '@/utils/cmn'
import { buildItemGroupViews } from '@/utils/panelFilter'
import { useAuthStore, usePanelState } from '@/store'
import { PanelPanelConfigStyleEnum, PanelStateNetworkModeEnum } from '@/enums'
import { VisitMode } from '@/enums/auth'
import { router } from '@/router'
import { t } from '@/locales'

interface ItemGroup extends Panel.ItemIconGroup {
  sortStatus?: boolean
  hoverStatus: boolean
  items?: Panel.ItemInfo[]
}

const ms = useMessage()
const dialog = useDialog()
const panelState = usePanelState()
const authStore = useAuthStore()

const scrollContainerRef = ref<HTMLElement | undefined>(undefined)

const editItemInfoShow = ref<boolean>(false)
const editItemInfoData = ref<Panel.ItemInfo | null>(null)
const windowShow = ref<boolean>(false)
const windowSrc = ref<string>('')
const windowTitle = ref<string>('')

const windowIframeRef = ref(null)
const windowIframeIsLoad = ref<boolean>(false)

const dropdownMenuX = ref(0)
const dropdownMenuY = ref(0)
const dropdownShow = ref(false)
const currentRightSelectItem = ref<Panel.ItemInfo | null>(null)
const currentAddItenIconGroupId = ref<number | undefined>()

const settingModalShow = ref(false)

const items = ref<ItemGroup[]>([])
/** 搜索框里的关键词: 面板过滤的唯一数据源 (由搜索框的 itemSearch 事件写入) */
const filterKeyword = ref('')

/** 是否按关键词过滤面板 (风格设置里关闭「允许搜索栏搜索项目」或关键词为空时不生效) */
const isFiltering = computed(() =>
  filterKeyword.value.trim() !== '' && panelState.panelConfig.searchBoxSearchIcon === true,
)

/**
 * 渲染用的分组视图
 *
 * 视图元素携带的是**原始分组对象**, 交互回调直接改它。
 * 过滤后命中的分组下标会偏移, 旧实现按下标回写 items.value, 会把 hover / 排序作用到别的分组上。
 */
const filterItems = computed(() => buildItemGroupViews(items.value, filterKeyword.value, isFiltering.value))

/** 过滤提示用: 命中项目数 */
const filteredItemCount = computed(() =>
  filterItems.value.reduce((total, view) => total + (view.items?.length ?? 0), 0),
)

/** 壁纸样式: 地址为空时不拼 `url()` 空值, 直接交给底层默认背景 */
const coverStyle = computed(() => {
  const src = panelState.panelConfig.backgroundImageSrc?.trim()
  return {
    filter: `blur(${panelState.panelConfig.backgroundBlur}px)`,
    ...(src
      ? { background: `url(${src}) no-repeat`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : {}),
  }
})

function openPage(openMethod: number, url: string, title?: string) {
  switch (openMethod) {
    case 1:
      window.location.href = url
      break
    case 2:
      window.open(url)
      break
    case 3:
      windowShow.value = true
      windowSrc.value = url
      windowTitle.value = title || url
      windowIframeIsLoad.value = true
      break

    default:
      break
  }
}

function handleItemClick(group: ItemGroup, item: Panel.ItemInfo) {
  // 排序模式下点击项目 = 编辑该项目
  if (group.sortStatus) {
    handleEditItem(item)
    return
  }

  // 内网模式下优先 lanUrl, 但 lanUrl 可能为空/未设置 (DB 列可为 null), 必须回退到 url,
  // 否则 jumpUrl 是 undefined, 会跳到 /undefined
  const preferLan = panelState.networkMode === PanelStateNetworkModeEnum.lan
  const jumpUrl = (preferLan ? (item.lanUrl || item.url) : (item.url || item.lanUrl)) || ''

  openPage(item.openMethod, jumpUrl, item.title)
}

function handWindowIframeIdLoad(_event: Event) {
  windowIframeIsLoad.value = false
}

function getList() {
  // 分组 + 项目一次取回 (旧流程是「先查分组, 再逐个分组查项目」= 1+N 次 Worker 请求)
  getGroupListWithItems<Common.ListResponse<ItemGroup[]>>().then(({ code, data }) => {
    // 未登录/无权限时拦截器已跳转登录页，此处直接返回避免读取 undefined
    if (code !== 0 || !data?.list)
      return

    items.value = data.list
  }).catch(() => ms.error(t('panelHome.getListFail')))
}

// 从后端获取组下面的图标 (按 id 定位分组, 不依赖数组下标, 过滤时也不会串组)
function updateItemIconGroupByNet(group: ItemGroup) {
  const groupId = group.id
  if (!groupId)
    return

  getListByGroupId<Common.ListResponse<Panel.ItemInfo[]>>(groupId).then((res) => {
    if (res.code !== 0)
      return
    const target = items.value.find(item => item.id === groupId)
    if (target)
      target.items = res.data.list
  })
}

function handleRightMenuSelect(key: string | number) {
  dropdownShow.value = false
  const target = currentRightSelectItem.value
  // 同 handleItemClick: 候选地址为空时逐级回退, 避免 window.open(undefined)
  const preferLan = panelState.networkMode === PanelStateNetworkModeEnum.lan
  const jumpUrl = (preferLan ? (target?.lanUrl || target?.url) : (target?.url || target?.lanUrl)) || ''
  switch (key) {
    case 'newWindows':
      if (jumpUrl)
        window.open(jumpUrl, '_blank', 'noopener')
      break
    case 'openWanUrl':
      if (currentRightSelectItem.value)
        openPage(currentRightSelectItem.value?.openMethod, currentRightSelectItem.value?.url, currentRightSelectItem.value?.title)
      break
    case 'openLanUrl':
      if (currentRightSelectItem.value && currentRightSelectItem.value.lanUrl)
        openPage(currentRightSelectItem.value?.openMethod, currentRightSelectItem.value.lanUrl, currentRightSelectItem.value?.title)
      break
    case 'edit':
      // 这里有个奇怪的问题，如果不使用{...}的方式 父组件的值会同步修改 标记一下
      handleEditItem({ ...currentRightSelectItem.value } as Panel.ItemInfo)
      break
    case 'delete':
      dialog.warning({
        title: t('common.warning'),
        content: t('common.deleteConfirmByName', { name: currentRightSelectItem.value?.title }),
        positiveText: t('common.confirm'),
        negativeText: t('common.cancel'),
        onPositiveClick: () => {
          deletes([currentRightSelectItem.value?.id as number]).then(({ code, msg }) => {
            if (code === 0) {
              ms.success(t('common.deleteSuccess'))
              getList()
            }
            else {
              ms.error(`${t('common.deleteFail')}:${msg}`)
            }
          }).catch(() => ms.error(t('common.deleteFail')))
        },
      })

      break
    default:
      break
  }
}

function handleContextMenu(e: MouseEvent, group: ItemGroup, item: Panel.ItemInfo) {
  // 排序模式下不弹右键菜单
  if (group.sortStatus)
    return

  e.preventDefault()
  currentRightSelectItem.value = item
  dropdownShow.value = false
  nextTick().then(() => {
    dropdownShow.value = true
    dropdownMenuX.value = e.clientX
    dropdownMenuY.value = e.clientY
  })
}

function onClickoutside() {
  dropdownShow.value = false
}

function handleEditSuccess(_item: Panel.ItemInfo) {
  getList()
}

function handleChangeNetwork(mode: PanelStateNetworkModeEnum) {
  panelState.setNetworkMode(mode)
  if (mode === PanelStateNetworkModeEnum.lan)
    ms.success(t('panelHome.changeToLanModelSuccess'))

  else
    ms.success(t('panelHome.changeToWanModelSuccess'))
}

function handleSaveSort(itemGroup: ItemGroup) {
  const saveItems: Common.SortItemRequest[] = []
  if (itemGroup.items) {
    for (let i = 0; i < itemGroup.items.length; i++) {
      const element = itemGroup.items[i]
      saveItems.push({
        id: element.id as number,
        sort: i + 1,
      })
    }

    saveSort({ itemIconGroupId: itemGroup.id as number, sortItems: saveItems }).then(({ code, msg }) => {
      if (code === 0) {
        // 同步本地 sort: 拖拽 key 用 id, 但顺序依赖 sort; 不同步会让下次保存写回旧值
        itemGroup.items?.forEach((element, i) => {
          element.sort = i + 1
        })
        ms.success(t('common.saveSuccess'))
        itemGroup.sortStatus = false
      }
      else {
        ms.error(`${t('common.saveFail')}:${msg}`)
      }
    }).catch(() => {
      // 保存失败时刷新回服务端顺序, 避免界面与后端长期不一致
      ms.error(t('common.saveFail'))
      getList()
    })
  }
}

function getDropdownMenuOptions() {
  const dropdownMenuOptions = [
    {
      label: t('iconItem.newWindowOpen'),
      key: 'newWindows',
    },

  ]

  if (currentRightSelectItem.value?.lanUrl && panelState.networkMode === PanelStateNetworkModeEnum.wan) {
    dropdownMenuOptions.push({
      label: t('panelHome.openLanUrl'),
      key: 'openLanUrl',
    })
  }

  if (currentRightSelectItem.value?.lanUrl && panelState.networkMode === PanelStateNetworkModeEnum.lan) {
    dropdownMenuOptions.push({
      label: t('panelHome.openWanUrl'),
      key: 'openWanUrl',
    })
  }

  if (authStore.visitMode === VisitMode.VISIT_MODE_LOGIN) {
    dropdownMenuOptions.push({
      label: t('common.edit'),
      key: 'edit',
    }, {
      label: t('common.delete'),
      key: 'delete',
    })
  }

  return dropdownMenuOptions
}

onMounted(() => {
  // 更新用户信息
  updateLocalUserInfo()
  getList()

  // 更新同步云端配置 (含搜索引擎配置); 失败时保留本地缓存配置并提示, 不影响面板渲染
  panelState.updatePanelConfigByCloud().catch(() => ms.error(t('panelHome.getConfigFail')))

  // 设置标题
  if (panelState.panelConfig.logoText)
    setTitle(panelState.panelConfig.logoText)
})

// NBackTop 的 listen-to 需要稳定引用, 内联箭头函数每次渲染都会重建并重新绑定监听
function getScrollContainer() {
  return scrollContainerRef.value
}

// 系统应用弹窗关闭后刷新分组数据（分组级卡片样式等可能在弹窗中被修改）
watch(settingModalShow, (show) => {
  if (!show)
    getList()
})

// 分组级卡片风格: -1 跟随全局
function getGroupCardStyle(group: Panel.ItemIconGroup): PanelPanelConfigStyleEnum {
  const style = group.cardStyle ?? -1
  if (style === -1)
    return panelState.panelConfig.iconStyle ?? PanelPanelConfigStyleEnum.icon
  return style as PanelPanelConfigStyleEnum
}

// 分组级文字颜色: 空 = 跟随全局
function getGroupTextColor(group: Panel.ItemIconGroup): string {
  return group.textColor || panelState.panelConfig.iconTextColor || '#ffffff'
}

// 分组级隐藏描述: 与全局设置任一开启即隐藏
function getGroupHideDescription(group: Panel.ItemIconGroup): boolean {
  return group.hideDescription === 1 || panelState.panelConfig.iconTextInfoHideDescription === true
}

// 搜索框输入: 只记录关键词, 过滤结果由 filterItems 计算属性派生
// (旧实现在这里做浅拷贝 + 按下标回写, 过滤后下标偏移会把 hover / 排序作用到别的分组)
function itemFrontEndSearch(keyword?: string) {
  filterKeyword.value = keyword ?? ''
}

function handleSetHoverStatus(group: ItemGroup, hoverStatus: boolean) {
  group.hoverStatus = hoverStatus
}

/**
 * 切换分组的排序模式
 *
 * 过滤中直接忽略: 此时拖拽只作用于命中的子集, 保存排序会把完整列表的顺序写坏。
 * 开始过滤时也会主动退出所有排序模式 (见下方 watch)。
 */
function handleSetSortStatus(group: ItemGroup) {
  if (isFiltering.value)
    return

  group.sortStatus = !group.sortStatus

  // 未保存就退出排序: 重新拉取该组, 丢弃本地拖拽顺序
  if (!group.sortStatus)
    updateItemIconGroupByNet(group)
}

// 一旦进入过滤状态, 退出所有分组的排序模式 (过滤结果只是子集, 排序保存会写坏完整顺序)
watch(isFiltering, (filtering) => {
  if (!filtering)
    return
  for (const group of items.value) {
    if (group.sortStatus) {
      group.sortStatus = false
      updateItemIconGroupByNet(group)
    }
  }
})

function handleEditItem(item: Panel.ItemInfo) {
  editItemInfoData.value = item
  editItemInfoShow.value = true
  currentAddItenIconGroupId.value = undefined
}

function handleAddItem(itemIconGroupId?: number) {
  editItemInfoData.value = null
  editItemInfoShow.value = true
  if (itemIconGroupId)
    currentAddItenIconGroupId.value = itemIconGroupId
}
</script>

<template>
  <div class="w-full h-full sun-main">
    <div
      class="cover wallpaper" :style="coverStyle"
    />
    <div class="mask" :style="{ backgroundColor: `rgba(0,0,0,${panelState.panelConfig.backgroundMaskNumber})` }" />
    <div ref="scrollContainerRef" class="absolute w-full h-full overflow-auto">
      <div
        class="p-2.5 mx-auto"
        :style="{
          marginTop: `${panelState.panelConfig.marginTop}%`,
          marginBottom: `${panelState.panelConfig.marginBottom}%`,
          maxWidth: (panelState.panelConfig.maxWidth ?? '1200') + panelState.panelConfig.maxWidthUnit,
        }"
      >
        <!-- 头 -->
        <div class="mx-[auto] w-[80%]">
          <div class="flex mx-[auto] items-center justify-center text-white">
            <div class="logo">
              <span class="text-2xl md:text-6xl font-bold text-shadow">
                {{ panelState.panelConfig.logoText }}
              </span>
            </div>
            <div class="divider text-base lg:text-2xl mx-[10px]">
              |
            </div>
            <div class="text-shadow">
              <Clock :hide-second="!panelState.panelConfig.clockShowSecond" />
            </div>
          </div>
          <div v-if="panelState.panelConfig.searchBoxShow" class="flex mt-[20px] mx-auto sm:w-full lg:w-[80%]">
            <SearchBox
              :border-color="panelState.panelConfig.searchBoxBorderColor"
              :placeholder-color="panelState.panelConfig.searchBoxPlaceholderColor"
              @item-search="itemFrontEndSearch"
            />
          </div>
        </div>

        <!-- 应用盒子 -->
        <div :style="{ marginLeft: `${panelState.panelConfig.marginX}px`, marginRight: `${panelState.panelConfig.marginX}px` }">
          <!-- 过滤状态提示 (「允许搜索栏搜索项目」开启且搜索框有关键词时) -->
          <div v-if="isFiltering" class="mt-[30px] ml-[10px] text-sm text-white/80 text-shadow">
            {{ $t('deskModule.searchBox.filteringTip', { keyword: filterKeyword.trim(), count: filteredItemCount }) }}
          </div>

          <!-- 组纵向排列: view 里带的是原始分组对象, 交互回调不再按下标回查 -->
          <div
            v-for="view in filterItems" :key="view.group.id ?? view.group.title"
            class="item-list mt-[50px]"
            :class="view.group.sortStatus ? 'shadow-2xl border shadow-[0_0_30px_10px_rgba(0,0,0,0.3)]  p-[10px] rounded-2xl' : ''"
            @mouseenter="handleSetHoverStatus(view.group, true)"
            @mouseleave="handleSetHoverStatus(view.group, false)"
          >
            <!-- 分组标题 -->
            <div class="text-white text-xl font-extrabold mb-[20px] ml-[10px] flex items-center">
              <span class="group-title text-shadow">
                {{ view.group.title }}
              </span>
              <div
                v-if="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN"
                class="group-buttons ml-2 delay-100 transition-opacity flex"
                :class="view.group.hoverStatus ? 'opacity-100' : 'opacity-0'"
              >
                <span class="mr-2 cursor-pointer" :title="t('common.add')" @click="handleAddItem(view.group.id)">
                  <SvgIcon class="text-white font-xl" icon="typcn:plus" />
                </span>
                <!-- 过滤中不提供排序: 拖拽只作用于命中的子集, 保存会把完整列表的顺序写坏 -->
                <span v-if="!isFiltering" class="mr-2 cursor-pointer " :title="t('common.sort')" @click="handleSetSortStatus(view.group)">
                  <SvgIcon class="text-white font-xl" icon="ri:drag-drop-line" />
                </span>
              </div>
            </div>

            <!-- 详情图标 -->
            <div v-if="getGroupCardStyle(view.group) === PanelPanelConfigStyleEnum.info">
              <div v-if="view.group.items">
                <VueDraggable
                  v-model="view.group.items" item-key="id" :animation="300"
                  class="icon-info-box"
                  filter=".not-drag"
                  :disabled="!view.group.sortStatus"
                >
                  <div v-for="item, index in view.items" :key="item.id ?? index" :title="item.description" :data-only-name="item.onlyName || undefined" @contextmenu="(e) => handleContextMenu(e, view.group, item)">
                    <AppIcon
                      :class="view.group.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="getGroupTextColor(view.group)"
                      :icon-text-info-hide-description="getGroupHideDescription(view.group)"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :card-style="0"
                      @click="handleItemClick(view.group, item)"
                    />
                  </div>

                  <div v-if="view.group.items.length === 0" class="not-drag">
                    <AppIcon
                      :class="view.group.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="{ icon: { itemType: 3, text: 'subway:add' }, title: t('common.add'), url: '', openMethod: 0 }"
                      :icon-text-color="getGroupTextColor(view.group)"
                      :icon-text-info-hide-description="getGroupHideDescription(view.group)"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :card-style="0"
                      @click="handleAddItem(view.group.id)"
                    />
                  </div>
                </VueDraggable>
              </div>
            </div>

            <!-- APP图标宫型盒子 -->
            <div v-else>
              <div v-if="view.group.items">
                <VueDraggable
                  v-model="view.group.items" item-key="id" :animation="300"
                  class="icon-small-box"

                  filter=".not-drag"
                  :disabled="!view.group.sortStatus"
                >
                  <div v-for="item, index in view.items" :key="item.id ?? index" :title="item.description" :data-only-name="item.onlyName || undefined" @contextmenu="(e) => handleContextMenu(e, view.group, item)">
                    <AppIcon
                      :class="view.group.sortStatus ? 'cursor-move' : 'cursor-pointer'"
                      :item-info="item"
                      :icon-text-color="getGroupTextColor(view.group)"
                      :icon-text-info-hide-description="getGroupHideDescription(view.group)"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :card-style="1"
                      @click="handleItemClick(view.group, item)"
                    />
                  </div>

                  <div v-if="view.group.items.length === 0" class="not-drag">
                    <AppIcon
                      class="cursor-pointer"
                      :item-info="{ icon: { itemType: 3, text: 'subway:add' }, title: $t('common.add'), url: '', openMethod: 0 }"
                      :icon-text-color="getGroupTextColor(view.group)"
                      :icon-text-info-hide-description="getGroupHideDescription(view.group)"
                      :icon-text-icon-hide-title="panelState.panelConfig.iconTextIconHideTitle || false"
                      :card-style="1"
                      @click="handleAddItem(view.group.id)"
                    />
                  </div>
                </VueDraggable>
              </div>
            </div>

            <!-- 编辑栏 -->
            <div v-if="view.group.sortStatus" class="flex mt-[10px]">
              <div>
                <NButton color="#2a2a2a6b" @click="handleSaveSort(view.group)">
                  <template #icon>
                    <SvgIcon class="text-white font-xl" icon="material-symbols:save" />
                  </template>
                  <div>
                    {{ $t('common.saveSort') }}
                  </div>
                </NButton>
              </div>
            </div>
          </div>

          <!-- 过滤后一个都没命中 -->
          <div v-if="isFiltering && filterItems.length === 0" class="mt-[50px] ml-[10px] text-white/80 text-shadow">
            {{ $t('deskModule.searchBox.filteringEmptyTip', { keyword: filterKeyword.trim() }) }}
          </div>
        </div>
        <div class="mt-5 footer" v-html="panelState.panelConfig.footerHtml" />
      </div>
    </div>

    <!-- 右键菜单 -->
    <NDropdown
      placement="bottom-start" trigger="manual" :x="dropdownMenuX" :y="dropdownMenuY"
      :options="getDropdownMenuOptions()" :show="dropdownShow" :on-clickoutside="onClickoutside" @select="handleRightMenuSelect"
    />

    <!-- 悬浮按钮 -->
    <div class="fixed-element fixed-element-shadow">
      <NButtonGroup vertical>
        <!-- 网络模式切换按钮组 -->
        <NButton
          v-if="panelState.networkMode === PanelStateNetworkModeEnum.lan && panelState.panelConfig.netModeChangeButtonShow" color="#2a2a2a6b"
          :title="t('panelHome.changeToWanModel')" @click="handleChangeNetwork(PanelStateNetworkModeEnum.wan)"
        >
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="material-symbols:lan-outline-rounded" />
          </template>
        </NButton>

        <NButton
          v-if="panelState.networkMode === PanelStateNetworkModeEnum.wan && panelState.panelConfig.netModeChangeButtonShow" color="#2a2a2a6b"
          :title="t('panelHome.changeToLanModel')" @click="handleChangeNetwork(PanelStateNetworkModeEnum.lan)"
        >
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="mdi:wan" />
          </template>
        </NButton>

        <NButton v-if="authStore.visitMode === VisitMode.VISIT_MODE_LOGIN" color="#2a2a2a6b" @click="settingModalShow = !settingModalShow">
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="majesticons-applications" />
          </template>
        </NButton>

        <NButton v-if="authStore.visitMode === VisitMode.VISIT_MODE_PUBLIC" color="#2a2a2a6b" :title="$t('panelHome.goToLogin')" @click="router.push('/login')">
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="material-symbols:account-circle" />
          </template>
        </NButton>
      </NButtonGroup>

      <AppStarter v-model:visible="settingModalShow" />
    </div>

    <NBackTop
      :listen-to="getScrollContainer"
      :right="10"
      :bottom="10"
      style="background-color:transparent;border: none;box-shadow: none;"
    >
      <div class="fixed-element-shadow">
        <NButton color="#2a2a2a6b">
          <template #icon>
            <SvgIcon class="text-white font-xl" icon="icon-park-outline:to-top" />
          </template>
        </NButton>
      </div>
    </NBackTop>

    <EditItem v-model:visible="editItemInfoShow" :item-info="editItemInfoData" :item-group-id="currentAddItenIconGroupId" @done="handleEditSuccess" />

    <!-- 弹窗 -->
    <NModal
      v-model:show="windowShow" :mask-closable="false" preset="card"
      style="max-width: 1000px;height: 600px;border-radius: 1rem;" :bordered="true" size="small" role="dialog"
      aria-modal="true"
    >
      <template #header>
        <div class="flex items-center">
          <span class="mr-[20px]">
            {{ windowTitle }}
          </span>

          <NSpin v-if="windowIframeIsLoad" size="small" />
        </div>
      </template>
      <div class="w-full h-full rounded-2xl overflow-hidden border dark:border-zinc-700">
        <div v-if="windowIframeIsLoad" class="flex flex-col p-5">
          <NSkeleton height="50px" width="100%" class="rounded-lg" />
          <NSkeleton height="180px" width="100%" class="mt-[20px] rounded-lg" />
          <NSkeleton height="180px" width="100%" class="mt-[20px] rounded-lg" />
        </div>
        <iframe
          v-show="!windowIframeIsLoad" id="windowIframeId" ref="windowIframeRef" :src="windowSrc"
          class="w-full h-full" frameborder="0" @load="handWindowIframeIdLoad"
        />
      </div>
    </NModal>
  </div>
</template>

<style>
body,
html {
  overflow: hidden;
  background-color: rgb(54, 54, 54);
}
</style>

<style scoped>
.mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.sun-main {
  user-select: none;
}

.cover {
  position: absolute;
  width: 100%;
  height: 100%;
  overflow: hidden;
  transform: scale(1.05);
}

.text-shadow {
  text-shadow: 2px 2px 50px rgb(0, 0, 0);
}

.app-icon-text-shadow {
  text-shadow: 2px 2px 5px rgb(0, 0, 0);
}

.fixed-element {
  position: fixed;
  /* 将元素固定在屏幕上 */
  right: 10px;
  /* 距离屏幕顶部的距离 */
  bottom: 50px;
  /* 距离屏幕左侧的距离 */
  /* 与按钮组外圈的圆角保持一致, 否则阴影会在四个角露出方角 */
  border-radius: 3px;
}

/*
 * 悬浮按钮的投影
 * 不用 box-shadow: 它按容器的矩形外框绘制, 而按钮组的四个角是圆的,
 * 会在四角留下一小片不透明像素; drop-shadow 按实际渲染出的圆角轮廓绘制, 四角始终干净。
 */
.fixed-element-shadow {
  filter: drop-shadow(0 0 5px rgba(0, 0, 0, 0.25));
}

.icon-info-box {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 18px;

}

.icon-small-box {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(75px, 1fr));
  gap: 18px;

}

@media (max-width: 500px) {
  .icon-info-box{
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
}
</style>
