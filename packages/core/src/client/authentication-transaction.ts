import { providerAuthorization } from './session-transport.js'
import type { ProviderRegistrationProof } from './session-transport.js'
import {
  PendingAuthorizationStore,
  authorizationCallback,
} from './pending-authorization.js'
import type { LoginIdentifier } from './identity.js'

export type PrimaryProofMethod = 'EMAIL_OTP' | 'SMS_OTP' | 'EMAIL_MAGIC_LINK'
export type MfaProofMethod = 'TOTP' | 'RECOVERY_CODE'
export type PrimaryAuthentication =
  | { method: 'PASSWORD'; identifier: LoginIdentifier; password: string }
  | { method: PrimaryProofMethod; identifier: LoginIdentifier; proof: string }
export interface AuthenticationView {
  transactionId: string
  state:
    | 'AUTHENTICATING'
    | 'AWAITING_PROVIDER'
    | 'MFA_REQUIRED'
    | 'AUTHENTICATED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'REJECTED'
  expiresAt: string
  nextAction: 'authenticate' | 'authorize' | 'mfa' | 'complete' | 'none'
}
export interface AuthenticationChallenge {
  transactionId: string
  expiresAt: string
  challengeExpiresAt: string
  cooldownSeconds: number
  nextAction: 'authenticate'
}
export interface AuthenticationTokens {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
}
export interface AuthenticationTransactionConfig {
  issuer: string
  tokenEndpoint: string
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  /** Bind this flow to its host's account/generation. Called before and after I/O. */
  assertOwner?: () => void
}
export class AuthenticationTransactionError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      code === 'TOKEN_EXCHANGE_UNCERTAIN'
        ? 'The token exchange result is unknown. Start sign-in again.'
        : `Authentication could not continue: ${code}`,
    )
    this.name = 'AuthenticationTransactionError'
  }
}

interface Pending {
  version: 1
  issuer: string
  clientId: string
  redirectUri: string
  entryMode: 'CUSTOM'
  flowOwner: string
  transactionId: string
  controlSecret: string
  verifier: string
  state: string
  expiresAt: string
}
const random = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
function fail(code: string): never {
  throw new AuthenticationTransactionError(code)
}

/** Public Custom login protocol. Embedded and Dialog use this same transaction. */
export class AuthenticationTransaction {
  private revision = 0
  private invalid = false
  private navigationSaved = false
  private exchangeStarted = false
  private providerCallbackConsumed = false
  private flight: {
    action: string
    body: string
    promise: Promise<unknown>
  } | null = null
  private uncertain: { action: string; body: string; key: string } | null = null
  private view: AuthenticationView

  private constructor(
    private readonly config: AuthenticationTransactionConfig,
    private readonly pending: Pending,
  ) {
    this.config = { ...config, scopes: [...config.scopes] }
    this.view = {
      transactionId: pending.transactionId,
      state: 'AUTHENTICATING',
      expiresAt: pending.expiresAt,
      nextAction: 'authenticate',
    }
  }

