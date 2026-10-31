import { SessionLifecycle, SessionInvalidatedError } from '@axis-iam/vertex'
import { IamApiError, IamConfigurationError, IamNetworkError, IamTokenRefreshError } from './types'
import type { TokenSet } from './types'
import type { CurrentUser, SessionInvalidationReason } from '@axis-iam/vertex'
import type { IamUser } from './types'
import { InvalidTokenResponseError, parseTokenResponse } from './token-response'

const SESSION_KEY = 'axis_iam_session'
const LEGACY_STORAGE_KEYS = ['iam_tokens', 'iam_permissions'] as const
const SESSION_VERSION = 6 as const

export type TokenStorageMode = 'memory' | 'sessionStorage'
export type AuthenticationProvenance = 'OAUTH_AUTHORIZATION_CODE'
export type RefreshProvenance = 'OAUTH_TOKEN_ENDPOINT'

interface TokenSession {
  version: typeof SESSION_VERSION
  tokens: TokenSet
  owner: SessionOwner | null
  authenticationProvenance: AuthenticationProvenance
  refreshProvenance: RefreshProvenance | null
  expiresAt: number
}

export interface SessionOwner {
  id: string
  applicationId: string
  clientId: string
  sessionId: string
}
export interface AuthorizationState {
  user: CurrentUser
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
  private user: IamUser | null = null
  private viewStatus: 'anonymous' | 'loading' | 'ready' | 'error' = 'anonymous'
  private viewError: Error | null = null
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
  get invalidationReason() { return this.lifecycle.invalidationReason }

  assertCurrent(generation: number, accessToken?: string): void {
    this.lifecycle.assertCurrent(generation)
    if (accessToken !== undefined && accessToken !== this.getAccessToken()) throw new SessionInvalidatedError()
  }

  pause(reason: SessionInvalidationReason = 'cleared'): void {
    this.paused = true
    this.expiry.invalidate()
    if (this.refreshTransportGeneration === this.generation) {
      // The server may already have consumed this RT. Never replay it after resuming.
      this.endSession(new IamTokenRefreshError('SESSION_UNAVAILABLE', false), reason)
    } else {
      this.lifecycle.invalidate(reason)
      this.notifyChange()
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
    this.pause('disposed')
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
      owner: null,
      authenticationProvenance,
      refreshProvenance,
      expiresAt: tokenDeadline(parsed),
    }
    this.saveSessionToStorage(session)
    this.lifecycle.invalidate('replaced')
    this.session = session
    this.user = null
    this.viewStatus = 'loading'
    this.viewError = null
    this.lastPermissionError = null
    this.lastRefreshError = null
    this.scheduleRefresh()
    this.notifyChange()
  }

  setPermissions(permissions: string[]): void {
    if (this.user) { this.user = { ...this.user, permissions: [...permissions] }; this.notifyChange() }
  }

  setAuthorization(roles: string[], permissions: string[]): void {
    if (this.user) { this.user = { ...this.user, roles: [...roles], permissions: [...permissions] }; this.notifyChange() }
  }

  getViewState() { return { status: this.session && !this.hasUsableToken() ? 'expired' as const : this.viewStatus, error: this.viewError, expiresAt: this.session?.expiresAt ?? null } }

  beginViewLoad(): void {
    if (!this.session) return
    this.user = null
    this.viewStatus = 'loading'
    this.viewError = null
    this.notifyChange()
  }

  failViewLoad(error: Error): void {
    this.user = null
    this.viewStatus = 'error'
    this.viewError = error
    this.lastPermissionError = error
    this.notifyChange()
  }

  applyViews(state: AuthorizationState): void {
    if (!this.hasUsableToken()) throw new SessionInvalidatedError()
    const { user, roles, permissions } = state
    const c = user.authenticationContext
    const owner: SessionOwner = { id: user.id, applicationId: c.applicationId, clientId: c.clientId, sessionId: c.sessionId }
    const previous = this.session!.owner
    if (previous && Object.keys(owner).some(key => owner[key as keyof SessionOwner] !== previous[key as keyof SessionOwner])) {
      const error = new IamConfigurationError('Current-user owner changed within a token session')
      this.failViewLoad(error)
      throw error
    }
    const session = { ...this.session!, owner }
    this.saveSessionToStorage(session)
    this.session = session
    this.user = { ...user, roles: [...roles], permissions: [...permissions],
      ...(typeof user.metadata.displayName === 'string' ? { name: user.metadata.displayName } : {}),
      orgId: c.organizationId ?? undefined, orgSlug: c.organizationSlug ?? undefined, orgRole: c.organizationRole ?? undefined,
      workspaceId: c.workspaceId ?? undefined, isImpersonating: c.impersonation !== null, actorId: c.impersonation?.actorId }
    this.viewStatus = 'ready'
    this.viewError = null
    this.lastPermissionError = null
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
    return this.session && this.isAuthenticated() ? [...this.user!.permissions] : []
  }

