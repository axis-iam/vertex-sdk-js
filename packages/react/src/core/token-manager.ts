import { IamConfigurationError } from './types'
import type { TokenSet } from './types'
import { decodeJwt, isTokenExpired, extractUser } from './jwt'
import type { IamUser, JWTPayload } from './types'

const SESSION_KEY = 'axis_iam_session'
const LEGACY_STORAGE_KEYS = ['iam_tokens', 'iam_permissions'] as const
const SESSION_VERSION = 3 as const

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
}

export class TokenManager {
  private session: TokenSession | null = null
  private lastPermissionError: Error | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private onRefreshNeeded: (() => Promise<TokenSet>) | null = null
  private onPermissionsRefreshNeeded: (() => Promise<AuthorizationState>) | null = null
  private onTokensChanged: ((user: IamUser | null) => void) | null = null
  private onPermissionErrorChanged: ((permissionError: Error | null) => void) | null = null
  private readonly storage: TokenStorageMode

  constructor(options: TokenManagerOptions = {}) {
    this.storage = options.storage ?? 'memory'
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

  /** Store tokens with explicit authentication and refresh contracts. */
  store(
    tokens: TokenSet,
    authenticationProvenance: AuthenticationProvenance,
    refreshProvenance: RefreshProvenance | null,
  ): void {
    validateSessionContext(tokens, authenticationProvenance, refreshProvenance)
    const session: TokenSession = {
      version: SESSION_VERSION,
      tokens: { ...tokens },
      roles: tokenRoles(tokens.access_token),
      permissions: [],
      authenticationProvenance,
      refreshProvenance,
    }
    this.saveSessionToStorage(session)
    this.session = session
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
    return this.session ? [...this.session.permissions] : []
  }

  getRoles(): string[] {
    return this.session ? [...this.session.roles] : []
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
    return token ? !isTokenExpired(token) : false
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
    const payload = this.decodePayload()
    return payload ? extractUser(payload, this.getPermissions(), this.getRoles()) : null
  }

  clear(): void {
    this.session = null
    this.lastPermissionError = null
    this.cancelRefresh()
    this.notifyChange()
    if (this.storage === 'sessionStorage') {
      this.removeStorageKeys([SESSION_KEY, ...LEGACY_STORAGE_KEYS])
    }
  }

  private scheduleRefresh(): void {
    this.cancelRefresh()
    const token = this.getAccessToken()
    if (!token || !this.onRefreshNeeded) return

    try {
      const payload = decodeJwt(token)
      if (!payload.exp) return
      const now = Math.floor(Date.now() / 1000)
      const remainingSeconds = payload.exp - now
      const refreshLeadSeconds = Math.min(60, remainingSeconds / 2)
      const refreshIn = Math.max((remainingSeconds - refreshLeadSeconds) * 1000, 0)
      this.refreshTimer = setTimeout(async () => this.performRefresh(), refreshIn)
    } catch {
      // Invalid access tokens cannot schedule refresh.
    }
  }

  private async performRefresh(): Promise<void> {
    const authenticationProvenance = this.getAuthenticationProvenance()
    const provenance = this.getRefreshProvenance()
    if (!this.onRefreshNeeded || !this.getRefreshToken() || !authenticationProvenance || !provenance) return

    let newTokens: TokenSet
    try {
      newTokens = await this.onRefreshNeeded()
    } catch {
      this.clear()
      return
    }

    this.store(newTokens, authenticationProvenance, provenance)
    if (!this.onPermissionsRefreshNeeded) return

    try {
      this.setAuthorizationState(await this.onPermissionsRefreshNeeded())
      this.setLastPermissionError(null)
    } catch (error) {
      // The rotated identity remains authenticated, but authorization stays empty and observable.
      if (!this.lastPermissionError) {
        this.setLastPermissionError(error instanceof Error ? error : new Error('Permission refresh failed'))
      }
    }
  }

  private cancelRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private setAuthorizationState(state: AuthorizationState): void {
    this.setAuthorization(state.roles, state.permissions)
  }

  private notifyChange(): void {
    this.onTokensChanged?.(this.getUser())
    this.onPermissionErrorChanged?.(this.lastPermissionError)
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
  if (!hasExactKeys(value, ['version', 'tokens', 'roles', 'permissions', 'authenticationProvenance', 'refreshProvenance'])) return null
  if (!isTokenSet(value.tokens) || !isStringArray(value.roles) || !isStringArray(value.permissions)) return null
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
    && typeof value.expires_in === 'number' && Number.isFinite(value.expires_in)
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
