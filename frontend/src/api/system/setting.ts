import { post } from '@/utils/request'

// 获取自定义 CSS/JS (公开接口, 未登录时也可获取用于页面注入)
export function getCustomCode<T>() {
  return post<T>({
    url: '/system/getCustomCode',
  })
}

// 保存自定义 CSS/JS
export function saveCustomCode<T>(customCss: string, customJs: string) {
  return post<T>({
    url: '/system/saveCustomCode',
    data: { customCss, customJs },
  })
}
