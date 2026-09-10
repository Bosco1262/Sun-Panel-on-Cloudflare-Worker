<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAvatar } from 'naive-ui'
import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

/**
 * 搜索引擎图标
 *
 * 图标地址可能失效(外链挂了 / 用户填错), 直接 <img> 会显示破图,
 * 这里统一按候选列表逐个回退, 全部失败时显示首字母, 保证界面上永远有东西。
 */
const props = withDefaults(defineProps<{
  iconSrc?: string
  title?: string
  size?: number
  /** 图标全部失败时是否回退到内置图标 (默认开启) */
  autoFallback?: boolean
  /** 用户填写的图标地址失效时的兜底候选 (如站点 favicon) */
  fallbackCandidates?: string[]
}>(), {
  iconSrc: '',
  title: '',
  size: 20,
  autoFallback: true,
  fallbackCandidates: () => [],
})

// 内置引擎的矢量图标: 后台里存的是打包后的 svg 地址, 这里按名称兜底
const BUILTIN_SVG: Record<string, string> = {
  google: SvgSrcGoogle,
  baidu: SvgSrcBaidu,
  bing: SvgSrcBing,
}

const failures = ref(0)

const builtinIcon = computed(() => {
  const key = (props.title ?? '').trim().toLowerCase()
  if (key === '百度')
    return SvgSrcBaidu
  return BUILTIN_SVG[key] ?? ''
})

const configuredIcon = computed(() => {
  const src = (props.iconSrc ?? '').trim()
  if (!src)
    return ''
  // 打包后的内置 svg 地址带 hash, 每次构建都会变; 命中内置图标时改用名称匹配
  if (/\/assets\/(google|baidu|bing)[-.]/i.test(src))
    return builtinIcon.value
  return src
})

const fallbackIcon = computed(() => (props.autoFallback ? builtinIcon.value : ''))

const candidates = computed(() => {
  // 用户填了图标就优先用它, 失效后再回退; 没填则直接用候选/内置图标
  const list: string[] = []
  if (configuredIcon.value)
    list.push(configuredIcon.value)
  for (const candidate of props.fallbackCandidates) {
    const src = (candidate ?? '').trim()
    if (src && !list.includes(src))
      list.push(src)
  }
  const builtin = fallbackIcon.value
  if (builtin && !list.includes(builtin))
    list.push(builtin)
  return list
})

const currentSrc = computed(() => candidates.value[failures.value] ?? '')

const initial = computed(() => (props.title ?? '').trim().charAt(0).toUpperCase() || '?')

watch(() => [props.iconSrc, props.title, props.fallbackCandidates], () => {
  failures.value = 0
})

function handleError() {
  failures.value += 1
}
</script>

<template>
  <NAvatar
    v-if="currentSrc"
    :src="currentSrc"
    :size="size"
    style="background-color: transparent;"
    object-fit="contain"
    @error="handleError"
  />
  <NAvatar v-else :size="size" style="background-color: transparent;">
    {{ initial }}
  </NAvatar>
</template>
