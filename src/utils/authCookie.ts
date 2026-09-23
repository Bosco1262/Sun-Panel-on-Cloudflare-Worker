import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

/**
 * Session cookie (improvement plan §9.4)
 *
 * Background: the JWT used to live only in localStorage + the `token` request header, so any XSS on the page
 * (most typically custom JS injected by the administrator) could read the token and replay it elsewhere.
 * With an HttpOnly cookie JavaScript cannot read it while browsers still send it automatically, and
 * `auth_epoch` keeps revoking it immediately on a password change / logout-all-devices.
 *
 * Compatibility: the request headers (`token` / `Authorization: Bearer`) are still accepted, so CLI scripts and
 * third-party tools keep working; the server reads the cookie first.
 *
 *
 * 会话 Cookie (改进计划 §9.4)
 *
 * 背景: JWT 原先只放在 localStorage + `token` 请求头里, 一旦页面存在 XSS (最典型的是管理员
 * 自己注入的自定义 JS), token 会被直接读走并可在别处重放。改成 HttpOnly Cookie 后
 * JavaScript 读不到它, 浏览器仍会自动携带; `auth_epoch` 依旧保证改密/退出所有设备即刻吊销。
 *
 * 兼容策略: 请求头 (`token` / `Authorization: Bearer`) 继续接受 —— 命令行脚本与第三方工具
 * 不受影响; 服务端读取顺序是 Cookie 优先。
 */
export const AUTH_COOKIE_NAME = 'sun_panel_token'

/**
 * Matches the JWT lifetime (72 hours), in seconds
 *
 * 与 JWT 有效期一致 (72 小时), 单位: 秒
 */
export const AUTH_COOKIE_MAX_AGE = 72 * 60 * 60

/**
 * Sets the session cookie on a successful login
 *
 * 登录成功时下发会话 Cookie
 */
export function setAuthCookie(c: Context, token: string): void {
  setCookie(c, AUTH_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    // Lax: no cookie on cross-site POSTs (the first CSRF line of defence); same-site navigation/requests still carry it
    // Lax: 跨站 POST 不带 Cookie (CSRF 第一道防线), 同站跳转与请求不受影响
    sameSite: 'Lax',
    maxAge: AUTH_COOKIE_MAX_AGE,
    // Local dev runs on http://127.0.0.1, where a Secure cookie is dropped by the browser
    // 本地 dev 是 http://127.0.0.1, 带 Secure 浏览器会直接丢弃该 Cookie
    secure: new URL(c.req.url).protocol === 'https:',
  })
}

/**
 * Clears the session cookie on logout
 *
 * 退出登录时清除会话 Cookie
 */
export function clearAuthCookie(c: Context): void {
  deleteCookie(c, AUTH_COOKIE_NAME, { path: '/' })
}

/**
 * Reads the session cookie (null when absent)
 *
 * 读取会话 Cookie (无则返回 null)
 */
export function readAuthToken(c: Context): string | null {
  return getCookie(c, AUTH_COOKIE_NAME) ?? null
}
