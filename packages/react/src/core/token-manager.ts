import { SessionLifecycle, SessionInvalidatedError } from '@axis-iam/vertex'
import { IamApiError, IamConfigurationError, IamNetworkError, IamTokenRefreshError } from './types'
import type { TokenSet } from './types'
import { decodeJwt, isTokenExpired, extractUser } from './jwt'
import type { IamUser, JWTPayload } from './types'
import { InvalidTokenResponseError, parseTokenResponse } from './token-response'

const SESSION_KEY = 'axis_iam_session'
const LEGACY_STORAGE_KEYS = ['iam_tokens', 'iam_permissions'] as const
const SESSION_VERSION = 4 as const

export type TokenStorageMode = 'memory' | 'sessionStorage'
export type AuthenticationProvenance = 'DIRECT_AUTH' | 'OAUTH_AUTHORIZATION_CODE'
export type RefreshProvenance = 'DIRECT_AUTH' | 'OAUTH_TOKEN_ENDPOINT'

interface TokenSession {
  version: typeof SESSION_VERSION
  tokens: TokenSet
  roles: string[]
  permissions: string[]
  authenticationProvenance: AuthenticationProvenance
  refreshProvenance: RefreshProvenance | null
  expiresAt: number
}

export interface AuthorizationState {
  roles: string[]
  permissions: string[]
}

export interface TokenManagerOptions {
  /**
   * Token and permission storage strategy. Defaults to memory-only.
   * sessionStorage persistence is browser-readable and must be explicitly opted in.
   */
  storage?: TokenStorageMode
  startPaused?: boolean
}

export class TokenManager {
  private session: TokenSession | null = null
  private lastPermissionError: Error | null = null
  private readonly lifecycle = new SessionLifecycle<TokenSet>()
  private paused = false
  private refreshTransportGeneration: number | null = null
  private readonly expiry = new SessionLifecycle<void>()
  private lastRefreshError: IamTokenRefreshError | null = null
  private onRefreshNeeded: (() => Promise<TokenSet>) | null = null
  private onPermissionsRefreshNeeded: (() => Promise<AuthorizationState>) | null = null
  private onTokensChanged: ((user: IamUser | null) => void) | null = null
  private onPermissionErrorChanged: ((permissionError: Error | null) => void) | null = null
  private onRefreshErrorChanged: ((error: IamTokenRefreshError | null) => void) | null = null
  private readonly storage: TokenStorageMode

  constructor(options: TokenManagerOptions = {}) {
    this.storage = options.storage ?? 'memory'
    this.paused = options.startPaused === true
    if (this.storage === 'sessionStorage') {
      this.removeLegacyStorage()
      this.loadFromStorage()
    }
  }

  setRefreshHandler(handler: () => Promise<TokenSet>): void {
    this.onRefreshNeeded = handler
    this.scheduleRefresh()
  }

  setPermissionsRefreshHandler(handler: () => Promise<AuthorizationState>): void {
    this.onPermissionsRefreshNeeded = handler
  }

  setTokensChangedHandler(handler: (user: IamUser | null) => void): void {
    this.onTokensChanged = handler
  }

  setPermissionErrorChangedHandler(handler: (permissionError: Error | null) => void): void {
    this.onPermissionErrorChanged = handler
  }

  setRefreshErrorChangedHandler(handler: (error: IamTokenRefreshError | null) => void): void {
    this.onRefreshErrorChanged = handler
  }

  getLastRefreshError(): IamTokenRefreshError | null {
    return this.lastRefreshError
  }

  get generation(): number {
    return this.lifecycle.generation
  }

  assertCurrent(generation: number, accessToken?: string): void {
    this.lifecycle.assertCurrent(generation)
    if (accessToken !== undefined && accessToken !== this.getAccessToken()) throw new SessionInvalidatedError()
  }

  pause(): void {
    this.paused = true
    this.expiry.invalidate()
    if (this.refreshTransportGeneration === this.generation) {
      // The server may already have consumed this RT. Never replay it after resuming.
      this.endSession(new IamTokenRefreshError('SESSION_UNAVAILABLE', false))
    } else {
      this.lifecycle.invalidate()
    }
  }

  resume(): void {
    this.paused = false
    this.scheduleRefresh()
  }

