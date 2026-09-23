import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../types'
import { BODY_TOO_LARGE_CODE, BODY_TOO_LARGE_MSG, apiReturn } from './response'

/**
 * Request-body size limiting (security review V-05, see docs/security.md §3)
 *
 * Why it is needed: every business endpoint parses the request body, and a body of tens of megabytes turns into
 * unbounded JSON parsing / `FormData` materialisation — a cheap CPU-and-memory amplifier for an attacker (the
 * unauthenticated `/login` included). Cloudflare also caps the request size at the edge, but that is a platform
 * default, not a guarantee this service should rely on.
 *
 * Two layers, deliberately:
 * 1. the `Content-Length` header is checked first (a cheap reject before buffering anything);
 * 2. the length actually read is checked afterwards as well, because the header can be missing (chunked
 *    transfer encoding) or smaller than the real body — a spoofed header must not get a free pass.
 *
 * Mechanics: the body is read once from a clone of the raw request, then `c.req.raw` is replaced by a request
 * rebuilt from those bytes (see `readBodyBytes`). Every later reader — Hono's `c.req.json()` / `c.req.formData()`
 * as well as the upload routes that touch the raw request directly — therefore sees a fresh, complete body.
 *
 *
 * 请求体大小限制 (安全审查 V-05, 见 docs/security.md §3)
 *
 * 为什么需要: 所有业务接口都要解析请求体, 几十 MB 的请求体会变成无上限的 JSON 解析 / FormData 物化 ——
 * 对攻击者来说这是一个廉价的 CPU/内存放大器 (未认证的 /login 也一样)。Cloudflare 边缘本身有请求体上限,
 * 但那是平台默认值, 不应作为本服务的依赖。
 *
 * 刻意留两层:
 * 1. 先看 `Content-Length` 头 (便宜, 在缓冲之前就拒掉);
 * 2. 再校验实际读到的长度 —— 头部可能缺失 (分块传输) 或小于真实体积, 伪造的头不能成为免检通道。
 *
 * 实现要点: 从原始请求的 clone 读一次请求体, 再用这些字节重建 `c.req.raw` (见 `readBodyBytes`)。
 * 之后所有读取方 —— 走 Hono 的 `c.req.json()` / `c.req.formData()`, 以及直接读原始请求的上传路由 ——
 * 拿到的都是一份全新且完整的请求体。
 */

/**
 * Body limits by scenario (bytes)
 *
 * 按场景划分的请求体上限 (字节)
 */
export const REQUEST_BODY_LIMIT = {
  /** Ordinary JSON requests: login, panel edits, list queries / 普通 JSON 请求: 登录、面板增删改、列表查询 */
  small: 64 * 1024,
  /** Large JSON payloads: panel config, custom CSS/JS / 大 JSON 载荷: 面板配置、自定义 CSS/JS */
  large: 1024 * 1024,
  /** File uploads (multipart) / 文件上传 (multipart) */
  upload: 50 * 1024 * 1024,
} as const

/**
 * Longest accepted `Content-Length` value: 12 digits is far beyond any real limit and still short enough that
 * a malicious header cannot be turned into expensive parsing
 *
 * `Content-Length` 允许的最长位数: 12 位远超任何真实上限, 同时短到无法用恶意头部换取昂贵的解析
 */
const CONTENT_LENGTH_MAX_DIGITS = 12

/**
 * Middleware: reject requests whose body exceeds `maxSize`
 *
 * Why the body is buffered here as well, when the header was already checked: a body that is only *declared*
 * small can still be large (a lying `Content-Length`, chunked encoding), and the header check cannot see that.
 * Reading it with `raw.text()` keeps the stream intact for Hono's own body cache — an earlier attempt used
 * `c.req.arrayBuffer()`, which left the cached buffer with downstream readers that do not go through Hono's
 * `HonoRequest` (the upload routes read the raw request), and the request hung instead of answering.
 *
 *
 * 为什么在已经看过头部之后还要缓冲请求体: 只被*声明*为小体积的请求体仍可能是大的
 * (撒谎的 `Content-Length`、分块编码), 光看头部看不出来。这里用 `raw.text()` 读取,
 * 让 Hono 自己的请求体缓存保持完整 —— 早先的实现用了 `c.req.arrayBuffer()`,
 * 而下游有不走 HonoRequest 的读取方 (上传路由直接读原始请求), 结果请求被挂住而不是返回响应。
 *
 * @param options.maxSize byte limit; defaults to the "small JSON" bucket
 * @param options.bufferBody whether to buffer and re-read the body — the default `true` closes the
 *   "a lying or missing `Content-Length`" gap; `false` is for routes whose body is read in full anyway
 *   (multipart uploads), where the extra copy would only cost memory
 *
 * @param options.maxSize 字节上限, 默认按「普通 JSON」档
 * @param options.bufferBody 是否缓冲并复核真实字节数 —— 默认 `true` 用来堵住
 *   「`Content-Length` 撒谎或缺失」的口子; `false` 用于本来就要整份读取请求体的路由 (multipart 上传),
 *   那里多复制一份只是白耗内存
 */
