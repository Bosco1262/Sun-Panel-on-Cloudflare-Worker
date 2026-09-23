<script setup lang="ts">
import { NConfigProvider } from 'naive-ui'
import { onBeforeUnmount, watch } from 'vue'
import { NaiveProvider } from '@/components/common'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { getCustomCode } from '@/api/system/setting'
import { useAuthStore } from '@/store'

const { theme, themeOverrides } = useTheme()
const { language } = useLanguage()
const authStore = useAuthStore()

// Only one custom-code request is in flight at a time; a new token aborts the previous one
// 同一时刻只保留一个自定义代码请求; 新 token 到来时中止上一个
let customCodeAbort: AbortController | null = null

/**
 * Injects the custom CSS/JS from the global settings (used together with the card's onlyName identifier)
 *
 * Idempotent: injecting twice would run the custom JS twice (for example when dev HMR remounts the app).
 * The endpoint has been authenticated since the security review (V-03), so this only runs while a token exists —
 * an anonymous page load has no custom code and never sends a request that is certain to be rejected.
 *
 *
 * 注入全局设置中的自定义 CSS/JS (配合卡片唯一标识 onlyName 使用)
 *
 * 幂等: 重复注入会让自定义 JS 执行两次 (例如开发态热更新重新挂载应用)。
 * 该接口自安全审查 V-03 起需要鉴权, 因此只在有 token 时执行 —— 未登录页面没有自定义代码,
 * 也不会发出注定被拒的请求。
 */
function injectCustomCode() {
  // Already injected: nothing to do (the guard also keeps HMR from re-requesting)
  // 已注入过: 无需重复处理 (这个判断同时避免 HMR 重复请求)
  if (document.getElementById('custom-global-css') || document.getElementById('custom-global-js'))
    return

  customCodeAbort?.abort()
  const controller = new AbortController()
  customCodeAbort = controller

  getCustomCode<{ customCss: string; customJs: string }>(controller.signal).then(({ code, data }) => {
    if (code !== 0 || !data)
      return
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
    // A failed custom-code read does not affect rendering, so it is only logged
    // 自定义代码读取失败不影响页面渲染, 仅记录日志
    console.warn('load custom css/js failed')
  })
}

// `immediate` keeps the original "runs at startup" timing for an authenticated visit; a token that appears later
// (a fresh login without a reload) triggers the download
//
// immediate 保留了「启动即执行」的原有行为 (已登录访问时); 稍后才出现的 token
// (刚登录未刷新页面) 也会触发拉取
watch(
  () => authStore.token,
  (token) => {
    if (token)
      injectCustomCode()
  },
  { immediate: true },
)

onBeforeUnmount(() => customCodeAbort?.abort())
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