  static async start(
    config: AuthenticationTransactionConfig,
  ): Promise<AuthenticationTransaction> {
    config = { ...config, scopes: [...config.scopes] }
    validateConfig(config)
    config.assertOwner?.()
    const verifier = random()
    const state = random()
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(verifier),
    )
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    config.assertOwner?.()
    const data = record(
      await send(new URL('/api/v1/auth/transactions', config.issuer).href, {
        client_id: config.clientId,
        entryMode: 'CUSTOM',
        redirect_uri: config.redirectUri,
        scope: config.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...(config.scopes.includes('openid') ? { nonce: random() } : {}),
      }),
    )
    config.assertOwner?.()
    const expiresAt = timestamp(data.expiresAt)
    if (
      Date.parse(expiresAt) <= Date.now() ||
      data.nextAction !== 'authenticate'
    )
      fail('AUTH_TRANSACTION_INVALID_RESPONSE')
    const controlSecret = secret(data.controlSecret)
    return new AuthenticationTransaction(config, {
      version: 1,
      issuer: config.issuer,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      entryMode: 'CUSTOM',
      flowOwner: random(),
      transactionId: text(data.transactionId),
      controlSecret,
      verifier,
      state,
      expiresAt,
    })
  }

  /** A fragment is proof only. Original tab control and an exact callback binding are required. */
  static restoreMagicLink(
    config: AuthenticationTransactionConfig,
    url: string,
  ): AuthenticationTransaction {
    validateConfig(config)
    config.assertOwner?.()
    const p = PendingAuthorizationStore.read({ ...config, entryMode: 'CUSTOM' })
    const pending: Pending = {
      ...p,
      entryMode: 'CUSTOM',
      transactionId: text(p.transactionId),
      controlSecret: secret(p.controlSecret),
    }
    const result = new AuthenticationTransaction(config, pending)
    result.navigationSaved = true
    result.assertActive()
    result.magicProof(url)
    result.removePending()
    return result
  }

  static discardNavigation(
    config: Pick<AuthenticationTransactionConfig, 'issuer' | 'clientId'>,
  ): void {
    PendingAuthorizationStore.discard(config)
  }

  getSnapshot(): AuthenticationView {
    if (Date.now() >= Date.parse(this.pending.expiresAt)) {
      this.invalidate()
      return { ...this.view, state: 'EXPIRED', nextAction: 'none' }
    }
    return { ...this.view }
  }

  /** Explicit short-lived navigation storage: no identifiers, password, proof or ordinary tokens. */
  persistForNavigation(): void {
    this.assertActive()
    PendingAuthorizationStore.save(this.pending)
    this.navigationSaved = true
  }

  invalidate(preserveNavigation = false): void {
    this.invalid = true
    this.revision++
    this.uncertain = null
    if (!preserveNavigation) this.removePending()
    this.pending.controlSecret = ''
    this.pending.verifier = ''
  }

  get(): Promise<AuthenticationView> {
    return this.run('get', undefined, false, (data) => this.applyView(data))
  }

  challenge(
    method: PrimaryProofMethod,
    identifier: LoginIdentifier,
  ): Promise<AuthenticationChallenge> {
    this.requireState('AUTHENTICATING')
    return this.run('challenges', { method, identifier }, false, (data) => {
      const d = record(data)
      this.assertBinding(d)
      const challengeExpiresAt = timestamp(d.challengeExpiresAt)
      if (
        Date.parse(challengeExpiresAt) > Date.parse(this.pending.expiresAt) ||
        Date.parse(challengeExpiresAt) <= Date.now() ||
        !Number.isSafeInteger(d.cooldownSeconds) ||
        typeof d.cooldownSeconds !== 'number' ||
        d.cooldownSeconds < 0 ||
        d.nextAction !== 'authenticate'
      )
        return fail('AUTH_TRANSACTION_INVALID_RESPONSE')
      return {
        transactionId: this.pending.transactionId,
        expiresAt: this.pending.expiresAt,
        challengeExpiresAt,
        cooldownSeconds: d.cooldownSeconds,
        nextAction: 'authenticate',
      }
    })
  }

  authenticate(input: PrimaryAuthentication): Promise<AuthenticationView> {
    this.requireState('AUTHENTICATING')
    return this.run(
      'authenticate',
      input,
      input.method !== 'PASSWORD',
      (data) => this.applyView(data),
    )
  }

  authenticateMagicLink(
    url: string,
    identifier: LoginIdentifier,
  ): Promise<AuthenticationView> {
    this.assertActive()
    const proof = this.magicProof(url)
    this.removePending()
    return this.authenticate({ method: 'EMAIL_MAGIC_LINK', identifier, proof })
  }

  verifyMfa(method: MfaProofMethod, code: string): Promise<AuthenticationView> {
    this.requireState('MFA_REQUIRED')
    return this.run('mfa', { method, code }, true, (data) =>
      this.applyView(data),
    )
  }

  /** Complete idempotently, then send the code exactly once. Concurrent callers share one flight. */
  exchange(): Promise<AuthenticationTokens> {
    this.assertActive()
    if (
      this.view.state !== 'AUTHENTICATED' &&
      !(
        this.view.state === 'COMPLETED' &&
        this.uncertain?.action === 'complete' &&
        !this.exchangeStarted
      )
    )
      fail('AUTH_TRANSACTION_STATE_INVALID')
    return this.run('complete', {}, true, async (data) => {
      const d = record(data)
      if (
        d.kind !== 'authorization_code' ||
        d.state !== this.pending.state ||
        typeof d.expiresIn !== 'number' ||
        !Number.isSafeInteger(d.expiresIn) ||
        d.expiresIn <= 0
      )
        fail('AUTH_TRANSACTION_INVALID_RESPONSE')
      return this.exchangeCode(text(d.code))
    })
  }

  async authorizeProvider(
    providerId: string,
    proof: ProviderRegistrationProof = {},
  ): Promise<{ authorizationUrl: string; expiresAt: string }> {
    this.requireState('AUTHENTICATING')
    const body = providerAuthorization(text(providerId), proof)
    this.persistForNavigation()
    return this.run(
      'authorize',
      body,
      false,
      (data) => {
        const d = record(data),
          url = new URL(text(d.authorizationUrl)),
          expiresAt = timestamp(d.expiresAt)
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          Date.parse(expiresAt) <= Date.now() ||
          Date.parse(expiresAt) > Date.parse(this.pending.expiresAt)
        )
          fail('AUTH_TRANSACTION_INVALID_RESPONSE')
        this.view = {
          ...this.view,
          state: 'AWAITING_PROVIDER',
          nextAction: 'authorize',
        }
        return { authorizationUrl: url.href, expiresAt }
      },
    )
  }

  static restoreProvider(
    config: AuthenticationTransactionConfig,
    url: string,
  ): AuthenticationTransaction {
    validateConfig(config)
    config.assertOwner?.()
    const p = PendingAuthorizationStore.read({ ...config, entryMode: 'CUSTOM' })
    const result = new AuthenticationTransaction(config, {
      ...p,
      entryMode: 'CUSTOM',
      transactionId: text(p.transactionId),
      controlSecret: secret(p.controlSecret),
    })
    result.navigationSaved = true
    result.providerParameters(url)
    result.removePending()
    result.view = {
      ...result.view,
      state: 'AWAITING_PROVIDER',
      nextAction: 'authorize',
    }
    return result
  }

  async completeProviderCallback(
    url: string,
  ): Promise<AuthenticationView | AuthenticationTokens> {
    this.assertActive()
    const params = this.providerParameters(url)
    if (this.providerCallbackConsumed) fail('AUTH_CALLBACK_CONSUMED')
    this.providerCallbackConsumed = true
    this.removePending()
    const view = await this.get()
    if (params.get('kind') === 'AUTH_CONTINUATION') {
      if (view.state !== 'MFA_REQUIRED') fail('AUTH_TRANSACTION_STATE_INVALID')
      return view
    }
    if (view.state !== 'COMPLETED') fail('AUTH_TRANSACTION_STATE_INVALID')
    return this.exchangeCode(text(params.get('code')))
  }

  private providerParameters(url: string): URLSearchParams {
    const continuation = new URL(url).searchParams.has('kind')
    const params = authorizationCallback(
      url,
      this.pending.redirectUri,
      continuation
        ? ['kind', 'auth_transaction_id', 'state']
        : ['code', 'state'],
    )
    if (
      params.get('state') !== this.pending.state ||
      (continuation &&
        (params.get('kind') !== 'AUTH_CONTINUATION' ||
          params.get('auth_transaction_id') !== this.pending.transactionId))
    )
      fail('AUTH_CALLBACK_MISMATCH')
    return params
  }

  private async exchangeCode(code: string): Promise<AuthenticationTokens> {
    if (this.exchangeStarted) return fail('AUTH_TRANSACTION_ALREADY_EXCHANGED')
    this.exchangeStarted = true
    this.removePending()
    const revision = this.revision
    let raw: unknown
    try {
      raw = await send(
        this.config.tokenEndpoint,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          code,
          redirect_uri: this.pending.redirectUri,
          code_verifier: this.pending.verifier,
        }),
        undefined,
        undefined,
        true,
      )
      this.assertActive(revision)
      let tokens: AuthenticationTokens
      try {
        tokens = parseAuthenticationTokens(raw)
      } catch {
        throw new AuthenticationTransactionError('TOKEN_EXCHANGE_UNCERTAIN')
      }
      this.view = { ...this.view, state: 'COMPLETED', nextAction: 'none' }
      this.invalidate()
      return tokens
    } catch (error) {
      this.invalidate()
      throw error
    }
  }

  async cancel(): Promise<AuthenticationView> {
    this.assertActive()
    const url = this.endpoint('cancel'),
      control = this.pending.controlSecret
    this.invalidate()
    const data = record(await send(url, {}, control))
    this.config.assertOwner?.()
    this.assertBinding(data)
    if (data.state !== 'CANCELLED' || data.nextAction !== 'none')
      fail('AUTH_TRANSACTION_INVALID_RESPONSE')
    this.view = {
      transactionId: this.pending.transactionId,
      state: 'CANCELLED',
      expiresAt: this.pending.expiresAt,
      nextAction: 'none',
    }
    return { ...this.view }
  }

  private run<T>(
    action: string,
    input: object | undefined,
    idempotent: boolean,
    consume: (data: unknown) => T | Promise<T>,
  ): Promise<T> {
    this.assertActive()
    const body = input === undefined ? '' : JSON.stringify(input)
    if (this.flight) {
      if (this.flight.action !== action || this.flight.body !== body)
        return Promise.reject(
          new AuthenticationTransactionError('AUTH_TRANSACTION_BUSY'),
        )
      return this.flight.promise.then((value) => value as T)
    }
    if (
      this.uncertain &&
      action !== 'get' &&
      (this.uncertain.action !== action || this.uncertain.body !== body)
    )
      return Promise.reject(
        new AuthenticationTransactionError('AUTH_TRANSACTION_RETRY_REQUIRED'),
      )
    const key = this.uncertain?.key ?? random()
    const revision = this.revision
    const promise = Promise.resolve()
      .then(async () => {
        this.assertActive(revision)
        try {
          const data = await send(
            this.endpoint(action === 'get' ? undefined : action),
            input === undefined ? undefined : body,
            this.pending.controlSecret,
            idempotent ? key : undefined,
          )
          this.assertActive(revision)
          const result = await consume(data)
          if (action !== 'get' || this.uncertain?.action !== 'complete')
            this.uncertain = null
          return result
        } catch (error) {
          if (!this.invalid) {
            this.assertActive(revision)
            if (action === 'get') {
              /* A status read cannot consume the unresolved completion key. */
            } else if (
              error instanceof AuthenticationTransactionError &&
              error.code === 'AUTH_TRANSACTION_UNCERTAIN'
            )
              this.uncertain = { action, body, key }
            else if (action === 'complete') this.invalidate()
            else this.uncertain = null
          }
          throw error
        }
      })
      .finally(() => {
        if (this.flight?.promise === promise) this.flight = null
      })
    this.flight = { action, body, promise }
    return promise
  }

  private assertActive(revision = this.revision): void {
    try {
      this.config.assertOwner?.()
    } catch (error) {
      this.invalidate()
      throw error
    }
    if (this.invalid || revision !== this.revision)
      fail('AUTH_TRANSACTION_INVALIDATED')
    if (Date.now() >= Date.parse(this.pending.expiresAt)) {
      this.invalidate()
      fail('AUTH_TRANSACTION_EXPIRED')
    }
  }
  private requireState(state: AuthenticationView['state']): void {
    this.assertActive()
    if (this.view.state !== state) fail('AUTH_TRANSACTION_STATE_INVALID')
  }
  private assertBinding(d: Record<string, unknown>): void {
    if (
      d.transactionId !== this.pending.transactionId ||
      timestamp(d.expiresAt) !== this.pending.expiresAt
    )
      fail('AUTH_TRANSACTION_BINDING_MISMATCH')
  }
  private applyView(data: unknown): AuthenticationView {
    const d = record(data)
    this.assertBinding(d)
    const states = {
      AUTHENTICATING: 'authenticate',
      AWAITING_PROVIDER: 'authorize',
      MFA_REQUIRED: 'mfa',
      AUTHENTICATED: 'complete',
      COMPLETED: 'none',
      CANCELLED: 'none',
      EXPIRED: 'none',
      REJECTED: 'none',
    } as const
    if (
      typeof d.state !== 'string' ||
      !Object.prototype.hasOwnProperty.call(states, d.state)
    )
      return fail('AUTH_TRANSACTION_INVALID_RESPONSE')
    const state = d.state as AuthenticationView['state']
    if (d.nextAction !== states[state])
      return fail('AUTH_TRANSACTION_INVALID_RESPONSE')
    this.view = {
      transactionId: this.pending.transactionId,
      expiresAt: this.pending.expiresAt,
      state,
      nextAction: states[state],
    }
    if (['CANCELLED', 'EXPIRED', 'REJECTED'].includes(state)) this.invalidate()
    return { ...this.view }
  }
  private endpoint(action?: string): string {
    return new URL(
      `/api/v1/auth/transactions/${encodeURIComponent(this.pending.transactionId)}${action ? `/${action}` : ''}`,
      this.config.issuer,
    ).href
  }
  private magicProof(url: string): string {
    const callback = new URL(url)
    const params = new URLSearchParams(callback.hash.slice(1))
    callback.hash = ''
    const keys = [...params.keys()]
    if (
      callback.href !== this.pending.redirectUri ||
      keys.length !== 5 ||
      new Set(keys).size !== 5 ||
      !['kind', 'auth_transaction_id', 'method', 'state', 'proof'].every(
        (key) => params.has(key),
      ) ||
      params.get('kind') !== 'AUTH_PROOF' ||
      params.get('method') !== 'EMAIL_MAGIC_LINK' ||
      params.get('auth_transaction_id') !== this.pending.transactionId ||
      params.get('state') !== this.pending.state
    )
      return fail('AUTH_CALLBACK_MISMATCH')
    return text(params.get('proof'))
  }
  private removePending(): void {
    if (!this.navigationSaved) return
    PendingAuthorizationStore.remove(this.pending.flowOwner)
    this.navigationSaved = false
  }
}

