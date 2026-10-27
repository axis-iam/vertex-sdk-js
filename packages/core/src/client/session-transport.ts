import type { PrimaryAuthentication, MfaProofMethod } from './authentication-transaction.js'
import type { CreateIdentityOperation, CompleteIdentityOperation, IdentityProofPurpose, StartRegistration } from './identity.js'

export class UnsupportedOperationError extends Error {
  readonly code = 'UNSUPPORTED_OPERATION'
  constructor() { super('This operation is unavailable in server_session mode'); this.name = 'UnsupportedOperationError' }
}
export class SessionTransportError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryAfterSeconds?: number) { super(code); this.name = 'SessionTransportError' }
}
export type ProviderRegistrationProof =
  | { registrationGrantToken: string; registrationAccessCode?: never }
  | { registrationAccessCode: string; registrationGrantToken?: never }
  | { registrationGrantToken?: never; registrationAccessCode?: never }

/** Exact strict authorize DTO. Proofs gate registration; they never authenticate. */
export function providerAuthorization(providerId: string, proof: ProviderRegistrationProof = {}) {
  if (!providerId || Object.keys(proof).some(k => !['registrationGrantToken', 'registrationAccessCode'].includes(k)))
    throw new SessionTransportError('REGISTRATION_GRANT_INVALID')
  const { registrationGrantToken, registrationAccessCode } = proof
  if (registrationGrantToken !== undefined && registrationAccessCode !== undefined)
    throw new SessionTransportError('REGISTRATION_GRANT_INVALID')
  for (const [value, max] of [[registrationGrantToken, 2048], [registrationAccessCode, 128]] as const)
    if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > max))
      throw new SessionTransportError('REGISTRATION_GRANT_INVALID')
  return { providerId, ...proof }
}

type EmptyAction = 'bootstrap' | 'session' | 'login' | 'complete' | 'cancel' | 'logout' | 'workspaces'
  | 'authMethods' | 'authPolicy' | 'profile' | 'security' | 'identifiers' | 'loginMethods' | 'providers'
  | 'sessions' | 'revokeOtherSessions' | 'organizations' | 'currentOrganization' | 'permissions'
  | 'mfaStatus' | 'credentials' | 'recoveryRemaining' | 'removeTotp' | 'generateRecoveryCodes'
  | 'totpEnroll' | 'webauthnEnroll' | 'transfers'
export type SessionRequest =
  | { action: EmptyAction; purposeRef?: string }
  | { action: 'authenticate'; body: PrimaryAuthentication }
  | { action: 'magic'; body: { transactionId: string; proof: string; state: string } }
  | { action: 'challenge'; body: { method: 'EMAIL_OTP' | 'SMS_OTP' | 'EMAIL_MAGIC_LINK'; identifier: PrimaryAuthentication['identifier'] } }
  | { action: 'authorize'; body: { providerId: string } & ProviderRegistrationProof }
  | { action: 'mfa'; body: { method: MfaProofMethod; code: string } }
  | { action: 'workspace'; body: { workspaceId: string; owner: string; version: number } }
  | { action: 'updateProfile'; body: { displayName?: string; avatarUrl?: string } }
  | { action: 'changePassword'; body: { currentPassword: string; newPassword: string }; purposeRef?: string }
  | { action: 'revokeSession' | 'removeCredential'; id: string; purposeRef?: string }
  | { action: 'switchOrganization'; body: { organizationId: string } }
  | { action: 'checkPermission'; body: { permission: string; organizationId?: string | null } }
  | { action: 'identityCreate'; body: CreateIdentityOperation | { type: 'ACCOUNT_DELETE'; expectedLoginMethodVersion: number; payload: Record<string, never> }; idempotencyKey: string }
  | { action: 'identityGet' | 'identityCancel'; ref: string }
  | { action: 'identityReauthenticate'; ref: string; body: { method: 'PASSWORD'; password: string } | { method: 'STEP_UP_PROOF'; ref: string } }
  | { action: 'identityChallenge'; ref: string; body: { targetProofMethod: 'EMAIL_OTP' | 'PHONE_OTP' } }
  | { action: 'identityComplete'; ref: string; body: CompleteIdentityOperation }
  | { action: 'identityTransfer'; ref: string; body: { decision: 'ACCEPT' | 'REJECT' } }
  | { action: 'identityAuthorize'; ref: string; body: { purpose: IdentityProofPurpose; methodId?: string } }
  | { action: 'registrationStart'; body: Omit<StartRegistration, 'organizationInvitationToken'>; idempotencyKey: string }
  | { action: 'registrationGet' | 'registrationChallenge' | 'registrationCancel'; ref: string }
  | { action: 'registrationComplete'; ref: string; body: { code: string } }
  | { action: 'resetRequest'; body: { email: string } }
  | { action: 'resetComplete'; body: { token: string; newPassword: string } }
  | { action: 'stepUpStart'; body: { trigger: string; reason: string } }
  | { action: 'stepUpVerify'; body: { ref: string; code: string } }
  | { action: 'stepUpWebAuthn'; body: { ref: string } }
  | { action: 'stepUpWebAuthnVerify'; body: { ref: string; credential: string } }
  | { action: 'enrollmentReauth'; body: { method: 'totp' | 'webauthn'; password: string } }
  | { action: 'totpVerify'; body: { ref: string; code: string } }
  | { action: 'webauthnVerify'; body: { ref: string; credential: string } }
  | { action: 'recoveryVerify'; body: { code: string } }

