/** OIDC Discovery document (subset of fields we use) */
export interface OIDCConfiguration {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  end_session_endpoint?: string
  scopes_supported?: string[]
  response_types_supported?: string[]
  grant_types_supported?: string[]
}

/** OAuth2 Token Set */
export interface TokenSet {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type: string
  expires_in: number
  scope?: string
}

/** Decoded JWT payload (client-side decode, no signature verification) */
export interface JWTPayload {
  sub: string
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  email?: string
  username?: string
  name?: string
  roles?: string[]
  org_id?: string
  org_slug?: string
  org_role?: string
  workspace_id?: string
  acr?: string
  act?: { sub: string }
  [key: string]: unknown
}

/**
 * Runtime user context extracted from JWT identity plus resolved permissions.
 *
 * Profile metadata from /api/v1/auth/me is not part of this authorization
 * context, and App User authorization attributes are app-scoped management
 * fields outside the React runtime SDK.
 */
export interface IamUser {
  id: string
  email?: string
  username?: string
  name?: string
  roles: string[]
  permissions: string[]
  orgId?: string
  orgSlug?: string
  orgRole?: string
  workspaceId?: string
  isImpersonating: boolean
  actorId?: string
  raw: JWTPayload
}

export type IdentityProviderProtocol = 'OIDC' | 'OAUTH2' | 'SAML' | 'UNSUPPORTED' | (string & {})

/** Public browser-safe identity provider metadata from IAM. */
export interface IdentityProviderOption {
  id: string
  applicationId: string
  providerType: string
  name: string
  displayName: string
  enabled: boolean
  protocol: IdentityProviderProtocol
  authorizationUrl?: string | null
  samlAcsUrl?: string | null
  supportsBrokeredToken: boolean
}

/** Response from selected provider authorize endpoint. */
export interface ProviderAuthorizationResponse {
  authorizationUrl: string
}

/** Options for selected provider Authorization Code + PKCE login. */
export type SignupMode = 'OPEN' | 'INVITE_REQUIRED' | 'DISABLED'

export type RegistrationGrantType = 'EMAIL_LINK' | 'ACCESS_CODE' | 'ORG_INVITATION'

/**
 * Exactly one proof for an Application registration grant. Proof values are
 * caller-managed, short-lived browser memory only.
 */
export type RegistrationGrantInput =
  | { type: 'EMAIL_LINK'; registrationGrantToken: string }
  | { type: 'ACCESS_CODE'; registrationAccessCode: string }
  | { type: 'ORG_INVITATION'; organizationInvitationToken: string }

/** Provider authorize endpoints support only EMAIL_LINK and ACCESS_CODE proofs. */
export type ProviderRegistrationGrantInput = Exclude<RegistrationGrantInput, { type: 'ORG_INVITATION' }>

export type RegistrationGrantPreviewStatus = 'VALID' | 'UNAVAILABLE'

/** Public, non-enumerating registration grant preview response. */
export interface RegistrationGrantPreviewResponse {
  status: RegistrationGrantPreviewStatus
  type: RegistrationGrantType | null
  emailHint: string | null
  domainHint: string | null
  applicationName: string | null
  expiresAt: string | null
  allowedAuthMethods: string[]
}

export interface ProviderAuthorizationOptions {
  redirectUri?: string
  scopes?: string[]
  /** Application.resourceAudience requested for access tokens; this is not clientId. */
  audience?: string
  /** Server-side provider continuation proof. Organization invitations are unsupported here. */
  registrationGrant?: ProviderRegistrationGrantInput
}

export type EmailVerificationMode = 'OFF' | 'OPTIONAL' | 'REQUIRED'

export type AuthMethodType = 'PASSWORD' | 'EMAIL_MAGIC_LINK' | 'EMAIL_OTP' | 'SMS_OTP' | 'SOCIAL'

export interface AuthMethodAvailabilityResponse {
  type: AuthMethodType
  enabled: boolean
  configured: boolean
  availableForLogin: boolean
  availableForSignup: boolean
  unavailableReason: string | null
}

export interface AuthMethodIdpProviderResponse {
  id: string
  providerType: string
  displayName: string
  enabled: boolean
  configured: boolean
  clickable: boolean
  availableForLogin: boolean
  availableForSignup: boolean
  unavailableReason: string | null
  authorizationUrl: string | null
}

