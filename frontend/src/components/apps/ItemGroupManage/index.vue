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

const groups = ref<Panel.ItemIconGroup[]>([])

function handleAddGroup() {
  editModalArg.value.show = !editModalArg.value.show
}

function handleEditGroup(groupInfo: Panel.ItemIconGroup) {
  editModalArg.value.show = true
  editModalArg.value.model = groupInfo
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
      ms.success(t('common.saveSuccess'))
      sortStatus.value = false
    }
    else {
      ms.error(`${t('common.saveFail')}:${msg}`)
    }
  })
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
            ms.error(t('common.deleteFail'))
          else
            refreshList()
        })
      }
    },

  })
}

function handleSaveGroup() {
  formRef.value?.validate((errors) => {
    if (!errors) {
      edit(editModalArg.value.model).then(({ code, msg }) => {
        if (code !== 0)
          ms.error(msg)

        refreshList()
        editModalArg.value.show = false
        editModalArg.value.model = { ...defaultMNodal }
      })
    }
    else { console.log(errors) }
  })
}

function refreshList() {
  getList<Common.ListResponse<Panel.ItemIconGroup[]>>().then(({ code, data }) => {
    groups.value = data.list
  })
}

onMounted(() => {
  refreshList()
})
</script>

<template>
  <div class="h-full">
    <div class="p-2">
      <NButton type="success" size="small" style="margin-right: 10px;" @click="handleAddGroup">
        {{ $t('common.add') }}
      </NButton>

      <NButton v-if="!sortStatus" size="small" @click="handleDragSort">
        {{ $t('common.sort') }}
      </NButton>

      <NButton v-else type="warning" size="small" @click="handleSaveSort">
        {{ $t('common.saveSort') }}
      </NButton>
    </div>

    <div class=" overflow-auto w-full mt-[20px]  bg-slate-200 dark:bg-zinc-900 rounded-xl" style="height:calc(100% - 65px)">
      <VueDraggable
        v-model="groups"
        item-key="sort" :animation="300"
        :style="{ padding: sortStatus ? '20px' : '10px' }"
        :disabled="!sortStatus"
      >
        <div v-for="(item, index) in groups" :key="index" class="w-full">
          <NCard size="small" style="border-radius:10px;margin-bottom: 10px;">
            <div class="flex" :class="sortStatus ? 'cursor-move' : ''">
              <div class="flex items-center">
                <span class="mr-[10px]">
                  <SvgIcon class="text-[20px]" icon="material-symbols:ad-group-outline-rounded" />
                  <!-- <SvgIcon class="text-[20px]" :icon="item.icon" /> -->
                </span>
                <span>
                  {{ item.title }}
                </span>
              </div>
              <div class="ml-auto">
                <span>
                  <NButton strong secondary type="success" size="small" @click="handleEditGroup(item)">
                    <template #icon>
                      <SvgIcon icon="basil:edit-solid" />
                    </template>
                  </NButton>
                </span>
                <span class="ml-[10px]">
                  <NButton strong secondary type="error" size="small" class="ml-[10px]" @click="handleDelete(item)">
                    <template #icon>
                      <SvgIcon icon="material-symbols:delete" />
                    </template>
                  </NButton>
                </span>
              </div>
            </div>
          </NCard>
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
