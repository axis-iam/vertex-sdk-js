/** Structured permission key */
export interface PermissionKey {
  resource: string
  action: string
}

/** Permission definition for registration with IAM server */
export interface PermissionDefinition {
  resource: string
  action: string
  displayName?: string
  description?: string
}

/** Create a PermissionKey */
export function permKey(resource: string, action: string): PermissionKey {
  return { resource, action }
}

/** Convert PermissionKey to authority string "resource:action" */
export function toAuthority(key: PermissionKey): string {
  return `${key.resource}:${key.action}`
}

/** Convert authority string "resource:action" to PermissionKey */
export function fromAuthority(authority: string): PermissionKey {
  const idx = authority.indexOf(':')
  if (idx === -1) throw new Error(`Invalid permission format: ${authority}`)
  return { resource: authority.slice(0, idx), action: authority.slice(idx + 1) }
}
