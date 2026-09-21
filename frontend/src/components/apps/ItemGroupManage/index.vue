<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FormInst, FormRules } from 'naive-ui'
import { NButton, NCard, NColorPicker, NForm, NFormItem, NInput, NSelect, NSwitch, useDialog, useMessage } from 'naive-ui'
import { VueDraggable } from 'vue-draggable-plus'
import { deletes, edit, getList, saveSort } from '@/api/panel/itemIconGroup'
import { RoundCardModal, SvgIcon } from '@/components/common'
import { PanelPanelConfigStyleEnum } from '@/enums'
import { t } from '@/locales'

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
  // 分组级卡片样式 (对齐上游: 新分组默认详情图标)
  cardStyle: 0 as number, // 0=详情图标, 1=小图标, -1=跟随全局
  textColor: '', // 空 = 跟随全局
  hideDescription: 0 as number,
}

const cardStyleOptions = [
  { label: t('apps.itemGroupManage.cardStyleInfo'), value: PanelPanelConfigStyleEnum.info },
  { label: t('apps.itemGroupManage.cardStyleSmall'), value: PanelPanelConfigStyleEnum.icon },
  { label: t('apps.itemGroupManage.followGlobal'), value: -1 },
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

// 文字颜色: 空字符串表示跟随全局, 取色器展示时回退为白色
const textColorValue = computed<string>({
  get: () => editModalArg.value.model.textColor || '#ffffff',
  set: (v: string) => {
    editModalArg.value.model.textColor = v
  },
})

const textColorFollowGlobal = computed(() => !editModalArg.value.model.textColor)

function handleResetTextColor() {
  editModalArg.value.model.textColor = ''
}

const groups = ref<Panel.ItemIconGroup[]>([])

function handleAddGroup() {
  // 必须先重置表单与模式: 否则「编辑某分组 → 关闭 → 点添加」会把旧分组数据当成
  // 新分组提交, 静默覆盖原分组 (editStatus 也不会切回「添加」)
  editModalArg.value.model = { ...defaultMNodal }
  editModalArg.value.editStatus = 1
  editModalArg.value.show = true
}

function handleEditGroup(groupInfo: Panel.ItemIconGroup) {
  editModalArg.value.show = true
  // 浅拷贝: 直接把列表项对象交给表单会让未保存的改动即时反映到列表, 且无法取消
  editModalArg.value.model = { ...groupInfo }
  editModalArg.value.editStatus = 2
}

function handleDragSort() {
  sortStatus.value = true
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
      // 同步本地 sort: 列表顺序由 sort 决定, 不同步会让下一次拖拽保存写回旧值
      groups.value.forEach((item, i) => {
        item.sort = i + 1
      })
      ms.success(t('common.saveSuccess'))
      sortStatus.value = false
    }
    else {
      ms.error(`${t('common.saveFail')}:${msg}`)
    }
  }).catch(() => ms.error(t('common.saveFail')))
}

function handleDelete(groupInfo: Panel.ItemIconGroup) {
  dialog.warning({
    title: t('common.warning'),
    content: t('apps.itemGroupManage.deleteWarnText', { name: groupInfo.title }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      if (groupInfo.id) {
        deletes([groupInfo.id]).then(({ code }) => {
          if (code !== 0)
            ms.error(t('common.deleteFail'))
          else
            refreshList()
        }).catch(() => ms.error(t('common.deleteFail')))
      }
    },

  })
}

function handleSaveGroup() {
  formRef.value?.validate((errors) => {
    if (errors)
      return

    edit(editModalArg.value.model).then(({ code, msg }) => {
      // 失败时保持弹窗打开, 让用户修正后重试 (旧实现失败也关窗+刷新, 改动丢失)
      if (code !== 0) {
        ms.error(msg || t('common.saveFail'))
        return
      }

      editModalArg.value.show = false
      editModalArg.value.model = { ...defaultMNodal }
      editModalArg.value.editStatus = 1
      refreshList()
    }).catch(() => ms.error(t('common.saveFail')))
  })
}

function refreshList() {
  getList<Common.ListResponse<Panel.ItemIconGroup[]>>().then(({ code, data, msg }) => {
    if (code === 0 && data?.list)
      groups.value = data.list
    else if (code !== 0)
      ms.error(`${t('apps.itemGroupManage.getListFail')}:${msg}`)
  }).catch(() => ms.error(t('apps.itemGroupManage.getListFail')))
}

onMounted(() => {
  refreshList()
})
</script>

