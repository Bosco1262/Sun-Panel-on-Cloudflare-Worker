<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FormInst, FormRules } from 'naive-ui'
import { NButton, NCard, NColorPicker, NDivider, NForm, NFormItem, NInput, NPopover, NSelect, NSwitch, useDialog, useMessage } from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import { deletes, edit, getList, saveSort } from '@/api/panel/itemIconGroup'
import { RoundCardModal, SvgIcon } from '@/components/common'
import { PanelPanelConfigStyleEnum } from '@/enums'
import { t } from '@/locales'
import { reportApiError, reportThrownError } from '@/utils/request/apiMessage'

interface EditModalArg {
  show: boolean
  editStatus: number // 1.添加 2.编辑
  model: Panel.ItemIconGroup
  rules: FormRules
}

const formRef = ref<FormInst | null>(null)
const ms = useMessage()
const dialog = useDialog()
const sortStatus = ref(false)

const defaultMNodal = {
  title: '',
  icon: 'material-symbols:folder-outline',
  sort: 9999,
  // Group-level card style (aligned with upstream: a new group defaults to the detail icon)
  // 分组级卡片样式 (对齐上游: 新分组默认详情图标)
  cardStyle: 0 as number, // 0=详情图标, 1=小图标
  textColor: '', // 空 = 跟随全局
  hideDescription: 0 as number,
  onlyName: '' as string,
}

// Aligned with upstream v1.8.1: only two styles, no "follow global" option
// 对齐上游 v1.8.1: 仅两种风格, 不含「跟随全局」选项
const cardStyleOptions = [
  { label: t('apps.itemGroupManage.cardStyleInfo'), value: PanelPanelConfigStyleEnum.info },
  { label: t('apps.itemGroupManage.cardStyleSmall'), value: PanelPanelConfigStyleEnum.icon },
]

const editModalArg = ref<EditModalArg>({
  show: false,
  editStatus: 1,
  model: defaultMNodal,
  rules: {
    title: [
      {
        required: true,
        trigger: 'blur',
        message: t('form.required'),
      },
    ],
  },
})

// Text colour: an empty string means "follow the globals"; the colour picker falls back to white for display
// 文字颜色: 空字符串表示跟随全局, 取色器展示时回退为白色
const textColorValue = computed<string>({
  get: () => editModalArg.value.model.textColor || '#ffffff',
  set: (v: string) => {
    editModalArg.value.model.textColor = v
  },
})

const groups = ref<Panel.ItemIconGroup[]>([])

function handleAddGroup() {
  // The form and the mode must be reset first: otherwise "edit a group → close → click add" submits the old group's
  // data as a new group and silently overwrites the original (and editStatus never switches back to "add").
  //
  // 必须先重置表单与模式: 否则「编辑某分组 → 关闭 → 点添加」会把旧分组数据当成
  // 新分组提交, 静默覆盖原分组 (editStatus 也不会切回「添加」)
  editModalArg.value.model = { ...defaultMNodal }
  editModalArg.value.editStatus = 1
  editModalArg.value.show = true
}

function handleEditGroup(groupInfo: Panel.ItemIconGroup) {
  editModalArg.value.show = true
  // Shallow copy: handing the list entry object to the form would show unsaved edits in the list immediately and make cancellation impossible
  // 浅拷贝: 直接把列表项对象交给表单会让未保存的改动即时反映到列表, 且无法取消
  editModalArg.value.model = { ...groupInfo }
  editModalArg.value.editStatus = 2
}

function handleDragSort() {
  sortStatus.value = !sortStatus.value

  // Leaving sort mode without saving: re-fetch the list and discard the local drag order
  // 未保存就退出排序: 重新拉取列表, 丢弃本地拖拽顺序
  if (!sortStatus.value)
    refreshList()
}

function handleSaveSort() {
  const saveItems: Common.SortItemRequest[] = []
  for (let i = 0; i < groups.value.length; i++) {
    const element = groups.value[i]
    saveItems.push({
      id: element.id as number,
      sort: i + 1,
    })
  }
  saveSort(saveItems).then(({ code, msg }) => {
    if (code === 0) {
      // Sync the local sort: the list order comes from sort, and without syncing the next drag-save would write back the old value
      // 同步本地 sort: 列表顺序由 sort 决定, 不同步会让下一次拖拽保存写回旧值
      groups.value.forEach((item, i) => {
        item.sort = i + 1
      })
      ms.success(t('common.saveSuccess'))
      sortStatus.value = false
    }
    else {
      reportApiError({ code, msg }, text => ms.error(text), 'common.saveFail')
    }
  }).catch(error => reportThrownError(error, text => ms.error(text), 'common.saveFail'))
}

