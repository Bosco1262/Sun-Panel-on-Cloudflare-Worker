<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NInput, useMessage } from 'naive-ui'
import { getCustomCode, saveCustomCode } from '@/api/system/setting'
import { t } from '@/locales'

const ms = useMessage()
const saveLoading = ref(false)
const customCss = ref('')
const customJs = ref('')

async function handleSave() {
  saveLoading.value = true
  try {
    const { code, msg } = await saveCustomCode(customCss.value, customJs.value)
    if (code === 0)
      ms.success(t('common.saveSuccess'))
    else
      ms.error(`${t('common.saveFail')}:${msg}`)
  }
  catch {
    ms.error(t('common.saveFail'))
  }
  saveLoading.value = false
}

onMounted(() => {
  getCustomCode<{ customCss: string; customJs: string }>().then(({ code, data }) => {
    if (code === 0 && data) {
      customCss.value = data.customCss || ''
      customJs.value = data.customJs || ''
    }
  })
})
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 p-2 h-full overflow-auto">
    <NAlert type="info" :show-icon="true" class="mb-[10px]">
      {{ $t('apps.globalSetting.customJSAndCssAlert') }}
    </NAlert>

    <div class="text-slate-500 font-bold mb-[5px]">
      {{ $t('apps.globalSetting.customCss') }}
    </div>
    <NInput
      v-model:value="customCss"
      type="textarea"
      :rows="8"
      style="font-family: monospace;"
    />

    <div class="text-slate-500 font-bold mt-[10px] mb-[5px]">
      {{ $t('apps.globalSetting.customJs') }}
    </div>
    <NInput
      v-model:value="customJs"
      type="textarea"
      :rows="8"
      style="font-family: monospace;"
    />

    <div class="mt-[10px] flex justify-end">
      <NButton type="success" size="small" :loading="saveLoading" @click="handleSave">
        {{ $t('common.save') }}
      </NButton>
    </div>
  </div>
</template>
