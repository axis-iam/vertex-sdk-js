import { SessionInvalidatedError, SessionLifecycle } from '../session-lifecycle.js'
import type { SessionInvalidationReason } from '../session-lifecycle.js'
import { parseCurrentUser } from './current-user.js'
import type { CurrentUser } from './current-user.js'
import type { AuthenticationTransaction, AuthenticationView, PrimaryAuthentication, MfaProofMethod, PrimaryProofMethod } from './authentication-transaction.js'
import type { LoginIdentifier } from './identity.js'
import { providerAuthorization, SessionTransportError } from './session-transport.js'
import type { SessionRequest, SessionTransport, ProviderRegistrationProof } from './session-transport.js'

export type LoginView = Omit<AuthenticationView, 'transactionId'>
export type AuthenticationFlow = Pick<AuthenticationTransaction, 'invalidate' | 'persistForNavigation'> & {
  getSnapshot(): LoginView
  get(): Promise<LoginView>
  cancel(): Promise<LoginView>
  authenticate(input: PrimaryAuthentication): Promise<LoginView>
  challenge(method: PrimaryProofMethod, identifier: LoginIdentifier): Promise<{ expiresAt: string; challengeExpiresAt: string; cooldownSeconds: number }>
  verifyMfa(method: MfaProofMethod, code: string): Promise<LoginView>
  authenticateMagicLink(url: string, identifier: LoginIdentifier): Promise<LoginView>
  authorizeProvider(providerId: string, proof?: ProviderRegistrationProof): Promise<{ authorizationUrl: string; expiresAt: string }>
}
export type ServerSessionView =
  | { state: 'AUTHENTICATED'; expiresAt: string; csrfToken: string; owner: string; version: number; profile: CurrentUser; permissions: { roles: string[]; permissions: string[] } }
  | { state: string; expiresAt: string; csrfToken: string; nextAction?: LoginView['nextAction']; challengeExpiresAt?: string; cooldownSeconds?: number; authorizationUrl?: string }

export function sessionRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
  return value as Record<string, unknown>
}
export function sessionText(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(x => typeof x === 'string')) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
  return [...value]
}
const allowedStates = ['PRELOGIN', 'PENDING', 'IN_FLIGHT', 'RECOVERABLE', 'AUTHENTICATING', 'AWAITING_PROVIDER', 'MFA_REQUIRED', 'AUTHENTICATED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED']
export function parseServerSession(value: unknown): ServerSessionView {
  const v = sessionRecord(value)
  if (Object.keys(v).some(k => !['state', 'expiresAt', 'csrfToken', 'owner', 'version', 'profile', 'permissions', 'nextAction', 'challengeExpiresAt', 'cooldownSeconds', 'authorizationUrl'].includes(k)) ||
    !allowedStates.includes(String(v.state)) || !Number.isFinite(Date.parse(sessionText(v.expiresAt))) ||
    !/^[A-Za-z0-9_-]{43}$/.test(sessionText(v.csrfToken))) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
  const base = { state: sessionText(v.state), expiresAt: sessionText(v.expiresAt), csrfToken: sessionText(v.csrfToken) }
  if (v.profile !== undefined) {
    const p = sessionRecord(v.permissions)
    const profile = parseCurrentUser(v.profile)
    if (v.state !== 'AUTHENTICATED' || !/^[A-Za-z0-9_-]{43}$/.test(sessionText(v.owner)) ||
      !Number.isSafeInteger(v.version) || Number(v.version) < 0) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
    // Portal permission envelopes carry context; Admin's safe view carries platform roles.
    if (p.applicationId !== undefined && (p.applicationId !== profile.authenticationContext.applicationId || p.organizationId !== profile.authenticationContext.organizationId))
      throw new SessionTransportError('SESSION_CONTEXT_MISMATCH')
    return { ...base, state: 'AUTHENTICATED', owner: sessionText(v.owner), version: Number(v.version), profile,
      permissions: { roles: strings(p.roles), permissions: strings(p.permissions) } }
  }
  if (v.owner !== undefined || v.version !== undefined || v.permissions !== undefined || v.state === 'AUTHENTICATED' && v.nextAction !== 'complete')
    throw new SessionTransportError('SESSION_RESPONSE_INVALID')
  const nextAction = v.nextAction
  if (nextAction !== undefined && !['authenticate', 'authorize', 'mfa', 'complete', 'none'].includes(String(nextAction))) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
  return { ...base, ...(nextAction !== undefined ? { nextAction: nextAction as LoginView['nextAction'] } : {}),
    ...(v.challengeExpiresAt !== undefined ? { challengeExpiresAt: sessionText(v.challengeExpiresAt) } : {}),
    ...(v.cooldownSeconds !== undefined ? { cooldownSeconds: Number(v.cooldownSeconds) } : {}),
    ...(v.authorizationUrl !== undefined ? { authorizationUrl: sessionText(v.authorizationUrl) } : {}) }
}

