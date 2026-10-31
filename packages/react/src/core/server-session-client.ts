import { validateIamConfig } from './iam-config'
import { AccountSecurityOperations } from './account-security-operations'
import {
  ServerSession, SessionLogin, UnsupportedOperationError, SessionTransportError,
  parseMfaStepUpResult, parseMfaWebAuthnStartResult, sessionRecord as record, sessionText as text, SessionInvalidatedError,
  SessionInvitationJourneyClient,
} from '@axis-iam/vertex'
import type {
  AuthenticationFlow, SessionRequest, ServerSessionView, SessionInvalidationReason,
  CreateIdentityOperation, CompleteIdentityOperation, OperationReauthentication,
  IdentityOperation, TargetProofMethod, StartRegistration, RegistrationOperation,
} from '@axis-iam/vertex'
import type * as T from './types'
import { IamConfigurationError } from './types'
import { parseIdentifiers, parseMethods, parseOperation, parseRegistration } from './identity-client'
import { registrationGrantBody } from './auth-flow-client'
import { validateFlowMetadata } from './auth-flow-client'
import { isEmbeddedSignInProvider } from './oauth-provider-authorization'

export type SessionIdentityOperation = Omit<IdentityOperation, 'id'> & { ref: string }
export type OperationView = IdentityOperation | SessionIdentityOperation
export const operationReference = (op: OperationView) => 'ref' in op ? op.ref : op.id
function safeOperation(value: unknown): SessionIdentityOperation {
  const v = record(value)
  if ('id' in v || 'controlSecret' in v || 'authorizationId' in v) throw new IamConfigurationError('Invalid session operation')
  const ref = text(v.ref)
  if (!/^[A-Za-z0-9_-]{43}$/.test(ref)) throw new IamConfigurationError('Invalid session ref')
  const { id: _privateId, ...safe } = parseOperation({ ...v, id: ref })
  return { ...safe, ref }
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new IamConfigurationError('Invalid session response'); return value }
function nullable(value: unknown): string | null { return value === null ? null : text(value) }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new IamConfigurationError('Invalid session response'); return value }
function strings(value: unknown): string[] { return array(value).map(text) }
function number(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new IamConfigurationError('Invalid session response'); return value }
function organization(value: unknown): T.AccountOrganization {
  const v = record(value); return { organizationId: text(v.organizationId), name: text(v.name), slug: nullable(v.slug), role: text(v.role), joinedAt: nullable(v.joinedAt), current: boolean(v.current) }
}
function profile(value: unknown): T.AccountProfile {
  const v = record(value)
  return { userId: text(v.userId), applicationId: text(v.applicationId), globalIdentityId: nullable(v.globalIdentityId), email: nullable(v.email),
    emailVerified: boolean(v.emailVerified), username: nullable(v.username), displayName: nullable(v.displayName), avatarUrl: nullable(v.avatarUrl),
    status: text(v.status), createdAt: text(v.createdAt), updatedAt: text(v.updatedAt), currentOrganization: v.currentOrganization === null ? null : organization(v.currentOrganization) }
}

