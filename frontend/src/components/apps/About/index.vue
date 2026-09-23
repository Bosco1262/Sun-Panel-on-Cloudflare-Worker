<script setup lang="ts">
import { NDivider, NTag } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { get } from '@/api/system/about'
import { useAppStore } from '@/store'
import srcSvglogo from '@/assets/logo.svg'
import srcGitee from '@/assets/about_image/gitee.png'
import srcGithub from '@/assets/about_image/github.png'
import srcDocker from '@/assets/about_image/docker.png'
import srcBilibili from '@/assets/about_image/bilibili.png'
import srcYoutube from '@/assets/about_image/youtube.png'
import srcQQGroupQR from '@/assets/about_image/qq_group_qr2.png'
import { RoundCardModal } from '@/components/common'

interface Version {
  versionName: string
  versionCode: number
}

/**
 * This port's own addresses: the About page leads with them
 *
 * 本移植版自己的地址: 关于页以它们为主
 */
const REPO_URL = 'https://github.com/Bosco1262/Sun-Panel-on-Cloudflare-Worker'
const REPO_ISSUES_URL = `${REPO_URL}/issues`
const REPO_DOCS_URL = `${REPO_URL}/blob/main/docs/README.md`

const appStore = useAppStore()
const versionName = ref('')
const qqGroupQRShow = ref(false)
const frontVersion = import.meta.env.VITE_APP_VERSION || 'unknown'

onMounted(() => {
  get<Version>().then((res) => {
    if (res.code === 0 && res.data?.versionName)
      versionName.value = res.data.versionName
  }).catch(() => {
    // A missing version number does not affect the rest of the about page
    // 版本号取不到不影响关于页其它内容
    console.warn('load version info failed')
  })
})
</script>

