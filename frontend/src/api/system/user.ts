import { post } from '@/utils/request'

export function getAuthInfo<T>() {
  return post<T>({
    url: '/user/getAuthInfo',
  })
}

export function updatePassword<T>(oldPassword: string, newPassword: string) {
  return post<T>({
    url: '/user/updatePassword',
    data: { newPassword, oldPassword },
  })
}

export function updateUsername<T>(username: string, password: string) {
  return post<T>({
    url: '/user/updateUsername',
    data: { username, password },
  })
}
