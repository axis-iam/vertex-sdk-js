import { describe, it, expect } from 'vitest'
import { getAuth, authMiddleware } from './server'
import type { AuthMiddlewareConfig } from './server'

// Helper: create a minimal JWT with given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${body}.fake-sig`
}

function makeRequest(token?: string, url = 'https://app.example.com/api/data'): Request {
  const headers = new Headers()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return new Request(url, { headers })
}

describe('getAuth', () => {
  it('extracts user info from valid JWT', () => {
    const jwt = makeJwt({
      sub: 'user-1',
      email: 'test@example.com',
      roles: ['admin'],
      org_id: 'org-1',
      workspace_id: 'ws-1',
    })
    const auth = getAuth(makeRequest(jwt))

    expect(auth.userId).toBe('user-1')
    expect(auth.email).toBe('test@example.com')
    expect(auth.roles).toEqual(['admin'])
    expect(auth.permissions).toEqual([])
    expect(auth.orgId).toBe('org-1')
    expect(auth.workspaceId).toBe('ws-1')
    expect(auth.isImpersonating).toBe(false)
    expect(auth.actorId).toBeNull()
  })

  it('hasPermission checks explicitly supplied resolved permissions', () => {
    const jwt = makeJwt({
      sub: 'u',
    })
    const auth = getAuth(makeRequest(jwt), { permissions: ['orders:read', 'users:*'] })

    expect(auth.hasPermission('orders:read')).toBe(true)
    expect(auth.hasPermission('users:delete')).toBe(true) // wildcard
    expect(auth.hasPermission('reports:read')).toBe(false)
  })

  it('does not read permissions from JWT payload', () => {
    const jwt = makeJwt({
      sub: 'u',
      permissions: ['*:*'],
    })
    const auth = getAuth(makeRequest(jwt))

    expect(auth.permissions).toEqual([])
    expect(auth.hasPermission('anything:delete')).toBe(false)
  })

  it('detects impersonation', () => {
    const jwt = makeJwt({
      sub: 'user-1',
      act: { sub: 'admin-789' },
    })
    const auth = getAuth(makeRequest(jwt))

    expect(auth.isImpersonating).toBe(true)
    expect(auth.actorId).toBe('admin-789')
  })

  it('returns empty auth when no Authorization header', () => {
    const auth = getAuth(makeRequest())

    expect(auth.userId).toBeNull()
    expect(auth.roles).toEqual([])
    expect(auth.permissions).toEqual([])
    expect(auth.hasPermission('anything:here')).toBe(false)
    expect(auth.raw).toBeNull()
  })

  it('returns empty auth for non-Bearer token', () => {
    const req = new Request('https://app.example.com/', {
      headers: { Authorization: 'Basic abc123' },
    })
    const auth = getAuth(req)

    expect(auth.userId).toBeNull()
  })

  it('returns empty auth for malformed JWT', () => {
    const auth = getAuth(makeRequest('not-a-jwt'))

    expect(auth.userId).toBeNull()
    expect(auth.hasPermission('orders:read')).toBe(false)
  })

  it('handles missing optional fields', () => {
    const jwt = makeJwt({ sub: 'user-1' })
    const auth = getAuth(makeRequest(jwt))

    expect(auth.userId).toBe('user-1')
    expect(auth.email).toBeNull()
    expect(auth.roles).toEqual([])
    expect(auth.permissions).toEqual([])
    expect(auth.orgId).toBeNull()
    expect(auth.workspaceId).toBeNull()
  })
})

describe('authMiddleware', () => {
  const config: AuthMiddlewareConfig = {
    clientId: 'my-app',
    clientSecret: 'secret',
    issuerUri: 'https://auth.example.com',
    publicRoutes: ['/', '/about', '/api/health'],
    protectedRoutes: ['/dashboard(.*)', '/api/v1(.*)'],
  }

  it('passes through public routes', async () => {
    const middleware = authMiddleware(config)
    const result = await middleware(makeRequest(undefined, 'https://app.example.com/'))
    expect(result).toBeUndefined()
  })

  it('passes through public routes (exact match)', async () => {
    const middleware = authMiddleware(config)
    const result = await middleware(makeRequest(undefined, 'https://app.example.com/about'))
    expect(result).toBeUndefined()
  })

  it('uses only the limited login-page handoff for unauthenticated protected routes', async () => {
    const middleware = authMiddleware(config)
    const result = await middleware(makeRequest(undefined, 'https://app.example.com/dashboard'))

    expect(result).toBeInstanceOf(Response)
    expect(result!.status).toBe(302)
    const location = result!.headers.get('Location')!
    expect(location).toContain('https://auth.example.com/login')
    expect(location).toContain('client_id=my-app')
    expect(location).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback')
    expect(location).not.toContain('/oauth2/authorize')
    expect(location).not.toContain('code_challenge')
    expect(location).not.toContain('code_verifier')
    expect(location).not.toContain('client_secret')
  })

  it('passes through protected routes when authenticated', async () => {
    const jwt = makeJwt({ sub: 'user-1' })
    const middleware = authMiddleware(config)
    const result = await middleware(makeRequest(jwt, 'https://app.example.com/dashboard/settings'))

    expect(result).toBeUndefined()
  })

  it('passes through routes not in protected list', async () => {
    const middleware = authMiddleware(config)
    const result = await middleware(makeRequest(undefined, 'https://app.example.com/other-page'))

    expect(result).toBeUndefined()
  })

  it('protects sub-paths with pattern matching', async () => {
    const middleware = authMiddleware(config)
    const result = await middleware(makeRequest(undefined, 'https://app.example.com/api/v1/orders'))

    expect(result).toBeInstanceOf(Response)
    expect(result!.status).toBe(302)
  })
})
