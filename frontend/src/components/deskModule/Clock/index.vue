<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '@/locales'

const props = defineProps<{
  hideSecond?: boolean
}>()

interface CurrentDate {
  time: string
  date: string
  week: string
}

const currentDate = ref<CurrentDate>({
  time: '--:--',
  date: '------',
  week: '--',
})

// The weekday strings are only recomputed when the language changes, instead of rebuilding the array every second
// 星期文案只在语言变化时重算, 不必每秒重建数组
const daysOfWeek = computed(() => [
  t('deskModule.clock.sun'),
  t('deskModule.clock.mon'),
  t('deskModule.clock.tue'),
  t('deskModule.clock.wed'),
  t('deskModule.clock.thu'),
  t('deskModule.clock.fri'),
  t('deskModule.clock.sat'),
])

function updateCurrentDate() {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')

  if (!props.hideSecond) {
    const seconds = String(now.getSeconds()).padStart(2, '0')
    currentDate.value.time = `${hours}:${minutes}:${seconds}`
  }
  else {
    currentDate.value.time = `${hours}:${minutes}`
  }

  // Get the current date
  // 获取当前的日期
  const day = now.getDate()
  // Months are zero-based, hence the +1
  // 月份从0开始，所以要加1
  const month = now.getMonth() + 1

  currentDate.value.week = daysOfWeek.value[now.getDay()]
  currentDate.value.date = `${month}-${day}`
}

const intervalId = setInterval(updateCurrentDate, 1000)

onMounted(() => {
  updateCurrentDate()
})

onBeforeUnmount(() => {
  clearInterval(intervalId)
})
</script>

<template>
  <div class="clock w-full text-center">
    <span class="clock-time text-2xl sm:text-2xl md:text-3xl font-[600]">
      {{ currentDate.time }}
    </span>
    <div class="hidden md:block">
      <span class="clock-date mr-1">
        {{ currentDate.date }}
      </span>
      <span class="clock-week">
        {{ currentDate.week }}
      </span>
    </div>
  </div>
</template>