/** An independent Cookie client. It has no TokenManager or browser OAuth material. */
export class ServerSessionClient {
  readonly invitations: SessionInvitationJourneyClient
  readonly mode = 'server_session' as const
  readonly session: ServerSession
  getRecoveryCodesRemaining = () => this.accountSecurity.getRecoveryCodesRemaining()
  readonly accountSecurity: AccountSecurityOperations
  getMfaCapabilities = (...args: Parameters<AccountSecurityOperations['getMfaCapabilities']>) => this.accountSecurity.getMfaCapabilities(...args)
  createMfaOperation = (...args: Parameters<AccountSecurityOperations['createMfaOperation']>) => this.accountSecurity.createMfaOperation(...args)
  getMfaOperation = (...args: Parameters<AccountSecurityOperations['getMfaOperation']>) => this.accountSecurity.getMfaOperation(...args)
  reauthenticateMfaOperation = (...args: Parameters<AccountSecurityOperations['reauthenticateMfaOperation']>) => this.accountSecurity.reauthenticateMfaOperation(...args)
  challengeMfaOperation = (...args: Parameters<AccountSecurityOperations['challengeMfaOperation']>) => this.accountSecurity.challengeMfaOperation(...args)
  authorizeMfaOperation = (...args: Parameters<AccountSecurityOperations['authorizeMfaOperation']>) => this.accountSecurity.authorizeMfaOperation(...args)
  completeMfaProviderAuthorization = (...args: Parameters<AccountSecurityOperations['completeMfaProviderAuthorization']>) => this.accountSecurity.completeMfaProviderAuthorization(...args)
  startMfaOperationStepUp = (...args: Parameters<AccountSecurityOperations['startMfaOperationStepUp']>) => this.accountSecurity.startMfaOperationStepUp(...args)
  verifyMfaOperationStepUp = (...args: Parameters<AccountSecurityOperations['verifyMfaOperationStepUp']>) => this.accountSecurity.verifyMfaOperationStepUp(...args)
  startMfaOperationWebAuthn = (...args: Parameters<AccountSecurityOperations['startMfaOperationWebAuthn']>) => this.accountSecurity.startMfaOperationWebAuthn(...args)
  verifyMfaOperationWebAuthn = (...args: Parameters<AccountSecurityOperations['verifyMfaOperationWebAuthn']>) => this.accountSecurity.verifyMfaOperationWebAuthn(...args)
  beginTotpEnrollmentOperation = (...args: Parameters<AccountSecurityOperations['beginTotpEnrollmentOperation']>) => this.accountSecurity.beginTotpEnrollmentOperation(...args)
  completeMfaOperation = (...args: Parameters<AccountSecurityOperations['completeMfaOperation']>) => this.accountSecurity.completeMfaOperation(...args)
  cancelMfaOperation = (...args: Parameters<AccountSecurityOperations['cancelMfaOperation']>) => this.accountSecurity.cancelMfaOperation(...args)
  readonly identity: SessionIdentityClient
  private loginFlow: SessionLogin | null = null
  private disposed = false
  private restoring: Promise<void> | null = null
  private purposeRefs = new Map<string, { ref: string; generation: number }>()
  get clientId() { return this.config.clientId }
  get state() {
    const session = this.session
    return {
      get generation() { return session.generation },
      get invalidationReason() { return session.invalidationReason },
      assertCurrent: (generation: number) => session.assertCurrent(generation),
      clear: (reason?: SessionInvalidationReason) => { this.purposeRefs.clear(); session.clear(reason) },
      getUser: () => this.getUser(), getViewState: () => session.getViewState(),
      subscribe: session.subscribe, isAuthenticated: () => session.isAuthenticated(),
    }
  }
  constructor(readonly config: T.IamConfig) {
    validateIamConfig(config)
    if (config.sessionMode !== 'server_session' || !config.sessionTransport || config.tokenStorage !== undefined)
      throw new IamConfigurationError('server_session requires an explicit SessionTransport and no tokenStorage')
    this.session = new ServerSession(config.sessionTransport, config.clientId)
    this.invitations = new SessionInvitationJourneyClient(request => this.session.action(request))
    this.identity = new SessionIdentityClient(this)
    this.accountSecurity = new AccountSecurityOperations(this)
  }
  private getUser(): T.IamUser | null {
    const v = this.session.getSnapshot()
    if (!v || !('profile' in v) || !this.session.isAuthenticated()) return null
    const u = v.profile, c = u.authenticationContext
    if (c.clientId !== this.clientId) throw new IamConfigurationError('Session client mismatch')
    return { ...u, roles: v.permissions.roles, permissions: v.permissions.permissions,
      ...(typeof u.metadata.displayName === 'string' ? { name: u.metadata.displayName } : {}),
      orgId: c.organizationId ?? undefined, orgSlug: c.organizationSlug ?? undefined, orgRole: c.organizationRole ?? undefined,
      workspaceId: c.workspaceId ?? undefined, isImpersonating: c.impersonation !== null, actorId: c.impersonation?.actorId }
  }
  async initialize() { this.disposed = false; await this.restoreSession() }
  restoreSession(): Promise<void> {
    if (this.restoring) return this.restoring
    const work = this.session.restore().then(() => { this.getUser() })
    this.restoring = work
    void work.finally(() => { if (this.restoring === work) this.restoring = null }).catch(() => {})
    return work
  }
  async fetchPermissions() { await this.restoreSession(); return this.getUser()?.permissions ?? [] }
  isAuthenticated() { return this.session.isAuthenticated() }
  getAccessToken(): never { throw new UnsupportedOperationError() }
  async refreshToken(): Promise<never> { throw new UnsupportedOperationError() }
  async getLogoutUrl(_options?: T.LogoutUrlOptions): Promise<never> { throw new UnsupportedOperationError() }
  async handleCallback(_code: string, _state: string): Promise<never> { throw new UnsupportedOperationError() }
  async discover(): Promise<never> { throw new UnsupportedOperationError() }
  async startAuthorizationFlow(_options?: { locale?: string }): Promise<string> {
    const uri = new URL(this.config.sessionLoginUri ?? '/login', typeof window === 'undefined' ? this.config.issuerUri : window.location.origin)
    if (typeof window === 'undefined' || uri.origin !== window.location.origin || uri.search || uri.hash) throw new IamConfigurationError('Server login page must be same-origin')
    return uri.href
  }
  async getAppContinuation(): Promise<never> { throw new UnsupportedOperationError() }
  async previewRegistrationGrant(_input: T.RegistrationGrantInput): Promise<never> { throw new UnsupportedOperationError() }
  async sendEmailVerification(_input: T.SendEmailVerificationInput): Promise<never> { throw new UnsupportedOperationError() }
  async verifyEmail(_input: T.VerifyEmailInput): Promise<never> { throw new UnsupportedOperationError() }
  async getPublicAuthMethods(): Promise<T.PublicAuthMethodsResponse> {
    const [methods, policy] = await Promise.all([this.request({ action: 'authMethods' }), this.request({ action: 'authPolicy' })])
    validateFlowMetadata(methods as T.PublicAuthMethodsResponse, policy as T.PublicAuthPolicyResponse); return methods as T.PublicAuthMethodsResponse
  }
  async getPublicAuthPolicy(): Promise<T.PublicAuthPolicyResponse> {
    const [methods, policy] = await Promise.all([this.request({ action: 'authMethods' }), this.request({ action: 'authPolicy' })])
    validateFlowMetadata(methods as T.PublicAuthMethodsResponse, policy as T.PublicAuthPolicyResponse); return policy as T.PublicAuthPolicyResponse
  }
  async listIdentityProviders(): Promise<T.IdentityProviderOption[]> { throw new UnsupportedOperationError() }
  async beginAuthentication(): Promise<SessionLogin> {
    this.loginFlow?.invalidate()
    await this.restoreSession()
    const v = this.session.getSnapshot()
    if (v?.state === 'PRELOGIN') await this.session.load('login')
    else if (!v || !['PENDING','AUTHENTICATING','AWAITING_PROVIDER','MFA_REQUIRED','AUTHENTICATED','COMPLETED'].includes(v.state) || 'profile' in v)
      throw new IamConfigurationError('Restart the server login')
    this.loginFlow = new SessionLogin(this.session); return this.loginFlow
  }
  async completeAuthentication(flow: AuthenticationFlow, committed?: () => void): Promise<ServerSessionView> {
    if (flow !== this.loginFlow) throw new SessionInvalidatedError()
    const view = await this.session.load('complete')
    if (!('profile' in view) || !this.getUser()) throw new IamConfigurationError('Required session views unavailable')
    this.loginFlow = null; committed?.(); return view
  }
  async resumeProviderCallback(_url: string, committed?: () => void, check?: () => void) {
    check?.(); await this.restoreSession()
    if (this.isAuthenticated()) { committed?.(); check?.(); return { kind: 'session' as const } }
    const transaction = await this.beginAuthentication()
    return { kind: 'continuation' as const, transaction, view: transaction.getSnapshot() }
  }
  async resumeMagicLink(_url: string): Promise<never> { throw new UnsupportedOperationError() }
  async handleRedirectCallback(_options?: T.RedirectCallbackOptions): Promise<T.RedirectCallbackResult> {
    await this.restoreSession()
    if (this.isAuthenticated()) return { status: 'session', user: this.getUser()! }
    const v = this.session.getSnapshot()
    if (v?.state === 'MFA_REQUIRED') {
      const transaction = await this.beginAuthentication()
      return { status: 'continuation', transaction, view: transaction.getSnapshot() }
    }
    return { status: 'idle' }
  }
  async startProviderAuthorizationFlow(provider: string | T.IdentityProviderOption | T.AuthMethodIdpProviderResponse, options: T.ProviderAuthorizationOptions = {}) {
    const found = typeof provider === 'string' ? (await this.getPublicAuthMethods()).idpProviders.find(p => p.id === provider) : provider
    if (!found || !isEmbeddedSignInProvider(found)) throw new IamConfigurationError('Provider unavailable')
    if (options.redirectUri || options.scopes || options.audience) throw new IamConfigurationError('Server owns login configuration')
    const flow = await this.beginAuthentication()
    return (await flow.authorizeProvider(found.id, registrationGrantBody(options.registrationGrant))).authorizationUrl
  }
  async logout(_options?: T.LogoutOptions) {
    this.accountSecurity.cancelProviderWindow()
    this.loginFlow?.invalidate(); this.loginFlow = null; this.purposeRefs.clear()
    await this.session.logout()
  }
  async logoutAccount() { await this.logout() }
  dispose() { this.accountSecurity.cancelProviderWindow(); this.disposed = true; this.loginFlow?.invalidate(); this.session.dispose(); this.purposeRefs.clear() }
  async request(request: SessionRequest) {
    if (this.disposed) throw new SessionInvalidatedError()
    return this.session.action(request)
  }
  async listWorkspaces() {
    return array(await this.request({ action: 'workspaces' })).map(v => { const w = record(v); return { id: text(w.id), name: text(w.name) } })
  }
  async selectWorkspace(workspaceId: string) {
    this.loginFlow?.invalidate(); this.purposeRefs.clear()
    await this.session.selectWorkspace(workspaceId)
  }
  async getAccountProfile() { return profile(await this.request({ action: 'profile' })) }
  async updateAccountProfile(input: T.AccountUpdateProfileInput) {
    if (input.displayName === null || input.avatarUrl === null) throw new IamConfigurationError('Profile fields must be strings when supplied')
    return profile(await this.request({ action: 'updateProfile', body: input as { displayName?: string; avatarUrl?: string } }))
  }
  async getAccountSecuritySummary(): Promise<T.AccountSecuritySummary> {
    const v = record(await this.request({ action: 'security' }))
    return { emailVerified: boolean(v.emailVerified), passwordCredentialPresent: boolean(v.passwordCredentialPresent), mfaEnrolled: boolean(v.mfaEnrolled),
      totpEnrolled: boolean(v.totpEnrolled), webAuthnEnrolled: boolean(v.webAuthnEnrolled), activeSessionCount: number(v.activeSessionCount) }
  }
  async listAccountLoginMethods() { return this.identity.loginMethods() }
  async listLinkableIdentityProviders(): Promise<T.LinkableIdentityProvider[]> {
    return array(await this.request({ action: 'providers' })).map(value => {
      const v = record(value)
      return { id: text(v.id), providerType: text(v.providerType), displayName: text(v.displayName), protocol: text(v.protocol), enabled: boolean(v.enabled), linked: boolean(v.linked), linkedAt: nullable(v.linkedAt), supportsAccountLinking: boolean(v.supportsAccountLinking), canLink: boolean(v.canLink), canReauthenticate: boolean(v.canReauthenticate), unavailableReasons: strings(v.unavailableReasons) }
    })
  }
  async listAccountSessions(): Promise<T.AccountSession[]> {
    return array(await this.request({ action: 'sessions' })).map(value => {
      const v = record(value); return { sessionId: text(v.sessionId), ipAddress: nullable(v.ipAddress), userAgent: nullable(v.userAgent), deviceId: nullable(v.deviceId),
        createdAt: text(v.createdAt), lastSeenAt: text(v.lastSeenAt), current: boolean(v.current) }
    })
  }
  async revokeAccountSession(id: string) { await this.request({ action: 'revokeSession', id }) }
  async revokeOtherAccountSessions() { await this.request({ action: 'revokeOtherSessions' }) }
  async listAccountOrganizations() { return array(await this.request({ action: 'organizations' })).map(organization) }
  async getCurrentAccountOrganization() { const v = await this.request({ action: 'currentOrganization' }); return v === null ? null : organization(v) }
  async hasAccountOrganizationMembership(id: string) { return (await this.listAccountOrganizations()).some(v => v.organizationId === id) }
  async switchAccountOrganization(organizationId: string): Promise<T.OrganizationSwitchResponse> {
    this.purposeRefs.clear()
    const v = record(await this.request({ action: 'switchOrganization', body: { organizationId } }))
    await this.restoreSession()
    return { organizationId: text(v.organizationId), continuation: text(v.continuation), tokenRefreshRequired: boolean(v.tokenRefreshRequired), message: nullable(v.message) }
  }
  async getAccountPermissionSummary(organizationId?: string | null): Promise<T.AccountPermissionSummary> {
    const v = record(await this.request({ action: 'permissions' }))
    if (organizationId !== undefined && organizationId !== v.organizationId) throw new IamConfigurationError('Permission context mismatch')
    return { applicationId: text(v.applicationId), organizationId: nullable(v.organizationId), roles: strings(v.roles), permissions: strings(v.permissions) }
  }
  async checkAccountPermission(input: T.AccountPermissionCheckInput): Promise<T.AccountPermissionCheckResponse> {
    const v = record(await this.request({ action: 'checkPermission', body: input }))
    return { applicationId: text(v.applicationId), organizationId: nullable(v.organizationId), permission: text(v.permission), allowed: boolean(v.allowed), roles: strings(v.roles) }
  }
  async changePassword(body: T.ChangePasswordInput) { await this.request({ action: 'changePassword', body, purposeRef: this.consumePurpose('PASSWORD_CHANGE') }) }
  async requestPasswordReset(body: T.RequestPasswordResetInput) {
    if (body.redirectUri) throw new IamConfigurationError('Server owns reset redirect')
    await this.request({ action: 'resetRequest', body: { email: body.email } })
  }
  async resetPassword(body: T.ResetPasswordInput) { await this.request({ action: 'resetComplete', body }) }
  rememberIdentityPurpose(ref: string) { this.purposeRefs.set('LOGIN_METHOD_CHANGE', { ref, generation: this.state.generation }) }
  consumePurpose(trigger: string) {
    const purpose = this.purposeRefs.get(trigger)
    this.purposeRefs.delete(trigger)
    if (!purpose || purpose.generation !== this.state.generation || !this.isAuthenticated()) throw new SessionTransportError('STEP_UP_REQUIRED', 403)
    return purpose.ref
  }
  async startStepUp(trigger: string, reason: string) {
    const generation = this.state.generation
    const v = record(await this.request({ action: 'stepUpStart', body: { trigger, reason } }))
    const ref = text(v.ref), methods = strings(v.availableMethods)
    const apply = (result: unknown) => { this.state.assertCurrent(generation); if (record(result).verified !== true) throw new IamConfigurationError('Step-up was not verified'); this.purposeRefs.set(trigger, { ref: text(record(result).ref), generation }) }
    return { ref, availableMethods: methods,
      verifyTotp: async (code: string) => { this.state.assertCurrent(generation); apply(await this.request({ action: 'stepUpVerify', body: { ref, code } })) },
      startWebAuthn: async () => { this.state.assertCurrent(generation); return this.request({ action: 'stepUpWebAuthn', body: { ref } }) },
      verifyWebAuthn: async (credential: string) => { this.state.assertCurrent(generation); apply(await this.request({ action: 'stepUpWebAuthnVerify', body: { ref, credential } })) } }
  }
  async enrollmentReauthenticate(method: 'webauthn', password: string) { await this.request({ action: 'enrollmentReauth', body: { method, password } }) }
  async enrollWebAuthn() {
    const v = record(await this.request({ action: 'webauthnEnroll' }))
    return { ref: text(v.ref), expiresAt: text(v.expiresAt), publicKeyCredentialCreationOptions: text(v.publicKeyCredentialCreationOptions) }
  }
  async verifyWebAuthnEnrollment(ref: string, credential: string) { return this.request({ action: 'webauthnVerify', body: { ref, credential } }) }
  async mfaStatus() { return this.request({ action: 'mfaStatus' }) }
  async credentials() { return this.request({ action: 'credentials' }) }
  async removeCredential(id: string) { await this.request({ action: 'removeCredential', id, purposeRef: this.consumePurpose('MFA_CHANGE') }) }
  async recoveryCodesRemaining() { return number(record(await this.request({ action: 'recoveryRemaining' })).remaining) }
  async verifyRecoveryCode(code: string) { return boolean(record(await this.request({ action: 'recoveryVerify', body: { code } })).verified) }
}

