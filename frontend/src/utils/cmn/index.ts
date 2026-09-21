import moment from 'moment'
import { useAuthStore, useUserStore } from '@/store'
import { getAuthInfo } from '@/api/system/user'
import type { VisitMode } from '@/enums/auth'

const userStore = useUserStore()
const authStore = useAuthStore()

export function timeFormat(timeString?: string) {
  return moment(timeString).format('YYYY-MM-DD HH:mm:ss')
}

export function setTitle(titile: string) {
  document.title = titile
}

// 拉取当前用户信息并写入 store (登录态与访客模式)
export async function updateLocalUserInfo() {
  interface Req {
    user: User.Info
    visitMode: VisitMode
  }

  const { code, data } = await getAuthInfo<Req>()
  if (code !== 0 || !data?.user)
    return

  userStore.updateUserInfo({ username: data.user.username, headImage: data.user.headImage, name: data.user.name })
  authStore.setUserInfo(data.user)
  authStore.setVisitMode(data.visitMode)
}

// 复制文字到剪切板
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    // 使用 Clipboard API
    try {
      await navigator.clipboard.writeText(text)
      return true
    }
    catch (err) {
      console.error('copy fail', err)
      return false
    }
  }
  else {
    // 兼容旧版浏览器
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.select()

    try {
      // 返回值代表复制是否真的成功, 旧实现忽略它 → 复制失败也会提示「复制成功」
      return document.execCommand('copy')
    }
    catch (err) {
      console.error('copy fail', err)
      return false
    }
    finally {
      document.body.removeChild(textArea)
    }
  }
}
