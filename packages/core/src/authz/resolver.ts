/** Interface for resolving permissions from roles */
export interface PermissionResolver {
  /**
   * Resolve permissions for given app + roles.
   * Returns a Set of permission authority strings ("resource:action").
   */
  resolve(appId: string, roles: string[]): Promise<Set<string>>
}