/** Browser holds only the safe view. The BFF owns PKCE, login control and session renewal. */
export class ServerSession {
  private readonly lifecycle = new SessionLifecycle<void>()
  private listeners = new Set<() => void>()
  private view: ServerSessionView | null = null
  private error: Error | null = null
  private loading = false
  constructor(readonly transport: SessionTransport, private readonly clientId?: string) {}
  get generation() { return this.lifecycle.generation }
  get invalidationReason() { return this.lifecycle.invalidationReason }
  assertCurrent(generation: number) { this.lifecycle.assertCurrent(generation) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private notify() { for (const listener of this.listeners) listener() }
  getSnapshot() { return this.view }
  getViewState() { return { status: this.error ? 'error' as const : this.view && Date.parse(this.view.expiresAt) <= Date.now() ? 'expired' as const : this.loading ? 'loading' as const : this.isAuthenticated() ? 'ready' as const : 'anonymous' as const, error: this.error, expiresAt: this.view ? Date.parse(this.view.expiresAt) : null } }
  isAuthenticated() { return !this.error && this.view !== null && 'profile' in this.view && Date.parse(this.view.expiresAt) > Date.now() }
  getUser(): CurrentUser | null { return this.isAuthenticated() && this.view && 'profile' in this.view ? this.view.profile : null }
  clear(reason: SessionInvalidationReason = 'cleared') { this.lifecycle.invalidate(reason); this.view = null; this.error = null; this.loading = false; this.notify() }
  dispose() { this.lifecycle.invalidate('disposed'); this.notify(); this.listeners.clear() }
  private apply(view: ServerSessionView) {
    if ('profile' in view && this.clientId !== undefined && view.profile.authenticationContext.clientId !== this.clientId) throw new SessionTransportError('SESSION_CONTEXT_MISMATCH')
    const previous = this.view
    if (previous && 'profile' in previous && !('profile' in view)) this.lifecycle.invalidate('replaced')
    if ('profile' in view && (!previous || !('profile' in previous) || previous.owner !== view.owner ||
      previous.profile.authenticationContext.workspaceId !== view.profile.authenticationContext.workspaceId ||
      previous.profile.authenticationContext.organizationId !== view.profile.authenticationContext.organizationId ||
      previous.profile.authenticationContext.sessionId !== view.profile.authenticationContext.sessionId ||
      previous.profile.id !== view.profile.id)) this.lifecycle.invalidate('replaced')
    if (previous && 'profile' in previous && 'profile' in view && previous.owner === view.owner && view.version < previous.version)
      throw new SessionInvalidatedError()
    this.view = view; this.error = null; this.loading = false
    this.lifecycle.scheduleAt(Date.parse(view.expiresAt), () => { this.clear() })
    this.notify()
  }
  async restore(): Promise<ServerSessionView> { return this.load('bootstrap') }
  async load(action: 'bootstrap' | 'session' | 'login' | 'complete' | 'workspace', body?: { workspaceId: string; owner: string; version: number }): Promise<ServerSessionView> {
    const generation = this.generation
    this.loading = true; this.error = null; this.notify()
    try {
      const request: SessionRequest = action === 'workspace' ? { action, body: body! } : { action }
      const view = parseServerSession(await this.transport.request(request))
      this.assertCurrent(generation); this.apply(view); return view
    } catch (error) {
      this.assertCurrent(generation)
      if (error instanceof SessionTransportError && error.status === 401) this.clear('unauthorized')
      this.error = error instanceof Error ? error : new SessionTransportError('SESSION_REQUEST_FAILED')
      this.loading = false; this.notify(); throw this.error
    }
  }
  async action(request: SessionRequest): Promise<unknown> {
    const generation = this.generation
    if (this.view && Date.parse(this.view.expiresAt) <= Date.now()) { this.clear(); throw new SessionInvalidatedError() }
    try {
      const result = await this.transport.request(request)
      this.assertCurrent(generation)
      return result
    } catch (error) {
      this.assertCurrent(generation)
      if (error instanceof SessionTransportError && error.status === 401) this.clear('unauthorized')
      throw error
    }
  }
  async loginAction(request: SessionRequest): Promise<ServerSessionView> {
    const raw = await this.action(request)
    const view = parseServerSession(raw); this.apply(view); return view
  }
  async logout(): Promise<void> {
    this.clear()
    const generation = this.generation
    await this.transport.request({ action: 'logout' }); this.assertCurrent(generation)
  }
  async cancelLogin(): Promise<void> {
    this.clear()
    const generation = this.generation
    await this.transport.request({ action: 'cancel' }); this.assertCurrent(generation)
  }
  async selectWorkspace(workspaceId: string) {
    if (!this.view || !('profile' in this.view)) throw new SessionTransportError('SESSION_REQUIRED')
    const { owner, version } = this.view
    this.lifecycle.invalidate(); this.notify()
    return this.load('workspace', { workspaceId, owner, version })
  }
}

export class SessionLogin implements AuthenticationFlow {
  private active = true
  private magicCallbackConsumed = false
  private readonly generation: number
  constructor(private readonly session: ServerSession) { this.generation = session.generation }
  private check() { if (!this.active) throw new SessionInvalidatedError(); this.session.assertCurrent(this.generation) }
  invalidate() { this.active = false }
  persistForNavigation() { this.check() }
  getSnapshot(): LoginView {
    this.check()
    const v = this.session.getSnapshot()
    if (!v) throw new SessionTransportError('SESSION_LOGIN_REQUIRED')
    return { expiresAt: v.expiresAt, state: v.state === 'PENDING' ? 'AUTHENTICATING' : v.state as LoginView['state'], nextAction: 'nextAction' in v && v.nextAction ? v.nextAction : 'authenticate' }
  }
  async get() { this.check(); await this.session.load('bootstrap'); return this.getSnapshot() }
  async cancel(): Promise<LoginView> {
    this.check(); this.active = false; await this.session.cancelLogin()
    return { state: 'CANCELLED', nextAction: 'none', expiresAt: new Date().toISOString() }
  }
  async authenticate(input: PrimaryAuthentication) { this.check(); await this.session.loginAction({ action: 'authenticate', body: input }); return this.getSnapshot() }
  async challenge(method: PrimaryProofMethod, identifier: LoginIdentifier) {
    this.check()
    const v = await this.session.loginAction({ action: 'challenge', body: { method, identifier } })
    if (!('challengeExpiresAt' in v) || !v.challengeExpiresAt || typeof v.cooldownSeconds !== 'number' || !Number.isFinite(v.cooldownSeconds) || v.cooldownSeconds < 0) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
    if (method === 'EMAIL_MAGIC_LINK') this.magicCallbackConsumed = false
    return { expiresAt: v.expiresAt, challengeExpiresAt: v.challengeExpiresAt, cooldownSeconds: v.cooldownSeconds }
  }
  async verifyMfa(method: MfaProofMethod, code: string) { this.check(); await this.session.loginAction({ action: 'mfa', body: { method, code } }); return this.getSnapshot() }
  async authorizeProvider(providerId: string, proof: ProviderRegistrationProof = {}) {
    this.check()
    const v = await this.session.loginAction({ action: 'authorize', body: providerAuthorization(providerId, proof) })
    if (!('authorizationUrl' in v) || !v.authorizationUrl) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
    const url = new URL(v.authorizationUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new SessionTransportError('SESSION_RESPONSE_INVALID')
    return { authorizationUrl: url.href, expiresAt: v.expiresAt }
  }
  async authenticateMagicLink(url: string, identifier: LoginIdentifier): Promise<LoginView> {
    this.check()
    const callback = new URL(url)
    const p = new URLSearchParams(callback.hash.slice(1))
    const keys = ['kind', 'method', 'auth_transaction_id', 'state', 'proof']
    if (this.magicCallbackConsumed || identifier.kind !== 'EMAIL' || callback.search || callback.username || callback.password || !['https:', 'http:'].includes(callback.protocol) ||
      (typeof location !== 'undefined' && callback.origin !== location.origin) ||
      [...p.keys()].some(k => !keys.includes(k)) || keys.some(k => p.getAll(k).length !== 1) ||
      p.get('kind') !== 'AUTH_PROOF' || p.get('method') !== 'EMAIL_MAGIC_LINK' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.get('auth_transaction_id') ?? '') ||
      ['state', 'proof'].some(k => !p.get(k)?.trim() || p.get(k)!.length > 128)) throw new SessionTransportError('AUTH_MAGIC_CALLBACK_INVALID')
    this.magicCallbackConsumed = true
    if (typeof window !== 'undefined' && window.location.href === url) window.history.replaceState(null, '', callback.pathname)
    await this.session.loginAction({ action: 'magic', body: { transactionId: p.get('auth_transaction_id')!, state: p.get('state')!, proof: p.get('proof')! } })
    return this.getSnapshot()
  }
}
