import { createHash, randomBytes } from 'node:crypto'

export type WebAuthErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'DISCOVERY_FAILED'
  | 'DISCOVERY_INVALID'
  | 'TRANSACTION_STORE_FAILED'
  | 'TRANSACTION_NOT_FOUND'
  | 'TRANSACTION_EXPIRED'
  | 'CALLBACK_INVALID'
  | 'CALLBACK_OAUTH_ERROR'
  | 'TOKEN_REQUEST_FAILED'
  | 'TOKEN_RESPONSE_INVALID'
  | 'SESSION_STORE_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'REFRESH_FAILED'
  | 'LOGOUT_FAILED'

const ERROR_MESSAGES: Record<WebAuthErrorCode, string> = {
  CONFIGURATION_INVALID: 'Web authentication configuration is invalid',
  DISCOVERY_FAILED: 'Authorization server discovery failed',
  DISCOVERY_INVALID: 'Authorization server metadata is invalid',
  TRANSACTION_STORE_FAILED: 'Authorization transaction store operation failed',
  TRANSACTION_NOT_FOUND: 'Authorization transaction was not found',
  TRANSACTION_EXPIRED: 'Authorization transaction has expired',
  CALLBACK_INVALID: 'Authorization callback is invalid',
  CALLBACK_OAUTH_ERROR: 'Authorization was not completed',
  TOKEN_REQUEST_FAILED: 'Token endpoint request failed',
  TOKEN_RESPONSE_INVALID: 'Token endpoint response is invalid',
  SESSION_STORE_FAILED: 'Web session store operation failed',
  SESSION_NOT_FOUND: 'Web session was not found',
  SESSION_EXPIRED: 'Web session has expired',
  REFRESH_FAILED: 'Web session refresh failed',
  LOGOUT_FAILED: 'Web session logout failed',
}

export class WebAuthError extends Error {
  readonly code: WebAuthErrorCode

  constructor(code: WebAuthErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'WebAuthError'
    this.code = code
  }

  toJSON(): { name: 'WebAuthError'; code: WebAuthErrorCode; message: string } {
    return { name: 'WebAuthError', code: this.code, message: this.message }
  }
}

export interface WebAuthTransaction {
  state: string
  codeVerifier: string
  createdAt: number
  expiresAt: number
}

export interface WebAuthTokenSet {
  accessToken: string
  refreshToken: string
  idToken?: string
  tokenType: 'Bearer'
  expiresAt: number
  scope?: string
}

export interface WebAuthSession {
  revision: string
  tokens: WebAuthTokenSet
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface WebAuthTransactionStore {
  save(id: string, transaction: WebAuthTransaction): Promise<void>
  /** Atomically returns and deletes the transaction. */
  consume(id: string): Promise<WebAuthTransaction | null>
}

export interface WebAuthSessionStore {
  create(id: string, session: WebAuthSession): Promise<void>
  read(id: string): Promise<WebAuthSession | null>
  /** Atomically replaces only the record whose revision still matches. */
  replace(id: string, expectedRevision: string, session: WebAuthSession): Promise<boolean>
  delete(id: string): Promise<void>
}

export interface WebAuthClientConfig {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  applicationOrigin: string
  successRedirect: string
  postLogoutRedirect: string
  scopes?: readonly string[]
  audience?: string
  transactionTtlSeconds?: number
  sessionTtlSeconds?: number
  transactionStore: WebAuthTransactionStore
  sessionStore: WebAuthSessionStore
  fetch?: typeof globalThis.fetch
  /** Injectable deterministic clock for tests. */
  now?: () => number
}

export interface WebAuthBeginLoginResult {
  transactionId: string
  authorizationUrl: string
  expiresAt: number
}

export interface WebAuthCallbackInput {
  transactionId: string
  state?: string
  code?: string
  error?: string
  errorDescription?: string
}

export interface WebAuthCallbackResult {
  sessionId: string
  session: WebAuthSession
  redirectUrl: string
}

export interface WebAuthRefreshInput {
  sessionId: string
}

export interface WebAuthRefreshResult {
  session: WebAuthSession
}

export interface WebAuthLogoutInput {
  sessionId?: string
}

export interface WebAuthLogoutResult {
  redirectUrl: string
}

interface DiscoveryMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
  endSessionEndpoint?: string
}

interface ValidatedConfig {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  applicationOrigin: string
  successRedirect: string
  postLogoutRedirect: string
  scopes: readonly string[]
  audience?: string
  transactionTtlMs: number
  sessionTtlMs: number
  transactionStore: WebAuthTransactionStore
  sessionStore: WebAuthSessionStore
  fetch: typeof globalThis.fetch
  now: () => number
}

