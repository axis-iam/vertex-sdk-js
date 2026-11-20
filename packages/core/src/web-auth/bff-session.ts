import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { parseCurrentUser, type CurrentUser } from '../client/current-user.js'
import { parseServerSession, type ServerSessionView } from '../client/server-session.js'
import { WebAuthClient, WebAuthError, type WebAuthClientConfig, type WebAuthTokenSet } from './web-auth-client.js'
import { BffError, type BffRecord, type BffSessionProvider, type BffLogin } from './session-provider.js'

export interface BffConfig extends Omit<WebAuthClientConfig, 'transactionStore' | 'sessionStore'> {
  provider: BffSessionProvider
  sessionIdleSeconds?: number
  refreshSkewSeconds?: number
  operationLeaseSeconds?: number
  upstreamTimeoutMs?: number
  requestBudgetMs?: number
  replicas?: number
  workers?: number
  passwordResetRedirectUri?: string
}
export interface BffResult { id: string; view: ServerSessionView }
export interface BffLogoutResult {
  local: 'INVALIDATED' | 'NOT_FOUND' | 'UNCONFIRMED'
  cookie: 'CLEARED'
  remote: 'SESSION_REVOKED' | 'REFRESH_FAMILY_REVOKED' | 'UNCONFIRMED' | 'NOT_ATTEMPTED'
  sso: 'NOT_REQUESTED'
}
const random = () => randomBytes(32).toString('base64url')
const iso = (n: number) => new Date(n).toISOString()
const finite = (n: number) => Number.isSafeInteger(n) && n > 0
const exact = (v: Record<string, unknown>, allowed: string[], required = allowed) => {
  if (Object.keys(v).some(k => !allowed.includes(k)) || required.some(k => !(k in v)))
    throw new BffError('VALIDATION_ERROR', 400)
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BffError('VALIDATION_ERROR', 400)
  return v as Record<string, unknown>
}
function wireObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BffError('IAM_RESPONSE_INVALID', 503)
  return v as Record<string, unknown>
}
function wireText(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 65536) throw new BffError('IAM_RESPONSE_INVALID', 503)
  return v
}
function text(v: unknown, max = 4096): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new BffError('VALIDATION_ERROR', 400)
  return v
}
function timestamp(v: unknown) {
  const value = wireText(v)
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new BffError('IAM_RESPONSE_INVALID', 503)
  const t = Date.parse(value)
  if (!Number.isFinite(t)) throw new BffError('IAM_RESPONSE_INVALID', 503)
  return t
}
function equal(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}
function identifier(value: unknown) {
  const v = object(value); exact(v, ['kind', 'value', 'region'], ['kind', 'value'])
  if (!['EMAIL', 'USERNAME', 'PHONE'].includes(String(v.kind))) throw new BffError('VALIDATION_ERROR', 400)
  return { kind: v.kind as 'EMAIL' | 'USERNAME' | 'PHONE', value: text(v.value, 320),
    ...(v.region !== undefined ? { region: v.region === null ? null : text(v.region, 8) } : {}) }
}
const unavailable = (): never => { throw new BffError('UNSUPPORTED_OPERATION', 400) }

