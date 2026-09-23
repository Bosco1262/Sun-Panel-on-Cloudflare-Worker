<script setup lang="ts">
import { NButton, NCard, NForm, NFormItem, NGradientText, NInput, NSelect, useMessage } from 'naive-ui'
import { ref } from 'vue'
import { login } from '@/api'
import { useAppStore, useAuthStore } from '@/store'
import { SvgIcon } from '@/components/common'
import { router } from '@/router'
import { t } from '@/locales'
import { languageOptions } from '@/utils/defaultData'
import type { Language } from '@/store/modules/app/helper'

const authStore = useAuthStore()
const appStore = useAppStore()
const ms = useMessage()
const loading = ref(false)
const languageValue = ref<Language>(appStore.language)

const form = ref<Login.LoginReqest>({
  username: '',
  password: '',
})

const loginPost = async () => {
  loading.value = true
  try {
    const res = await login<Login.LoginResponse>(form.value)
    if (res.code === 0) {
      authStore.setToken(res.data.token)
      authStore.setUserInfo(res.data)

      setTimeout(() => {
        // The whole welcome line is translated: an English "Hi xxx," prefix used to leak into the Chinese UI
        // 整句走 i18n: 原先写死的英文 "Hi xxx," 前缀会出现在中文界面里
        ms.success(t('login.welcomeMessage', { name: res.data.name }))
        loading.value = false
        router.push({ path: '/' })
      }, 500)
    }
    else {
      loading.value = false
    }
  }
  catch (error) {
    // Network / server errors are already reported centrally by the request layer
    // 网络/服务端异常已由请求层统一提示
    loading.value = false
    console.error('login failed:', error)
  }
}

function handleSubmit() {
  // Triggered by clicking the sign-in button
  // 点击登录按钮触发
  loginPost()
}

function handleChangeLanuage(value: Language) {
  languageValue.value = value
  appStore.setLanguage(value)
}
</script>

<template>
  <div class="login-container">
    <NCard class="login-card" style="border-radius: 20px;">
      <div class="mb-5 flex items-center justify-end">
        <div class="mr-2">
          <SvgIcon icon="ion-language" style="width: 20px;height: 20px;" />
        </div>
        <div class="min-w-[100px]">
          <NSelect v-model:value="languageValue" size="small" :options="languageOptions" @update:value="handleChangeLanuage" />
        </div>
      </div>

      <div class="login-title  ">
        <NGradientText :size="30" type="success" class="!font-bold">
          {{ $t('common.appName') }}
        </NGradientText>
      </div>
      <NForm :model="form" label-width="100px" @keydown.enter="handleSubmit">
        <NFormItem>
          <NInput v-model:value="form.username" :placeholder="$t('login.usernamePlaceholder')">
            <template #prefix>
              <SvgIcon icon="ph:user-bold" />
            </template>
          </NInput>
        </NFormItem>

        <NFormItem>
          <NInput v-model:value="form.password" type="password" :placeholder="$t('login.passwordPlaceholder')">
            <template #prefix>
              <SvgIcon icon="mdi:password-outline" />
            </template>
          </NInput>
        </NFormItem>

        <NFormItem style="margin-top: 10px">
          <NButton type="primary" block :loading="loading" @click="handleSubmit">
            {{ $t('login.loginButton') }}
          </NButton>
        </NFormItem>

        <div class="flex justify-center text-slate-300">
          Powered By <a href="https://github.com/hslr-s/sun-panel" target="_blank" class="ml-[5px] text-slate-500">Sun-Panel</a>
        </div>
      </NForm>
    </NCard>
  </div>
</template>

  <style>
    .login-container {
        padding: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background-color: #f2f6ff;
    }

    /* Dark mode
       夜间模式 */
    .dark .login-container{
      background-color: rgb(43, 43, 43);
    }

    @media (min-width: 600px) {
        .login-card {
            width: auto;
            margin: 0px 10px;
        }
        .login-button {
            width: 100%;
        }
    }

    .login-card {
        margin: 20px;
        min-width:400px;
    }

  .login-title{
    text-align: center;
    margin: 20px;
  }
  </style>
