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

  // 对齐上游: 弹窗/卡片统一圆角 (Dialog 默认无圆角, 这里统一为 1rem, 与 RoundCardModal 一致)
  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    return {
      common: {
        borderRadius: '10px',
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
