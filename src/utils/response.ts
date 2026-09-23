import type { Context } from 'hono'

// Error-code table (kept identical to the Go version's ErrorCode.go)
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
  1401: 'Unique name already exists',
}

/**
 * Dedicated code for "request body too large" (security review V-05, see docs/security.md §3)
 *
 * Kept out of ERROR_CODE_MAP on purpose: the message must reach the caller verbatim (the same reason code 1009
 * is absent from that table), and 1400 ("parameter format error") is a different condition.
 *
 * 「请求体过大」的专用错误码 (安全审查 V-05, 见 docs/security.md §3)
 *
 * 刻意不放进 ERROR_CODE_MAP: 文案需要原样抵达调用方 (与 1009 同理), 而 1400「参数格式错误」是另一回事。
 */
export const BODY_TOO_LARGE_CODE = 1402
export const BODY_TOO_LARGE_MSG = 'Request body too large'

/**
 * @param status HTTP status override; business responses use 200 so the frontend reads `code` (protocol layer
 *   failures such as 413 keep their own status)
 *
 * @param status HTTP 状态码覆盖; 业务响应默认 200 让前端读 `code`
 *   (413 这类协议层失败保留自己的状态码)
 */
export function apiReturn(c: Context, code: number, msg: string, data?: unknown, status?: 200 | 400 | 413 | 503) {
  const body: Record<string, unknown> = { code, msg }
  if (data !== undefined)
    body.data = data
  return c.json(body, status ?? 200)
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

// Same behaviour as the Go version's ErrorByCodeAndMsg: "Server error[original message]"
// 与 Go 版 ErrorByCodeAndMsg 行为一致: "Server error[原始信息]"
export function errorByCodeAndMsg(c: Context, code: number, msg: string) {
  const innerMsg = ERROR_CODE_MAP[code] ?? msg
  return apiReturn(c, code, `Server error[${innerMsg}]`)
}

/**
 * Logs one non-sensitive line for an internal failure
 *
 * Deliberately narrow: only the error name and message (with newlines stripped). The full object is not dumped,
 * because a D1/R2 error can carry the failing SQL and bound parameters.
 *
 *
 * 为内部故障记录一行非敏感日志
 *
 * 刻意收窄: 只留错误名与消息 (并去掉换行)。不整体打印对象 —— D1/R2 的错误里可能带着出错的 SQL 与绑定参数。
 */
export function logInternalError(scope: string, err: unknown) {
  const name = err instanceof Error ? err.name : typeof err
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[${scope}] ${name}: ${message.replace(/\s+/g, ' ').slice(0, 300)}`)
}

/**
 * Internal failure: logs the detail locally and answers with the code's generic message only
 * (security review V-04, see docs/security.md §3)
 *
 * The client used to receive `Server error[UNIQUE constraint failed: item_icon.only_name]` — table, column and
 * constraint names in the response body. That is schema intelligence for an attacker and noise for a user, so the
 * raw message stays in the Worker log (visible in `wrangler tail` / Workers Logs) and never reaches the wire.
 *
 *
 * 内部故障: 详情只记本地日志, 对外仅返回错误码对应的通用文案 (安全审查 V-04, 见 docs/security.md §3)
 *
 * 客户端原先会拿到 `Server error[UNIQUE constraint failed: item_icon.only_name]` —— 响应体里带着表名、列名与
 * 约束名。对攻击者这是 schema 情报, 对用户这是噪音, 因此原始信息只进 Worker 日志
 * (可在 `wrangler tail` / Workers Logs 查看), 不出网。
 */
export function internalError(c: Context, code: number, scope: string, err: unknown) {
  logInternalError(scope, err)
  return errorByCode(c, code)
}
