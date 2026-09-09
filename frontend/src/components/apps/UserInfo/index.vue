<script setup lang="ts">
import type { FormInst, FormRules } from 'naive-ui'
import { NButton, NCard, NDivider, NForm, NFormItem, NInput, NSelect, useDialog, useMessage } from 'naive-ui'
import { ref } from 'vue'
import { useAppStore, useAuthStore, usePanelState, useUserStore } from '@/store'
import { languageOptions } from '@/utils/defaultData'
import type { Language, Theme } from '@/store/modules/app/helper'
import { logout } from '@/api'
import { RoundCardModal, SvgIcon } from '@/components/common/'
import { updatePassword, updateUsername } from '@/api/system/user'
import { updateLocalUserInfo } from '@/utils/cmn'
import { t } from '@/locales'

const userStore = useUserStore()
const authStore = useAuthStore()
const appStore = useAppStore()
const panelState = usePanelState()
const ms = useMessage()
const dialog = useDialog()

const languageValue = ref(appStore.language)
const themeValue = ref(appStore.theme)
const formRef = ref<FormInst | null>(null)
const usernameFormRef = ref<FormInst | null>(null)
const themeOptions: { label: string; key: string; value: Theme }[] = [
  { label: t('apps.userInfo.themeStyle.dark'), key: 'dark', value: 'dark' },
  { label: t('apps.userInfo.themeStyle.light'), key: 'light', value: 'light' },
  { label: t('apps.userInfo.themeStyle.auto'), key: 'Auto', value: 'auto' },
]
const updatePasswordModalState = ref({
  show: false,
  loading: false,
  form: {
    password: '',
    oldPassword: '',
    confirmPassword: '',
  },
})
const updateUsernameModalState = ref({
  show: false,
  loading: false,
  form: {
    username: authStore.userInfo?.username || '',
    password: '',
  },
})

const updatePasswordModalFormRules: FormRules = {
  oldPassword: {
    required: true,
    trigger: 'blur',
    min: 6,
    max: 20,
    message: t('adminSettingUsers.formRules.passwordLimit'),
  },
  password: {
    required: true,
    trigger: 'blur',
    min: 6,
    max: 20,
    message: t('adminSettingUsers.formRules.passwordLimit'),
  },
  confirmPassword: {
    required: true,
    trigger: 'blur',
    min: 6,
    max: 20,
    message: t('adminSettingUsers.formRules.passwordLimit'),
  },
}

const updateUsernameModalFormRules: FormRules = {
  username: {
    required: true,
    trigger: ['blur', 'input'],
    message: t('settingUserInfo.usernameRequiredMsg'),
  },
  password: {
    required: true,
    trigger: 'blur',
    message: t('settingUserInfo.currentPasswordRequiredMsg'),
  },
}

async function logoutApi() {
  // 后端登出失败（如 token 已过期、网络异常）不应阻塞本地登出
  try {
    await logout()
  }
  catch {}
  userStore.resetUserInfo()
  authStore.removeToken()
  panelState.removeState()
  appStore.removeToken()
  ms.success(t('settingUserInfo.logoutSuccess'))
  // router.push({ path: '/login' })
  location.reload()// 强制刷新一下页面
}

function handleUpdatePassword(e: MouseEvent) {
  e.preventDefault()
  formRef.value?.validate((errors) => {
    if (errors) {
      console.log(errors)
      return
    }

    if (updatePasswordModalState.value.form.password !== updatePasswordModalState.value.form.confirmPassword) {
      ms.error(t('settingUserInfo.confirmPasswordInconsistentMsg'))
      return
    }
    updatePasswordModalState.value.loading = true
    updatePassword(
      updatePasswordModalState.value.form.oldPassword,
      updatePasswordModalState.value.form.password,
    ).then(({ code, msg }) => {
      if (code === 0) {
        // 成功
        updatePasswordModalState.value.show = false
        updateLocalUserInfo()
        ms.success(t('common.success'))
      }
      else {
        ms.error(msg)
      }
    }).finally(() => {
      updatePasswordModalState.value.loading = false
    }).catch(() => {
      ms.error(t('common.serverError'))
    })
  })
}

function handleUpdateUsername(e: MouseEvent) {
  e.preventDefault()
  usernameFormRef.value?.validate((errors) => {
    if (errors) {
      console.log(errors)
      return
    }

    const newUsername = updateUsernameModalState.value.form.username.trim()
    if (newUsername === authStore.userInfo?.username) {
      ms.error(t('settingUserInfo.usernameUnchangedMsg'))
      return
    }

    updateUsernameModalState.value.loading = true
    updateUsername(newUsername, updateUsernameModalState.value.form.password).then(({ code, msg }) => {
      if (code === 0) {
        // 成功
        updateUsernameModalState.value.show = false
        updateUsernameModalState.value.form.password = ''
        updateLocalUserInfo()
        ms.success(t('common.success'))
      }
      else {
        ms.error(msg)
      }
    }).finally(() => {
      updateUsernameModalState.value.loading = false
    }).catch(() => {
      ms.error(t('common.serverError'))
    })
  })
}

