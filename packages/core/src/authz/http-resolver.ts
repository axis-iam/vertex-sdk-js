import { LRUCache } from 'lru-cache'
import type { PermissionResolver } from './resolver.js'
import type { IamClient } from '../client/iam-client.js'
import type { IamSdkConfig } from '../config.js'

/**
 * HTTP-based permission resolver with LRU caching.
 * Calls POST /open/v1/permissions:resolve on cache miss.
 */
export class HttpPermissionResolver implements PermissionResolver {
  private cache: LRUCache<string, Set<string>>

  constructor(
    private client: IamClient,
    private config: Pick<IamSdkConfig, 'permissionCacheTtlMs' | 'permissionCacheMax' | 'clientId' | 'failMode'>,
  ) {
    this.cache = new LRUCache({
      max: config.permissionCacheMax ?? 10_000,
      ttl: config.permissionCacheTtlMs ?? 300_000,
    })
  }

  async resolve(appId: string, roles: string[]): Promise<Set<string>> {
    if (roles.length === 0) return new Set()

    const key = `${appId}|${[...roles].sort().join(',')}`
    const cached = this.cache.get(key)
    if (cached) return cached

    try {
      const { permissions } = await this.client.resolvePermissions(this.config.clientId, roles)
      const set = new Set(permissions)
      this.cache.set(key, set)
      return set
    } catch (err) {
      if (this.config.failMode === 'open') return new Set()
      throw err
    }
  }

  /** Invalidate all cached entries */
  clear(): void {
    this.cache.clear()
  }
}