<template>
  <div class="pt-5 px-4 pb-6">
    <!-- Identity: this project first, the upstream project is credited further down -->
    <!-- 身份: 先标明本项目, 上游项目在下面致谢 -->
    <div class="flex flex-col items-center justify-center text-center">
      <img :src="srcSvglogo" width="100" height="100" alt="">
      <div class="text-2xl font-semibold">
        {{ $t('apps.about.portName') }}
      </div>
      <div class="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {{ $t('apps.about.portSubtitle') }}
      </div>
      <!-- Version number only: this port has no release page to link to -->
      <!-- 只显示版本号: 本移植版没有 release 页面可跳转 -->
      <div class="mt-2 text-lg text-slate-500 dark:text-slate-400">
        v{{ versionName }}
      </div>
    </div>

    <NDivider style="margin:10px 0">
      •
    </NDivider>

    <!-- Primary block: this repository -->
    <!-- 主区块: 本仓库 -->
    <div class="mx-auto max-w-[460px]">
      <div class="mb-2 flex items-center gap-[6px] font-bold">
        <span class="h-[14px] w-[3px] rounded-sm bg-emerald-600 dark:bg-emerald-500" />
        {{ $t('apps.about.thisRepoTitle') }}
      </div>

      <div class="flex flex-col gap-[6px] text-[14px]">
        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.repoAddress') }}</span>
          <a :href="REPO_URL" target="_blank" class="link break-all">Sun-Panel-on-Cloudflare-Worker</a>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.repoIssue') }}</span>
          <a :href="REPO_ISSUES_URL" target="_blank" class="link">Github Issues</a>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.docsIndex') }}</span>
          <a :href="REPO_DOCS_URL" target="_blank" class="link">docs/README.md</a>
        </div>
      </div>
    </div>

    <NDivider style="margin:10px 0">
      •
    </NDivider>

    <!-- Secondary block: upstream author and the original project (smaller and faded, so the hierarchy stays clear) -->
    <!-- 次区块: 上游原作者与原版项目 (缩小字号并降低透明度, 保持层级清晰) -->
    <div class="mx-auto max-w-[460px] text-[12.5px] opacity-[0.78]">
      <div class="mb-2 flex items-center gap-[6px] font-bold">
        <span class="h-[12px] w-[3px] rounded-sm bg-slate-400 dark:bg-slate-500" />
        {{ $t('apps.about.upstreamTitle') }}
      </div>

      <div class="flex flex-col gap-[6px]">
        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.author') }}</span>
          <span>
            <a href="https://github.com/hslr-s" target="_blank" class="link">红烧猎人</a>
            <span class="mx-[5px] text-slate-400 dark:text-slate-500">|</span>
            <a href="https://github.com/hslr-s/sun-panel/blob/master/doc/donate.md" target="_blank" class="text-red-600 hover:text-red-900">{{ $t('apps.about.donate') }}</a>
          </span>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.upstreamRepo') }}</span>
          <a href="https://github.com/hslr-s/sun-panel" target="_blank" class="link">hslr-s/sun-panel</a>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.issue') }}</span>
          <a href="https://github.com/hslr-s/sun-panel/issues" target="_blank" class="link">Github Issues</a>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.discussions') }}</span>
          <a href="https://github.com/hslr-s/sun-panel/discussions" target="_blank" class="link">Github Discussions</a>
        </div>

        <div class="flex items-baseline gap-2">
          <span class="w-[74px] shrink-0 text-slate-500 dark:text-slate-400">{{ $t('apps.about.QQGroup') }}</span>
          <span>
            <a href="http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=K6UII6aEPZUeDRIPOEpOSJZH-Vmr_RPu&authKey=jEXhnVekLbDDx5UkQzKtd3bRmhZggkGBxmvW4NT5LLIAFP7toMmqABwvkANGHbLb&noverify=0&group_code=831615449" target="_blank" class="link">{{ $t('apps.about.addQQGroupUrl') }}</a>
            <span class="mx-[5px] text-slate-400 dark:text-slate-500">|</span>
            <span class="link cursor-pointer" @click="qqGroupQRShow = !qqGroupQRShow">
              {{ $t('apps.about.QR') }}
            </span>
          </span>
        </div>
      </div>

      <div class="mt-[10px] flex flex-wrap justify-center">
        <div class="flex items-center mx-[10px]">
          <img class="w-[20px] h-[20px] mr-[5px]" :src="srcGithub" alt="">
          <a href="https://github.com/hslr-s/sun-panel" target="_blank" class="link">Github</a>
        </div>
        <div class="flex items-center mx-[10px]">
          <img class="w-[20px] h-[20px] mr-[5px]" :src="srcGitee" alt="">
          <a href="https://gitee.com/hslr/sun-panel" target="_blank" class="link">Gitee</a>
        </div>
        <div class="flex items-center mx-[10px]">
          <img class="w-[20px] h-[20px] mr-[5px]" :src="srcDocker" alt="">
          <a href="https://hub.docker.com/r/hslr/sun-panel" target="_blank" class="link">Docker</a>
        </div>
        <div class="flex items-center mx-[10px]">
          <img class="w-[20px] h-[20px] mr-[5px]" :src="srcBilibili" alt="">
          <a href="https://space.bilibili.com/27407696/channel/collectiondetail?sid=2023810" target="_blank" class="link">Bilibili</a>
        </div>
        <div v-if="appStore.language !== 'zh-CN'" class="flex items-center mx-[10px]">
          <img class="w-[20px] h-[20px] mr-[5px]" :src="srcYoutube" alt="">
          <a href="https://www.youtube.com/channel/UCKwbFmKU25R602z6P2fgPYg" target="_blank" class="link">YouTube</a>
        </div>
      </div>
    </div>

    <div class="mt-5 flex justify-center">
      <NTag :bordered="false" size="small">
        {{ $t("apps.about.frontVersionText") }}: FV-{{ frontVersion }}
      </NTag>
    </div>

    <RoundCardModal v-model:show="qqGroupQRShow" :title="$t('apps.about.qqGroupQrTitle')" style="width: 300px;">
      <div class="text-center">
        {{ $t('apps.about.qqGroupQrTip') }}
      </div>
      <div class="flex justify-center">
        <img :src="srcQQGroupQR" class="h-[260px]">
      </div>
    </RoundCardModal>
  </div>
</template>

<style>
.link{
    color:rgb(0, 89, 255)
}
</style>