export interface PublicAuthMethodsResponse {
  clientId: string
  passwordLoginEnabled: boolean
  emailMagicLinkEnabled: boolean
  emailOtpEnabled: boolean
  smsOtpEnabled: boolean
  socialLoginEnabled: boolean
  signupEnabled: boolean
  selfRegistrationEnabled: boolean
  emailVerificationMode: EmailVerificationMode
  idpAutoProvisioningEnabled: boolean
  loginInitiationUri: string | null
  postVerificationRedirectUri: string | null
  methods: AuthMethodAvailabilityResponse[]
  idpProviders: AuthMethodIdpProviderResponse[]
  resend: {
    emailVerificationCooldownSeconds: number
  }
}

export interface AppContinuation {
  loginInitiationUri: string | null
  postVerificationRedirectUri: string | null
  /** OAuth client-level post logout redirect configured on IamProvider, not Application authConfig. */
  postLogoutRedirectUri: string | null
}

export type RedirectCallbackResult =
  | { status: 'idle' }
  | { status: 'success'; tokens: TokenSet }
  | { status: 'error'; error: Error }

export interface RedirectCallbackOptions {
  url?: string | URL
  cleanUrl?: string | false
}

export interface LogoutUrlOptions {
  /** OAuth client-level post logout redirect URI. Overrides IamConfig.postLogoutRedirectUri for this call. */
  postLogoutRedirectUri?: string
}

export interface LogoutOptions extends LogoutUrlOptions {
  redirect?: boolean
}

/** Resolved public auth policy for browser login/signup flows. */
export interface PublicAuthPolicyResponse {
  passwordLoginEnabled: boolean
  passwordlessEnabled: boolean
  minPasswordLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireDigit: boolean
  requireSpecialChar: boolean
  breachedPasswordCheck: boolean
  totpEnabled: boolean
  webauthnEnabled: boolean
  mfaEnforcement: string
  stepUpEnabled: boolean
  stepUpTriggers: string[]
  deviceTrustDays: number
  maxTrustedDevices: number
  maxLoginAttempts: number
  lockoutDurationMinutes: number
  progressiveLockout: boolean
  emailVerificationMode: EmailVerificationMode
  idpAutoProvisioningEnabled: boolean
  signupMode: SignupMode
  allowedRegistrationGrantTypes: RegistrationGrantType[]
}

export interface IamApiErrorDetails {
  trigger?: string
  methods?: string[]
  [key: string]: unknown
}

export interface IamApiErrorOptions {
  status?: number
  code?: string
  details?: IamApiErrorDetails
  retryAfterSeconds?: number
}

export class IamApiError extends Error {
  status?: number
  code?: string
  details?: IamApiErrorDetails
  retryAfterSeconds?: number

  constructor(message: string, options: IamApiErrorOptions = {}) {
    super(message)
    this.name = 'IamApiError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export class IamNetworkError extends Error {
  cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'IamNetworkError'
    this.cause = cause
  }
}

export class IamConfigurationError extends Error {
  cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'IamConfigurationError'
    this.cause = cause
  }
}

export type TokenRefreshFailureReason = 'SESSION_UNAVAILABLE' | 'SESSION_REJECTED' | 'INVALID_RESPONSE' | 'TEMPORARY_FAILURE' | 'CONFIGURATION_ERROR'

/** Safe refresh failure metadata. Never retains a raw response or transport cause. */
export class IamTokenRefreshError extends Error {
  readonly code = 'TOKEN_REFRESH_FAILED'

