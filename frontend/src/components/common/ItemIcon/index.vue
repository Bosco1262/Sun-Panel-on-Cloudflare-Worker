<script setup lang="ts">
import { NAvatar, NImage } from 'naive-ui'
import { computed, withDefaults } from 'vue'
import { SvgIconOnline } from '@/components/common'

interface Prop {
  itemIcon?: Panel.ItemIcon | null
  // Default 70
  // 默认70
  size?: number
  // Forced background colour
  // 强制背景色
  forceBackground?: string
}

const props = withDefaults(defineProps<Prop>(), { size: 70 })
const defaultBackground = '#2a2a2a6b'
// A computed rather than a ref, so a dynamic size change from the parent is picked up as well
// computed 而非 ref: 父组件动态改 size 时也要跟着变
const defaultStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))
const iconExt = computed(() => {
  const src = props.itemIcon?.src
  if (!src)
    return ''
  // Strip ?query / #hash before taking the extension, otherwise xxx.svg?v=1 is treated as a non-svg
  // 去掉 ?query / #hash 再取扩展名, 否则 xxx.svg?v=1 会被判成非 svg
  return (src.split(/[?#]/)[0].split('.').pop() || '').toLowerCase()
})
</script>

<template>
  <div class="item-icon" :style="defaultStyle">
    <slot>
      <template v-if="itemIcon">
        <template v-if="itemIcon?.itemType === 1">
          <NAvatar :size="props.size" :style="{ backgroundColor: (forceBackground ?? itemIcon?.backgroundColor) || defaultBackground }">
            {{ itemIcon.text }}
          </NAvatar>
        </template>

        <template v-else-if="itemIcon?.itemType === 2">
          <div v-if="iconExt === 'svg'" :style="{ backgroundColor: (forceBackground ?? itemIcon?.backgroundColor) || defaultBackground, ...defaultStyle }" class="flex justify-center items-center">
            <img :src="itemIcon?.src" :alt="itemIcon?.text || ''" class="w-[35px] h-[35px]">
          </div>
          <NImage v-else :style="{ backgroundColor: (forceBackground ?? itemIcon?.backgroundColor) || defaultBackground, ...defaultStyle }" :src="itemIcon?.src" preview-disabled />
        </template>

        <template v-else-if="itemIcon?.itemType === 3">
          <NAvatar :size="props.size" :style="{ backgroundColor: (forceBackground ?? itemIcon?.backgroundColor) || defaultBackground }">
            <SvgIconOnline style="font-size: 35px;" :icon="itemIcon.text" />
          </NAvatar>
        </template>

        <!-- Fallback when itemType is missing or invalid: the old implementation rendered a blank space -->
        <!-- itemType 缺失/非法时的兜底: 旧实现会渲染成空白 -->
        <template v-else>
          <NAvatar :size="props.size" :style="{ backgroundColor: (forceBackground ?? itemIcon?.backgroundColor) || defaultBackground }">
            {{ itemIcon?.text }}
          </NAvatar>
        </template>
      </template>

      <template v-else>
        <NAvatar :size="props.size" />
      </template>
    </slot>
  </div>
</template>
