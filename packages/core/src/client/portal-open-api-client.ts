export const PORTAL_OPEN_API_READ_SCOPE = 'portal:openapi:read'
export const PORTAL_OPEN_API_WRITE_SCOPE = 'portal:openapi:write'
export const REGISTRATION_GRANTS_READ_SCOPE = 'registration_grants:read'
export const REGISTRATION_GRANTS_WRITE_SCOPE = 'registration_grants:write'
export const REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE = 'registration_grants:redemptions:read'
export const ORGANIZATIONS_READ_SCOPE = 'organizations:read'
export const ORGANIZATIONS_WRITE_SCOPE = 'organizations:write'
export const ORGANIZATION_INVITATIONS_READ_SCOPE = 'organization_invitations:read'
export const ORGANIZATION_INVITATIONS_WRITE_SCOPE = 'organization_invitations:write'
export const ORGANIZATION_MEMBERS_READ_SCOPE = 'organization_members:read'
export const ORGANIZATION_MEMBERS_WRITE_SCOPE = 'organization_members:write'
export const ROLES_READ_SCOPE = 'roles:read'
export const ROLES_WRITE_SCOPE = 'roles:write'
export const PERMISSIONS_READ_SCOPE = 'permissions:read'
export const PERMISSIONS_WRITE_SCOPE = 'permissions:write'
export const ROLE_PERMISSIONS_READ_SCOPE = 'role_permissions:read'
export const ROLE_PERMISSIONS_WRITE_SCOPE = 'role_permissions:write'
export const USER_ROLES_READ_SCOPE = 'user_roles:read'
export const USER_ROLES_WRITE_SCOPE = 'user_roles:write'

export type PortalOpenApiScope =
  | typeof PORTAL_OPEN_API_READ_SCOPE
  | typeof PORTAL_OPEN_API_WRITE_SCOPE
  | typeof REGISTRATION_GRANTS_READ_SCOPE
  | typeof REGISTRATION_GRANTS_WRITE_SCOPE
  | typeof REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE
  | typeof ORGANIZATIONS_READ_SCOPE
  | typeof ORGANIZATIONS_WRITE_SCOPE
  | typeof ORGANIZATION_INVITATIONS_READ_SCOPE
  | typeof ORGANIZATION_INVITATIONS_WRITE_SCOPE
  | typeof ORGANIZATION_MEMBERS_READ_SCOPE
  | typeof ORGANIZATION_MEMBERS_WRITE_SCOPE
  | typeof ROLES_READ_SCOPE
  | typeof ROLES_WRITE_SCOPE
  | typeof PERMISSIONS_READ_SCOPE
  | typeof PERMISSIONS_WRITE_SCOPE
  | typeof ROLE_PERMISSIONS_READ_SCOPE
  | typeof ROLE_PERMISSIONS_WRITE_SCOPE
  | typeof USER_ROLES_READ_SCOPE
  | typeof USER_ROLES_WRITE_SCOPE

export type PortalOpenApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface PortalOpenApiClientConfig {
  /** IAM issuer/auth server base URL. Tokens are requested from `${issuer}/oauth2/token`. */
  issuer: string
  /** iam-portal base URL used for `/open/v1/**` management requests. */
  portalEndpoint: string
  /** M2M confidential ApplicationClient.clientId. */
  clientId: string
  /** M2M confidential ApplicationClient secret. Never expose this to browser code. */
  clientSecret: string
  /** Seconds subtracted from `expires_in` before caching a token. Defaults to 30 seconds. */
  tokenSkewSeconds?: number
  /** Fetch timeout for token and Portal API requests. Defaults to 5000ms. */
  timeoutMs?: number
}

export interface PortalOpenApiMachineToken {
  accessToken: string
  scope: PortalOpenApiScope
  expiresAtMs: number
}

export type RegistrationGrantType = 'EMAIL_LINK' | 'ACCESS_CODE' | 'ORG_INVITATION'
export type CreateRegistrationGrantType = 'EMAIL_LINK' | 'ACCESS_CODE'
export type RegistrationGrantStatus = 'ACTIVE' | 'PAUSED' | 'REDEEMED' | 'EXPIRED' | 'REVOKED'

export interface RegistrationGrant {
  id: string
  type: RegistrationGrantType
  status: RegistrationGrantStatus
  displayName: string | null
  allowedEmail: string | null
  allowedDomain: string | null
  expiresAt: string | null
  maxUses: number | null
  usedCount: number
  sourceType: string
  createdAt: string
  updatedAt: string
  revokedAt: string | null
  revokeReason: string | null
}

export interface CreateRegistrationGrantInput {
  type: CreateRegistrationGrantType
  displayName?: string
  allowedEmail?: string
  allowedDomain?: string
  expiresAt?: string
  maxUses?: number
}

export interface CreatedRegistrationGrant {
  grant: RegistrationGrant
  registrationGrantToken?: string
  registrationAccessCode?: string
}

export interface RegistrationGrantListOptions {
  type?: RegistrationGrantType
  status?: RegistrationGrantStatus
  search?: string
  page?: number
  size?: number
}