function handleLogout() {
  dialog.warning({
    title: t('common.warning'),
    content: t('settingUserInfo.confirmLogoutText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      logoutApi()
    },
  })
}

function handleChangeLanuage(value: Language) {
  languageValue.value = value
  appStore.setLanguage(value)
  location.reload()
}

function handleChangeTheme(value: Theme) {
  themeValue.value = value
  appStore.setTheme(value)
  // location.reload()
}
</script>

<template>
  <div class="bg-slate-200 dark:bg-zinc-900 p-2 h-full">
    <!-- 账号 -->
    <NCard style="border-radius:10px" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('settingUserInfo.account') }}
      </div>

      <div>
        <div class="text-slate-500 font-bold">
          {{ $t('settingUserInfo.username') }}
        </div>
        <div class="flex items-center gap-[6px]">
          <span>{{ authStore.userInfo?.username }}</span>
          <NButton size="small" text type="info" @click="updateUsernameModalState.show = true">
            {{ $t('settingUserInfo.updateUsername') }}
          </NButton>
        </div>
      </div>

      <NDivider style="margin: 10px 0;" dashed />
      <div>
        <NButton size="small" text type="info" @click="updatePasswordModalState.show = !updatePasswordModalState.show">
          {{ $t('settingUserInfo.updatePassword') }}
        </NButton>
      </div>
    </NCard>

    <!-- 设置 -->
    <NCard style="border-radius:10px" class="mt-[10px]" size="small">
      <div class="text-slate-500 mb-[5px] font-bold">
        {{ $t('settingUserInfo.settings') }}
      </div>

      <div class="mt-[10px]">
        <div class="text-slate-500 font-bold">
          {{ $t('common.language') }}
        </div>
        <div class="max-w-[200px]">
          <NSelect v-model:value="languageValue" :options="languageOptions" @update-value="handleChangeLanuage" />
        </div>
      </div>

      <div class="mt-[10px]">
        <div class="text-slate-500 font-bold">
          {{ $t('apps.userInfo.theme') }}
        </div>
        <div class="max-w-[200px]">
          <NSelect v-model:value="themeValue" :options="themeOptions" @update-value="handleChangeTheme" />
        </div>
      </div>

      <NDivider style="margin: 10px 0;" dashed />
      <div>
        <NButton size="small" text type="error" @click="handleLogout">
          <template #icon>
            <SvgIcon icon="tabler:logout" />
          </template>
          {{ $t('settingUserInfo.logout') }}
        </NButton>
      </div>
    </NCard>

    <RoundCardModal v-model:show="updatePasswordModalState.show" size="small" preset="card" style="width: 400px" :title="$t('settingUserInfo.updatePassword')">
      <NForm ref="formRef" :model="updatePasswordModalState.form" :rules="updatePasswordModalFormRules">
        <NFormItem path="oldPassword" :label="$t('settingUserInfo.oldPassword')">
          <NInput v-model:value="updatePasswordModalState.form.oldPassword" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.oldPassword')" />
        </NFormItem>

        <NFormItem path="password" :label="$t('settingUserInfo.newPassword')">
          <NInput v-model:value="updatePasswordModalState.form.password" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.newPassword')" />
        </NFormItem>

        <NFormItem path="confirmPassword" :label="$t('settingUserInfo.confirmPassword')">
          <NInput v-model:value="updatePasswordModalState.form.confirmPassword" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.confirmPassword')" />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="float-right">
          <NButton type="success" size="small" :loading="updatePasswordModalState.loading" @click="handleUpdatePassword">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </template>
    </RoundCardModal>

    <RoundCardModal v-model:show="updateUsernameModalState.show" size="small" preset="card" style="width: 400px" :title="$t('settingUserInfo.updateUsername')">
      <NForm ref="usernameFormRef" :model="updateUsernameModalState.form" :rules="updateUsernameModalFormRules">
        <NFormItem path="username" :label="$t('settingUserInfo.newUsername')">
          <NInput v-model:value="updateUsernameModalState.form.username" :maxlength="20" type="text" :placeholder="$t('settingUserInfo.newUsername')" />
        </NFormItem>

        <NFormItem path="password" :label="$t('settingUserInfo.currentPassword')">
          <NInput v-model:value="updateUsernameModalState.form.password" :maxlength="20" type="password" :placeholder="$t('settingUserInfo.currentPassword')" />
        </NFormItem>
      </NForm>

      <template #footer>
        <div class="float-right">
          <NButton type="success" size="small" :loading="updateUsernameModalState.loading" @click="handleUpdateUsername">
            {{ $t('common.save') }}
          </NButton>
        </div>
      </template>
    </RoundCardModal>
  </div>
</template>
