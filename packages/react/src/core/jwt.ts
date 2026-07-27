import type { JWTPayload, IamUser } from './types'

/**
 * Decode a JWT token payload without verifying the signature.
 * Client-side only — signature verification happens on the server.
 */
export function decodeJwt(token: string): JWTPayload {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts')
  }

  const payload = parts[1]
  // Base64url → Base64
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)

  const decoded = atob(padded)
  return JSON.parse(decoded) as JWTPayload
}

/** Check if a JWT token is expired (with optional clock skew buffer) */
export function isTokenExpired(token: string, bufferSeconds = 0): boolean {
  try {
    const payload = decodeJwt(token)
    if (!payload.exp) return false
    const now = Math.floor(Date.now() / 1000)
    return payload.exp - bufferSeconds <= now
  } catch {
    return true
  }
}

/**
 * Extract IamUser from JWT payload.
 * @param payload - Decoded JWT claims
 * @param permissions - Resolved permissions from login/refresh response or permissions API.
 * @param roles - Current roles from the canonical authorization summary.
 */
export function extractUser(payload: JWTPayload, permissions?: string[], roles?: string[]): IamUser {
  return {
    id: payload.sub,
    email: payload.email as string | undefined,
    username: payload.username as string | undefined,
    name: payload.name as string | undefined,
    roles: roles ?? payload.roles ?? [],
    permissions: permissions ?? [],
    orgId: payload.org_id as string | undefined,
    orgSlug: payload.org_slug as string | undefined,
    orgRole: payload.org_role as string | undefined,
    workspaceId: payload.workspace_id as string | undefined,
    isImpersonating: !!payload.act,
    actorId: payload.act?.sub,
    raw: payload,
  }
}