export interface RegistrationGrantPage {
  content: RegistrationGrant[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}

export interface RegistrationGrantRedemption {
  id: string
  result: string
  email: string | null
  authMethod: string | null
  idpId: string | null
  clientId: string | null
  redeemedAt: string
  failureReason: string | null
}

export interface RegistrationGrantRedemptionPage {
  content: RegistrationGrantRedemption[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}

export type OrganizationMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER'
export type OrganizationInvitationStatus = 'PENDING' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED'
export type OrganizationInvitationDeliveryStatus = 'NOT_REQUESTED' | 'SENT' | 'FAILED'
export type OrganizationSortDirection = 'ASC' | 'DESC'

export interface Organization {
  id: string
  name: string
  slug: string
  version: number
  createdAt: string
  updatedAt: string
  /** Present for create/get/update responses when Portal returns an ETag. */
  etag?: string
}

export interface CreateOrganizationInput {
  name: string
  slug: string
}

export interface UpdateOrganizationInput {
  name?: string
  slug?: string
}

export interface OrganizationListOptions {
  search?: string
  page?: number
  size?: number
  sort?: string | readonly string[]
  direction?: OrganizationSortDirection | readonly OrganizationSortDirection[]
}

export interface OrganizationPage {
  content: Organization[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}

export interface IdempotencyOptions {
  idempotencyKey?: string
}

export interface IfMatchOptions {
  ifMatch?: string
}

export interface OrganizationInvitation {
  id: string
  email: string
  role: OrganizationMemberRole
  status: OrganizationInvitationStatus
  deliveryStatus: OrganizationInvitationDeliveryStatus
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface CreateOrganizationInvitationInput {
  email: string
  role?: OrganizationMemberRole
  sendEmail?: boolean
}

export interface OrganizationInvitationListOptions {
  status?: OrganizationInvitationStatus
  page?: number
  size?: number
}

export interface OrganizationInvitationPage {
  content: OrganizationInvitation[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}

export interface OrganizationMember {
  membershipId: string
  userId: string
  email: string
  displayName: string
  role: OrganizationMemberRole
  joinedAt: string
  updatedAt: string
  version: number
}

export interface OrganizationMemberListOptions {
  search?: string
  page?: number
  size?: number
}

export interface OrganizationMemberPage {
  content: OrganizationMember[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}

export interface AuthorizationPageMetadata {
  size: number
  number: number
  totalElements: number
  totalPages: number
}

export interface AuthorizationPageOptions { page?: number; size?: number }
export interface AuthorizationIdempotencyOptions { idempotencyKey?: string }

export interface Role {
  id: string
  key: string
  name: string
  description: string | null
  system: boolean
  version: number
  createdAt: string
  updatedAt: string
  etag: string
}
export interface RolePage { content: Role[]; page: AuthorizationPageMetadata }
export interface CreateRoleInput { key: string; name: string; description?: string | null }
export interface UpdateRoleInput { key?: string; name?: string; description?: string | null }

export interface Permission {
  id: string
  resource: string
  action: string
  key: string
  name: string
  description: string | null
  source: 'CODE' | 'MANUAL'
  version: number
  createdAt: string
  updatedAt: string
  etag: string
}
export interface PermissionPage { content: Permission[]; page: AuthorizationPageMetadata }
export interface CreatePermissionInput { resource: string; action: string; name: string; description?: string | null }
export interface UpdatePermissionInput { name?: string; description?: string | null }

export interface RolePermissionBinding { roleId: string; permissionId: string; createdAt: string }
export interface RolePermissionBindingPage { content: RolePermissionBinding[]; page: AuthorizationPageMetadata; etag: string }
export interface RolePermissionSet { roleId: string; permissionIds: string[]; version: number; etag: string }

export interface UserRoleCondition { expression?: string | null; description?: string | null }
export interface UserRoleAssignment {
  id: string
  userId: string
  roleId: string
  organizationId: string | null
  conditionExpression: string | null
  conditionDescription: string | null
  version: number
  createdAt: string
  updatedAt: string
  etag: string
}
export interface UserRoleAssignmentPage { content: UserRoleAssignment[]; page: AuthorizationPageMetadata }
export interface CreateUserRoleInput { roleId: string; condition?: UserRoleCondition | null }
export interface UpdateUserRoleInput { condition: UserRoleCondition | null }

interface TokenResponse {
  access_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_TOKEN_SKEW_SECONDS = 30
const SUPPORTED_SCOPES = new Set<PortalOpenApiScope>([
  PORTAL_OPEN_API_READ_SCOPE,
  PORTAL_OPEN_API_WRITE_SCOPE,
  REGISTRATION_GRANTS_READ_SCOPE,
  REGISTRATION_GRANTS_WRITE_SCOPE,
  REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE,
  ORGANIZATIONS_READ_SCOPE,
  ORGANIZATIONS_WRITE_SCOPE,
  ORGANIZATION_INVITATIONS_READ_SCOPE,
  ORGANIZATION_INVITATIONS_WRITE_SCOPE,
  ORGANIZATION_MEMBERS_READ_SCOPE,
  ORGANIZATION_MEMBERS_WRITE_SCOPE,
  ROLES_READ_SCOPE, ROLES_WRITE_SCOPE,
  PERMISSIONS_READ_SCOPE, PERMISSIONS_WRITE_SCOPE,
  ROLE_PERMISSIONS_READ_SCOPE, ROLE_PERMISSIONS_WRITE_SCOPE,
  USER_ROLES_READ_SCOPE, USER_ROLES_WRITE_SCOPE,
])
const SUPPORTED_METHODS = new Set<PortalOpenApiMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const PORTAL_ERROR_CODES = new Set([
  'OPEN_API_SCOPE_INSUFFICIENT',
  'OPEN_API_MACHINE_TOKEN_REQUIRED',
  'OPEN_API_INVALID_AUDIENCE',
])

export class PortalOpenApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  readonly retryAfter?: string

