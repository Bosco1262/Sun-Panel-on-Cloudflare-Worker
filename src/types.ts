export interface Env {
  DB: D1Database
  FILES: R2Bucket
  JWT_SECRET: string
  LOGIN_RATE: KVNamespace
}

export interface UserInfo {
  id: number
  username: string
  name: string
  headImage: string
  role: number
}
