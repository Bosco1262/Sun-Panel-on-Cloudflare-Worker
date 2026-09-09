<script setup lang="ts">
import { NConfigProvider } from 'naive-ui'
import { onMounted } from 'vue'
import { NaiveProvider } from '@/components/common'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { getCustomCode } from '@/api/system/setting'

const { theme, themeOverrides } = useTheme()
const { language } = useLanguage()

// 注入全局设置中的自定义 CSS/JS (配合卡片唯一标识 onlyName 美化卡片)
onMounted(() => {
  getCustomCode<{ customCss: string; customJs: string }>().then(({ code, data }) => {
    if (code !== 0 || !data)
      return
    if (data.customCss) {
      const style = document.createElement('style')
      style.id = 'custom-global-css'
      style.textContent = data.customCss
      document.head.appendChild(style)
    }
    if (data.customJs) {
      const script = document.createElement('script')
      script.id = 'custom-global-js'
      script.textContent = data.customJs
      document.body.appendChild(script)
    }
  })
})
</script>

<template>
  <NConfigProvider
    class="h-full"
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="language"
  >
    <NaiveProvider>
      <RouterView />
    </NaiveProvider>
  </NConfigProvider>
</template>