  getRoles(): string[] {
    return this.session && this.isAuthenticated() ? [...this.user!.roles] : []
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

  hasUsableToken(): boolean { return this.session !== null && Date.now() < this.session.expiresAt }

  isAuthenticated(): boolean { return this.hasUsableToken() && this.viewStatus === 'ready' && this.user !== null }

  getUser(): IamUser | null { return this.isAuthenticated() ? structuredClone(this.user) : null }

  clear(reason: SessionInvalidationReason = 'cleared'): void {
    this.endSession(null, reason)
  }

  private endSession(refreshError: IamTokenRefreshError | null, reason: SessionInvalidationReason = 'cleared'): void {
    this.lifecycle.invalidate(reason)
    this.expiry.invalidate()
    this.session = null
    this.user = null
    this.viewStatus = 'anonymous'
    this.viewError = null
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
          ...previous, tokens: { ...tokens, ...(tokens.id_token === undefined && previous.tokens.id_token !== undefined ? { id_token: previous.tokens.id_token } : {}) }, expiresAt: tokenDeadline(tokens),
        }
        this.saveSessionToStorage(session)
        this.session = session
        this.user = null
        this.viewStatus = 'loading'
        this.viewError = null
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
      if (!this.onPermissionsRefreshNeeded) {
        const error = new IamConfigurationError('Session view refresh handler is required')
        this.failViewLoad(error)
        throw error
      }
      if (this.onPermissionsRefreshNeeded) {
        try {
          const state = await this.onPermissionsRefreshNeeded()
          this.assertCurrent(generation)
          this.applyViews(state)
          this.setLastPermissionError(null)
        } catch (error) {
          this.assertCurrent(generation)
          if (error instanceof IamApiError && error.status === 401) {
            const failure = new IamTokenRefreshError('SESSION_REJECTED', false, 401)
            this.endSession(failure)
            throw failure
          }
          const failure = error instanceof Error ? error : new Error('Session view refresh failed')
          this.failViewLoad(failure)
          this.scheduleRefresh()
          throw failure
        }
      }
      this.assertCurrent(generation)
      this.scheduleRefresh()
      return tokens
    })
  }

  private readonly listeners = new Set<() => void>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  private notifyChange(): void {
    for (const listener of this.listeners) listener()
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
    this.viewStatus = 'loading'
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
  if (!hasExactKeys(value, ['version', 'tokens', 'owner', 'authenticationProvenance', 'refreshProvenance', 'expiresAt'])) return null
  if (!isTokenSet(value.tokens)) return null
  const owner = value.owner === null ? null : parseOwner(value.owner)
  if (value.owner !== null && owner === null) return null
  if (typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) return null
  const authenticationProvenance = value.authenticationProvenance
  if (authenticationProvenance !== 'OAUTH_AUTHORIZATION_CODE') return null
  const provenance = value.refreshProvenance
  if (provenance !== null && provenance !== 'OAUTH_TOKEN_ENDPOINT') return null
  try {
    validateSessionContext(value.tokens, authenticationProvenance, provenance)
  } catch {
    return null
  }
  return {
    version: SESSION_VERSION,
    tokens: { ...value.tokens },
    owner,
    authenticationProvenance,
    refreshProvenance: provenance,
    expiresAt: value.expiresAt,
  }
}

function parseOwner(value: unknown): SessionOwner | null {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'applicationId', 'clientId', 'sessionId'])) return null
  const { id, applicationId, clientId, sessionId } = value
  if (typeof id !== 'string' || !id.trim() || typeof applicationId !== 'string' || !applicationId.trim()
    || typeof clientId !== 'string' || !clientId.trim() || typeof sessionId !== 'string' || !sessionId.trim()) return null
  return { id, applicationId, clientId, sessionId }
}

function validateSessionContext(
  tokens: TokenSet,
  authenticationProvenance: AuthenticationProvenance,
  refreshProvenance: RefreshProvenance | null,
): void {
  if (authenticationProvenance !== 'OAUTH_AUTHORIZATION_CODE') {
    throw new TypeError('Tokens require explicit authentication provenance')
  }
  if (tokens.refresh_token && !refreshProvenance) {
    throw new TypeError('Refresh-bearing tokens require explicit refresh provenance')
  }
  if (!tokens.refresh_token && refreshProvenance) {
    throw new TypeError('Refresh provenance requires a refresh token')
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
