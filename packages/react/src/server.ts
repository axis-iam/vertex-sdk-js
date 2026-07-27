/**
 * Server-side exports for @axis-iam/vertex-react/server
 * Used in Next.js middleware, API routes, and Server Components.
 *
 * This is a server guard/token-inspection surface. It is not the browser
 * React login flow and it does not replace the backend-owned IAM login page.
 */

import { decodeJwt } from './core/jwt'
import { hasPermission } from '@axis-iam/vertex'
import type { JWTPayload } from './core/types'

export interface GetAuthOptions {
  /** Resolved business permissions from login/refresh response or permissions API. */
  permissions?: string[]
}

export interface AuthResult {
  userId: string | null
  email: string | null
  roles: string[]
  permissions: string[]
  orgId: string | null
  workspaceId: string | null
  isImpersonating: boolean
  actorId: string | null
  hasPermission: (permission: string) => boolean
  raw: JWTPayload | null
}

/**
 * Extract auth information from a request's Authorization header.
 * Decodes the JWT client-side (no signature verification — that's the server's job
 * before the request reaches your handler). Final permissions are not read from
 * JWT claims; pass resolved permissions explicitly when this helper should
 * evaluate route-level permissions.
 *
 * @example
 * ```ts
 * // Next.js API Route
 * import { getAuth } from '@axis-iam/vertex-react/server'
 *
 * export async function GET(request: Request) {
 *   const auth = getAuth(request, { permissions: resolvedPermissions })
 *   if (!auth.userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
 *   if (!auth.hasPermission('orders:read')) return Response.json({ error: 'Forbidden' }, { status: 403 })
 * }
 * ```
 */
export function getAuth(request: Request, options: GetAuthOptions = {}): AuthResult {
  const header = request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return emptyAuth()
  }

  const token = header.slice(7)
  try {
    const payload = decodeJwt(token)
    const permissions = options.permissions ?? []

    return {
      userId: payload.sub,
      email: (payload.email as string) ?? null,
      roles: payload.roles ?? [],
      permissions,
      orgId: (payload.org_id as string) ?? null,
      workspaceId: (payload.workspace_id as string) ?? null,
      isImpersonating: !!payload.act,
      actorId: payload.act?.sub ?? null,
      hasPermission: (perm: string) => hasPermission(permissions, perm),
      raw: payload,
    }
  } catch {
    return emptyAuth()
  }
}

function emptyAuth(): AuthResult {
  return {
    userId: null,
    email: null,
    roles: [],
    permissions: [],
    orgId: null,
    workspaceId: null,
    isImpersonating: false,
    actorId: null,
    hasPermission: () => false,
    raw: null,
  }
}

export interface AuthMiddlewareConfig {
  /** ApplicationClient.clientId for a WEB/M2M confidential server-side client. */
  clientId: string
  /** Secret for that WEB/M2M confidential ApplicationClient. Never expose it to browser bundles. */
  clientSecret: string
  issuerUri: string
  /**
   * Absolute callback URL for the customer app. If omitted, defaults to
   * `${request origin}/callback`. The IAM login page owns IdP selection and
   * starts the Phase 1 runtime flow.
   */
  redirectUri?: string
  publicRoutes?: string[]
  protectedRoutes?: string[]
}

/**
 * Next.js middleware for bearer-token route guarding.
 *
 * Unauthenticated protected routes use a limited legacy handoff to the
 * iam-server login page. This middleware does not generate or store OAuth
 * state, does not generate or store a PKCE verifier, does not send
 * code_challenge/code_challenge_method, and does not perform a confidential
 * token exchange callback.
 *
 * Java IAM now requires WEB authorization-code clients to use confidential
 * client authentication plus S256 PKCE. This middleware is therefore not a
 * complete WEB browser login helper. Use @axis-iam/vertex-react with a SPA
 * public client for browser login, or implement a dedicated WEB/BFF login flow
 * with server-side state/verifier storage, S256 PKCE, and client-secret token
 * endpoint authentication.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { authMiddleware } from '@axis-iam/vertex-react/server'
 * export default authMiddleware({
 *   clientId: process.env.IAM_CLIENT_ID!,
 *   clientSecret: process.env.IAM_CLIENT_SECRET!,
 *   issuerUri: 'https://auth.example.com',
 *   publicRoutes: ['/', '/about'],
 *   protectedRoutes: ['/dashboard(.*)'],
 * })
 * ```
 */
export function authMiddleware(config: AuthMiddlewareConfig) {
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url)
    const path = url.pathname

    // Check if route is public
    if (config.publicRoutes?.some((route) => matchRoute(path, route))) {
      return undefined // Pass through
    }

    // Check if route is protected (if protectedRoutes specified, only those need auth)
    if (config.protectedRoutes && !config.protectedRoutes.some((route) => matchRoute(path, route))) {
      return undefined // Not in protected list, pass through
    }

    const auth = getAuth(request)
    if (!auth.userId) {
      // Limited login-page handoff only. Do not present this as a full WEB
      // Authorization Code login flow; it has no PKCE/state storage.
      const loginUrl = new URL(`${config.issuerUri.replace(/\/$/, '')}/login`)
      loginUrl.searchParams.set('client_id', config.clientId)
      loginUrl.searchParams.set('redirect_uri', config.redirectUri ?? `${url.origin}/callback`)

      return Response.redirect(loginUrl.toString(), 302)
    }

    return undefined // Authenticated, pass through
  }
}

function matchRoute(path: string, pattern: string): boolean {
  // Simple pattern matching — convert route pattern to regex
  const regex = new RegExp(`^${pattern.replace(/\(\.?\*\)/g, '.*')}$`)
  return regex.test(path)
}
