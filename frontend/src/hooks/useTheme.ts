import type { GlobalThemeOverrides } from 'naive-ui'
import { computed, watch } from 'vue'
import { darkTheme, useOsTheme } from 'naive-ui'
import { useAppStore } from '@/store'

export function useTheme() {
  const appStore = useAppStore()

  const OsTheme = useOsTheme()

  const isDark = computed(() => {
    if (appStore.theme === 'auto')
      return OsTheme.value === 'dark'
    else
      return appStore.theme === 'dark'
  })

  const theme = computed(() => {
    return isDark.value ? darkTheme : undefined
  })

  // Aligned with upstream v1.8.1 (measured on the deployed site): every control uses naive-ui's default 3px
  // radius; only modals carry 1rem (Dialog has no radius by default, so it is set here, matching RoundCardModal)
  // and settings cards keep naive-ui Card's 10px.
  // 对齐上游 v1.8.1 (部署站实测): 所有控件用 naive-ui 默认 3px 圆角; 仅弹窗为 1rem
  // (Dialog 默认无圆角, 这里设置, 与 RoundCardModal 一致), 设置页卡片保持 naive-ui Card 的 10px。
  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    return {
      common: {
        borderRadius: '3px',
      },
      Dialog: {
        borderRadius: '1rem',
      },
      Card: {
        borderRadius: '10px',
      },
    }
  })

  watch(
    () => isDark.value,
    (dark) => {
      if (dark)
        document.documentElement.classList.add('dark')
      else
        document.documentElement.classList.remove('dark')
    },
    { immediate: true },
  )

  return { theme, themeOverrides }
}
