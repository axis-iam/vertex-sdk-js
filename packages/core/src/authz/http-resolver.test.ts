import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpPermissionResolver } from './http-resolver.js'
import type { IamClient } from '../client/iam-client.js'

function mockClient(perms: string[]): IamClient {
  return {
    resolvePermissions: vi.fn().mockResolvedValue({ permissions: perms }),
  } as unknown as IamClient
}

describe('HttpPermissionResolver', () => {
  it('returns a fresh empty set for zero roles without calling IAM', async () => {
    const client = mockClient(['orders:read'])
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1' })

    const first = await resolver.resolve('app-1', [])
    const second = await resolver.resolve('app-1', [])
    expect(first).toEqual(new Set())
    expect(second).toEqual(new Set())
    expect(second).not.toBe(first)
    expect(client.resolvePermissions).not.toHaveBeenCalled()
  })

  it('resolves permissions via client', async () => {
    const client = mockClient(['orders:read', 'orders:create'])
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1', permissionCacheMax: 100, permissionCacheTtlMs: 60_000 })

    const result = await resolver.resolve('app-1', ['admin'])
    expect(result).toEqual(new Set(['orders:read', 'orders:create']))
    expect(client.resolvePermissions).toHaveBeenCalledWith('app-1', ['admin'])
  })

  it('returns cached result on second call', async () => {
    const client = mockClient(['orders:read'])
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1', permissionCacheMax: 100, permissionCacheTtlMs: 60_000 })

    await resolver.resolve('app-1', ['admin'])
    await resolver.resolve('app-1', ['admin'])

    expect(client.resolvePermissions).toHaveBeenCalledTimes(1)
  })

  it('uses different cache keys for different roles', async () => {
    const client = mockClient(['orders:read'])
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1', permissionCacheMax: 100, permissionCacheTtlMs: 60_000 })

    await resolver.resolve('app-1', ['admin'])
    await resolver.resolve('app-1', ['editor'])

    expect(client.resolvePermissions).toHaveBeenCalledTimes(2)
  })

  it('sorts roles for consistent cache key', async () => {
    const client = mockClient(['orders:read'])
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1', permissionCacheMax: 100, permissionCacheTtlMs: 60_000 })

    await resolver.resolve('app-1', ['editor', 'admin'])
    await resolver.resolve('app-1', ['admin', 'editor'])

    expect(client.resolvePermissions).toHaveBeenCalledTimes(1)
  })

  it('throws on error when failMode=close (default)', async () => {
    const client = { resolvePermissions: vi.fn().mockRejectedValue(new Error('network')) } as unknown as IamClient
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1' })

    await expect(resolver.resolve('app-1', ['admin'])).rejects.toThrow('network')
  })

  it('returns empty set on error when failMode=open', async () => {
    const client = { resolvePermissions: vi.fn().mockRejectedValue(new Error('network')) } as unknown as IamClient
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1', failMode: 'open' })

    const result = await resolver.resolve('app-1', ['admin'])
    expect(result).toEqual(new Set())
  })

  it('clears cache', async () => {
    const client = mockClient(['orders:read'])
    const resolver = new HttpPermissionResolver(client, { clientId: 'app-1', permissionCacheMax: 100, permissionCacheTtlMs: 60_000 })

    await resolver.resolve('app-1', ['admin'])
    resolver.clear()
    await resolver.resolve('app-1', ['admin'])

    expect(client.resolvePermissions).toHaveBeenCalledTimes(2)
  })
})
