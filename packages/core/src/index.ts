// --- Config ---
export type { IamBrowserConfig } from './config.js'

// --- Authorization ---
export type { PermissionKey, PermissionDefinition } from './authz/permission.js'
export { permKey, toAuthority, fromAuthority } from './authz/permission.js'
export type { PermissionResolver } from './authz/resolver.js'
export {
  matchPermission,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from './authz/wildcard.js'

// --- JWT ---
export { JwtVerifier } from './jwt/verifier.js'
export type { IamJwtPayload } from './jwt/verifier.js'

// --- Client DTOs ---
export type {
  RequestPasswordResetInput,
  ResetPasswordInput,
} from './client/types.js'
