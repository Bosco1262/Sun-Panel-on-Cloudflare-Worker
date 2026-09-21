import type { AxiosError, AxiosProgressEvent, AxiosResponse, GenericAbortSignal } from 'axios'
import request from './axios'
import { apiRespErrMsg, message } from './apiMessage'
import { t } from '@/locales'
import { useAppStore, useAuthStore } from '@/store'
import { router } from '@/router'

let loginMessageShow = false
export interface HttpOption {
  url: string
  data?: any
  method?: string
  headers?: any
  onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void
  signal?: GenericAbortSignal
}

export interface Response<T = any> {
  data: T
  msg: string
  code: number
}

function http<T = any>(
  { url, data, method, headers, onDownloadProgress, signal }: HttpOption,
) {
  const authStore = useAuthStore()
  const appStore = useAppStore()
  const successHandler = (res: AxiosResponse<Response<T>>) => {
    if (res.data.code === 0)
      return res.data

    if (res.data.code === 1001) {
      // 避免重复弹窗
      if (loginMessageShow === false) {
        loginMessageShow = true
        message.warning(t('api.loginExpires'), {
        // message.warning('登录过期', {
          onLeave() {
            loginMessageShow = false
          },
        })
      }

      router.push({ path: '/login' })
      authStore.removeToken()
      return res.data
    }

    if (res.data.code === 1000) {
      router.push({ path: '/login' })
      authStore.removeToken()
      return res.data
    }

    if (res.data.code === 1005) {
      message.warning(res.data.msg)
      return res.data
    }

    // code -1: 业务侧「无数据」等非致命结果 (如 userConfig/get 无记录)。
    // 这里只原样返回, 提示由调用方按场景决定, 避免统一弹窗造成重复提示
    if (res.data.code === -1)
      return res.data

    if (!apiRespErrMsg(res.data))
      return Promise.reject(res.data)
    else
      return res.data
  }

  // HTTP 层失败 (网络中断 / 5xx): 业务错误码在上面的 successHandler 里处理。
  // 旧实现把参数标成 Response<Error>, 于是永远读不到服务端返回的 msg, 只显示通用「网络错误」
  const failHandler = (error: AxiosError<Response>) => {
    message.error(error.response?.data?.msg || t('common.networkError'), {
      duration: 8000,
      closable: true,
    })
    throw error
  }

  method = method || 'GET'

  const params = Object.assign(typeof data === 'function' ? data() : data ?? {}, {})
  if (!headers)
    headers = {}

  // 会话默认走 HttpOnly Cookie; 只有在内存里拿到 token 时才补发请求头 (脚本/回退场景)
  if (authStore.token)
    headers.token = authStore.token
  headers.lang = appStore.language
  // GET 也要带 headers: 否则将来新增需要鉴权的 GET 接口会静默丢 token
  return method === 'GET'
    ? request.get(url, { params, headers, signal, onDownloadProgress }).then(successHandler, failHandler)
    : request.post(url, params, { headers, signal, onDownloadProgress }).then(successHandler, failHandler)
}

export function get<T = any>(
  { url, data, method = 'GET', onDownloadProgress, signal }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    onDownloadProgress,
    signal,
  })
}

export function post<T = any>(
  { url, data, method = 'POST', headers, onDownloadProgress, signal }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
  })
}
