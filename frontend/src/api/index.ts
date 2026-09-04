import { post } from '@/utils/request'

// 登录相关

export function login<T>(data: Login.LoginReqest) {
  return post<T>({
    url: '/login',
    data,
  })
}

export function logout<T>() {
  return post<T>({
    url: '/logout',
  })
}
