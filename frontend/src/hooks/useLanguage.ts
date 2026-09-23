import { ref, watch } from 'vue'
import { enUS, zhCN } from 'naive-ui'
import { useAppStore } from '@/store'
import { setLocale } from '@/locales'

export function useLanguage() {
  const appStore = useAppStore()
  const language = ref(zhCN)

  // A watch rather than a computed: a computed should stay pure, and performing the setLocale side effect inside
  // its evaluation depends on who reads it first (nobody reads it, the language never switches).
  //
  // 用 watch 而非 computed: computed 应保持纯函数, 在求值里做 setLocale 副作用会
  // 依赖「谁先读它」的时机 (没人读就不会切换语言)
  watch(() => appStore.language, (lang) => {
    if (lang === 'en-US') {
      setLocale('en-US')
      language.value = enUS
      return
    }

    setLocale('zh-CN')
    language.value = zhCN
  }, { immediate: true })

  return { language }
}