export class WebAuthClient {
  private readonly config: ValidatedConfig
  private discovery?: Promise<DiscoveryMetadata>

  constructor(config: WebAuthClientConfig) {
    this.config = validateConfig(config)
  }

  get successRedirect(): string {
    return this.config.successRedirect
  }

  get postLogoutRedirect(): string {
    return this.config.postLogoutRedirect
  }

  async beginLogin(): Promise<WebAuthBeginLoginResult> {
    const metadata = await this.discover()
    const now = this.config.now()
    const transactionId = opaqueIdentifier()
    const state = opaqueIdentifier()
    const codeVerifier = randomBytes(48).toString('base64url')
    const transaction: WebAuthTransaction = {
      state,
      codeVerifier,
      createdAt: now,
      expiresAt: now + this.config.transactionTtlMs,
    }
    try {
      await this.config.transactionStore.save(transactionId, transaction)
    } catch {
      throw new WebAuthError('TRANSACTION_STORE_FAILED')
    }

    const url = new URL(metadata.authorizationEndpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('scope', this.config.scopes.join(' '))
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'))
    url.searchParams.set('code_challenge_method', 'S256')
    if (this.config.audience) url.searchParams.set('audience', this.config.audience)
    return { transactionId, authorizationUrl: url.toString(), expiresAt: transaction.expiresAt }
  }

  async handleCallback(input: WebAuthCallbackInput): Promise<WebAuthCallbackResult> {
    const transactionId = nonBlankInput(input.transactionId, 'CALLBACK_INVALID')
    let transaction: WebAuthTransaction | null
    try {
      transaction = await this.config.transactionStore.consume(transactionId)
    } catch {
      throw new WebAuthError('TRANSACTION_STORE_FAILED')
    }
    if (!transaction) throw new WebAuthError('TRANSACTION_NOT_FOUND')
    if (transaction.expiresAt <= this.config.now()) throw new WebAuthError('TRANSACTION_EXPIRED')
    if (!input.state || !constantTimeTextEqual(input.state, transaction.state)) {
      throw new WebAuthError('CALLBACK_INVALID')
    }
    if (input.error !== undefined) throw new WebAuthError('CALLBACK_OAUTH_ERROR')
    const code = nonBlankInput(input.code, 'CALLBACK_INVALID')

    const metadata = await this.discover()
    const tokens = await this.requestTokens(metadata.tokenEndpoint, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: transaction.codeVerifier,
    }), 'TOKEN_REQUEST_FAILED')
    const now = this.config.now()
    const sessionId = opaqueIdentifier()
    const session: WebAuthSession = {
      revision: opaqueIdentifier(),
      tokens,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.config.sessionTtlMs,
    }
    try {
      await this.config.sessionStore.create(sessionId, session)
    } catch {
      throw new WebAuthError('SESSION_STORE_FAILED')
    }
    return { sessionId, session, redirectUrl: this.config.successRedirect }
  }

  async readSession(sessionId: string): Promise<WebAuthSession> {
    const id = nonBlankInput(sessionId, 'SESSION_NOT_FOUND')
    let session: WebAuthSession | null
    try {
      session = await this.config.sessionStore.read(id)
    } catch {
      throw new WebAuthError('SESSION_STORE_FAILED')
    }
    if (!session) throw new WebAuthError('SESSION_NOT_FOUND')
    if (session.expiresAt <= this.config.now()) {
      try {
        await this.config.sessionStore.delete(id)
      } catch {
        throw new WebAuthError('SESSION_STORE_FAILED')
      }
      throw new WebAuthError('SESSION_EXPIRED')
    }
    return session
  }

  async refresh(input: WebAuthRefreshInput): Promise<WebAuthRefreshResult> {
    const sessionId = nonBlankInput(input.sessionId, 'SESSION_NOT_FOUND')
    const current = await this.readSession(sessionId)
    const metadata = await this.discover()
    let tokens: WebAuthTokenSet
    try {
      tokens = await this.requestTokens(metadata.tokenEndpoint, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: current.tokens.refreshToken,
      }), 'REFRESH_FAILED')
    } catch (error) {
      if (error instanceof WebAuthError && error.code === 'TOKEN_RESPONSE_INVALID') {
        throw new WebAuthError('REFRESH_FAILED')
      }
      throw error
    }
    if (tokens.refreshToken === current.tokens.refreshToken) throw new WebAuthError('REFRESH_FAILED')

    const now = this.config.now()
    const replacement: WebAuthSession = {
      revision: opaqueIdentifier(),
      tokens,
      createdAt: current.createdAt,
      updatedAt: now,
      expiresAt: now + this.config.sessionTtlMs,
    }
    let replaced: boolean
    try {
      replaced = await this.config.sessionStore.replace(sessionId, current.revision, replacement)
    } catch {
      throw new WebAuthError('SESSION_STORE_FAILED')
    }
    if (!replaced) throw new WebAuthError('REFRESH_FAILED')
    return { session: replacement }
  }

  async logout(input: WebAuthLogoutInput): Promise<WebAuthLogoutResult> {
    if (input.sessionId) {
      try {
        await this.config.sessionStore.delete(input.sessionId)
      } catch {
        throw new WebAuthError('LOGOUT_FAILED')
      }
    }

    let metadata: DiscoveryMetadata
    try {
      metadata = await this.discover()
    } catch {
      return { redirectUrl: this.config.postLogoutRedirect }
    }
    if (!metadata.endSessionEndpoint) {
      return { redirectUrl: this.config.postLogoutRedirect }
    }
    const url = new URL(metadata.endSessionEndpoint)
    url.searchParams.set('post_logout_redirect_uri', this.config.postLogoutRedirect)
    return { redirectUrl: url.toString() }
  }

  private async discover(): Promise<DiscoveryMetadata> {
    if (!this.discovery) {
      this.discovery = this.fetchDiscovery().catch((error: unknown) => {
        this.discovery = undefined
        if (error instanceof WebAuthError) throw error
        throw new WebAuthError('DISCOVERY_FAILED')
      })
    }
    return await this.discovery
  }

  private async fetchDiscovery(): Promise<DiscoveryMetadata> {
    let response: Response
    try {
      response = await this.config.fetch(`${this.config.issuer}/.well-known/openid-configuration`, {
        headers: { accept: 'application/json' },
      })
    } catch {
      throw new WebAuthError('DISCOVERY_FAILED')
    }
    if (!response.ok || !isJsonResponse(response)) throw new WebAuthError('DISCOVERY_FAILED')
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new WebAuthError('DISCOVERY_INVALID')
    }
    const record = objectRecord(value, 'DISCOVERY_INVALID')
    const issuer = endpoint(record.issuer, 'DISCOVERY_INVALID')
    if (issuer !== this.config.issuer) throw new WebAuthError('DISCOVERY_INVALID')
    return {
      issuer,
      authorizationEndpoint: sameIssuerEndpoint(record.authorization_endpoint, issuer),
      tokenEndpoint: sameIssuerEndpoint(record.token_endpoint, issuer),
      jwksUri: sameIssuerEndpoint(record.jwks_uri, issuer),
      ...(record.end_session_endpoint === undefined
        ? {}
        : { endSessionEndpoint: sameIssuerEndpoint(record.end_session_endpoint, issuer) }),
    }
  }

  private async requestTokens(
    tokenEndpoint: string,
    body: URLSearchParams,
    requestErrorCode: 'TOKEN_REQUEST_FAILED' | 'REFRESH_FAILED',
  ): Promise<WebAuthTokenSet> {
    let response: Response
    try {
      response = await this.config.fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
    } catch {
      throw new WebAuthError(requestErrorCode)
    }
    if (!response.ok) throw new WebAuthError(requestErrorCode)
    if (!isJsonResponse(response)) throw new WebAuthError('TOKEN_RESPONSE_INVALID')
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new WebAuthError('TOKEN_RESPONSE_INVALID')
    }
    return parseTokenSet(value, this.config.now())
  }
}

