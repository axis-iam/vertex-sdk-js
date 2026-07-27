import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchPermission, hasPermission, hasAllPermissions, hasAnyPermission } from './wildcard.js'

describe('matchPermission', () => {
  it('consumes shared wildcard vectors', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../../testdata/permission-manifest-vectors.json', import.meta.url), 'utf8')) as {
      codeGeneration: { wildcardMatch: Array<{ target: string; granted: string; matches: boolean }> }
    }
    for (const vector of fixture.codeGeneration.wildcardMatch) {
      expect(matchPermission(vector.granted, vector.target), `${vector.granted} -> ${vector.target}`).toBe(vector.matches)
    }
  })
  it('matches exact permission', () => {
    expect(matchPermission('orders:read', 'orders:read')).toBe(true)
  })

  it('does not match different resource', () => {
    expect(matchPermission('orders:read', 'users:read')).toBe(false)
  })

  it('does not match different action', () => {
    expect(matchPermission('orders:read', 'orders:write')).toBe(false)
  })

  it('matches resource:* wildcard', () => {
    expect(matchPermission('orders:*', 'orders:read')).toBe(true)
    expect(matchPermission('orders:*', 'orders:create')).toBe(true)
    expect(matchPermission('orders:*', 'orders:delete')).toBe(true)
  })

  it('does not match resource:* for different resource', () => {
    expect(matchPermission('orders:*', 'users:read')).toBe(false)
  })

  it('matches *:* (full wildcard)', () => {
    expect(matchPermission('*:*', 'orders:read')).toBe(true)
    expect(matchPermission('*:*', 'anything:here')).toBe(true)
  })

  it('rejects invalid format (no colon)', () => {
    expect(matchPermission('orders', 'orders:read')).toBe(false)
    expect(matchPermission('orders:read', 'orders')).toBe(false)
  })

  it('rejects empty resource', () => {
    expect(matchPermission(':read', 'orders:read')).toBe(false)
  })

  it('rejects multiple colons', () => {
    expect(matchPermission('a:b:c', 'a:b')).toBe(false)
  })
})

describe('hasPermission', () => {
  const perms = ['orders:read', 'orders:create', 'users:*']

  it('returns true for exact match', () => {
    expect(hasPermission(perms, 'orders:read')).toBe(true)
  })

  it('returns true for wildcard match', () => {
    expect(hasPermission(perms, 'users:delete')).toBe(true)
  })

  it('returns false for missing permission', () => {
    expect(hasPermission(perms, 'reports:read')).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(hasPermission([], 'orders:read')).toBe(false)
  })
})

describe('hasAllPermissions', () => {
  const perms = ['orders:read', 'users:*']

  it('returns true when all present', () => {
    expect(hasAllPermissions(perms, ['orders:read', 'users:manage'])).toBe(true)
  })

  it('returns false when one missing', () => {
    expect(hasAllPermissions(perms, ['orders:read', 'reports:read'])).toBe(false)
  })

  it('returns true for empty required', () => {
    expect(hasAllPermissions(perms, [])).toBe(true)
  })
})

describe('hasAnyPermission', () => {
  const perms = ['orders:read']

  it('returns true when at least one present', () => {
    expect(hasAnyPermission(perms, ['orders:read', 'reports:read'])).toBe(true)
  })

  it('returns false when none present', () => {
    expect(hasAnyPermission(perms, ['users:read', 'reports:read'])).toBe(false)
  })

  it('returns false for empty required', () => {
    expect(hasAnyPermission(perms, [])).toBe(false)
  })
})