export function bodyLimit(options: number | { maxSize?: number, bufferBody?: boolean } = {}): MiddlewareHandler<{ Bindings: Env }> {
  const { maxSize, bufferBody } = typeof options === 'number'
    ? { maxSize: options, bufferBody: true }
    : { maxSize: options.maxSize ?? REQUEST_BODY_LIMIT.small, bufferBody: options.bufferBody ?? true }

  return async (c, next) => {
    const declared = c.req.header('content-length')
    if (declared !== undefined && isOverLimit(declared, maxSize))
      return rejectTooLarge(c)

    // The declared length is enough when it is present: nothing on the wire was smaller than the header says
    // in a way that helps an attacker, and the downstream parser still materialises the real body.
    //
    // 有声明长度时它就够用: 真实体积不会比头部声称的更小, 而下游解析器仍会按真实体积处理。
    if (!bufferBody && declared !== undefined) {
      await next()
      return
    }

    // Otherwise the real length is measured, because a request without a `Content-Length` (chunked encoding, or
    // a synthetic Request in tests and scripts) carries a perfectly real body that no header describes.
    //
    // 否则就要量真实长度: 没有 `Content-Length` 的请求 (分块编码, 或测试/脚本里合成的 Request)
    // 带的仍然是真实请求体, 只是没有头部描述它。
    if (mayHaveBody(c)) {
      let actual = 0
      try {
        actual = await readBodyBytes(c)
      }
      catch (err) {
        const name = (err as Error).name
        if (name === 'TypeError')
          actual = 0 // no body at all / 本就没有请求体
        else
          throw err // a genuine read failure must not silently disable the limit / 真实读取失败不能静默绕过限制
      }
      if (actual > maxSize)
        return rejectTooLarge(c)
    }

    await next()
  }
}

/**
 * Whether the request can carry a body at all (GET/HEAD cannot, per the fetch specification)
 *
 * 请求是否可能带请求体 (按 fetch 规范 GET/HEAD 不能)
 */
function mayHaveBody(c: Context): boolean {
  const method = c.req.method.toUpperCase()
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

/**
 * Re-reads the body from the raw request and returns its byte length
 *
 * Reading through `raw.clone()` keeps the body intact for whoever reads it next, and replacing
 * `c.req.raw` with a request built from the buffered bytes means no reader can end up with a consumed
 * stream. The headers are copied explicitly because a `Request` built from a body silently rewrites
 * `Content-Type` (`text/plain;charset=UTF-8` for a string), which would make `c.req.json()` and
 * multipart parsing reject a body that was perfectly valid.
 *
 *
 * 从原始请求重新读一遍请求体并返回其字节长度
 *
 * 通过 `raw.clone()` 读取可以为后续读取方保留请求体; 再用缓冲后的字节重建 `c.req.raw`, 任何读取方都不会
 * 拿到一个已被消费的流。头部必须显式复制: 用请求体构造 `Request` 会悄悄改写 `Content-Type`
 * (字符串会变成 `text/plain;charset=UTF-8`), 那会让 `c.req.json()` 与 multipart 解析拒绝一个本来合法的请求体。
 */
async function readBodyBytes(c: Context): Promise<number> {
  const bytes = await c.req.raw.clone().arrayBuffer()
  const headers = new Headers(c.req.raw.headers)
  const contentType = c.req.raw.headers.get('content-type')
  if (contentType)
    headers.set('content-type', contentType)
  c.req.raw = new Request(c.req.raw.url, { method: c.req.raw.method, headers, body: bytes })
  return bytes.byteLength
}

/**
 * Checks a declared length without turning it into a number
 *
 * A plain `Number()` would accept `1e9`, `0x1000`, `Infinity` and `-1`; here anything that is not a plain
 * decimal is treated as **over the limit** (fail closed), so a malformed header cannot dodge the check.
 *
 *
 * 不把头部解析成数字即可完成判断
 *
 * 直接用 `Number()` 会接受 `1e9`、`0x1000`、`Infinity`、`-1`; 这里凡不是纯十进制一律按**超限**处理
 * (fail closed), 畸形头部无法用来绕过检查。
 */
export function isOverLimit(declared: string, maxSize: number): boolean {
  const value = declared.trim()
  if (!/^\d+$/.test(value) || value.length > CONTENT_LENGTH_MAX_DIGITS)
    return true
  // Leading zeros are legal in the header and must not inflate the digit count
  // 头部里的前导零是合法的, 不能让它虚增位数
  const digits = value.replace(/^0+/, '')
  const limit = String(maxSize)
  if (digits.length > limit.length)
    return true
  if (digits.length < limit.length)
    return false
  return digits > limit
}

function rejectTooLarge(c: Context) {
  // 413 carries the meaning at the HTTP layer; the body keeps the usual { code, msg } shape so every existing
  // frontend branch handles it without a special case.
  //
  // 用 413 在 HTTP 层承载语义, 响应体保持既有的 { code, msg } 结构, 前端无需特殊分支
  return apiReturn(c, BODY_TOO_LARGE_CODE, BODY_TOO_LARGE_MSG, undefined, 413)
}
