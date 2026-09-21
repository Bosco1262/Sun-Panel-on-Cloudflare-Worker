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
    // 幂等: 重复注入会执行两次自定义 JS (例如开发态热更新重新挂载)
    if (data.customCss && !document.getElementById('custom-global-css')) {
      const style = document.createElement('style')
      style.id = 'custom-global-css'
      style.textContent = data.customCss
      document.head.appendChild(style)
    }
    if (data.customJs && !document.getElementById('custom-global-js')) {
      const script = document.createElement('script')
      script.id = 'custom-global-js'
      script.textContent = data.customJs
      document.body.appendChild(script)
    }
  }).catch(() => {
    // 自定义代码读取失败不影响页面渲染, 仅记录日志
    console.warn('load custom css/js failed')
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