  dispose(): void {
    this.onTokensChanged = null
    this.onPermissionErrorChanged = null
    this.onRefreshErrorChanged = null
    this.pause()
  }

  /** Store tokens with explicit authentication and refresh contracts. */
  store(
    tokens: TokenSet,
    authenticationProvenance: AuthenticationProvenance,
    refreshProvenance: RefreshProvenance | null,
  ): void {
    validateSessionContext(tokens, authenticationProvenance, refreshProvenance)
    const parsed = parseTokenResponse({
      access_token: tokens.access_token, token_type: tokens.token_type, expires_in: tokens.expires_in,
      ...(tokens.refresh_token !== undefined ? { refresh_token: tokens.refresh_token } : {}),
      ...(tokens.id_token !== undefined ? { id_token: tokens.id_token } : {}),
      ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
    })
    const session: TokenSession = {
      version: SESSION_VERSION,
      tokens: parsed,
      roles: tokenRoles(tokens.access_token),
      permissions: [],
      authenticationProvenance,
      refreshProvenance,
      expiresAt: tokenDeadline(parsed),
    }
    this.saveSessionToStorage(session)
    this.lifecycle.invalidate()
    this.session = session
    this.lastPermissionError = null
    this.lastRefreshError = null
    this.scheduleRefresh()
    this.notifyChange()
  }

  setPermissions(permissions: string[]): void {
    if (!this.session) return
    const session = { ...this.session, permissions: [...permissions] }
    this.saveSessionToStorage(session)
    this.session = session
    this.notifyChange()
  }

  setAuthorization(roles: string[], permissions: string[]): void {
    if (!this.session) return
    const session = { ...this.session, roles: [...roles], permissions: [...permissions] }
    this.saveSessionToStorage(session)
    this.session = session
    this.notifyChange()
  }

  setLastPermissionError(error: Error | null): void {
    this.lastPermissionError = error
    this.notifyChange()
  }

  getLastPermissionError(): Error | null {
    return this.lastPermissionError
  }

  getPermissions(): string[] {
    return this.session && this.isAuthenticated() ? [...this.session.permissions] : []
  }

  getRoles(): string[] {
    return this.session && this.isAuthenticated() ? [...this.session.roles] : []
  }

  getRefreshProvenance(): RefreshProvenance | null {
    return this.session?.refreshProvenance ?? null
  }

  getAuthenticationProvenance(): AuthenticationProvenance | null {
    return this.session?.authenticationProvenance ?? null
  }

  getAccessToken(): string | null {
    return this.session?.tokens.access_token ?? null
  }

  getRefreshToken(): string | null {
    return this.session?.tokens.refresh_token ?? null
  }

  getIdToken(): string | null {
    return this.session?.tokens.id_token ?? null
  }

  isAuthenticated(): boolean {
    const token = this.getAccessToken()
    return token && this.session ? Date.now() < this.session.expiresAt && !isTokenExpired(token) : false
  }

  decodePayload(): JWTPayload | null {
    const token = this.getAccessToken()
    if (!token) return null
    try {
      return decodeJwt(token)
    } catch {
      return null
    }
  }

  getUser(): IamUser | null {
    if (!this.isAuthenticated()) return null
    const payload = this.decodePayload()
    return payload ? extractUser(payload, this.getPermissions(), this.getRoles()) : null
  }

  clear(): void {
    this.endSession(null)
  }

  private endSession(refreshError: IamTokenRefreshError | null): void {
    this.lifecycle.invalidate()
    this.expiry.invalidate()
    this.session = null
    this.lastPermissionError = null
    this.lastRefreshError = refreshError
    try {
      if (this.storage === 'sessionStorage') this.removeStorageKeys([SESSION_KEY, ...LEGACY_STORAGE_KEYS])
    } finally {
      this.notifyChange()
    }
  }

