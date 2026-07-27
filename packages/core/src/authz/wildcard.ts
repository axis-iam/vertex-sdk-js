/**
 * Check if a user permission matches a required permission.
 * Supports wildcard: "orders:*" matches "orders:read", "orders:create", etc.
 *
 * @param userPerm - A permission the user has (e.g. "orders:*")
 * @param required - The permission being checked (e.g. "orders:read")
 */
export function matchPermission(userPerm: string, required: string): boolean {
  if (userPerm === required) return true

  const userParts = userPerm.split(':')
  const reqParts = required.split(':')
  if (userParts.length !== 2 || reqParts.length !== 2) return false
  if (userParts[0] === '' || reqParts[0] === '') return false

  const [userResource, userAction] = userParts
  const [reqResource] = reqParts

  // "*:*" matches any valid "resource:action"
  if (userResource === '*' && userAction === '*') return true

  // "resource:*" matches "resource:anything"
  if (userAction === '*' && userResource === reqResource) return true

  return false
}

/**
 * Check if a user's permission set includes the required permission.
 */
export function hasPermission(userPermissions: string[], required: string): boolean {
  return userPermissions.some((p) => matchPermission(p, required))
}

/**
 * Check if a user's permission set includes ALL required permissions.
 */
export function hasAllPermissions(userPermissions: string[], required: string[]): boolean {
  return required.every((r) => hasPermission(userPermissions, r))
}

/**
 * Check if a user's permission set includes ANY of the required permissions.
 */
export function hasAnyPermission(userPermissions: string[], required: string[]): boolean {
  return required.some((r) => hasPermission(userPermissions, r))
}