/** Implementations own Cookie/CSRF only. No arbitrary URL, header or bearer-token escape hatch. */
export interface SessionTransport { request(request: SessionRequest): Promise<unknown> }

const ref = (value: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new SessionTransportError('SESSION_REF_INVALID')
  return value
}
const segment = (value: string) => {
  if (!value || value === '.' || value === '..') throw new SessionTransportError('SESSION_PATH_INVALID')
  return encodeURIComponent(value)
}
const routes = {
  bootstrap: ['GET', '/session/bootstrap'], session: ['GET', '/session'], login: ['POST', '/session/login'],
  authenticate: ['POST', '/session/login/authenticate'], challenge: ['POST', '/session/login/challenges'],
  magic: ['POST', '/session/login/magic'],
  authorize: ['POST', '/session/login/authorize'], mfa: ['POST', '/session/login/mfa'],
  complete: ['POST', '/session/login/complete'], cancel: ['POST', '/session/login/cancel'], logout: ['POST', '/session/logout'],
  workspaces: ['GET', '/session/workspaces'], workspace: ['POST', '/session/workspace'],
  authMethods: ['GET', '/auth-methods'], authPolicy: ['GET', '/auth-policy'],
  profile: ['GET', '/api/self/profile'], updateProfile: ['PATCH', '/api/self/profile'],
  security: ['GET', '/api/self/security'], identifiers: ['GET', '/api/self/identifiers'],
  loginMethods: ['GET', '/api/self/login-methods'], providers: ['GET', '/api/self/linkable-identity-providers'],
  sessions: ['GET', '/api/self/sessions'], revokeOtherSessions: ['DELETE', '/api/api/v1/auth/sessions'],
  organizations: ['GET', '/api/api/v1/auth/me/organizations'], currentOrganization: ['GET', '/api/api/v1/auth/me/organizations/current'],
  switchOrganization: ['POST', '/api/api/v1/auth/me/organizations/current'], permissions: ['GET', '/api/api/v1/auth/me/permissions'],
  checkPermission: ['POST', '/api/api/v1/auth/me/permissions:check'], changePassword: ['POST', '/api/api/v1/auth/password/change'],
  identityCreate: ['POST', '/identity-operations'], transfers: ['POST', '/identity-operations/transfers'],
  registrationStart: ['POST', '/registration'], resetRequest: ['POST', '/password-reset/request'], resetComplete: ['POST', '/password-reset/complete'],
  stepUpStart: ['POST', '/step-up/start'], stepUpVerify: ['POST', '/step-up/verify'],
  stepUpWebAuthn: ['POST', '/step-up/webauthn/start'], stepUpWebAuthnVerify: ['POST', '/step-up/webauthn/verify'],
  mfaStatus: ['GET', '/api/api/v1/auth/mfa/status'], credentials: ['GET', '/api/api/v1/auth/mfa/webauthn/credentials'],
  recoveryRemaining: ['GET', '/api/api/v1/auth/mfa/recovery-codes/remaining'], recoveryVerify: ['POST', '/api/api/v1/auth/mfa/recovery-codes/verify'],
  removeTotp: ['DELETE', '/api/api/v1/auth/mfa/totp'], generateRecoveryCodes: ['POST', '/api/api/v1/auth/mfa/recovery-codes/generate'],
  enrollmentReauth: ['POST', '/mfa/enrollment/reauth'], totpEnroll: ['POST', '/mfa/totp/enroll'],
  totpVerify: ['POST', '/mfa/totp/enroll/verify'], webauthnEnroll: ['POST', '/mfa/webauthn/register/start'],
  webauthnVerify: ['POST', '/mfa/webauthn/register/finish'],
} as const