  private scheduleRefresh(): void {
    this.lifecycle.cancelTimer()
    this.expiry.invalidate()
    if (this.paused || !this.session) return
    const { expiresAt, tokens } = this.session
    if (expiresAt > Date.now()) this.expiry.scheduleAt(expiresAt, () => this.notifyChange())
    if (!tokens.refresh_token || !this.onRefreshNeeded || this.lastRefreshError) {
      return
    }
    const remaining = expiresAt - Date.now()
    const lead = Math.min(60_000, Math.max(remaining / 2, 0))
    this.lifecycle.scheduleAt(Math.max(Math.floor(expiresAt - lead), Date.now()), () => {
      void this.refresh().catch((error: unknown) => {
        // A superseded operation belongs to its old session; other failures are observable state.
        if (error instanceof IamTokenRefreshError && error === this.lastRefreshError) this.onRefreshErrorChanged?.(error)
      })
    })
  }

  refresh(): Promise<TokenSet> {
    return this.lifecycle.run(async (generation) => {
      const previous = this.session
      this.lifecycle.cancelTimer()
      let tokens: TokenSet
      try {
        if (this.paused || !previous?.tokens.refresh_token || !previous.refreshProvenance || !this.onRefreshNeeded) {
          throw new IamTokenRefreshError('SESSION_UNAVAILABLE', false)
        }
        this.refreshTransportGeneration = generation
        let response: TokenSet
        try {
          response = await this.onRefreshNeeded()
        } finally {
          if (this.refreshTransportGeneration === generation) this.refreshTransportGeneration = null
        }
        this.assertCurrent(generation)
        tokens = parseTokenResponse(response, {
          requireRefreshToken: true,
          previousRefreshToken: previous.tokens.refresh_token,
        })
        const session: TokenSession = {
          ...previous, tokens: { ...tokens, ...(tokens.id_token === undefined && previous.tokens.id_token !== undefined ? { id_token: previous.tokens.id_token } : {}) }, expiresAt: tokenDeadline(tokens), roles: [], permissions: [],
        }
        this.saveSessionToStorage(session)
        this.session = session
        this.lastRefreshError = null
        this.lastPermissionError = null
        this.scheduleRefresh()
        this.lifecycle.cancelTimer()
        this.notifyChange()
      } catch (error) {
        this.assertCurrent(generation)
        const failure = refreshFailure(error)
        if (!failure.retryable) {
          this.endSession(failure)
        } else {
          this.lastRefreshError = failure
          this.scheduleRefresh()
          this.notifyChange()
        }
        throw failure
      }
      this.assertCurrent(generation)
      if (this.onPermissionsRefreshNeeded) {
        try {
          const state = await this.onPermissionsRefreshNeeded()
          this.assertCurrent(generation)
          this.setAuthorization(state.roles, state.permissions)
          this.setLastPermissionError(null)
        } catch (error) {
          this.assertCurrent(generation)
          if (error instanceof IamApiError && error.status === 401) {
            const failure = new IamTokenRefreshError('SESSION_REJECTED', false, 401)
            this.endSession(failure)
            throw failure
          }
          this.setLastPermissionError(error instanceof Error ? error : new Error('Permission refresh failed'))
        }
      }
      this.assertCurrent(generation)
      this.scheduleRefresh()
      return tokens
    })
  }

  private notifyChange(): void {
    this.onTokensChanged?.(this.getUser())
    this.onPermissionErrorChanged?.(this.lastPermissionError)
    this.onRefreshErrorChanged?.(this.lastRefreshError)
  }

  private saveSessionToStorage(session: TokenSession): void {
    if (this.storage !== 'sessionStorage') return
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      throw new IamConfigurationError('Token session storage write failed')
    }
  }

  private loadFromStorage(): void {
    let raw: string | null
    try {
      raw = sessionStorage.getItem(SESSION_KEY)
    } catch {
      throw new IamConfigurationError('Token session storage read failed')
    }
    if (!raw) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      this.discardCorruptSession()
      throw new IamConfigurationError('Stored token session is invalid')
    }
    const session = parseSession(parsed)
    if (!session) {
      this.discardCorruptSession()
      throw new IamConfigurationError('Stored token session is invalid')
    }
    this.session = session
  }

  private discardCorruptSession(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // Cleanup is best-effort so a removal failure cannot mask the corrupt-session error.
    }
  }

  private removeLegacyStorage(): void {
    this.removeStorageKeys(LEGACY_STORAGE_KEYS)
  }

  private removeStorageKeys(keys: readonly string[]): void {
    let failed = false
    for (const key of keys) {
      try {
        sessionStorage.removeItem(key)
      } catch {
        failed = true
      }
    }
    if (failed) {
      throw new IamConfigurationError('Token session storage removal failed')
    }
  }
}

