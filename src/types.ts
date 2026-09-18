export interface Env {
  DB: D1Database
  FILES: R2Bucket
  JWT_SECRET: string
  /** 密码哈希用的 pepper (可选): 配置后新密码使用 PBKDF2, 详见 src/utils/password.ts */
  PASSWORD_PEPPER?: string
  /** 可选的 PBKDF2 迭代数覆盖值 (默认 5000) */
  PASSWORD_PBKDF2_ITERATIONS?: string
}

export interface UserInfo {
  id: number
  username: string
  name: string
  headImage: string
  role: number
}