function handleDelete(groupInfo: Panel.ItemIconGroup) {
  dialog.warning({
    title: t('common.warning'),
    content: t('apps.itemGroupManage.deleteWarnText', { name: groupInfo.title }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      if (groupInfo.id) {
        deletes([groupInfo.id]).then(({ code, msg }) => {
          if (code !== 0)
            reportApiError({ code, msg }, text => ms.error(text), 'common.deleteFail')
          else
            refreshList()
        }).catch(error => reportThrownError(error, text => ms.error(text), 'common.deleteFail'))
      }
    },

  })
}

function handleSaveGroup() {
  formRef.value?.validate((errors) => {
    if (errors)
      return

    edit(editModalArg.value.model).then(({ code, msg }) => {
      // Keep the dialog open on failure so the user can fix the input and retry (the old implementation closed and refreshed even on failure, losing the edit)
      // 失败时保持弹窗打开, 让用户修正后重试 (旧实现失败也关窗+刷新, 改动丢失)
      if (code !== 0) {
        reportApiError({ code, msg }, text => ms.error(text), 'common.saveFail')
        return
      }

      editModalArg.value.show = false
      editModalArg.value.model = { ...defaultMNodal }
      editModalArg.value.editStatus = 1
      refreshList()
    }).catch(error => reportThrownError(error, text => ms.error(text), 'common.saveFail'))
  })
}

function refreshList() {
  getList<Common.ListResponse<Panel.ItemIconGroup[]>>().then(({ code, data, msg }) => {
    if (code === 0 && data?.list)
      groups.value = data.list
    else if (code !== 0)
      reportApiError({ code, msg }, text => ms.error(text), 'apps.itemGroupManage.getListFail')
  }).catch(error => reportThrownError(error, text => ms.error(text), 'apps.itemGroupManage.getListFail'))
}

onMounted(() => {
  refreshList()
})
</script>

