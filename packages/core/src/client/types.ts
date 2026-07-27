/** Response from POST /open/v1/permissions:resolve */
export interface ResolvePermissionsResponse {
  permissions: string[]
}

/** Response from GET /open/v1/apps/{clientId}/permissions */
export interface PermissionsSnapshot {
  applicationId: string
  clientId: string
  roles: Array<{
    key: string
    name: string
    permissions: string[]
  }>
}

/** Request body for POST /api/v1/auth/password/forgot */
export interface RequestPasswordResetInput {
  email: string
  redirectUri?: string
}

/** Request body for POST /api/v1/auth/password/reset */
export interface ResetPasswordInput {
  token: string
  newPassword: string
}
