import md5 from 'blueimp-md5'

// ===================== 旧版 (与 Go 版兼容) =====================

// 与 Go 版 cmn.PasswordEncryption 一致: md5(md5(md5(password))) 小写 hex
export function passwordEncryption(password: string): string {
  return md5(md5(md5(password)))
}

export function md5Hex(str: string): string {
  return md5(str)
}

// ===================== v2: PBKDF2-SHA256 + 随机盐 + pepper =====================

/**
 * 迭代数默认值
 *
 * 本机 WebCrypto 实测 (Node 24 / BoringSSL, 与 workerd 同源): 5k ≈ 2.6ms、10k ≈ 4.5ms、
 * 100k ≈ 43ms、210k ≈ 85ms。Workers 免费版每请求 CPU 只有 10ms (超限直接 1102 报错),
 * 因此默认取 5k 留出余量; 想要更高强度可用 Worker 变量 PASSWORD_PBKDF2_ITERATIONS 覆盖
 * (例如升级到 Workers Paid 后可设 210000)。
 *
 * 迭代数会写进哈希串, 所以调高之后旧哈希照样能校验, 并在下次登录成功时自动重算。
 */
export const DEFAULT_PBKDF2_ITERATIONS = 5000
const MIN_PBKDF2_ITERATIONS = 1000
const MAX_PBKDF2_ITERATIONS = 1_000_000

const LEGACY_HASH_PATTERN = /^[0-9a-f]{32}$/
const V2_HASH_PATTERN = /^pbkdf2\$sha256\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)\$([0-9a-f]{8})$/

const SALT_BYTES = 16
const KEY_BITS = 256

/** 解析可选的迭代数覆盖值 (非法/越界时回退默认值) */
export function resolveIterations(override?: string): number {
  const n = Number(override ?? '')
  if (!Number.isFinite(n) || n <= 0)
    return DEFAULT_PBKDF2_ITERATIONS
  return Math.min(MAX_PBKDF2_ITERATIONS, Math.max(MIN_PBKDF2_ITERATIONS, Math.floor(n)))
}

/** 是否是旧版三重 MD5 哈希 */
export function isLegacyHash(stored: string): boolean {
  return LEGACY_HASH_PATTERN.test(stored ?? '')
}

/** 当前 pepper 的标识 (sha256 前 8 位): 用来发现「pepper 被换掉」而不是报密码错误 */
export async function pepperId(pepper: string): Promise<string> {
  if (!pepper)
    return ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pepper))
  return bytesToHex(new Uint8Array(digest)).slice(0, 8)
}

/** 从哈希串里取 pepper 标识 (旧格式 / 非法格式返回 '') */
export function storedPepperId(stored: string): string {
  const m = V2_HASH_PATTERN.exec(stored ?? '')
  return m ? m[4] : ''
}

/** 生成 v2 哈希: `pbkdf2$sha256$<iterations>$<saltB64>$<hashB64>$<pepperId>` */
export async function hashPassword(plain: string, pepper: string, iterations = DEFAULT_PBKDF2_ITERATIONS): Promise<string> {
  if (!pepper)
    throw new Error('PASSWORD_PEPPER is required to create v2 password hashes')

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(plain, pepper, salt, iterations)
  return `pbkdf2$sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}$${await pepperId(pepper)}`
}

/** 是否需要重算哈希 (旧格式, 或迭代数低于当前配置) */
export function needsRehash(stored: string, iterations = DEFAULT_PBKDF2_ITERATIONS): boolean {
  if (isLegacyHash(stored))
    return true
  const m = V2_HASH_PATTERN.exec(stored ?? '')
  if (!m)
    return false
  return Number(m[1]) < iterations
}

/**
 * 校验结果
 *
 * - `ok` / `mismatch`: 正常的密码对不对
 * - `pepper-missing`: 存的是 v2 哈希, 但服务端没配 PASSWORD_PEPPER (fail-closed, 不当作密码错)
 * - `pepper-changed`: pepper 与哈希串里记录的不一致 (fail-closed, 给出可操作的错误)
 */
export type PasswordCheckOutcome = 'ok' | 'mismatch' | 'pepper-missing' | 'pepper-changed'

export async function checkPassword(
  plain: string,
  stored: string,
  pepper: string,
): Promise<PasswordCheckOutcome> {
  if (!stored)
    return 'mismatch'

  // 旧版哈希: 仍然支持校验, 由调用方在登录成功后升级
  if (isLegacyHash(stored))
    return timingSafeEqual(passwordEncryption(plain), stored) ? 'ok' : 'mismatch'

  const m = V2_HASH_PATTERN.exec(stored)
  if (!m)
    return 'mismatch'

  if (!pepper)
    return 'pepper-missing'
  if (await pepperId(pepper) !== m[4])
    return 'pepper-changed'

  const actual = await derive(plain, pepper, base64ToBytes(m[2]), Number(m[1]))
  return timingSafeEqual(bytesToBase64(actual), m[3]) ? 'ok' : 'mismatch'
}

/** 兼容旧调用点的布尔版本 (不区分 pepper 异常) */
export async function verifyPassword(plain: string, stored: string, pepper: string): Promise<boolean> {
  return await checkPassword(plain, stored, pepper) === 'ok'
}

// ===================== 内部实现 =====================

async function derive(plain: string, pepper: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  // pepper 作为密钥的一部分参与派生: 只有 D1 数据泄露时无法离线爆破
  const key = await crypto.subtle.importKey('raw', encoder.encode(`${pepper}${plain}`), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/** 常量时间比较 (长度不同直接 false) */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length)
    return false
  let diff = 0
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return bytes
}