function validateConfig(config: WebAuthClientConfig): ValidatedConfig {
  if (!config || typeof config !== 'object') throw new WebAuthError('CONFIGURATION_INVALID')
  const applicationOriginUrl = absoluteHttpUrl(config.applicationOrigin)
  if (applicationOriginUrl.pathname !== '/' || applicationOriginUrl.search || applicationOriginUrl.hash || applicationOriginUrl.username || applicationOriginUrl.password) {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  const applicationOrigin = applicationOriginUrl.origin
  const issuerUrl = absoluteHttpUrl(config.issuer)
  const issuer = issuerUrl.toString().replace(/\/$/, '')
  const redirectUri = sameApplicationUrl(config.redirectUri, applicationOrigin)
  const successRedirect = sameApplicationUrl(config.successRedirect, applicationOrigin)
  const postLogoutRedirect = sameApplicationUrl(config.postLogoutRedirect, applicationOrigin)
  const clientId = requiredText(config.clientId)
  const clientSecret = requiredText(config.clientSecret)
  const scopes = config.scopes ?? ['openid', 'profile', 'email', 'offline_access']
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(scope => typeof scope !== 'string' || !scope.trim() || /\s/.test(scope))) {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  const audience = config.audience === undefined ? undefined : requiredText(config.audience)
  const transactionTtlMs = positiveSeconds(config.transactionTtlSeconds ?? 600, 60, 1800)
  const sessionTtlMs = positiveSeconds(config.sessionTtlSeconds ?? 86_400, 300, 2_592_000)
  if (!config.transactionStore || !config.sessionStore) throw new WebAuthError('CONFIGURATION_INVALID')
  const fetchImplementation = config.fetch ?? globalThis.fetch
  if (typeof fetchImplementation !== 'function') throw new WebAuthError('CONFIGURATION_INVALID')
  if (config.now !== undefined && typeof config.now !== 'function') throw new WebAuthError('CONFIGURATION_INVALID')
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    applicationOrigin,
    successRedirect,
    postLogoutRedirect,
    scopes: [...scopes],
    ...(audience ? { audience } : {}),
    transactionTtlMs,
    sessionTtlMs,
    transactionStore: config.transactionStore,
    sessionStore: config.sessionStore,
    fetch: fetchImplementation,
    now: config.now ?? Date.now,
  }
}

function absoluteHttpUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('//')) throw new WebAuthError('CONFIGURATION_INVALID')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new WebAuthError('CONFIGURATION_INVALID')
  if (url.protocol === 'http:' && !isLoopback(url.hostname)) throw new WebAuthError('CONFIGURATION_INVALID')
  return url
}

function sameApplicationUrl(value: unknown, applicationOrigin: string): string {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('//')) throw new WebAuthError('CONFIGURATION_INVALID')
  let url: URL
  try {
    url = new URL(value, applicationOrigin)
  } catch {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  if (url.origin !== applicationOrigin || url.username || url.password || url.protocol === 'javascript:') {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  return url.toString()
}

function endpoint(value: unknown, code: WebAuthErrorCode): string {
  if (typeof value !== 'string') throw new WebAuthError(code)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WebAuthError(code)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.protocol === 'http:' && !isLoopback(url.hostname))) {
    throw new WebAuthError(code)
  }
  return url.toString().replace(/\/$/, '')
}

function sameIssuerEndpoint(value: unknown, issuer: string): string {
  const result = endpoint(value, 'DISCOVERY_INVALID')
  if (new URL(result).origin !== new URL(issuer).origin) throw new WebAuthError('DISCOVERY_INVALID')
  return result
}

function parseTokenSet(value: unknown, now: number): WebAuthTokenSet {
  const record = objectRecord(value, 'TOKEN_RESPONSE_INVALID')
  const accessToken = tokenText(record.access_token)
  const refreshToken = tokenText(record.refresh_token)
  if (record.token_type !== 'Bearer') throw new WebAuthError('TOKEN_RESPONSE_INVALID')
  if (typeof record.expires_in !== 'number' || !Number.isInteger(record.expires_in) || record.expires_in <= 0 || record.expires_in > 86_400) {
    throw new WebAuthError('TOKEN_RESPONSE_INVALID')
  }
  const idToken = record.id_token === undefined ? undefined : tokenText(record.id_token)
  const scope = record.scope === undefined ? undefined : requiredTokenResponseText(record.scope)
  return {
    accessToken,
    refreshToken,
    ...(idToken ? { idToken } : {}),
    tokenType: 'Bearer',
    expiresAt: now + record.expires_in * 1000,
    ...(scope ? { scope } : {}),
  }
}

function objectRecord(value: unknown, code: WebAuthErrorCode): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WebAuthError(code)
  return value as Record<string, unknown>
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new WebAuthError('CONFIGURATION_INVALID')
  return value.trim()
}

function requiredTokenResponseText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 8192) throw new WebAuthError('TOKEN_RESPONSE_INVALID')
  return value
}

function tokenText(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 65_536) throw new WebAuthError('TOKEN_RESPONSE_INVALID')
  return value
}

function nonBlankInput(value: unknown, code: WebAuthErrorCode): string {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new WebAuthError(code)
  return value
}

function positiveSeconds(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new WebAuthError('CONFIGURATION_INVALID')
  }
  return value * 1000
}

function opaqueIdentifier(): string {
  return randomBytes(32).toString('base64url')
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return leftDigest.equals(rightDigest)
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  return contentType?.startsWith('application/json') === true || contentType?.includes('+json') === true
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
