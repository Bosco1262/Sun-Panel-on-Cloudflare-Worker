import type { GenericAbortSignal } from 'axios'
import { post } from '@/utils/request'

// Reads the custom CSS/JS (authenticated since the security review V-03)
// 获取自定义 CSS/JS (安全审查 V-03 起需要鉴权)
//
// The caller passes a `signal` and aborts it while no token is known yet, so an anonymous page load never sends a
// request that is certain to be rejected with 1000.
//
// 调用方传入 `signal`, 在还不知道有 token 时中止请求 —— 未登录的页面加载不会发出注定被拒 (1000) 的请求。
export function getCustomCode<T>(signal?: GenericAbortSignal) {
  return post<T>({
    url: '/system/getCustomCode',
    signal,
  })
}

// Saves the custom CSS/JS
// 保存自定义 CSS/JS
export function saveCustomCode<T>(customCss: string, customJs: string) {
  return post<T>({
    url: '/system/saveCustomCode',
    data: { customCss, customJs },
  })
}

/**
 * Reads the storage settings (whether deleting an item/group automatically reclaims unreferenced images)
 *
 * 读取存储设置 (删除项目/分组时是否自动回收未引用图片)
 */
export function getStorageSettings<T>() {
  return post<T>({
    url: '/system/getStorageSettings',
  })
}

/**
 * Saves the storage settings
 *
 * 保存存储设置
 */
export function saveStorageSettings<T>(autoCleanUnused: boolean) {
  return post<T>({
    url: '/system/saveStorageSettings',
    data: { autoCleanUnused },
  })
}
