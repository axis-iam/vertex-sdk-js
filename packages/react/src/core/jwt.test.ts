import { describe, it, expect } from 'vitest'
import { decodeJwt, isTokenExpired, extractUser } from './jwt'

// Helper: create a minimal JWT with given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const sig = 'fake-signature'
  return `${header}.${body}.${sig}`
}

describe('decodeJwt', () => {
  it('decodes a valid JWT payload', () => {
    const token = makeJwt({ sub: 'user-1', email: 'a@b.com', custom: 'value' })
    const payload = decodeJwt(token)
    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('a@b.com')
    expect(payload.custom).toBe('value')
  })

  it('throws on invalid JWT format', () => {
    expect(() => decodeJwt('not-a-jwt')).toThrow('Invalid JWT')
    expect(() => decodeJwt('a.b')).toThrow('Invalid JWT')
  })
})

describe('isTokenExpired', () => {
  it('returns false for non-expired token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    const token = makeJwt({ sub: 'u', exp })
    expect(isTokenExpired(token)).toBe(false)
  })

  it('returns true for expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 60 // 1 minute ago
    const token = makeJwt({ sub: 'u', exp })
    expect(isTokenExpired(token)).toBe(true)
  })

  it('respects buffer seconds', () => {
    const exp = Math.floor(Date.now() / 1000) + 30 // 30s from now
    const token = makeJwt({ sub: 'u', exp })
    expect(isTokenExpired(token, 0)).toBe(false)
    expect(isTokenExpired(token, 60)).toBe(true) // within 60s buffer
  })

  it('returns false when exp is missing', () => {
    const token = makeJwt({ sub: 'u' })
    expect(isTokenExpired(token)).toBe(false)
  })

  it('returns true for invalid token', () => {
    expect(isTokenExpired('garbage')).toBe(true)
  })
})

describe('extractUser', () => {
  it('extracts user fields from payload', () => {
    const payload = {
      sub: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      roles: ['admin'],
      org_id: 'org-1',
      org_slug: 'acme',
      org_role: 'admin',
      workspace_id: 'ws-1',
    }
    const user = extractUser(payload, ['users:read', 'users:create'])

    expect(user.id).toBe('user-123')
    expect(user.email).toBe('test@example.com')
    expect(user.name).toBe('Test User')
    expect(user.roles).toEqual(['admin'])
    expect(user.permissions).toEqual(['users:read', 'users:create'])
    expect(user.orgId).toBe('org-1')
    expect(user.orgSlug).toBe('acme')
    expect(user.orgRole).toBe('admin')
    expect(user.workspaceId).toBe('ws-1')
    expect(user.isImpersonating).toBe(false)
    expect(user.actorId).toBeUndefined()
  })

  it('detects impersonation from act claim', () => {
    const payload = {
      sub: 'user-456',
      act: { sub: 'admin-789' },
    }
    const user = extractUser(payload)
    expect(user.isImpersonating).toBe(true)
    expect(user.actorId).toBe('admin-789')
  })

  it('handles missing optional fields', () => {
    const user = extractUser({ sub: 'u' })
    expect(user.id).toBe('u')
    expect(user.roles).toEqual([])
    expect(user.permissions).toEqual([])
    expect(user.email).toBeUndefined()
    expect(user.orgId).toBeUndefined()
  })

  it('does not trust a JWT permissions claim fallback', () => {
    const payload = {
      sub: 'user-789',
      roles: ['admin'],
      permissions: ['*:*'],
    }

    const user = extractUser(payload)

    expect(user.roles).toEqual(['admin'])
    expect(user.permissions).toEqual([])
  })
})
