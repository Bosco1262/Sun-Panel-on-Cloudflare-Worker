import { post } from '@/utils/request'

export function getAuthInfo<T>() {
  return post<T>({
    url: '/user/getAuthInfo',
  })
}

export function updatePassword<T>(username: string, oldPassword: string, newPassword: string) {
  return post<T>({
    url: '/user/updatePassword',
    data: { username, newPassword, oldPassword },
  })
}