function validateConfig(config: AuthenticationTransactionConfig): void {
  const issuer = new URL(config.issuer),
    token = new URL(config.tokenEndpoint),
    redirect = new URL(config.redirectUri)
  if (
    ![issuer, token, redirect].every(
      (url) =>
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash,
    ) ||
    issuer.origin !== token.origin ||
    !config.clientId.trim() ||
    config.scopes.length === 0 ||
    config.scopes.some((scope) => !scope || /\s/.test(scope)) ||
    new Set(config.scopes).size !== config.scopes.length
  )
    fail('AUTH_CONFIGURATION_INVALID')
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('AUTH_TRANSACTION_INVALID_RESPONSE')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    return fail('AUTH_TRANSACTION_INVALID_RESPONSE')
  return value
}
function secret(value: unknown): string {
  const s = text(value)
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(s))
    return fail('AUTH_CONTROL_LOST')
  return s
}
function timestamp(value: unknown): string {
  const s = text(value)
  if (!Number.isFinite(Date.parse(s)))
    return fail('AUTH_TRANSACTION_INVALID_RESPONSE')
  return s
}
export function parseAuthenticationTokens(data: unknown): AuthenticationTokens {
  const d = record(data)
  if (
    typeof d.expires_in !== 'number' ||
    !Number.isSafeInteger(d.expires_in) ||
    d.expires_in <= 0
  )
    fail('TOKEN_EXCHANGE_UNCERTAIN')
  const tokens: AuthenticationTokens = {
    access_token: text(d.access_token),
    token_type: text(d.token_type),
    expires_in: d.expires_in,
  }
  if (d.refresh_token !== undefined)
    tokens.refresh_token = text(d.refresh_token)
  if (d.id_token !== undefined) tokens.id_token = text(d.id_token)
  if (d.scope !== undefined)
    tokens.scope =
      typeof d.scope === 'string' ? d.scope : fail('TOKEN_EXCHANGE_UNCERTAIN')
  return tokens
}
async function send(
  url: string,
  body?: object | string,
  control?: string,
  key?: string,
  token = false,
): Promise<unknown> {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: abort.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined
          ? {
              'Content-Type':
                body instanceof URLSearchParams
                  ? 'application/x-www-form-urlencoded'
                  : 'application/json',
            }
          : {}),
        ...(control ? { 'Authentication-Transaction': control } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined
        ? {
            body:
              body instanceof URLSearchParams
                ? body.toString()
                : typeof body === 'string'
                  ? body
                  : JSON.stringify(body),
          }
        : {}),
    })
    if (!response.ok) {
      let code = 'AUTH_TRANSACTION_REJECTED'
      if (token)
        code =
          response.status >= 500
            ? 'TOKEN_EXCHANGE_UNCERTAIN'
            : 'TOKEN_EXCHANGE_REJECTED'
      else if (response.status >= 500) code = 'AUTH_TRANSACTION_UNCERTAIN'
      else {
        const error: unknown = await response.json().catch(() => null)
        if (
          error &&
          typeof error === 'object' &&
          'error' in error &&
          typeof error.error === 'string' &&
          /^[A-Z][A-Z0-9_]{0,127}$/.test(error.error)
        )
          code = error.error
      }
      const retry = response.headers.get('Retry-After')
      throw new AuthenticationTransactionError(
        code,
        response.status,
        retry && /^\d+$/.test(retry) ? Number(retry) : undefined,
      )
    }
    return await response.json()
  } catch (error) {
    if (error instanceof AuthenticationTransactionError) throw error
    throw new AuthenticationTransactionError(
      token ? 'TOKEN_EXCHANGE_UNCERTAIN' : 'AUTH_TRANSACTION_UNCERTAIN',
    )
  } finally {
    clearTimeout(timeout)
  }
}
