import type { PermissionResolver } from '@axis-iam/vertex'

/**
 * In-memory mock permission resolver for testing.
 *
 * @example
 * ```ts
 * const resolver = new MockPermissionResolver()
 *   .given('admin', ['posts:read', 'posts:write'])
 *   .given('viewer', ['posts:read'])
 *
 * const perms = await resolver.resolve('app-1', ['admin'])
 * // Set { 'posts:read', 'posts:write' }
 * ```
 */
export class MockPermissionResolver implements PermissionResolver {
  private map: Record<string, string[]> = {}

  constructor(rolesToPerms?: Record<string, string[]>) {
    if (rolesToPerms) this.map = { ...rolesToPerms }
  }

  /** Add role → permissions mapping */
  given(role: string, perms: string[]): this {
    this.map[role] = perms
    return this
  }

  async resolve(_appId: string, roles: string[]): Promise<Set<string>> {
    return new Set(roles.flatMap((r) => this.map[r] ?? []))
  }
}
