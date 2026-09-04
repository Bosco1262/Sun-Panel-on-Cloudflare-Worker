import type { Context } from 'hono'

// 错误码表 (与 Go 版 ErrorCode.go 保持一致)
export const ERROR_CODE_MAP: Record<number, string> = {
  1000: 'Not logged in yet',
  1003: 'Incorrect username or password',
  1004: 'Account disabled or not activated',
  1005: 'No current permission for operation',
  1006: 'Account does not exist',
  1007: 'Old password error',
  1008: 'Too many login attempts, please try again later',
  1200: 'Database error',
  1201: 'Please keep at least one',
  1202: 'No data record found',
  1300: 'Upload failed',
  1301: 'Unsupported file format',
  1400: 'Parameter format error',
}

export function apiReturn(c: Context, code: number, msg: string, data?: unknown) {
  const body: Record<string, unknown> = { code, msg }
  if (data !== undefined)
    body.data = data
  return c.json(body)
}

export function success(c: Context) {
  return apiReturn(c, 0, 'OK')
}

export function successData(c: Context, data: unknown) {
  return apiReturn(c, 0, 'OK', data)
}

export function successList(c: Context, list: unknown, count: number) {
  return apiReturn(c, 0, 'OK', { list, count })
}

export function error(c: Context, msg: string) {
  return apiReturn(c, -1, msg)
}

export function errorByCode(c: Context, code: number) {
  return apiReturn(c, code, ERROR_CODE_MAP[code] ?? 'Server error')
}

// 与 Go 版 ErrorByCodeAndMsg 行为一致: "Server error[原始信息]"
export function errorByCodeAndMsg(c: Context, code: number, msg: string) {
  const innerMsg = ERROR_CODE_MAP[code] ?? msg
  return apiReturn(c, code, `Server error[${innerMsg}]`)
}