function parseSession(value: unknown): TokenSession | null {
  if (!isRecord(value) || value.version !== SESSION_VERSION) return null
  if (!hasExactKeys(value, ['version', 'tokens', 'roles', 'permissions', 'authenticationProvenance', 'refreshProvenance', 'expiresAt'])) return null
  if (!isTokenSet(value.tokens) || !isStringArray(value.roles) || !isStringArray(value.permissions)) return null
  if (typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) return null
  const authenticationProvenance = value.authenticationProvenance
  if (authenticationProvenance !== 'DIRECT_AUTH' && authenticationProvenance !== 'OAUTH_AUTHORIZATION_CODE') return null
  const provenance = value.refreshProvenance
  if (provenance !== null && provenance !== 'DIRECT_AUTH' && provenance !== 'OAUTH_TOKEN_ENDPOINT') return null
  try {
    validateSessionContext(value.tokens, authenticationProvenance, provenance)
  } catch {
    return null
  }
  return {
    version: SESSION_VERSION,
    tokens: { ...value.tokens },
    roles: [...value.roles],
    permissions: [...value.permissions],
    authenticationProvenance,
    refreshProvenance: provenance,
    expiresAt: value.expiresAt,
  }
}

function tokenRoles(accessToken: string): string[] {
  try {
    const roles = decodeJwt(accessToken).roles
    return isStringArray(roles) ? [...roles] : []
  } catch {
    return []
  }
}

function validateSessionContext(
  tokens: TokenSet,
  authenticationProvenance: AuthenticationProvenance,
  refreshProvenance: RefreshProvenance | null,
): void {
  if (authenticationProvenance !== 'DIRECT_AUTH' && authenticationProvenance !== 'OAUTH_AUTHORIZATION_CODE') {
    throw new TypeError('Tokens require explicit authentication provenance')
  }
  if (tokens.refresh_token && !refreshProvenance) {
    throw new TypeError('Refresh-bearing tokens require explicit refresh provenance')
  }
  if (!tokens.refresh_token && refreshProvenance) {
    throw new TypeError('Refresh provenance requires a refresh token')
  }
  if (authenticationProvenance === 'DIRECT_AUTH' && refreshProvenance === 'OAUTH_TOKEN_ENDPOINT') {
    throw new TypeError('Direct Auth tokens cannot use OAuth refresh provenance')
  }
  if (authenticationProvenance === 'OAUTH_AUTHORIZATION_CODE' && refreshProvenance === 'DIRECT_AUTH') {
    throw new TypeError('OAuth tokens cannot use Direct Auth refresh provenance')
  }
}

function isTokenSet(value: unknown): value is TokenSet {
  if (!isRecord(value)) return false
  return typeof value.access_token === 'string' && value.access_token.length > 0
    && typeof value.token_type === 'string' && value.token_type.length > 0
    && typeof value.expires_in === 'number' && Number.isSafeInteger(value.expires_in) && value.expires_in > 0
    && (value.refresh_token === undefined || typeof value.refresh_token === 'string')
    && (value.id_token === undefined || typeof value.id_token === 'string')
    && (value.scope === undefined || typeof value.scope === 'string')
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function tokenDeadline(tokens: TokenSet): number {
  const deadline = Date.now() + tokens.expires_in * 1000
  if (!Number.isSafeInteger(deadline)) throw new InvalidTokenResponseError('expires_in exceeds the supported deadline')
  return deadline
}

function refreshFailure(error: unknown): IamTokenRefreshError {
  if (error instanceof IamTokenRefreshError) return error
  if (error instanceof IamNetworkError) return new IamTokenRefreshError('TEMPORARY_FAILURE', true)
  if (error instanceof IamApiError) {
    const retryable = error.status === 429 || (error.status !== undefined && error.status >= 500)
    return new IamTokenRefreshError(retryable ? 'TEMPORARY_FAILURE' : 'SESSION_REJECTED', retryable, error.status, error.retryAfterSeconds)
  }
  return new IamTokenRefreshError(error instanceof InvalidTokenResponseError ? 'INVALID_RESPONSE' : 'CONFIGURATION_ERROR', false)
}
