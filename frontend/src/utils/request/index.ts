import type { AxiosError, AxiosProgressEvent, AxiosResponse, GenericAbortSignal } from 'axios'
import request from './axios'
import { apiErrorText, apiRespErrMsg, markErrorReported, message } from './apiMessage'
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
      // Avoid duplicate dialogs
      // 避免重复弹窗
      if (loginMessageShow === false) {
        loginMessageShow = true
        message.warning(t('api.loginExpires'), {
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
      // The backend msg is English; the code is what carries the meaning for the user
      // 后端 msg 是英文, 对用户有意义的是 code
      message.warning(t('apiErrorCode.1005'))
      return res.data
    }

    // code -1: non-fatal business results such as "no data" (for example userConfig/get without a record).
    // It is returned as-is and the caller decides what to show, so a central dialog cannot duplicate messages.
    //
    // code -1: 业务侧「无数据」等非致命结果 (如 userConfig/get 无记录)。
    // 这里只原样返回, 提示由调用方按场景决定, 避免统一弹窗造成重复提示
    if (res.data.code === -1)
      return res.data

    if (!apiRespErrMsg(res.data))
      return Promise.reject(res.data)
    else
      return res.data
  }

  // Transport-level failure (network drop / 5xx): business codes are handled by successHandler above.
  // 413 (body too large) and 503 (JWT_SECRET unusable) still carry a business `code`, so the text is resolved the same
  // way — straight from the code, never from the English `msg`.
  //
  // HTTP 层失败 (网络中断 / 5xx): 业务错误码在上面的 successHandler 里处理。
  // 413 (请求体过大) 与 503 (JWT_SECRET 不可用) 同样带着业务 code, 因此文案按同样方式解析 ——
  // 一律由 code 决定, 不用英文 msg。
  const failHandler = (error: AxiosError<Response>) => {
    const body = error.response?.data
    message.error(body ? apiErrorText(body, 'common.networkError') : t('common.networkError'), {
      duration: 8000,
      closable: true,
    })
    // Marked so the caller's catch does not show the same failure a second time (see reportThrownError)
    // 打上标记, 调用方的 catch 就不会把同一次失败再提示一遍 (见 reportThrownError)
    throw markErrorReported(error)
  }

  method = method || 'GET'

  const params = Object.assign(typeof data === 'function' ? data() : data ?? {}, {})
  if (!headers)
    headers = {}

  // The session normally travels in the HttpOnly cookie; the request header is only added when a token exists in memory (scripts / fallback)
  // 会话默认走 HttpOnly Cookie; 只有在内存里拿到 token 时才补发请求头 (脚本/回退场景)
  if (authStore.token)
    headers.token = authStore.token
  headers.lang = appStore.language
  // GET also carries headers: otherwise a future authenticated GET endpoint would silently lose the token
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
  // `signal` travels through: callers cancel a request that is already known to be unauthenticated
  // (see the custom-code read in App.vue) so it is never sent at all
  // signal 会一路传下去: 调用方可以取消「已知未认证」的请求 (见 App.vue 的自定义代码读取), 让它根本不发出
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
  })
}
