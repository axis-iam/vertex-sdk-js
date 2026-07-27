import { describe, it, expect } from 'vitest'
import { permKey, toAuthority, fromAuthority } from './permission.js'

describe('permKey', () => {
  it('creates a PermissionKey', () => {
    const key = permKey('orders', 'read')
    expect(key).toEqual({ resource: 'orders', action: 'read' })
  })
})

describe('toAuthority', () => {
  it('converts PermissionKey to string', () => {
    expect(toAuthority({ resource: 'orders', action: 'read' })).toBe('orders:read')
  })

  it('handles wildcard', () => {
    expect(toAuthority({ resource: '*', action: '*' })).toBe('*:*')
  })
})

describe('fromAuthority', () => {
  it('parses authority string', () => {
    expect(fromAuthority('orders:read')).toEqual({ resource: 'orders', action: 'read' })
  })

  it('throws on invalid format', () => {
    expect(() => fromAuthority('invalid')).toThrow('Invalid permission format')
  })
})