/** Authentication algorithms only. HTTP routes and Cookie ownership live in adapters. */
export class BffSessionClient {
  private readonly protocol: WebAuthClient
  private readonly context = new AsyncLocalStorage<AbortSignal>()
  private readonly now: () => number
  private readonly fetch: typeof globalThis.fetch
  private readonly absoluteMs: number
  private readonly idleMs: number
  private readonly leaseMs: number
  private readonly skewMs: number
  readonly origin: string
  readonly successRedirect: string
  readonly postLogoutRedirect: string
  constructor(readonly config: BffConfig) {
    if (!config.provider || !['process', 'shared'].includes(config.provider.scope) ||
      !text(config.audience) || !finite(config.replicas ?? 1) || !finite(config.workers ?? 1) ||
      (config.provider.scope === 'process' && ((config.replicas ?? 1) !== 1 || (config.workers ?? 1) !== 1)))
      throw new BffError('CONFIGURATION_INVALID', 400)
    this.now = config.now ?? Date.now
    this.absoluteMs = (config.sessionTtlSeconds ?? 3600) * 1000
    this.idleMs = (config.sessionIdleSeconds ?? 3600) * 1000
    this.leaseMs = (config.operationLeaseSeconds ?? 15) * 1000
    this.skewMs = (config.refreshSkewSeconds ?? 30) * 1000
    if (![this.absoluteMs, this.idleMs, this.leaseMs, config.upstreamTimeoutMs ?? 5000, config.requestBudgetMs ?? 10000].every(finite) ||
      !Number.isSafeInteger(this.skewMs) || this.skewMs < 0)
      throw new BffError('CONFIGURATION_INVALID', 400)
    const implementation = config.fetch ?? globalThis.fetch
    this.fetch = async (url, init) => {
      const signals = [AbortSignal.timeout(config.upstreamTimeoutMs ?? 5000)]
      if (init?.signal) signals.push(init.signal)
      const request = this.context.getStore()
      if (request) signals.push(request)
      return implementation(url, { ...init, redirect: 'error', signal: AbortSignal.any(signals) })
    }
    // These stores are never used by protocol primitives. BFF has exactly one provider.
    this.protocol = new WebAuthClient({ ...config, fetch: this.fetch,
      transactionStore: { save: unavailable, consume: unavailable },
      sessionStore: { create: unavailable, read: unavailable, replace: unavailable, delete: unavailable },
    })
    this.origin = new URL(config.applicationOrigin).origin
    this.successRedirect = this.protocol.successRedirect
    this.postLogoutRedirect = this.protocol.postLogoutRedirect
    if (config.passwordResetRedirectUri && new URL(config.passwordResetRedirectUri).origin !== this.origin)
      throw new BffError('CONFIGURATION_INVALID', 400)
  }
  /** Adapters call once per incoming request; all dependent IAM calls share this budget. */
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const budget = AbortSignal.timeout(this.config.requestBudgetMs ?? 10000)
    return this.context.run(signal ? AbortSignal.any([budget, signal]) : budget, work)
  }
  private async store<T>(work: () => Promise<T>): Promise<T> {
    try { return await work() }
    catch (e) { if (e instanceof BffError) throw e; throw new BffError('SESSION_STORE_UNAVAILABLE', 503) }
  }
  private async read(id?: string) {
    if (!id) return null
    const r = await this.store(() => this.config.provider.read(id))
    if (r && (r.schemaVersion !== 1 || r.clientId !== this.config.clientId)) throw new BffError('SESSION_INVALIDATED', 401)
    if (r?.successorId) return null
    if (r && Math.min(r.absoluteExpiresAt, r.idleExpiresAt, r.login?.expiresAt ?? Infinity) <= this.now()) {
      await this.store(() => this.config.provider.invalidate(id)); return null
    }
    return r
  }
  private async required(id: string, wait = true): Promise<BffRecord> {
    const r = await this.read(id)
    if (!r) throw new BffError('SESSION_REQUIRED', 401)
    if (r.lifecycle !== 'READY') {
      if (!r.operation || r.operation.expiresAt <= this.now()) {
        await this.store(() => this.config.provider.invalidate(id))
        throw new BffError(r.kind === 'SESSION' ? 'REFRESH_UNCERTAIN' : 'AUTH_EXCHANGE_UNCERTAIN', 401)
      }
      if (wait) {
        // Bounded re-read only: never take over or resend a persisted intent.
        await new Promise<void>(resolve => setTimeout(resolve, 25))
        return this.required(id, false)
      }
      throw new BffError('SESSION_ACTION_PENDING', 409)
    }
    return r
  }
  private async commit(id: string, previous: BffRecord, changes: Partial<BffRecord>) {
    const next: BffRecord = { ...previous, ...changes, version: previous.version + 1 }
    if (await this.store(() => this.config.provider.compareAndSet(id, previous, next)) !== 'COMMITTED')
      throw new BffError('SESSION_ACTION_PENDING', 409)
    return next
  }
  private async claim(id: string, r: BffRecord) {
    const owned = await this.commit(id, r, { lifecycle: 'OWNED', operation: { fence: random(), expiresAt: this.now() + this.leaseMs } })
    return this.commit(id, owned, { lifecycle: 'SEND_INTENT' })
  }
  private async terminate(id: string, code: 'AUTH_EXCHANGE_UNCERTAIN' | 'REFRESH_UNCERTAIN'): Promise<never> {
    // Even on unavailable invalidate the persisted SEND_INTENT forbids replay.
    try { await this.store(() => this.config.provider.invalidate(id)) }
    catch (e) { if (!(e instanceof BffError)) throw e }
    throw new BffError(code, 401)
  }
  private async operationFailed(id: string, error: unknown, uncertain: 'AUTH_EXCHANGE_UNCERTAIN' | 'REFRESH_UNCERTAIN'): Promise<never> {
    // A known rejection/dependency result does not authorize replay. Invalidate
    // even when reporting 503; if storage is down the persisted intent still fences.
    try { await this.store(() => this.config.provider.invalidate(id)) }
    catch (failure) { if (!(failure instanceof BffError)) throw failure }
    if (error instanceof WebAuthError) {
      if (error.code === 'IAM_UNAVAILABLE' || error.code === 'DISCOVERY_FAILED')
        throw new BffError('IAM_UNAVAILABLE', 503)
      if (['OAUTH_INVALID_GRANT', 'OAUTH_INVALID_CLIENT', 'OAUTH_REQUEST_REJECTED'].includes(error.code))
        throw new BffError(error.code, 401)
    }
    if (error instanceof BffError && ['IAM_UNAVAILABLE', 'IAM_RESPONSE_INVALID'].includes(error.code) && error.status === 503)
      throw error
    throw new BffError(uncertain, 401)
  }
  private safe(r: BffRecord): ServerSessionView {
    return parseServerSession({
      state: r.kind === 'SESSION' ? 'AUTHENTICATED' : r.login?.stateName ?? 'PRELOGIN',
      expiresAt: iso(Math.min(r.absoluteExpiresAt, r.idleExpiresAt, r.login?.expiresAt ?? Infinity)), csrfToken: r.csrfToken,
      ...(r.kind === 'SESSION' ? { owner: r.owner, version: r.version, profile: r.profile, permissions: r.permissions } :
        r.login?.nextAction ? { nextAction: r.login.nextAction } : {}),
    })
  }
  async bootstrap(id?: string): Promise<BffResult> {
    const r = await this.read(id)
    if (r && id) return { id, view: r.kind === 'SESSION' ? await this.protect(id) : this.safe(await this.required(id)) }
    const now = this.now(), newId = random(), ttl = Math.min(this.config.transactionTtlSeconds ?? 600, 600) * 1000
    const record: BffRecord = { schemaVersion: 1, version: 0, kind: 'PRELOGIN', lifecycle: 'READY',
      createdAt: now, absoluteExpiresAt: now + ttl, idleExpiresAt: now + ttl,
      csrfToken: random(), owner: random(), clientId: this.config.clientId }
    if (await this.store(() => this.config.provider.create(newId, record)) !== 'COMMITTED')
      throw new BffError('SESSION_STORE_UNAVAILABLE', 503)
    const stored = await this.required(newId)
    return { id: newId, view: this.safe(stored) }
  }
  async session(id: string) { const r = await this.required(id); return r.kind === 'SESSION' ? this.protect(id) : this.safe(r) }
  async verifyCsrf(id: string, origin: unknown, csrf: unknown) {
    const r = await this.store(() => this.config.provider.read(id))
    // Logout may fence an in-flight operation, so this deliberately permits SEND_INTENT.
    if (!r || origin !== this.origin || typeof csrf !== 'string' || !equal(csrf, r.csrfToken))
      throw new BffError('SESSION_CSRF_INVALID', 403)
  }
  async hostedLogin(id: string) {
    const r = await this.required(id)
    if (r.kind !== 'PRELOGIN' || r.login) throw new BffError('SESSION_ACTION_PENDING', 409)
    const prepared = await this.protocol.prepareLogin()
    await this.commit(id, r, { login: { ...prepared.transaction, kind: 'HOSTED', stateName: 'AUTHENTICATING' } })
    return prepared.authorizationUrl
  }
  private prelogin(r: BffRecord): BffLogin {
    if (r.kind !== 'PRELOGIN' || !r.login || r.login.expiresAt <= this.now()) throw new BffError('SESSION_REQUIRED', 401)
    return r.login
  }
  async callback(id: string, query: URLSearchParams): Promise<{ id: string; redirectUrl: string }> {
    const r = await this.required(id), login = this.prelogin(r)
    if (['CANCELLED', 'COMPLETED', 'EXPIRED', 'REJECTED'].includes(login.stateName))
      throw new BffError('AUTH_CALLBACK_INVALID', 400)
    if (login.kind === 'CUSTOM' && login.stateName !== 'AWAITING_PROVIDER') throw new BffError('AUTH_CALLBACK_INVALID', 400)
    const keys = [...query.keys()]
    const branch = query.has('code') ? ['code', 'state'] : query.has('kind') ? ['kind', 'auth_transaction_id', 'state'] : ['error', 'state']
    if (keys.length !== branch.length || keys.some(k => !branch.includes(k)) || branch.some(k => query.getAll(k).length !== 1) ||
      !equal(text(query.get('state')), login.state)) throw new BffError('AUTH_CALLBACK_INVALID', 400)
    if (query.has('error')) {
      const claimed = await this.claim(id, r)
      await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined,
        absoluteExpiresAt: Math.min(r.absoluteExpiresAt, this.now() + 60_000),
        idleExpiresAt: Math.min(r.idleExpiresAt, this.now() + 60_000),
        login: { ...login, stateName: 'CANCELLED', nextAction: 'none', codeVerifier: '',
          controlSecret: undefined, nonce: undefined, transactionId: undefined } })
      return { id, redirectUrl: this.successRedirect }
    }
    if (query.has('kind')) {
      if (login.kind !== 'CUSTOM' || query.get('kind') !== 'AUTH_CONTINUATION' || query.get('auth_transaction_id') !== login.transactionId)
        throw new BffError('AUTH_CALLBACK_INVALID', 400)
      const claimed = await this.claim(id, r)
      try {
        const v = await this.transaction(login, 'GET', '')
        if (v.state !== 'MFA_REQUIRED' || v.nextAction !== 'mfa') throw new BffError('AUTH_CALLBACK_INVALID', 400)
        await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined, login: this.updatedLogin(login, v) })
        return { id, redirectUrl: this.successRedirect }
      } catch (e) {
        // This is a controlled GET, not a code exchange. Dependency failure
        // must stay a service error and does not establish invalid authentication.
        await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined })
        throw e
      }
    }
    const claimed = await this.claim(id, r)
    const result = await this.exchange(id, claimed, text(query.get('code')))
    return { id: result.id, redirectUrl: this.successRedirect }
  }
  private async exchange(id: string, claimed: BffRecord, code: string): Promise<BffResult> {
    try {
      const login = this.prelogin(claimed)
      const tokens = await this.protocol.exchangeAuthorizationCode(code, login)
      const identity = await this.identity(tokens)
      const now = this.now(), newId = random()
      const record: BffRecord = { schemaVersion: 1, version: 0, kind: 'SESSION', lifecycle: 'READY',
        owner: random(), csrfToken: random(), clientId: this.config.clientId, createdAt: now,
        absoluteExpiresAt: Math.min(now + this.absoluteMs, identity.absolute),
        idleExpiresAt: Math.min(now + this.idleMs, identity.idle), tokens: { ...tokens, expiresAt: Math.min(tokens.expiresAt, identity.access) },
        profile: identity.profile, permissions: identity.permissions }
      if (await this.store(() => this.config.provider.rotate(id, claimed, newId, record)) !== 'COMMITTED')
        throw new BffError('SESSION_STORE_UNAVAILABLE', 503)
      return { id: newId, view: this.safe(await this.required(newId)) }
    } catch (error) { return this.operationFailed(id, error, 'AUTH_EXCHANGE_UNCERTAIN') }
  }
  private async iam(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {},
    errorContext: 'session' | 'transaction' = 'session'): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetch(new URL(path, this.config.issuer), {
        method, headers: { accept: 'application/json', ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch { throw new BffError('IAM_UNAVAILABLE', 503) }
    if (!response.ok) {
      if (response.status >= 500) throw new BffError('IAM_UNAVAILABLE', 503)
      let value: unknown
      try { value = await response.json() } catch { throw new BffError('IAM_RESPONSE_INVALID', 503) }
      const error = wireObject(value)
      const retry = response.headers.get('retry-after')
      const seconds = retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : undefined
      if (response.status === 429) throw new BffError('RATE_LIMITED', 429, seconds)
      if (response.status === 401 && errorContext === 'session') throw new BffError('SESSION_INVALIDATED', 401)
      if (typeof error.error === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.error))
        throw new BffError(error.error, response.status)
      throw new BffError('IAM_RESPONSE_INVALID', 503)
    }
    if (response.status === 204) return undefined
    try { return wireObject(await response.json()) } catch { throw new BffError('IAM_RESPONSE_INVALID', 503) }
  }
  private async identity(tokens: WebAuthTokenSet, expected?: CurrentUser) {
    const headers = { authorization: `Bearer ${tokens.accessToken}` }
    let profile: CurrentUser
    try {
      const raw = wireObject(await this.iam('/api/v1/auth/me', 'GET', undefined, headers))
      const context = wireObject(raw.authenticationContext)
      // IAM may omit nullable Jackson fields. Normalize only the documented nullables.
      const nullable = ['workspaceId', 'organizationId', 'organizationSlug', 'organizationRole', 'authTime', 'assuranceLevel', 'impersonation']
      profile = parseCurrentUser({ ...raw, email: raw.email ?? null, username: raw.username ?? null,
        authenticationContext: { ...context, ...Object.fromEntries(nullable.map(key => [key, context[key] ?? null])) } })
    }
    catch (e) { if (e instanceof BffError) throw e; throw new BffError('IAM_RESPONSE_INVALID', 503) }
    const c = profile.authenticationContext
    if (c.clientId !== this.config.clientId || (expected && (profile.id !== expected.id ||
      c.applicationId !== expected.authenticationContext.applicationId || c.sessionId !== expected.authenticationContext.sessionId)))
      throw new BffError('SESSION_INVALIDATED', 401)
    const permissions = wireObject(await this.iam('/api/v1/auth/me/permissions', 'GET', undefined, headers))
    if (permissions.applicationId !== c.applicationId || permissions.organizationId !== c.organizationId ||
      !Array.isArray(permissions.roles) || !permissions.roles.every(v => typeof v === 'string') ||
      !Array.isArray(permissions.permissions) || !permissions.permissions.every(v => typeof v === 'string'))
      throw new BffError('IAM_RESPONSE_INVALID', 503)
    const validity = wireObject(await this.iam('/api/v1/auth/session/validity', 'GET', undefined, headers))
    if (validity.sessionId !== c.sessionId || validity.clientId !== c.clientId || validity.applicationId !== c.applicationId)
      throw new BffError('SESSION_INVALIDATED', 401)
    const absolute = timestamp(validity.expiresAt), idle = timestamp(validity.idleExpiresAt), access = timestamp(validity.accessExpiresAt)
    if (Math.min(absolute, idle, access) <= this.now()) throw new BffError('SESSION_INVALIDATED', 401)
    return { profile, permissions: { roles: permissions.roles as string[], permissions: permissions.permissions as string[] }, absolute, idle, access }
  }
  async protect(id: string): Promise<Extract<ServerSessionView, { profile: CurrentUser }>> {
    let r = await this.required(id)
    if (r.kind !== 'SESSION' || !r.tokens || !r.profile) throw new BffError('SESSION_REQUIRED', 401)
    if (r.tokens.expiresAt <= this.now() + this.skewMs && r.tokens.refreshToken) {
      const claimed = await this.claim(id, r)
      try {
        const tokens = await this.protocol.rotateTokens(r.tokens)
        r = await this.commit(id, claimed, { tokens, lifecycle: 'READY', operation: undefined })
      } catch (e) {
        return this.operationFailed(id, e, 'REFRESH_UNCERTAIN')
      }
    }
    if (!r.tokens || r.tokens.expiresAt <= this.now()) {
      await this.store(() => this.config.provider.invalidate(id)); throw new BffError('SESSION_INVALIDATED', 401)
    }
    try {
      const identity = await this.identity(r.tokens, r.profile)
      r = await this.commit(id, r, { profile: identity.profile, permissions: identity.permissions,
        absoluteExpiresAt: Math.min(r.absoluteExpiresAt, identity.absolute),
        idleExpiresAt: Math.min(r.absoluteExpiresAt, identity.idle, this.now() + this.idleMs),
        tokens: { ...r.tokens, expiresAt: Math.min(r.tokens.expiresAt, identity.access) } })
    } catch (e) {
      if (e instanceof BffError && e.status === 401) await this.store(() => this.config.provider.invalidate(id))
      throw e
    }
    const view = this.safe(r)
    if (!('profile' in view)) throw new BffError('IAM_RESPONSE_INVALID', 503)
    return view
  }
  async customLogin(id: string): Promise<ServerSessionView> {
    const r = await this.required(id)
    if (r.kind !== 'PRELOGIN' || r.login) throw new BffError('SESSION_ACTION_PENDING', 409)
    const { transaction } = await this.protocol.prepareLogin()
    const claimed = await this.claim(id, r)
    try {
      const v = wireObject(await this.iam('/api/v1/auth/transactions', 'POST', {
        client_id: this.config.clientId, entryMode: 'CUSTOM', redirect_uri: this.config.redirectUri,
        scope: (this.config.scopes ?? ['openid', 'profile', 'email', 'offline_access']).join(' '),
        state: transaction.state, code_challenge: createHash('sha256').update(transaction.codeVerifier).digest('base64url'),
        code_challenge_method: 'S256', ...(transaction.nonce ? { nonce: transaction.nonce } : {}),
      }))
      const login: BffLogin = { ...transaction, kind: 'CUSTOM', transactionId: wireText(v.transactionId),
        controlSecret: wireText(v.controlSecret), stateName: 'AUTHENTICATING', nextAction: 'authenticate',
        expiresAt: Math.min(transaction.expiresAt, timestamp(v.expiresAt)) }
      return this.safe(await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined, login }))
    } catch (e) {
      await this.store(() => this.config.provider.invalidate(id))
      throw e
    }
  }
  private async transaction(login: BffLogin, method: string, suffix: string, body?: unknown, key = random()) {
    if (!login.transactionId || !login.controlSecret) throw new BffError('SESSION_REQUIRED', 401)
    return wireObject(await this.iam('/api/v1/auth/transactions/' + encodeURIComponent(login.transactionId) + suffix, method, body, {
      'Authentication-Transaction': login.controlSecret, ...(method !== 'GET' ? { 'Idempotency-Key': key } : {}),
    }, 'transaction'))
  }
  private updatedLogin(login: BffLogin, v: Record<string, unknown>): BffLogin {
    const pairs: Record<string, string> = { AUTHENTICATING: 'authenticate', AWAITING_PROVIDER: 'authorize',
      MFA_REQUIRED: 'mfa', AUTHENTICATED: 'complete', COMPLETED: 'none', CANCELLED: 'none', EXPIRED: 'none', REJECTED: 'none' }
    if (v.transactionId !== login.transactionId || typeof v.state !== 'string' || pairs[v.state] !== v.nextAction)
      throw new BffError('IAM_RESPONSE_INVALID', 503)
    return { ...login, stateName: v.state, nextAction: v.nextAction as BffLogin['nextAction'],
      expiresAt: Math.min(login.expiresAt, timestamp(v.expiresAt)) }
  }
  async loginAction(id: string, action: string, raw: unknown): Promise<BffResult> {
    const r = await this.required(id), login = this.prelogin(r), body = object(raw)
    if (['CANCELLED', 'EXPIRED', 'REJECTED'].includes(login.stateName)) {
      if (action !== 'cancel') throw new BffError('SESSION_REQUIRED', 401)
      exact(body, [])
      await this.store(() => this.config.provider.invalidate(id))
      return { id, view: { state: 'CANCELLED', nextAction: 'none', csrfToken: r.csrfToken, expiresAt: iso(this.now()) } }
    }
    if (login.kind !== 'CUSTOM') throw new BffError('UNSUPPORTED_OPERATION', 400)
    let suffix: string, input: unknown = body, nextIdentifier = login.identifier
    switch (action) {
      case 'authenticate':
        if (body.method === 'PASSWORD') { exact(body, ['method', 'identifier', 'password']); text(body.password, 1024) }
        else if (['EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'].includes(String(body.method))) {
          exact(body, ['method', 'identifier', 'proof']); text(body.proof, 128)
        } else throw new BffError('VALIDATION_ERROR', 400)
        nextIdentifier = identifier(body.identifier); suffix = '/authenticate'; break
      case 'challenges':
        exact(body, ['method', 'identifier'])
        if (!['EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'].includes(String(body.method))) throw new BffError('VALIDATION_ERROR', 400)
        nextIdentifier = identifier(body.identifier); suffix = '/challenges'; break
      case 'authorize':
        exact(body, ['providerId', 'registrationGrantToken', 'registrationAccessCode'], ['providerId'])
        if (!/^[0-9a-f-]{36}$/i.test(text(body.providerId)) ||
          (body.registrationGrantToken !== undefined && body.registrationAccessCode !== undefined)) throw new BffError('VALIDATION_ERROR', 400)
        if (body.registrationGrantToken !== undefined) text(body.registrationGrantToken, 2048)
        if (body.registrationAccessCode !== undefined) text(body.registrationAccessCode, 128)
        suffix = '/authorize'; break
      case 'mfa':
        exact(body, ['method', 'code'])
        if (!['TOTP', 'RECOVERY_CODE'].includes(String(body.method))) throw new BffError('VALIDATION_ERROR', 400)
        text(body.code, 128); suffix = '/mfa'; break
      case 'magic':
        exact(body, ['transactionId', 'state', 'proof'])
        if (login.magicConsumed || body.transactionId !== login.transactionId || body.state !== login.state || login.identifier?.kind !== 'EMAIL')
          throw new BffError('AUTH_CALLBACK_INVALID', 400)
        input = { method: 'EMAIL_MAGIC_LINK', identifier: login.identifier, proof: text(body.proof, 128) }
        suffix = '/authenticate'; break
      case 'complete': case 'cancel': exact(body, []); suffix = '/' + action; break
      default: throw new BffError('UNSUPPORTED_OPERATION', 400)
    }
    const claimed = await this.claim(id, r)
    try {
      const v = await this.transaction(login, 'POST', suffix, input, claimed.operation!.fence)
      if (action === 'complete') {
        if (v.kind !== 'authorization_code' || v.state !== login.state || !Number.isSafeInteger(v.expiresIn) || Number(v.expiresIn) < 0)
          throw new BffError('IAM_RESPONSE_INVALID', 503)
        return this.exchange(id, claimed, wireText(v.code))
      }
      if (action === 'cancel') {
        await this.store(() => this.config.provider.invalidate(id))
        return { id, view: { state: 'CANCELLED', nextAction: 'none', csrfToken: r.csrfToken, expiresAt: iso(this.now()) } }
      }
      let updated: BffLogin = { ...login, identifier: nextIdentifier,
        ...(action === 'magic' ? { magicConsumed: true } : {}),
        ...(action === 'challenges' && body.method === 'EMAIL_MAGIC_LINK' ? { magicConsumed: false } : {}) }
      const extra: Record<string, unknown> = {}
      if (action === 'authorize') {
        const url = new URL(wireText(v.authorizationUrl))
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
          (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new BffError('IAM_RESPONSE_INVALID', 503)
        updated = { ...updated, stateName: 'AWAITING_PROVIDER', nextAction: 'authorize',
          expiresAt: Math.min(login.expiresAt, timestamp(v.expiresAt)) }
        extra.authorizationUrl = url.href
      } else if (action === 'challenges') {
        if (v.transactionId !== login.transactionId || !Number.isSafeInteger(v.cooldownSeconds) || Number(v.cooldownSeconds) < 0)
          throw new BffError('IAM_RESPONSE_INVALID', 503)
        extra.challengeExpiresAt = iso(timestamp(v.challengeExpiresAt)); extra.cooldownSeconds = v.cooldownSeconds
      } else updated = this.updatedLogin(updated, v)
      const committed = await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined, login: updated })
      return { id, view: parseServerSession({ ...this.safe(committed), ...extra }) }
    } catch (e) {
      if (action === 'complete') return this.terminate(id, 'AUTH_EXCHANGE_UNCERTAIN')
      if (e instanceof BffError && e.status >= 400 && e.status < 500) {
        await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined })
        throw e
      }
      return this.terminate(id, 'AUTH_EXCHANGE_UNCERTAIN')
    }
  }
  async capabilities(which: 'auth-methods' | 'auth-policy') {
    return this.iam('/api/v1/apps/' + encodeURIComponent(this.config.clientId) + '/' + which)
  }
  async registration(id: string, method: string, ref: string | undefined, action: string, raw: unknown, idempotencyKey?: string) {
    const r = await this.required(id), body = object(raw)
    let path = '/api/v1/auth/signup', input: unknown = body, headers: Record<string, string> = {}
    let registration = ref ? r.registrations?.[ref] : undefined
    if (ref) {
      if (!registration || registration.expiresAt <= this.now()) throw new BffError('SESSION_REQUIRED', 401)
      path += '/operations/' + encodeURIComponent(registration.id) + action
      headers = { 'Registration-Client': this.config.clientId }
      if (method === 'GET') headers['Registration-Control'] = text(registration.controlSecret)
      else {
        exact(body, action === '/complete' ? ['code'] : [])
        if (action === '/complete' && !/^\d{6}$/.test(text(body.code))) throw new BffError('VALIDATION_ERROR', 400)
        input = { ...body, controlSecret: text(registration.controlSecret) }
      }
    } else {
      exact(body, ['identifier', 'password', 'uiLocales', 'registrationGrantToken', 'registrationAccessCode'], ['identifier', 'password'])
      identifier(body.identifier); text(body.password, 128)
      if (body.registrationGrantToken !== undefined && body.registrationAccessCode !== undefined) throw new BffError('VALIDATION_ERROR', 400)
      input = { ...body, client_id: this.config.clientId }
      headers['Idempotency-Key'] = text(idempotencyKey, 128)
    }
    const claimed = await this.claim(id, r)
    try {
      const v = wireObject(await this.iam(path, method, method === 'GET' ? undefined : input, headers))
      const localRef = ref ?? random()
      if (registration && v.registrationId !== registration.id) throw new BffError('IAM_RESPONSE_INVALID', 503)
      registration = { id: wireText(v.registrationId), controlSecret: v.controlSecret == null ? registration?.controlSecret ?? null : wireText(v.controlSecret),
        expiresAt: timestamp(v.expiresAt) }
      if (v.status === 'PENDING_VERIFICATION' && !registration.controlSecret)
        throw new BffError('REGISTRATION_RESTART_REQUIRED', 401)
      await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined,
        registrations: { ...r.registrations, [localRef]: registration } })
      return { registrationId: localRef, status: wireText(v.status), expiresAt: iso(registration.expiresAt),
        nextAction: wireText(v.nextAction), nextChallengeAt: v.nextChallengeAt == null ? null : iso(timestamp(v.nextChallengeAt)) }
    } catch (e) {
      await this.commit(id, claimed, { lifecycle: 'READY', operation: undefined })
      throw e
    }
  }
  async passwordReset(action: 'request' | 'complete', raw: unknown) {
    const body = object(raw)
    if (action === 'request') {
      exact(body, ['email']); text(body.email, 320)
      await this.iam('/api/v1/auth/password/forgot', 'POST', { ...body, client_id: this.config.clientId,
        ...(this.config.passwordResetRedirectUri ? { redirect_uri: this.config.passwordResetRedirectUri } : {}) })
    } else {
      exact(body, ['token', 'newPassword']); text(body.token, 2048); text(body.newPassword, 128)
      await this.iam('/api/v1/auth/password/reset', 'POST', body, { 'Password-Reset-Client': this.config.clientId })
    }
  }
  async logout(id?: string): Promise<BffLogoutResult> {
    let captured: BffRecord | null = null
    let local: BffLogoutResult['local']
    try {
      captured = await this.read(id)
      const removed = id ? await this.store(() => this.config.provider.invalidate(id)) : null
      captured = removed ?? captured
      local = removed ? 'INVALIDATED' : 'NOT_FOUND'
    } catch (e) {
      if (!(e instanceof BffError)) throw e
      local = 'UNCONFIRMED'
    }
    const remote = captured?.tokens ? await this.protocol.revokeTokens(captured.tokens) : 'NOT_ATTEMPTED'
    return { local, cookie: 'CLEARED', remote, sso: 'NOT_REQUESTED' }
  }
}