class SessionIdentityClient {
  constructor(private readonly client: ServerSessionClient) {}
  async identifiers() { return parseIdentifiers(await this.client.request({ action: 'identifiers' })) }
  async loginMethods() { return parseMethods(await this.client.request({ action: 'loginMethods' })) }
  async create(body: CreateIdentityOperation, idempotencyKey: string) { return safeOperation(await this.client.request({ action: 'identityCreate', body, idempotencyKey })) }
  async get(ref: string) { return safeOperation(await this.client.request({ action: 'identityGet', ref })) }
  async transfers() { return array(await this.client.request({ action: 'transfers' })).map(safeOperation) }
  async reauthenticate(ref: string, input: OperationReauthentication) {
    const body = input.method === 'PASSWORD' ? input : { method: 'EMAIL_OTP' as const, challengeRef: input.challengeId, code: input.code }
    return safeOperation(await this.client.request({ action: 'identityReauthenticate', ref, body }))
  }
  async currentAccountChallenge(ref: string, identifierId: string) {
    const v = record(await this.client.request({ action: 'identityCurrentChallenge', ref, body: { identifierId } }))
    return { operation: safeOperation(v.operation), challengeId: text(v.challengeRef), nextChallengeAt: text(v.nextChallengeAt) }
  }
  async startOperationStepUp(ref: string) {
    const v = parseMfaStepUpResult(await this.client.request({ action: 'identityStepUpStart', ref }))
    return { challengeId: v.challengeRef, availableMethods: v.availableMethods }
  }
  async verifyOperationStepUp(ref: string, challengeRef: string, code: string) {
    return safeOperation(await this.client.request({ action: 'identityStepUpVerify', ref, body: { challengeRef, code } }))
  }
  async startOperationWebAuthn(ref: string, challengeRef: string) {
    const v = parseMfaWebAuthnStartResult(await this.client.request({ action: 'identityWebAuthnStart', ref, body: { challengeRef } }))
    return { requestId: v.requestRef, publicKey: v.publicKey }
  }
  async verifyOperationWebAuthn(ref: string, challengeRef: string, requestRef: string, credential: string) {
    return safeOperation(await this.client.request({ action: 'identityWebAuthnVerify', ref, body: { challengeRef, requestRef, credential } }))
  }
  async challenge(ref: string, targetProofMethod: TargetProofMethod) { return safeOperation(await this.client.request({ action: 'identityChallenge', ref, body: { targetProofMethod } })) }
  async complete(ref: string, body: CompleteIdentityOperation) { return safeOperation(await this.client.request({ action: 'identityComplete', ref, body })) }
  async cancel(ref: string) { return safeOperation(await this.client.request({ action: 'identityCancel', ref })) }
  async confirmTransfer(ref: string, decision: 'ACCEPT' | 'REJECT') { return safeOperation(await this.client.request({ action: 'identityTransfer', ref, body: { decision } })) }
  async openProvider(ref: string, purpose: import('@axis-iam/vertex').IdentityProofPurpose, methodId?: string) {
    const v = record(await this.client.request({ action: 'identityAuthorize', ref, body: { purpose, ...(methodId ? { methodId } : {}) } }))
    if (v.ref !== ref) throw new IamConfigurationError('Operation ref mismatch')
    return { ref, authorizationUrl: text(v.authorizationUrl), expiresAt: text(v.expiresAt) }
  }
  async startAccountDeletion(version: number, key: string, proof?: OperationReauthentication) {
    const op = safeOperation(await this.client.request({ action: 'identityCreate', body: { type: 'ACCOUNT_DELETE', expectedLoginMethodVersion: version, payload: {} }, idempotencyKey: key }))
    return proof ? this.reauthenticate(op.ref, proof) : op
  }
  async completeAccountDeletion(ref: string) { return this.complete(ref, { proofs: [] }) }
  async startStepUp(trigger: 'LOGIN_METHOD_CHANGE' | 'ACCOUNT_DELETE' = 'LOGIN_METHOD_CHANGE') {
    const challenge = await this.client.startStepUp(trigger, trigger)
    return { challengeId: challenge.ref, availableMethods: challenge.availableMethods.filter((m): m is 'totp' | 'webauthn' => m === 'totp' || m === 'webauthn') }
  }
  async verifyStepUp(challengeId: string, code: string) {
    const v = record(await this.client.request({ action: 'stepUpVerify', body: { ref: challengeId, code } }))
    if (v.verified !== true) throw new IamConfigurationError('Step-up was not verified')
    this.client.rememberIdentityPurpose(text(v.ref))
  }
  async startStepUpWebAuthn(challengeId: string) {
    const v = record(await this.client.request({ action: 'stepUpWebAuthn', body: { ref: challengeId } }))
    return { requestId: text(v.ref), publicKey: text(v.publicKey) }
  }
  async verifyStepUpWebAuthn(challengeId: string, _requestId: string, credential: string) {
    const v = record(await this.client.request({ action: 'stepUpWebAuthnVerify', body: { ref: challengeId, credential } }))
    if (v.verified !== true) throw new IamConfigurationError('Step-up was not verified')
    this.client.rememberIdentityPurpose(text(v.ref))
  }
  async startRegistration(input: StartRegistration, idempotencyKey: string): Promise<RegistrationOperation> {
    if (!['EMAIL', 'USERNAME'].includes(input.identifier.kind) || 'region' in input.identifier || 'organizationInvitationToken' in input) throw new UnsupportedOperationError()
    const proof = registrationGrantBody(input.registrationGrantToken !== undefined ? { type: 'EMAIL_LINK', registrationGrantToken: input.registrationGrantToken } : input.registrationAccessCode !== undefined ? { type: 'ACCESS_CODE', registrationAccessCode: input.registrationAccessCode } : undefined)
    if (input.registrationGrantToken !== undefined && input.registrationAccessCode !== undefined) throw new IamConfigurationError('Choose one registration proof')
    return this.registration(await this.client.request({ action: 'registrationStart', body: { identifier: input.identifier, password: input.password, ...(input.uiLocales !== undefined ? { uiLocales: input.uiLocales } : {}), ...proof }, idempotencyKey }))
  }
  private registration(value: unknown) {
    const v = record(value)
    return parseRegistration({ ...v, registrationId: text(v.ref) })
  }
  async getRegistration(ref: string) { return this.registration(await this.client.request({ action: 'registrationGet', ref })) }
  async registrationAction(ref: string, action: 'complete' | 'challenges' | 'cancel', code?: string) {
    const request: SessionRequest = action === 'complete' ? { action: 'registrationComplete', ref, body: { code: text(code) } } : { action: action === 'challenges' ? 'registrationChallenge' : 'registrationCancel', ref }
    return this.registration(await this.client.request(request))
  }
}
