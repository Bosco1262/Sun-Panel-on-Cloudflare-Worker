import { SignJWT, jwtVerify } from 'jose'
import type { UserInfo } from '../types'

export interface JWTPayload {
  uid: number
  role: number
}

export async function signToken(secret: string, user: UserInfo): Promise<string> {
  return await new SignJWT({ uid: user.id, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret))
}

export async function verifyToken(secret: string, token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    return {
      uid: payload.uid as number,
      role: payload.role as number,
    }
  }
  catch {
    return null
  }
}