  constructor(
    readonly reason: TokenRefreshFailureReason,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Token refresh failed: ${reason}`)
    this.name = 'IamTokenRefreshError'
  }
}

export function isIamApiError(error: unknown): error is IamApiError {
  return error instanceof IamApiError
}

export function isStepUpRequiredError(error: unknown): error is IamApiError {
  return error instanceof IamApiError && error.code === 'STEP_UP_REQUIRED'
}

export type AccountLoginMethodKind = 'CREDENTIAL' | 'IDENTITY_PROVIDER' | (string & {})
export type AccountCredentialType = 'PASSWORD' | 'TOTP' | 'WEBAUTHN' | 'RECOVERY_CODE' | (string & {})
export type AccountLinkProtocol = 'OIDC' | 'OAUTH2' | 'SAML' | (string & {})

export interface AccountLoginMethod {
  methodId: string
  kind: AccountLoginMethodKind
  credentialType: AccountCredentialType | null
  identityProviderId: string | null
  providerKey: string | null
  providerType: string | null
  protocol: AccountLinkProtocol | null
  displayName: string
  linkedAt: string | null
  providerUserId: string | null
  unlinkable: boolean
}

export interface LinkableIdentityProvider {
  id: string
  providerType: string
  protocol: AccountLinkProtocol
  displayName: string
  enabled: boolean
  linked: boolean
  linkedAt: string | null
  supportsAccountLinking: boolean
}

export interface AccountLinkAuthorizeOptions {
  redirectUri?: string
  state?: string
}

export interface AccountLinkAuthorizeResult {
  authorizationUrl: string
  state: string
  expiresAt: string
}

export interface AccountLinkTicketExchangeInput {
  linkTicket: string
  state: string
}

export interface AccountLinkCallbackResult {
  method: AccountLoginMethod
}

export interface AccountOrganization {
  organizationId: string
  name: string
  slug: string | null
  role: string
  joinedAt: string | null
  current: boolean
}

export interface AccountProfile {
  userId: string
  applicationId: string
  globalIdentityId: string | null
  email: string
  emailVerified: boolean
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  status: string
  createdAt: string
  updatedAt: string
  currentOrganization: AccountOrganization | null
}

export interface AccountUpdateProfileInput {
  username?: string | null
  displayName?: string | null
  avatarUrl?: string | null
}

export interface AccountSecuritySummary {
  emailVerified: boolean
  passwordCredentialPresent: boolean
  mfaEnrolled: boolean
  totpEnrolled: boolean
  webAuthnEnrolled: boolean
  activeSessionCount: number
}

export interface AccountSession {
  sessionId: string
  ipAddress: string | null
  userAgent: string | null
  deviceId: string | null
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export interface AccountPermissionSummary {
  applicationId: string
  organizationId: string | null
  roles: string[]
  permissions: string[]
}

export interface AccountPermissionCheckInput {
  permission: string
  organizationId?: string | null
}

export interface AccountPermissionCheckResponse {
  applicationId: string
  organizationId: string | null
  permission: string
  allowed: boolean
  roles: string[]
}

export interface OrganizationSwitchResponse {
  organizationId: string
  continuation: string
  tokenRefreshRequired: boolean
  message: string | null
}

export interface PublicOrganizationInvitationPreview {
  applicationId: string
  applicationName: string
  organizationId: string
  organizationName: string
  inviteeEmail: string
  role: string
  status: string
  expiresAt: string
}

export type PublicOrganizationInvitationAcceptStatus =
  | 'ACCEPTED'
  | 'LOGIN_REQUIRED'
  | (string & {})

export interface PublicOrganizationInvitationAcceptResponse {
  status: PublicOrganizationInvitationAcceptStatus
  continuation: string | null
  applicationId: string
  organizationId: string
  organizationName: string
  role: string
  acceptedAt: string | null
}

/** Social identity provider configuration */
export interface SocialProviderConfig {
  /**
   * @deprecated Embedded provider buttons are discovered from IAM via
   * GET /api/v1/apps/{clientId}/identity-providers. This field is now only
   * used as a legacy display override for matching backend-enabled providers.
   */
  provider: string
  /** @deprecated Browser embedded login never uses provider client IDs. */
  clientId?: string
  displayName?: string
}

/** SDK configuration */
export interface IamConfig {
  /** SPA/NATIVE public ApplicationClient.clientId. Browser SDK config must not include a secret. */
  clientId: string
  issuerUri: string
  redirectUri: string
  postLogoutRedirectUri?: string
  scopes?: string[]
  /** Application.resourceAudience requested for access tokens; this is not clientId. */
  audience?: string
  /**
   * Token and resolved-permission storage strategy for the browser SDK.
   * Defaults to memory-only. sessionStorage persistence is browser-readable
   * and should be enabled only when the app deliberately accepts that risk.
   */
  tokenStorage?: 'memory' | 'sessionStorage'
  /**
   * @deprecated Embedded SignIn/SignUp visibility is resolved from
   * GET /api/v1/apps/{clientId}/auth-methods. This field no longer creates
   * visible password, SMS, or magic-link methods at runtime.
   */
  authMethods?: Array<'password' | 'sms' | 'magic_link'>
  /**
   * @deprecated Embedded login discovers provider buttons from IAM. Static
   * entries can only override display names for matching backend-enabled
   * providers; they do not create clickable providers by themselves.
   */
  socialProviders?: SocialProviderConfig[]
}

/** Canonical current-user authorization projection from GET /api/v1/auth/me/permissions. */
export interface PermissionResponse {
  applicationId: string
  organizationId: string | null
  roles: string[]
  permissions: string[]
}

/** Request input for public password-reset email flow. */
export interface RequestPasswordResetInput {
  email: string
  redirectUri?: string
}

/** Request input for completing password reset. */
export interface ResetPasswordInput {
  token: string
  newPassword: string
}

/** Request input for public email verification resend flow. */
export interface SendEmailVerificationInput {
  email: string
}

export interface VerifyEmailInput {
  token: string
}

export interface EmailVerificationResponse {
  message: string
  retryAfterSeconds: number | null
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export interface LogoutAccountOptions {
  refreshToken?: string | null
}