  constructor(message: string, status: number, code: string, details?: unknown, retryAfter?: string) {
    super(message)
    this.name = 'PortalOpenApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

export class PortalOpenApiTokenError extends Error {
  readonly status?: number
  readonly code: string
  readonly details: unknown

  constructor(message: string, code: string, status?: number, details?: unknown) {
    super(message)
    this.name = 'PortalOpenApiTokenError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Server-side client for iam-portal `/open/v1/**`.
 *
 * This client first obtains a `client_credentials` machine token from iam-server
 * with an explicit `portal:openapi:read` or `portal:openapi:write` scope, then
 * sends only `Authorization: Bearer <machine_token>` to iam-portal. It is not a
 * browser/React client and must not be bundled with a public SPA.
 */
export class PortalOpenApiClient {
  private readonly issuer: string
  private readonly portalEndpoint: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly tokenSkewSeconds: number
  private readonly timeoutMs: number
  private readonly tokenCache = new Map<PortalOpenApiScope, PortalOpenApiMachineToken>()

  constructor(config: PortalOpenApiClientConfig) {
    if (!config.issuer?.trim()) {
      throw new Error('PortalOpenApiClient issuer is required')
    }
    if (!config.portalEndpoint?.trim()) {
      throw new Error('PortalOpenApiClient portalEndpoint is required')
    }
    if (!config.clientId?.trim() || !config.clientSecret?.trim()) {
      throw new Error('PortalOpenApiClient requires M2M clientId and clientSecret')
    }
    if (config.timeoutMs !== undefined && config.timeoutMs <= 0) {
      throw new Error('PortalOpenApiClient timeoutMs must be positive')
    }
    if (config.tokenSkewSeconds !== undefined && config.tokenSkewSeconds < 0) {
      throw new Error('PortalOpenApiClient tokenSkewSeconds must be non-negative')
    }

    this.issuer = stripTrailingSlash(config.issuer)
    this.portalEndpoint = stripTrailingSlash(config.portalEndpoint)
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.tokenSkewSeconds = config.tokenSkewSeconds ?? DEFAULT_TOKEN_SKEW_SECONDS
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async requestJson<T>(method: PortalOpenApiMethod, path: string, body?: unknown): Promise<T> {
    const normalizedMethod = method.toUpperCase() as PortalOpenApiMethod
    if (!SUPPORTED_METHODS.has(normalizedMethod)) {
      throw new PortalOpenApiError(`Unsupported Portal Open API method: ${method}`, 0, 'invalid_portal_method', { method })
    }
    const scope = scopeForMethod(normalizedMethod)
    return this.requestJsonWithScope(method, path, scope, body)
  }

  async listRegistrationGrants(options: RegistrationGrantListOptions = {}): Promise<RegistrationGrantPage> {
    return this.requestRegistrationGrantJson<RegistrationGrantPage>(
      'GET',
      `/open/v1/registration-grants${registrationGrantQuery(options)}`,
      REGISTRATION_GRANTS_READ_SCOPE,
    )
  }

  async createRegistrationGrant(input: CreateRegistrationGrantInput): Promise<CreatedRegistrationGrant> {
    const response = await this.requestRegistrationGrantJson<unknown>(
      'POST', '/open/v1/registration-grants', REGISTRATION_GRANTS_WRITE_SCOPE, input,
    )
    return parseCreatedRegistrationGrant(response)
  }

  async getRegistrationGrant(grantId: string): Promise<RegistrationGrant> {
    return this.requestRegistrationGrantJson('GET', registrationGrantPath(grantId), REGISTRATION_GRANTS_READ_SCOPE)
  }

  async pauseRegistrationGrant(grantId: string): Promise<RegistrationGrant> {
    return this.requestRegistrationGrantJson('POST', `${registrationGrantPath(grantId)}/pause`, REGISTRATION_GRANTS_WRITE_SCOPE)
  }

  async resumeRegistrationGrant(grantId: string): Promise<RegistrationGrant> {
    return this.requestRegistrationGrantJson('POST', `${registrationGrantPath(grantId)}/resume`, REGISTRATION_GRANTS_WRITE_SCOPE)
  }

  async revokeRegistrationGrant(grantId: string, reason?: string): Promise<RegistrationGrant> {
    return this.requestRegistrationGrantJson(
      'POST', `${registrationGrantPath(grantId)}/revoke`, REGISTRATION_GRANTS_WRITE_SCOPE,
      reason === undefined ? undefined : { reason },
    )
  }

  async listRegistrationGrantRedemptions(grantId: string, options: Pick<RegistrationGrantListOptions, 'page' | 'size'> = {}): Promise<RegistrationGrantRedemptionPage> {
    return this.requestRegistrationGrantJson(
      'GET', `${registrationGrantPath(grantId)}/redemptions${registrationGrantQuery(options)}`,
      REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE,
    )
  }

  /** List Application-bound Organizations with optional search, paging, and sorting. */
  async listOrganizations(options: OrganizationListOptions = {}): Promise<OrganizationPage> {
    return parseOrganizationPage(await this.requestJsonWithScope(
      'GET', `/open/v1/organizations${organizationQuery(options)}`, ORGANIZATIONS_READ_SCOPE,
    ))
  }

  /** Create an Organization. The Idempotency-Key is sent only when explicitly supplied. */
  async createOrganization(input: CreateOrganizationInput, options: IdempotencyOptions = {}): Promise<Organization> {
    return this.requestOrganization(
      'POST', '/open/v1/organizations', ORGANIZATIONS_WRITE_SCOPE, input, idempotencyHeaders(options),
    )
  }

  /** Get one Organization scoped to the M2M token's Application. */
  async getOrganization(organizationId: string): Promise<Organization> {
    return this.requestOrganization('GET', organizationPath(organizationId), ORGANIZATIONS_READ_SCOPE)
  }

  /** Patch an Organization, optionally enforcing the ETag received from a prior read. */
  async updateOrganization(organizationId: string, input: UpdateOrganizationInput, options: IfMatchOptions = {}): Promise<Organization> {
    return this.requestOrganization(
      'PATCH', organizationPath(organizationId), ORGANIZATIONS_WRITE_SCOPE, input, ifMatchHeaders(options),
    )
  }

  /** Delete an Organization, optionally enforcing the ETag received from a prior read. */
  async deleteOrganization(organizationId: string, options: IfMatchOptions = {}): Promise<void> {
    await this.requestJsonWithScope(
      'DELETE', organizationPath(organizationId), ORGANIZATIONS_WRITE_SCOPE, undefined, ifMatchHeaders(options),
    )
  }

  /** List Organization invitations, including delivery and lifecycle state. */
  async listOrganizationInvitations(organizationId: string, options: OrganizationInvitationListOptions = {}): Promise<OrganizationInvitationPage> {
    return parseOrganizationInvitationPage(await this.requestJsonWithScope(
      'GET', `${organizationPath(organizationId)}/invitations${organizationInvitationQuery(options)}`,
      ORGANIZATION_INVITATIONS_READ_SCOPE,
    ))
  }

  /** Create an Organization invitation. No raw invitation proof is exposed by this helper. */
  async createOrganizationInvitation(organizationId: string, input: CreateOrganizationInvitationInput, options: IdempotencyOptions = {}): Promise<OrganizationInvitation> {
    return parseOrganizationInvitation(await this.requestJsonWithScope(
      'POST', `${organizationPath(organizationId)}/invitations`, ORGANIZATION_INVITATIONS_WRITE_SCOPE,
      input, idempotencyHeaders(options),
    ))
  }

  async getOrganizationInvitation(organizationId: string, invitationId: string): Promise<OrganizationInvitation> {
    return parseOrganizationInvitation(await this.requestJsonWithScope(
      'GET', organizationInvitationPath(organizationId, invitationId), ORGANIZATION_INVITATIONS_READ_SCOPE,
    ))
  }

  /** Resend a pending invitation. A 429 exposes its Retry-After header on PortalOpenApiError. */
  async resendOrganizationInvitation(organizationId: string, invitationId: string): Promise<OrganizationInvitation> {
    return parseOrganizationInvitation(await this.requestJsonWithScope(
      'POST', `${organizationInvitationPath(organizationId, invitationId)}/resend`, ORGANIZATION_INVITATIONS_WRITE_SCOPE,
    ))
  }

  /** Cancel an invitation. Portal owns terminal-state/idempotency semantics. */
  async cancelOrganizationInvitation(organizationId: string, invitationId: string): Promise<void> {
    await this.requestJsonWithScope(
      'DELETE', organizationInvitationPath(organizationId, invitationId), ORGANIZATION_INVITATIONS_WRITE_SCOPE,
    )
  }

  async listOrganizationMembers(organizationId: string, options: OrganizationMemberListOptions = {}): Promise<OrganizationMemberPage> {
    return parseOrganizationMemberPage(await this.requestJsonWithScope(
      'GET', `${organizationPath(organizationId)}/members${organizationMemberQuery(options)}`,
      ORGANIZATION_MEMBERS_READ_SCOPE,
    ))
  }

  async getOrganizationMember(organizationId: string, membershipId: string): Promise<OrganizationMember> {
    return parseOrganizationMember(await this.requestJsonWithScope(
      'GET', organizationMemberPath(organizationId, membershipId), ORGANIZATION_MEMBERS_READ_SCOPE,
    ))
  }

  /** Change a member's role, optionally enforcing the member version with If-Match. */
  async updateOrganizationMemberRole(organizationId: string, membershipId: string, role: OrganizationMemberRole, options: IfMatchOptions = {}): Promise<OrganizationMember> {
    return parseOrganizationMember(await this.requestJsonWithScope(
      'PATCH', organizationMemberPath(organizationId, membershipId), ORGANIZATION_MEMBERS_WRITE_SCOPE,
      { role }, ifMatchHeaders(options),
    ))
  }

  /** Remove an Organization member. Last-owner conflicts remain typed Portal errors. */
  async removeOrganizationMember(organizationId: string, membershipId: string): Promise<void> {
    await this.requestJsonWithScope(
      'DELETE', organizationMemberPath(organizationId, membershipId), ORGANIZATION_MEMBERS_WRITE_SCOPE,
    )
  }

  async listRoles(options: AuthorizationPageOptions = {}): Promise<RolePage> {
    return parseRolePage(await this.requestJsonWithScope('GET', `/open/v1/roles${authorizationPageQuery(options)}`, ROLES_READ_SCOPE))
  }

  async getRole(roleId: string): Promise<Role> {
    const role = await this.requestAuthorizationObject('GET', authorizationPath('roles', roleId), ROLES_READ_SCOPE, undefined, parseRole)
    return requireAuthorizationIdentity(role, role.id, roleId)
  }

  async createRole(input: CreateRoleInput, options: AuthorizationIdempotencyOptions = {}): Promise<Role> {
    return this.requestAuthorizationObject('POST', '/open/v1/roles', ROLES_WRITE_SCOPE, input, parseRole, idempotencyHeaders(options))
  }

  async updateRole(roleId: string, input: UpdateRoleInput, ifMatch: string): Promise<Role> {
    const role = await this.requestAuthorizationObject('PATCH', authorizationPath('roles', roleId), ROLES_WRITE_SCOPE, input, parseRole, requiredIfMatchHeaders(ifMatch))
    return requireAuthorizationIdentity(role, role.id, roleId)
  }

  async deleteRole(roleId: string, ifMatch: string): Promise<void> {
    await this.requestJsonWithScope('DELETE', authorizationPath('roles', roleId), ROLES_WRITE_SCOPE, undefined, requiredIfMatchHeaders(ifMatch))
  }

  async listPermissions(options: AuthorizationPageOptions = {}): Promise<PermissionPage> {
    return parsePermissionPage(await this.requestJsonWithScope('GET', `/open/v1/permissions${authorizationPageQuery(options)}`, PERMISSIONS_READ_SCOPE))
  }

  async getPermission(permissionId: string): Promise<Permission> {
    const permission = await this.requestAuthorizationObject('GET', authorizationPath('permissions', permissionId), PERMISSIONS_READ_SCOPE, undefined, parsePermission)
    return requireAuthorizationIdentity(permission, permission.id, permissionId)
  }

  async createPermission(input: CreatePermissionInput, options: AuthorizationIdempotencyOptions = {}): Promise<Permission> {
    validatePermissionGrant(input.resource, input.action)
    return this.requestAuthorizationObject('POST', '/open/v1/permissions', PERMISSIONS_WRITE_SCOPE, input, parsePermission, idempotencyHeaders(options))
  }

  async updatePermission(permissionId: string, input: UpdatePermissionInput, ifMatch: string): Promise<Permission> {
    const permission = await this.requestAuthorizationObject('PATCH', authorizationPath('permissions', permissionId), PERMISSIONS_WRITE_SCOPE, input, parsePermission, requiredIfMatchHeaders(ifMatch))
    return requireAuthorizationIdentity(permission, permission.id, permissionId)
  }

  async deletePermission(permissionId: string, ifMatch: string): Promise<void> {
    await this.requestJsonWithScope('DELETE', authorizationPath('permissions', permissionId), PERMISSIONS_WRITE_SCOPE, undefined, requiredIfMatchHeaders(ifMatch))
  }

  async listRolePermissions(roleId: string, options: AuthorizationPageOptions = {}): Promise<RolePermissionBindingPage> {
    const response = await this.requestJsonWithScopeResponse<unknown>('GET', `${authorizationPath('roles', roleId)}/permissions${authorizationPageQuery(options)}`, ROLE_PERMISSIONS_READ_SCOPE)
    const page = parseRolePermissionBindingPage(response.body)
    if (page.content.some((binding) => binding.roleId !== roleId)) throw invalidAuthorizationResponse()
    return { ...page, etag: requiredEtag(response.etag) }
  }

  async replaceRolePermissions(roleId: string, permissionIds: string[], ifMatch: string): Promise<RolePermissionSet> {
    permissionIds.forEach((id) => authorizationId(id, 'permission'))
    const result = await this.requestAuthorizationObject('PUT', `${authorizationPath('roles', roleId)}/permissions`, ROLE_PERMISSIONS_WRITE_SCOPE, { permissionIds }, parseRolePermissionSet, requiredIfMatchHeaders(ifMatch))
    return requireAuthorizationIdentity(result, result.roleId, roleId)
  }

  async listUserRoles(userId: string, options: AuthorizationPageOptions = {}): Promise<UserRoleAssignmentPage> {
    const page = parseUserRoleAssignmentPage(await this.requestJsonWithScope('GET', `${authorizationUserRolePath(userId)}${authorizationPageQuery(options)}`, USER_ROLES_READ_SCOPE))
    if (page.content.some((assignment) => assignment.userId !== userId)) throw invalidAuthorizationResponse()
    return page
  }

  async createUserRole(userId: string, input: CreateUserRoleInput, options: AuthorizationIdempotencyOptions = {}): Promise<UserRoleAssignment> {
    authorizationId(input.roleId, 'role')
    const assignment = await this.requestAuthorizationObject('POST', authorizationUserRolePath(userId), USER_ROLES_WRITE_SCOPE, input, parseUserRoleAssignment, idempotencyHeaders(options))
    if (assignment.userId !== userId || assignment.roleId !== input.roleId) throw invalidAuthorizationResponse()
    return assignment
  }

  async updateUserRole(userId: string, assignmentId: string, input: UpdateUserRoleInput, ifMatch: string): Promise<UserRoleAssignment> {
    const assignment = await this.requestAuthorizationObject('PATCH', `${authorizationUserRolePath(userId)}/${authorizationId(assignmentId, 'assignment')}`, USER_ROLES_WRITE_SCOPE, input, parseUserRoleAssignment, requiredIfMatchHeaders(ifMatch))
    if (assignment.userId !== userId || assignment.id !== assignmentId) throw invalidAuthorizationResponse()
    return assignment
  }

  async deleteUserRole(userId: string, assignmentId: string, ifMatch: string): Promise<void> {
    await this.requestJsonWithScope('DELETE', `${authorizationUserRolePath(userId)}/${authorizationId(assignmentId, 'assignment')}`, USER_ROLES_WRITE_SCOPE, undefined, requiredIfMatchHeaders(ifMatch))
  }

  private async requestAuthorizationObject<T>(method: PortalOpenApiMethod, path: string, scope: PortalOpenApiScope, body: unknown, parser: (value: unknown, etag: string) => T, headers?: Record<string, string>): Promise<T> {
    const response = await this.requestJsonWithScopeResponse<unknown>(method, path, scope, body, headers)
    return parser(response.body, requiredEtag(response.etag))
  }

  private async requestRegistrationGrantJson<T>(method: PortalOpenApiMethod, path: string, scope: PortalOpenApiScope, body?: unknown): Promise<T> {
    return this.requestJsonWithScope(method, path, scope, body)
  }

  private async requestOrganization(method: PortalOpenApiMethod, path: string, scope: PortalOpenApiScope, body?: unknown, extraHeaders?: Record<string, string>): Promise<Organization> {
    const response = await this.requestJsonWithScopeResponse<unknown>(method, path, scope, body, extraHeaders)
    return parseOrganization(response.body, response.etag)
  }

  private async requestJsonWithScope<T>(method: PortalOpenApiMethod, path: string, scope: PortalOpenApiScope, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return (await this.requestJsonWithScopeResponse<T>(method, path, scope, body, extraHeaders)).body
  }

  private async requestJsonWithScopeResponse<T>(method: PortalOpenApiMethod, path: string, scope: PortalOpenApiScope, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ body: T; etag?: string }> {
    const normalizedMethod = method.toUpperCase() as PortalOpenApiMethod
    if (!SUPPORTED_METHODS.has(normalizedMethod)) {
      throw new PortalOpenApiError(`Unsupported Portal Open API method: ${method}`, 0, 'invalid_portal_method', { method })
    }
    const url = this.portalUrl(path)
    const token = await this.getMachineToken(scope)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.accessToken}`,
    }
    for (const [key, value] of Object.entries(extraHeaders ?? {})) {
      if (isForbiddenResourceHeader(key)) {
        throw new PortalOpenApiError(`Portal Open API header is managed by the SDK: ${key}`, 0, 'invalid_portal_header', { header: key })
      }
      headers[key] = value
    }
    const init: RequestInit = {
      method: normalizedMethod,
      headers,
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    const response = await this.fetchWithTimeout(url, init)
    if (!response.ok) {
      throw await this.portalError(response)
    }

    if (response.status === 204) {
      return { body: undefined as T }
    }

    const text = await response.text()
    if (!text) {
      return { body: undefined as T, etag: response.headers.get('ETag') ?? undefined }
    }
    return { body: JSON.parse(text) as T, etag: response.headers.get('ETag') ?? undefined }
  }

  async getMachineToken(scope: PortalOpenApiScope): Promise<PortalOpenApiMachineToken> {
    this.assertSupportedScope(scope)

    const cached = this.tokenCache.get(scope)
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached
    }

    const token = await this.requestMachineToken(scope)
    this.tokenCache.set(scope, token)
    return token
  }

  clearTokenCache(scope?: PortalOpenApiScope): void {
    if (scope) {
      this.tokenCache.delete(scope)
      return
    }
    this.tokenCache.clear()
  }

  private async requestMachineToken(scope: PortalOpenApiScope): Promise<PortalOpenApiMachineToken> {
    this.assertSupportedScope(scope)

    const body = new URLSearchParams()
    body.set('grant_type', 'client_credentials')
    body.set('scope', scope)

    const response = await this.fetchWithTimeout(`${this.issuer}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${encodeBasicAuth(this.clientId, this.clientSecret)}`,
      },
      body: body.toString(),
    })

    const payload = await parseTokenResponse(response)
    if (!response.ok) {
      throw new PortalOpenApiTokenError(
        payload.error_description || payload.error || `Token request failed with HTTP ${response.status}`,
        payload.error || 'token_request_failed',
        response.status,
        payload,
      )
    }

    if (!payload.access_token || !payload.access_token.trim()) {
      throw new PortalOpenApiTokenError('Token response is missing access_token', 'missing_bearer_token', response.status, payload)
    }
    if (payload.token_type?.toLowerCase() !== 'bearer') {
      throw new PortalOpenApiTokenError('Token response is missing bearer token_type', 'missing_bearer_token', response.status, payload)
    }
    if (typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
      throw new PortalOpenApiTokenError('Token response is missing positive expires_in', 'invalid_token_response', response.status, payload)
    }

    const responseScopes = new Set((payload.scope ?? scope).split(/\s+/).filter(Boolean))
    if (!responseScopes.has(scope)) {
      throw new PortalOpenApiTokenError(`Token response does not include requested scope ${scope}`, 'invalid_scope', response.status, payload)
    }

    const ttlMs = Math.max((payload.expires_in - this.tokenSkewSeconds) * 1000, 0)
    return {
      accessToken: payload.access_token,
      scope,
      expiresAtMs: Date.now() + ttlMs,
    }
  }

  private assertSupportedScope(scope: string): asserts scope is PortalOpenApiScope {
    if (!scope) {
      throw new PortalOpenApiTokenError('Portal Open API token requests require an explicit scope', 'invalid_scope')
    }
    if (!SUPPORTED_SCOPES.has(scope as PortalOpenApiScope)) {
      throw new PortalOpenApiTokenError(`Unsupported Portal Open API scope: ${scope}`, 'invalid_scope')
    }
  }

  private portalUrl(path: string): string {
    if (!path.startsWith('/open/v1/')) {
      throw new PortalOpenApiError('Portal Open API path must start with /open/v1/', 0, 'invalid_portal_path', { path })
    }
    return `${this.portalEndpoint}${path}`
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private async portalError(response: Response): Promise<PortalOpenApiError> {
    const details = await parseResponseBody(response)
    const code = extractErrorCode(details) ?? `HTTP_${response.status}`
    const message = PORTAL_ERROR_CODES.has(code)
      ? code
      : extractErrorMessage(details) ?? `Portal Open API request failed with HTTP ${response.status}`
    return new PortalOpenApiError(message, response.status, code, details, response.headers.get('Retry-After') ?? undefined)
  }
}

function registrationGrantPath(grantId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[157][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grantId)) {
    throw new PortalOpenApiError('Registration grant id must be a UUID', 0, 'invalid_registration_grant_id')
  }
  return `/open/v1/registration-grants/${encodeURIComponent(grantId)}`
}

function registrationGrantQuery(options: RegistrationGrantListOptions | Pick<RegistrationGrantListOptions, 'page' | 'size'>): string {
  const params = new URLSearchParams()
  if ('type' in options && options.type !== undefined) params.set('type', options.type)
  if ('status' in options && options.status !== undefined) params.set('status', options.status)
  if ('search' in options && options.search !== undefined) params.set('search', options.search)
  if (options.page !== undefined) params.set('page', String(options.page))
  if (options.size !== undefined) params.set('size', String(options.size))
  const query = params.toString()
  return query ? `?${query}` : ''
}

function organizationPath(organizationId: string): string {
  return `/open/v1/organizations/${organizationIdPathSegment(organizationId, 'organization')}`
}

function organizationInvitationPath(organizationId: string, invitationId: string): string {
  return `${organizationPath(organizationId)}/invitations/${organizationIdPathSegment(invitationId, 'invitation')}`
}

function organizationMemberPath(organizationId: string, membershipId: string): string {
  return `${organizationPath(organizationId)}/members/${organizationIdPathSegment(membershipId, 'membership')}`
}

function organizationIdPathSegment(value: string, resource: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new PortalOpenApiError(`${resource[0]?.toUpperCase()}${resource.slice(1)} id must be a UUID`, 0, `invalid_${resource}_id`)
  }
  return encodeURIComponent(value)
}

function organizationQuery(options: OrganizationListOptions): string {
  const params = new URLSearchParams()
  if (options.search !== undefined) params.set('search', options.search)
  if (options.page !== undefined) params.set('page', String(options.page))
  if (options.size !== undefined) params.set('size', String(options.size))
  appendQueryValues(params, 'sort', options.sort)
  appendQueryValues(params, 'direction', options.direction)
  const query = params.toString()
  return query ? `?${query}` : ''
}

function organizationInvitationQuery(options: OrganizationInvitationListOptions): string {
  const params = new URLSearchParams()
  if (options.status !== undefined) params.set('status', options.status)
  if (options.page !== undefined) params.set('page', String(options.page))
  if (options.size !== undefined) params.set('size', String(options.size))
  const query = params.toString()
  return query ? `?${query}` : ''
}

function organizationMemberQuery(options: OrganizationMemberListOptions): string {
  const params = new URLSearchParams()
  if (options.search !== undefined) params.set('search', options.search)
  if (options.page !== undefined) params.set('page', String(options.page))
  if (options.size !== undefined) params.set('size', String(options.size))
  const query = params.toString()
  return query ? `?${query}` : ''
}

function appendQueryValues(params: URLSearchParams, key: string, value: string | readonly string[] | undefined): void {
  if (value === undefined) return
  if (typeof value === 'string') {
    params.append(key, value)
    return
  }
  for (const item of value) params.append(key, item)
}

function idempotencyHeaders(options: IdempotencyOptions): Record<string, string> | undefined {
  return options.idempotencyKey === undefined ? undefined : { 'Idempotency-Key': options.idempotencyKey }
}

function ifMatchHeaders(options: IfMatchOptions): Record<string, string> | undefined {
  return options.ifMatch === undefined ? undefined : { 'If-Match': options.ifMatch }
}

function requiredIfMatchHeaders(ifMatch: string): Record<string, string> {
  if (!/^"\d+"$/.test(ifMatch)) throw invalidAuthorizationResponse('If-Match must be a strong quoted numeric ETag')
  return { 'If-Match': ifMatch }
}

function requiredEtag(etag: string | undefined): string {
  if (etag === undefined || !/^"\d+"$/.test(etag)) throw invalidAuthorizationResponse('Missing or malformed strong ETag')
  return etag
}

function authorizationPageQuery(options: AuthorizationPageOptions): string {
  const page = options.page ?? 0
  const size = options.size ?? 20
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(size) || size < 1 || size > 100) {
    throw invalidAuthorizationResponse('page must be non-negative and size must be between 1 and 100')
  }
  return `?page=${page}&size=${size}`
}

function authorizationId(value: string, resource: string): string {
  if (!isCanonicalUuid(value)) {
    throw new PortalOpenApiError(`${resource} id must be a UUID`, 0, `invalid_${resource}_id`)
  }
  return encodeURIComponent(value)
}

function authorizationPath(resource: 'roles' | 'permissions', id: string): string {
  return `/open/v1/${resource}/${authorizationId(id, resource === 'roles' ? 'role' : 'permission')}`
}

function authorizationUserRolePath(userId: string): string {
  return `/open/v1/users/${authorizationId(userId, 'user')}/roles`
}

function validatePermissionGrant(resource: string, action: string): void {
  const segment = /^(?:\*|[a-z0-9_-]{1,128})$/
  if (!segment.test(resource) || !segment.test(action) || (resource === '*' && action !== '*')) {
    throw new PortalOpenApiError('Invalid permission grant', 0, 'invalid_permission_key')
  }
}

function authorizationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidAuthorizationResponse()
  return value as Record<string, unknown>
}

function requireAuthorizationIdentity<T>(value: T, actual: string, expected: string): T {
  if (actual !== expected) throw invalidAuthorizationResponse()
  return value
}

function authorizationString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || value.length === 0) throw invalidAuthorizationResponse()
  return value
}

function authorizationNullableString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field]
  if (value !== null && typeof value !== 'string') throw invalidAuthorizationResponse()
  return value
}

function authorizationNumber(payload: Record<string, unknown>, field: string): number {
  const value = payload[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidAuthorizationResponse()
  return value
}

function authorizationTimestamp(payload: Record<string, unknown>, field: string): string {
  const value = authorizationString(payload, field)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value)
  const parsed = new Date(value)
  if (!match || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2])
    || parsed.getUTCDate() !== Number(match[3]) || parsed.getUTCHours() !== Number(match[4])
    || parsed.getUTCMinutes() !== Number(match[5]) || parsed.getUTCSeconds() !== Number(match[6])) throw invalidAuthorizationResponse()
  return value
}

function parseAuthorizationPageMetadata(value: unknown, contentLength: number): AuthorizationPageMetadata {
  const payload = authorizationRecord(value)
  const page = { size: authorizationNumber(payload, 'size'), number: authorizationNumber(payload, 'number'), totalElements: authorizationNumber(payload, 'totalElements'), totalPages: authorizationNumber(payload, 'totalPages') }
  const expectedPages = page.size > 0 ? Math.ceil(page.totalElements / page.size) : -1
  const expectedContent = page.totalElements === 0 ? 0 : Math.min(page.size, page.totalElements - page.number * page.size)
  if (page.size < 1 || page.size > 100 || contentLength > page.size || contentLength > page.totalElements
    || page.totalPages !== expectedPages || (page.totalElements === 0 ? page.number !== 0 : page.number >= page.totalPages)
    || contentLength !== expectedContent) throw invalidAuthorizationResponse()
  return page
}

function parseRole(value: unknown, etag = ''): Role {
  const p = authorizationRecord(value)
  if (typeof p.system !== 'boolean') throw invalidAuthorizationResponse()
  return { id: authorizationUuid(p, 'id'), key: authorizationString(p, 'key'), name: authorizationString(p, 'name'), description: authorizationNullableString(p, 'description'), system: p.system, version: authorizationNumber(p, 'version'), createdAt: authorizationTimestamp(p, 'createdAt'), updatedAt: authorizationTimestamp(p, 'updatedAt'), etag }
}

function parseRolePage(value: unknown): RolePage {
  const p = authorizationRecord(value)
  if (!Array.isArray(p.content)) throw invalidAuthorizationResponse()
  return { content: p.content.map((item) => parseRole(item)), page: parseAuthorizationPageMetadata(p.page, p.content.length) }
}

function parsePermission(value: unknown, etag = ''): Permission {
  const p = authorizationRecord(value)
  const resource = authorizationString(p, 'resource'); const action = authorizationString(p, 'action')
  try { validatePermissionGrant(resource, action) } catch { throw invalidAuthorizationResponse() }
  const key = authorizationString(p, 'key')
  if (key !== `${resource}:${action}`) throw invalidAuthorizationResponse()
  const source = authorizationString(p, 'source')
  if (source !== 'CODE' && source !== 'MANUAL') throw invalidAuthorizationResponse()
  return { id: authorizationUuid(p, 'id'), resource, action, key, name: authorizationString(p, 'name'), description: authorizationNullableString(p, 'description'), source, version: authorizationNumber(p, 'version'), createdAt: authorizationTimestamp(p, 'createdAt'), updatedAt: authorizationTimestamp(p, 'updatedAt'), etag }
}

function parsePermissionPage(value: unknown): PermissionPage {
  const p = authorizationRecord(value)
  if (!Array.isArray(p.content)) throw invalidAuthorizationResponse()
  return { content: p.content.map((item) => parsePermission(item)), page: parseAuthorizationPageMetadata(p.page, p.content.length) }
}

function parseRolePermissionBinding(value: unknown): RolePermissionBinding {
  const p = authorizationRecord(value)
  return { roleId: authorizationUuid(p, 'roleId'), permissionId: authorizationUuid(p, 'permissionId'), createdAt: authorizationTimestamp(p, 'createdAt') }
}

function parseRolePermissionBindingPage(value: unknown): Omit<RolePermissionBindingPage, 'etag'> {
  const p = authorizationRecord(value)
  if (!Array.isArray(p.content)) throw invalidAuthorizationResponse()
  return { content: p.content.map(parseRolePermissionBinding), page: parseAuthorizationPageMetadata(p.page, p.content.length) }
}

function parseRolePermissionSet(value: unknown, etag: string): RolePermissionSet {
  const p = authorizationRecord(value)
  if (!Array.isArray(p.permissionIds) || p.permissionIds.some((id) => typeof id !== 'string' || !isCanonicalUuid(id))) throw invalidAuthorizationResponse()
  return { roleId: authorizationUuid(p, 'roleId'), permissionIds: p.permissionIds, version: authorizationNumber(p, 'version'), etag }
}

function parseUserRoleAssignment(value: unknown, etag = ''): UserRoleAssignment {
  const p = authorizationRecord(value)
  const organizationId = p.organizationId
  if (organizationId !== null && (typeof organizationId !== 'string' || !isCanonicalUuid(organizationId))) throw invalidAuthorizationResponse()
  return { id: authorizationUuid(p, 'id'), userId: authorizationUuid(p, 'userId'), roleId: authorizationUuid(p, 'roleId'), organizationId, conditionExpression: authorizationNullableString(p, 'conditionExpression'), conditionDescription: authorizationNullableString(p, 'conditionDescription'), version: authorizationNumber(p, 'version'), createdAt: authorizationTimestamp(p, 'createdAt'), updatedAt: authorizationTimestamp(p, 'updatedAt'), etag }
}

function parseUserRoleAssignmentPage(value: unknown): UserRoleAssignmentPage {
  const p = authorizationRecord(value)
  if (!Array.isArray(p.content)) throw invalidAuthorizationResponse()
  return { content: p.content.map((item) => parseUserRoleAssignment(item)), page: parseAuthorizationPageMetadata(p.page, p.content.length) }
}

function authorizationUuid(payload: Record<string, unknown>, field: string): string {
  const value = authorizationString(payload, field)
  if (!isCanonicalUuid(value)) throw invalidAuthorizationResponse()
  return value
}

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

function invalidAuthorizationResponse(message = 'Invalid authorization management response'): PortalOpenApiError {
  return new PortalOpenApiError(message, 0, 'invalid_authorization_response')
}

function isForbiddenResourceHeader(key: string): boolean {
  return ['authorization', 'x-iam-client-id', 'x-application-id', 'x-app-key'].includes(key.toLowerCase())
}

function parseOrganization(value: unknown, etag?: string): Organization {
  const payload = organizationManagementRecord(value)
  return {
    id: organizationManagementString(payload, 'id'),
    name: organizationManagementString(payload, 'name'),
    slug: organizationManagementString(payload, 'slug'),
    version: organizationManagementNumber(payload, 'version'),
    createdAt: organizationManagementString(payload, 'createdAt'),
    updatedAt: organizationManagementString(payload, 'updatedAt'),
    ...(etag === undefined ? {} : { etag }),
  }
}

function parseOrganizationPage(value: unknown): OrganizationPage {
  const payload = organizationManagementRecord(value)
  if (!Array.isArray(payload.content)) throw invalidOrganizationManagementResponse()
  return { content: payload.content.map((item) => parseOrganization(item)), page: parseOrganizationPageMetadata(payload.page) }
}

function parseOrganizationInvitation(value: unknown): OrganizationInvitation {
  const payload = organizationManagementRecord(value)
  const role = organizationManagementString(payload, 'role')
  const status = organizationManagementString(payload, 'status')
  const deliveryStatus = organizationManagementString(payload, 'deliveryStatus')
  if (!isOrganizationMemberRole(role) || !isOrganizationInvitationStatus(status) || !isOrganizationInvitationDeliveryStatus(deliveryStatus)) {
    throw invalidOrganizationManagementResponse()
  }
  return {
    id: organizationManagementString(payload, 'id'),
    email: organizationManagementString(payload, 'email'),
    role,
    status,
    deliveryStatus,
    expiresAt: organizationManagementString(payload, 'expiresAt'),
    createdAt: organizationManagementString(payload, 'createdAt'),
    updatedAt: organizationManagementString(payload, 'updatedAt'),
  }
}

function parseOrganizationInvitationPage(value: unknown): OrganizationInvitationPage {
  const payload = organizationManagementRecord(value)
  if (!Array.isArray(payload.content)) throw invalidOrganizationManagementResponse()
  return { content: payload.content.map((item) => parseOrganizationInvitation(item)), page: parseOrganizationPageMetadata(payload.page) }
}

function parseOrganizationMember(value: unknown): OrganizationMember {
  const payload = organizationManagementRecord(value)
  const role = organizationManagementString(payload, 'role')
  if (!isOrganizationMemberRole(role)) throw invalidOrganizationManagementResponse()
  return {
    membershipId: organizationManagementString(payload, 'membershipId'),
    userId: organizationManagementString(payload, 'userId'),
    email: organizationManagementString(payload, 'email'),
    displayName: organizationManagementString(payload, 'displayName'),
    role,
    joinedAt: organizationManagementString(payload, 'joinedAt'),
    updatedAt: organizationManagementString(payload, 'updatedAt'),
    version: organizationManagementNumber(payload, 'version'),
  }
}

function parseOrganizationMemberPage(value: unknown): OrganizationMemberPage {
  const payload = organizationManagementRecord(value)
  if (!Array.isArray(payload.content)) throw invalidOrganizationManagementResponse()
  return { content: payload.content.map((item) => parseOrganizationMember(item)), page: parseOrganizationPageMetadata(payload.page) }
}

function parseOrganizationPageMetadata(value: unknown): { size: number; number: number; totalElements: number; totalPages: number } {
  const payload = organizationManagementRecord(value)
  return {
    size: organizationManagementNumber(payload, 'size'),
    number: organizationManagementNumber(payload, 'number'),
    totalElements: organizationManagementNumber(payload, 'totalElements'),
    totalPages: organizationManagementNumber(payload, 'totalPages'),
  }
}

function organizationManagementRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOrganizationManagementResponse()
  return value as Record<string, unknown>
}

function organizationManagementString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field]
  if (typeof value !== 'string' || !value) throw invalidOrganizationManagementResponse()
  return value
}

function organizationManagementNumber(payload: Record<string, unknown>, field: string): number {
  const value = payload[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidOrganizationManagementResponse()
  return value
}

function isOrganizationMemberRole(value: string): value is OrganizationMemberRole {
  return value === 'OWNER' || value === 'ADMIN' || value === 'MEMBER'
}

function isOrganizationInvitationStatus(value: string): value is OrganizationInvitationStatus {
  return value === 'PENDING' || value === 'ACCEPTED' || value === 'CANCELLED' || value === 'EXPIRED'
}

function isOrganizationInvitationDeliveryStatus(value: string): value is OrganizationInvitationDeliveryStatus {
  return value === 'NOT_REQUESTED' || value === 'SENT' || value === 'FAILED'
}

function invalidOrganizationManagementResponse(): PortalOpenApiError {
  return new PortalOpenApiError('Invalid organization management response', 0, 'invalid_organization_response')
}

function parseCreatedRegistrationGrant(value: unknown): CreatedRegistrationGrant {
  if (!value || typeof value !== 'object') {
    throw new PortalOpenApiError('Invalid registration grant create response', 0, 'invalid_registration_grant_response')
  }
  const response = value as Record<string, unknown>
  const grant = response.grant
  const token = response.registrationGrantToken
  const code = response.registrationAccessCode
  if (!grant || typeof grant !== 'object' || ((token !== undefined && token !== null && typeof token !== 'string') || (code !== undefined && code !== null && typeof code !== 'string'))) {
    throw new PortalOpenApiError('Invalid registration grant create response', 0, 'invalid_registration_grant_response')
  }
  const type = (grant as Record<string, unknown>).type
  const tokenPresent = typeof token === 'string' && token.length > 0
  const codePresent = typeof code === 'string' && code.length > 0
  if ((tokenPresent === codePresent) || (type === 'EMAIL_LINK' && !tokenPresent) || (type === 'ACCESS_CODE' && !codePresent)) {
    throw new PortalOpenApiError('Invalid registration grant create response', 0, 'invalid_registration_grant_response')
  }
  if (type !== 'EMAIL_LINK' && type !== 'ACCESS_CODE') {
    throw new PortalOpenApiError('Invalid registration grant create response', 0, 'invalid_registration_grant_response')
  }
  return {
    grant: grant as RegistrationGrant,
    ...(tokenPresent ? { registrationGrantToken: token } : {}),
    ...(codePresent ? { registrationAccessCode: code } : {}),
  }
}

function scopeForMethod(method: PortalOpenApiMethod): PortalOpenApiScope {
  if (method === 'GET') {
    return PORTAL_OPEN_API_READ_SCOPE
  }
  return PORTAL_OPEN_API_WRITE_SCOPE
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function encodeBasicAuth(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`)
  const maybeBuffer = (globalThis as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: 'base64'): string } }
  }).Buffer
  if (maybeBuffer) {
    return maybeBuffer.from(bytes).toString('base64')
  }

  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return globalThis.btoa(binary)
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  const body = await parseResponseBody(response)
  if (typeof body === 'object' && body !== null) {
    return body as TokenResponse
  }
  return {}
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function extractErrorCode(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined
  }
  const record = details as Record<string, unknown>
  const candidates = [record.code, record.error, record.errorCode]
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0)
}

function extractErrorMessage(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return typeof details === 'string' ? details : undefined
  }
  const record = details as Record<string, unknown>
  const candidates = [record.message, record.error_description, record.error]
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0)
}