<template>
  <div class="h-full flex flex-col gap-2 bg-slate-200 dark:bg-zinc-900 p-2">
    <!-- Aligned with upstream v1.8.1: the toolbar lives in the card header, the list in the content -->
    <!-- 对齐上游 v1.8.1: 工具栏在卡片 header 内, 列表在内容区 -->
    <NCard size="small" class="flex-1 min-h-0 overflow-auto">
      <template #header>
        <div class="flex items-center gap-2">
          <NButton type="success" size="small" @click="handleAddGroup">
            <template #icon>
              <SvgIcon icon="mingcute:add-fill" />
            </template>
            {{ $t('common.add') }}
          </NButton>

          <NButton size="small" ghost @click="handleDragSort">
            <template #icon>
              <SvgIcon icon="iconoir:sort" />
            </template>
            {{ $t('common.sort') }}
          </NButton>

          <NButton v-if="sortStatus" type="warning" size="small" @click="handleSaveSort">
            {{ $t('common.saveSort') }}
          </NButton>
        </div>
      </template>

      <!-- Group list -->
      <!-- 分组列表 -->
      <div class="w-full pt-[5px]">
        <VueDraggable
          v-model="groups"
          item-key="id" :animation="300"
          :disabled="!sortStatus"
        >
          <div v-for="item in groups" :key="item.id" class="w-full">
            <NCard size="small" style="border-radius: 10px; margin-bottom: 4px;">
              <div class="flex items-center">
                <!-- Drag handle shown only in sort mode -->
                <!-- 仅排序模式出现的拖拽手柄 -->
                <span v-if="sortStatus" class="move-element-icon cursor-move mr-5 text-[20px]">
                  <SvgIcon icon="lets-icons:sort-list-alt" />
                </span>

                <div class="flex items-center cursor-pointer" @click="handleEditGroup(item)">
                  <span class="mr-[10px] text-[20px]">
                    <SvgIcon icon="material-symbols:ad-group-outline-rounded" />
                  </span>
                  <span>{{ item.title }}</span>
                </div>

                <div class="ml-auto">
                  <!-- Aligned with upstream v1.8.1: borderless edit/delete buttons with icons -->
                  <!-- 对齐上游 v1.8.1: 无边框带图标的编辑/删除按钮 -->
                  <NButton quaternary type="success" size="small" @click="handleEditGroup(item)">
                    <template #icon>
                      <SvgIcon icon="basil:edit-solid" />
                    </template>
                    {{ $t('common.edit') }}
                  </NButton>
                  <NButton quaternary type="error" size="small" class="ml-[10px]" @click="handleDelete(item)">
                    <template #icon>
                      <SvgIcon icon="material-symbols:delete" />
                    </template>
                    {{ $t('common.delete') }}
                  </NButton>
                </div>
              </div>
            </NCard>
          </div>

          <!-- Empty state -->
          <!-- 空状态 -->
          <div v-if="groups.length === 0" class="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            {{ $t('common.noData') }}
          </div>
        </VueDraggable>
      </div>
    </NCard>

    <!-- Aligned with upstream v1.8.1's group edit page, minus the "hide in public mode" switch -->
    <!-- 对齐上游 v1.8.1 的分组编辑页, 去掉「公开模式下隐藏」开关 -->
    <RoundCardModal v-model:show="editModalArg.show" size="small" type="small" :title="editModalArg.editStatus === 1 ? $t('common.add') : $t('common.edit')" style="width: 400px;">
      <NForm ref="formRef" :model="editModalArg.model" :rules="editModalArg.rules" label-placement="top">
        <NFormItem path="title" :label="$t('apps.itemGroupManage.groupName')">
          <NInput v-model:value="editModalArg.model.title" type="text" :maxlength="20" show-count />
        </NFormItem>

        <NDivider style="margin: 4px 0 12px;" />

        <!-- Card style -->
        <!-- 卡片风格 -->
        <NFormItem path="cardStyle" :label="$t('apps.itemGroupManage.cardStyle')">
          <NSelect v-model:value="editModalArg.model.cardStyle" :options="cardStyleOptions" />
        </NFormItem>

        <!-- Hide the description -->
        <!-- 隐藏描述信息 -->
        <NFormItem path="hideDescription" :label="$t('apps.baseSettings.hideDescription')">
          <NSwitch
            size="small"
            :value="editModalArg.model.hideDescription === 1"
            @update:value="(v: boolean) => editModalArg.model.hideDescription = v ? 1 : 0"
          />
        </NFormItem>

        <NDivider style="margin: 4px 0 12px;" />

        <!-- Text colour -->
        <!-- 文字颜色 -->
        <NFormItem path="textColor">
          <template #label>
            <span class="inline-flex items-center gap-1">
              {{ $t('common.textColor') }}
              <NPopover trigger="hover" placement="top">
                <template #trigger>
                  <SvgIcon class="cursor-help text-slate-400" icon="mdi:information-outline" />
                </template>
                {{ $t('apps.itemGroupManage.textColorTip') }}
              </NPopover>
            </span>
          </template>
          <NColorPicker
            v-model:value="textColorValue"
            class="w-full"
            :show-alpha="false"
            size="small"
            :modes="['hex']"
            :swatches="['#000000', '#ffffff', '#18A058', '#2080F0', '#F0A020']"
          />
        </NFormItem>

        <NDivider style="margin: 4px 0 12px;" />

        <!-- Unique identifier -->
        <!-- 唯一标识 -->
        <NFormItem path="onlyName">
          <template #label>
            <span class="inline-flex items-center gap-1">
              {{ $t('apps.itemGroupManage.onlyName') }}
              <NPopover trigger="hover" placement="top">
                <template #trigger>
                  <SvgIcon class="cursor-help text-slate-400" icon="mdi:information-outline" />
                </template>
                {{ $t('apps.itemGroupManage.onlyNameTip') }}
              </NPopover>
            </span>
          </template>
          <NInput v-model:value="editModalArg.model.onlyName" type="text" :maxlength="20" show-count :placeholder="$t('common.inputPlaceholder')" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NButton type="success" size="small" class="float-right" @click="handleSaveGroup">
          {{ $t('common.save') }}
        </NButton>
      </template>
    </RoundCardModal>
  </div>
</template>
