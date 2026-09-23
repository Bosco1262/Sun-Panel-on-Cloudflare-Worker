import type { ConfigProviderProps } from 'naive-ui'
import { createDiscreteApi, darkTheme, lightTheme, useOsTheme } from 'naive-ui'
import { computed, ref } from 'vue'
import type { Response } from './index'
import { t } from '@/locales'
import { useAppStore } from '@/store'

const themeRef = ref<'light' | 'dark'>('light')
const configProviderPropsRef = computed<ConfigProviderProps>(() => ({
  theme: themeRef.value === 'light' ? lightTheme : darkTheme,
}))
export const { message } = createDiscreteApi(['message'], { configProviderProps: configProviderPropsRef })

const errorCodeKey = (code: number) => `apiErrorCode.${code}`

/**
 * Whether the backend's numeric `code` has a translation of its own.
 *
 * The backend always answers with a numeric `code` plus an **English** `msg` (see `src/utils/response.ts`), so the
 * translation is the only text fit for the user. Every code the API protocol defines has one; a code without a
 * translation is the caller-owned business code -1, or a code this frontend does not know yet.
 *
 *
 * 后端的数字 `code` 是否有对应译文。
 *
 * 后端固定返回「数字 code + **英文** msg」(见 `src/utils/response.ts`), 因此只有译文才适合展示给用户。
 * 协议里定义的错误码都有译文; 没有译文的只剩由调用方决定的业务码 -1, 以及前端尚不认识的新码。
 */
export function hasApiErrorText(code: number): boolean {
  const key = errorCodeKey(code)
  return t(key) !== key
}

/**
 * User-facing text for a failed response.
 *
 * The translation wins whenever the code has one, otherwise the backend `msg` is the only information available
 * (see `hasApiErrorText`); `fallbackKey` is used when there is no message at all.
 *
 *
 * 失败响应对应的用户可见文案。
 *
 * code 有译文时一律用译文, 否则只能退回后端 `msg` (见 `hasApiErrorText`); 连 msg 都没有时用 `fallbackKey`。
 */
export function apiErrorText(res: Pick<Response, 'code' | 'msg'>, fallbackKey = 'common.unknownError'): string {
  if (hasApiErrorText(res.code))
    return t(errorCodeKey(res.code))
  return res.msg || t(fallbackKey)
}

/**
 * Reports a failed response, unless the request layer already did it.
 *
 * `successHandler` shows the dialog itself for every code that has a translation (see `apiRespErrMsg` below), so a
 * caller reporting the same response again would make the user see one failure twice — and, because the backend
 * `msg` is English, the second dialog would be in the wrong language as well.
 *
 *
 * 上报一次失败响应, 除非请求层已经报过。
 *
 * 有译文的 code 已经由 `successHandler` 调用 `apiRespErrMsg` 弹过窗, 调用方再报一次会让同一次失败弹两遍;
 * 而且后端 `msg` 是英文, 第二个弹窗还会是错的语种。
 */
export function reportApiError(
  res: Pick<Response, 'code' | 'msg'>,
  report: (text: string) => void,
  fallbackKey = 'common.unknownError',
) {
  if (hasApiErrorText(res.code))
    return
  report(apiErrorText(res, fallbackKey))
}

/**
 * Marker put on an error whose dialog the request layer already showed (see `failHandler`).
 *
 * 请求层已经弹过窗的错误对象上的标记 (见 `failHandler`)。
 */
const REPORTED_FLAG = '__sunPanelErrorReported'

export function markErrorReported<T>(error: T): T {
  if (error && typeof error === 'object')
    (error as Record<string, unknown>)[REPORTED_FLAG] = true
  return error
}

function isErrorReported(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as Record<string, unknown>)[REPORTED_FLAG] === true
}

/**
 * Reports an error caught by the caller, unless the request layer already reported it.
 *
 * A transport failure (network drop / 5xx) is shown by `failHandler` and then rethrown, so the caller's `catch`
 * must stay silent for it — otherwise the user sees the same failure twice. Errors thrown by the calling code
 * itself are not marked and are reported with the caller's own `fallbackKey`.
 *
 *
 * 上报调用方 catch 到的错误, 除非请求层已经报过。
 *
 * 传输层失败 (网络中断 / 5xx) 已由 `failHandler` 提示后重新抛出, 调用方的 `catch` 必须保持安静,
 * 否则同一次失败会弹两遍。调用方自己抛出的错误没有标记, 用调用方给的 `fallbackKey` 提示。
 */
export function reportThrownError(
  error: unknown,
  report: (text: string) => void,
  fallbackKey = 'common.serverError',
) {
  if (isErrorReported(error))
    return
  report(t(fallbackKey))
}

/**
 * Shows the dialog for a failed response that reached the request layer.
 *
 * @returns whether a dialog was shown, so the caller can tell "reported" from "the caller decides"
 *
 * 请求层收到失败响应时弹窗。
 *
 * @returns 是否弹了窗, 便于调用方区分「已提示」与「由调用方决定」
 */
export function apiRespErrMsg(res: Response): boolean {
  const appStore = useAppStore()
  const osTheme = useOsTheme()
  if (appStore.theme === 'auto')
    themeRef.value = osTheme.value as 'dark' | 'light'
  else
    themeRef.value = appStore.theme as 'dark' | 'light'

  if (!hasApiErrorText(res.code))
    return false

  message.error(t(errorCodeKey(res.code)))
  return true
}