<template>
  <div class="h-full flex flex-col gap-2 bg-slate-200 dark:bg-zinc-900 p-2">
    <!-- 工具栏: 操作按钮靠左, 状态提示靠右 -->
    <div class="shrink-0 flex items-center gap-2 px-3 py-2 bg-white dark:bg-zinc-800 rounded-xl">
      <NButton type="success" size="small" @click="handleAddGroup">
        <template #icon>
          <SvgIcon icon="typcn:plus" />
        </template>
        {{ $t('common.add') }}
      </NButton>

      <NButton v-if="!sortStatus" size="small" @click="handleDragSort">
        <template #icon>
          <SvgIcon icon="ri:drag-drop-line" />
        </template>
        {{ $t('common.sort') }}
      </NButton>

      <NButton v-else type="warning" size="small" @click="handleSaveSort">
        <template #icon>
          <SvgIcon icon="material-symbols:save" />
        </template>
        {{ $t('common.saveSort') }}
      </NButton>

      <span class="ml-auto truncate text-xs text-slate-400 dark:text-slate-500">
        {{ sortStatus ? $t('apps.itemGroupManage.sortTip') : $t('apps.itemGroupManage.groupCount', { count: groups.length }) }}
      </span>
    </div>

    <!-- 分组列表: flex-1 自适应剩余高度, 内部滚动 -->
    <div class="flex-1 min-h-0 overflow-auto">
      <VueDraggable
        v-model="groups"
        item-key="id" :animation="300"
        :disabled="!sortStatus"
      >
        <div v-for="item in groups" :key="item.id" class="w-full">
          <NCard size="small" class="group-card" :class="sortStatus ? 'cursor-move' : ''">
            <div class="flex items-center gap-3">
              <span class="shrink-0 text-[20px]">
                <SvgIcon icon="material-symbols:ad-group-outline-rounded" />
                <!-- <SvgIcon :icon="item.icon" /> -->
              </span>
              <span class="flex-1 min-w-0 truncate">
                {{ item.title }}
              </span>
              <div class="shrink-0 flex items-center gap-2">
                <NButton strong secondary type="success" size="small" :title="$t('common.edit')" @click="handleEditGroup(item)">
                  <template #icon>
                    <SvgIcon icon="basil:edit-solid" />
                  </template>
                </NButton>
                <NButton strong secondary type="error" size="small" :title="$t('common.delete')" @click="handleDelete(item)">
                  <template #icon>
                    <SvgIcon icon="material-symbols:delete" />
                  </template>
                </NButton>
              </div>
            </div>
          </NCard>
        </div>

        <!-- 空状态 -->
        <div v-if="groups.length === 0" class="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
          {{ $t('common.noData') }}
        </div>
      </VueDraggable>
    </div>

    <RoundCardModal v-model:show="editModalArg.show" size="small" type="small" :title="editModalArg.editStatus === 1 ? '添加' : '编辑'" style="width: 400px;">
      <NForm ref="formRef" :model="editModalArg.model" :rules="editModalArg.rules">
        <NFormItem path="title" :label="$t('apps.itemGroupManage.groupName')">
          <NInput v-model:value="editModalArg.model.title" type="text" :maxlength="20" show-count />
        </NFormItem>

        <!-- 卡片风格 -->
        <NFormItem path="cardStyle" :label="$t('apps.itemGroupManage.cardStyle')">
          <NSelect v-model:value="editModalArg.model.cardStyle" :options="cardStyleOptions" />
        </NFormItem>

        <!-- 隐藏描述信息 -->
        <NFormItem path="hideDescription" :label="$t('apps.baseSettings.hideDescription')">
          <NSwitch
            :value="editModalArg.model.hideDescription === 1"
            @update:value="(v: boolean) => editModalArg.model.hideDescription = v ? 1 : 0"
          />
        </NFormItem>

        <!-- 文字颜色 -->
        <NFormItem path="textColor" :label="$t('common.textColor')">
          <div class="w-full flex items-center">
            <NColorPicker
              v-model:value="textColorValue"
              class="flex-1"
              :show-alpha="false"
              size="small"
              :modes="['hex']"
              :swatches="['#000000', '#ffffff', '#18A058', '#2080F0', '#F0A020']"
            />
            <NButton v-if="!textColorFollowGlobal" quaternary type="info" size="small" class="ml-[8px]" @click="handleResetTextColor">
              {{ $t('apps.itemGroupManage.followGlobal') }}
            </NButton>
          </div>
        </NFormItem>
      </NForm>
      <template #footer>
        <NButton type="success" size="small" class="float-right" @click="handleSaveGroup">
          {{ $t('common.confirm') }}
        </NButton>
      </template>
    </RoundCardModal>
  </div>
</template>

<style scoped>
.group-card {
  border-radius: 10px;
  margin-bottom: 10px;
}
</style>