/** Same-origin adapter for the delivered finite Console contract, also replaceable by customer BFFs. */
export class CookieSessionTransport implements SessionTransport {
  private csrf: string | null = null
  private revision = 0
  private writePending = false
  private readonly base: URL
  constructor(config: { origin: string; basePath?: string }) {
    this.base = new URL(config.basePath ?? '/console', config.origin)
    const origin = new URL(config.origin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      this.base.origin !== origin.origin || this.base.search || this.base.hash ||
      (typeof location !== 'undefined' && origin.origin !== location.origin))
      throw new SessionTransportError('SESSION_ORIGIN_INVALID')
  }
  async request(input: SessionRequest): Promise<unknown> {
    if (input.action === 'authorize') providerAuthorization(input.body.providerId, {
      ...(input.body.registrationGrantToken !== undefined ? { registrationGrantToken: input.body.registrationGrantToken } : {}),
      ...(input.body.registrationAccessCode !== undefined ? { registrationAccessCode: input.body.registrationAccessCode } : {}),
    } as ProviderRegistrationProof)
    let method: string, path: string
    if (input.action.startsWith('identity') && 'ref' in input) {
      const actions: Record<string, string> = { identityGet: '', identityCancel: '/cancel', identityReauthenticate: '/reauthenticate',
        identityChallenge: '/challenges', identityComplete: '/complete', identityTransfer: '/confirm-transfer', identityAuthorize: '/authorize' }
      const suffix = actions[input.action]
      if (suffix === undefined) throw new UnsupportedOperationError()
      method = input.action === 'identityGet' ? 'GET' : 'POST'
      path = '/identity-operations/' + ref(input.ref) + suffix
    } else if (input.action.startsWith('registration') && 'ref' in input) {
      const actions: Record<string, string> = { registrationGet: '', registrationCancel: '/cancel', registrationChallenge: '/challenges', registrationComplete: '/complete' }
      const suffix = actions[input.action]
      if (suffix === undefined) throw new UnsupportedOperationError()
      method = input.action === 'registrationGet' ? 'GET' : 'POST'; path = '/registration/' + ref(input.ref) + suffix
    } else if (input.action === 'revokeSession' || input.action === 'removeCredential') {
      method = 'DELETE'; path = '/api/api/v1/auth/' + (input.action === 'revokeSession' ? 'sessions/' : 'mfa/webauthn/credentials/') + segment(input.id)
    } else {
      const route = routes[input.action as keyof typeof routes]
      if (!route) throw new UnsupportedOperationError()
      ;[method, path] = route
    }
    const write = method !== 'GET'
    if (write && (!this.csrf || (this.writePending && input.action !== 'logout'))) throw new SessionTransportError(this.writePending ? 'SESSION_ACTION_PENDING' : 'SESSION_CSRF_REQUIRED')
    if (input.action === 'logout') ++this.revision
    const revision = this.revision
    if (write) this.writePending = true
    try {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (write) { headers['X-CSRF-Token'] = this.csrf!; headers['Content-Type'] = 'application/json' }
      if ('idempotencyKey' in input) headers['Idempotency-Key'] = input.idempotencyKey
      if ('purposeRef' in input && input.purposeRef) headers['X-Console-Step-Up-Ref'] = ref(input.purposeRef)
      const response = await fetch(this.base.href.replace(/\/$/, '') + path, {
        method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        ...(write ? { body: JSON.stringify('body' in input ? input.body : {}) } : {}),
      })
      if (!response.ok) {
        let code = 'SESSION_REQUEST_FAILED'
        const data: unknown = await response.json().catch(() => null)
        if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && /^[A-Z0-9_]+$/.test(data.error)) code = data.error
        const retry = response.headers.get('Retry-After')
        const seconds = retry !== null && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : undefined
        throw new SessionTransportError(code, response.status, seconds)
      }
      const data: unknown = response.status === 204 ? undefined : await response.json()
      if (revision !== this.revision) throw new SessionTransportError('SESSION_INVALIDATED')
      if (data && typeof data === 'object' && 'csrfToken' in data && typeof data.csrfToken === 'string') this.csrf = ref(data.csrfToken)
      if (input.action === 'cancel' || input.action === 'logout') { this.csrf = null; ++this.revision; this.writePending = false }
      return data
    } finally { if (write && (revision === this.revision || input.action === 'logout')) this.writePending = false }
  }
}
