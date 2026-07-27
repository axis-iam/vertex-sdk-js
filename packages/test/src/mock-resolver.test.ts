import { describe, it, expect } from 'vitest'
import { MockPermissionResolver } from './mock-resolver.js'

describe('MockPermissionResolver', () => {
  it('resolves permissions for given roles', async () => {
    const resolver = new MockPermissionResolver()
      .given('admin', ['posts:read', 'posts:write'])
      .given('viewer', ['posts:read'])

    const result = await resolver.resolve('app-1', ['admin'])
    expect(result).toEqual(new Set(['posts:read', 'posts:write']))
  })

  it('merges permissions from multiple roles', async () => {
    const resolver = new MockPermissionResolver()
      .given('admin', ['posts:write'])
      .given('viewer', ['posts:read'])

    const result = await resolver.resolve('app-1', ['admin', 'viewer'])
    expect(result).toEqual(new Set(['posts:write', 'posts:read']))
  })

  it('returns empty set for unknown roles', async () => {
    const resolver = new MockPermissionResolver()
    const result = await resolver.resolve('app-1', ['unknown'])
    expect(result).toEqual(new Set())
  })

  it('accepts initial map in constructor', async () => {
    const resolver = new MockPermissionResolver({ editor: ['posts:read'] })
    const result = await resolver.resolve('app-1', ['editor'])
    expect(result).toEqual(new Set(['posts:read']))
  })
})
