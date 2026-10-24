import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TokenManager } from './token-manager'
import { IamApiError, IamConfigurationError, IamNetworkError, IamTokenRefreshError } from './types'
import { makeTestUser } from '../test-utils'
import type { AuthorizationState } from './token-manager'
import type { TokenSet } from './types'

// Helper: create a minimal JWT with given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${body}.fake-sig`
}

function makeTokenSet(overrides: Partial<TokenSet> = {}): TokenSet {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: makeJwt({ sub: 'user-1', email: 'a@b.com', exp }),
    refresh_token: 'refresh-token-abc',
    token_type: 'Bearer',
    expires_in: 3600,
    ...overrides,
  }
}

function storeTokens(manager: TokenManager, tokens: TokenSet): void {
  manager.store(tokens, 'OAUTH_AUTHORIZATION_CODE', tokens.refresh_token ? 'OAUTH_TOKEN_ENDPOINT' : null)
  manager.applyViews({ user: makeTestUser(), roles: [], permissions: [] })
}

describe('TokenManager', () => {
  let tm: TokenManager

  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    tm = new TokenManager()
    tm.setPermissionsRefreshHandler(async () => ({ user: makeTestUser(), roles: [], permissions: [] }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('store / get tokens', () => {
    it('requires explicit authentication provenance', () => {
      expect(() => tm.store(
        makeTokenSet(),
        'UNKNOWN' as 'OAUTH_AUTHORIZATION_CODE',
        'OAUTH_TOKEN_ENDPOINT',
      )).toThrow('explicit authentication provenance')
    })

    it('requires explicit refresh provenance only when a refresh token exists', () => {
      expect(() => tm.store(makeTokenSet(), 'OAUTH_AUTHORIZATION_CODE', null)).toThrow('explicit refresh provenance')
      const tokens = makeTokenSet({ refresh_token: undefined })
      expect(() => tm.store(tokens, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')).toThrow('requires a refresh token')
      expect(() => tm.store(tokens, 'OAUTH_AUTHORIZATION_CODE', null)).not.toThrow()
      expect(() => tm.store(tokens, 'OAUTH_AUTHORIZATION_CODE', null)).not.toThrow()
    })

    it('stores and retrieves access token', () => {
      const tokens = makeTokenSet()
      storeTokens(tm, tokens)
      expect(tm.getAccessToken()).toBe(tokens.access_token)
    })

    it('stores and retrieves refresh token', () => {
      const tokens = makeTokenSet()
      storeTokens(tm, tokens)
      expect(tm.getRefreshToken()).toBe('refresh-token-abc')
    })

    it('stores and retrieves id token', () => {
      const tokens = makeTokenSet({ id_token: 'id-token-xyz' })
      storeTokens(tm, tokens)
      expect(tm.getIdToken()).toBe('id-token-xyz')
    })

    it('returns null when no tokens stored', () => {
      expect(tm.getAccessToken()).toBeNull()
      expect(tm.getRefreshToken()).toBeNull()
      expect(tm.getIdToken()).toBeNull()
    })
  })

  describe('isAuthenticated', () => {
    it('returns false when no tokens', () => {
      expect(tm.isAuthenticated()).toBe(false)
    })

    it('returns true with valid non-expired token', () => {
      storeTokens(tm, makeTokenSet())
      expect(tm.isAuthenticated()).toBe(true)
    })

    it('returns false with expired token', () => {
      const exp = Math.floor(Date.now() / 1000) - 60
      const tokens = makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp }), expires_in: 1,
      })
      storeTokens(tm, tokens)
      vi.advanceTimersByTime(1001)
      expect(tm.isAuthenticated()).toBe(false)
    })
  })

  describe('getUser', () => {
    it('loads user from the current-user API view', () => {
      storeTokens(tm, makeTokenSet())
      const user = tm.getUser()
      expect(user?.id).toBe('user-1')
      expect(user?.email).toBe('test@example.com')
      expect(user?.permissions).toEqual([])
    })

    it('uses explicitly stored permissions instead of JWT permissions claims', () => {
      storeTokens(tm, makeTokenSet({
        access_token: makeJwt({ sub: 'user-1', permissions: ['*:*'] }),
      }))
      tm.setPermissions(['orders:read'])

      const user = tm.getUser()

      expect(user?.permissions).toEqual(['orders:read'])
    })

    it('atomically uses canonical roles and permissions instead of stale JWT authorization', () => {
      storeTokens(tm, makeTokenSet({
        access_token: makeJwt({ sub: 'user-1', roles: ['stale-role'] }),
      }))

      tm.setAuthorization(['current-role'], ['orders:read'])

      expect(tm.getUser()).toMatchObject({ roles: ['current-role'], permissions: ['orders:read'] })
    })

    it('returns null when no tokens', () => {
      expect(tm.getUser()).toBeNull()
    })
  })

  describe('clear', () => {
    it('clears all tokens', () => {
      storeTokens(tm, makeTokenSet())
      tm.clear()
      expect(tm.getAccessToken()).toBeNull()
      expect(tm.getRefreshToken()).toBeNull()
      expect(tm.isAuthenticated()).toBe(false)
    })

    it('does not write tokens to sessionStorage by default', () => {
      storeTokens(tm, makeTokenSet())
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
      tm.clear()
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
    })
  })

  describe('token change notification', () => {
    it('calls handler on store', () => {
      const handler = vi.fn()
      tm.setTokensChangedHandler(handler)
      storeTokens(tm, makeTokenSet())
      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler.mock.calls[0][0]).toBeNull()
      expect(handler.mock.calls[1][0].id).toBe('user-1')
    })

    it('calls handler with null on clear', () => {
      const handler = vi.fn()
      tm.setTokensChangedHandler(handler)
      storeTokens(tm, makeTokenSet())
      handler.mockClear()
      tm.clear()
      expect(handler).toHaveBeenCalledWith(null)
    })
  })

  describe('auto-refresh scheduling', () => {
    it('does not refresh or clear an explicit OAuth session at zero delay for a 60-second token', async () => {
      const direct = new TokenManager({ storage: 'sessionStorage' })
      const refreshHandler = vi.fn().mockRejectedValue(new Error('Direct refresh rejected'))
      direct.setRefreshHandler(refreshHandler)
      const exp = Math.floor(Date.now() / 1000) + 60

      direct.store(
        makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }), expires_in: 60 }),
        'OAUTH_AUTHORIZATION_CODE',
        'OAUTH_AUTHORIZATION_CODE',
      )

      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(0)

      expect(refreshHandler).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()
      expect(new TokenManager({ storage: 'sessionStorage' }).isAuthenticated()).toBe(false)
    })

    it('refreshes a 60-second OAuth session after 30 seconds and persists rotated authorization', async () => {
      const direct = new TokenManager({ storage: 'sessionStorage' })
      const exp = Math.floor(Date.now() / 1000) + 60
      const refreshed = makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp: exp + 900 }),
        refresh_token: 'rotated-refresh-token',
      })
      const refreshHandler = vi.fn().mockResolvedValue(refreshed)
      const authorizationHandler = vi.fn().mockResolvedValue({ user: makeTestUser(), roles: ['member'], permissions: ['orders:read'] })
      direct.setRefreshHandler(refreshHandler)
      direct.setPermissionsRefreshHandler(authorizationHandler)
      direct.store(makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }), expires_in: 60 }), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')

      await vi.advanceTimersByTimeAsync(29_999)
      expect(refreshHandler).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(1)

      expect(refreshHandler).toHaveBeenCalledTimes(1)
      expect(authorizationHandler).toHaveBeenCalledTimes(1)
      expect(direct.getRefreshToken()).toBe('rotated-refresh-token')
      expect(direct.getAuthenticationProvenance()).toBe('OAUTH_AUTHORIZATION_CODE')
      expect(direct.getRefreshProvenance()).toBe('OAUTH_TOKEN_ENDPOINT')
      expect(direct.getRoles()).toEqual(['member'])
      expect(direct.getPermissions()).toEqual(['orders:read'])
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session')!)).toMatchObject({
        tokens: { refresh_token: 'rotated-refresh-token' },
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
        owner: { id: 'user-1', sessionId: 's1' },
      })
    })

    it('clears a 60-second OAuth session only after its deferred refresh fails', async () => {
      const direct = new TokenManager({ storage: 'sessionStorage' })
      const refreshHandler = vi.fn().mockRejectedValue(new Error('Direct refresh rejected'))
      direct.setRefreshHandler(refreshHandler)
      const exp = Math.floor(Date.now() / 1000) + 60
      direct.store(makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }), expires_in: 60 }), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')

      await vi.advanceTimersByTimeAsync(29_999)
      expect(refreshHandler).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(1)
      expect(refreshHandler).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
      expect(direct.isAuthenticated()).toBe(false)
    })

    it.each([
      ['OAuth', 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT'],
      ['OAuth', 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT'],
    ] as const)('retains the 60-second lead for 15-minute %s tokens', async (
      _name,
      authenticationProvenance,
      refreshProvenance,
    ) => {
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet())
      tm.setRefreshHandler(refreshHandler)
      const exp = Math.floor(Date.now() / 1000) + 900
      tm.store(makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }), expires_in: 900 }), authenticationProvenance, refreshProvenance)

      await vi.advanceTimersByTimeAsync(839_999)
      expect(refreshHandler).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(refreshHandler).toHaveBeenCalledTimes(1)
    })

    it('calls refresh handler before token expiry', async () => {
      const newTokenSet = makeTokenSet({ refresh_token: 'rotated' })
      const refreshHandler = vi.fn().mockResolvedValue(newTokenSet)
      tm.setRefreshHandler(refreshHandler)

      // Token expires in 120 seconds → refresh scheduled at 60s
      const exp = Math.floor(Date.now() / 1000) + 120
      storeTokens(tm, makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp }), expires_in: 120,
      }))

      expect(refreshHandler).not.toHaveBeenCalled()
      // Advance 60 seconds (refresh should fire at 120-60=60s)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(refreshHandler).toHaveBeenCalledTimes(1)
      expect(tm.getRefreshProvenance()).toBe('OAUTH_TOKEN_ENDPOINT')
    })

    it('clears tokens on refresh failure', async () => {
      const refreshHandler = vi.fn().mockRejectedValue(new Error('fail'))
      tm.setRefreshHandler(refreshHandler)

      const exp = Math.floor(Date.now() / 1000) + 120
      storeTokens(tm, makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp }), expires_in: 120,
      }))

      await vi.advanceTimersByTimeAsync(60_000)
      expect(tm.isAuthenticated()).toBe(false)
    })

    it('denies authentication and preserves an observable error when view refresh fails', async () => {
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet({ refresh_token: 'rotated' }))
      const permissionHandler = vi.fn().mockRejectedValue(new Error('permission service unavailable'))
      tm.setRefreshHandler(refreshHandler)
      tm.setPermissionsRefreshHandler(permissionHandler)
      const exp = Math.floor(Date.now() / 1000) + 120
      storeTokens(tm, makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }), expires_in: 120 }))

      await vi.advanceTimersByTimeAsync(60_000)
      expect(tm.isAuthenticated()).toBe(false)
      expect(tm.getPermissions()).toEqual([])
      expect(tm.getLastPermissionError()?.message).toBe('permission service unavailable')
    })

    it('does not clear a permission error when permissions are replaced fail-closed', () => {
      storeTokens(tm, makeTokenSet())
      const error = new Error('permission service unavailable')
      tm.setLastPermissionError(error)

      tm.setPermissions([])

      expect(tm.getPermissions()).toEqual([])
      expect(tm.getLastPermissionError()).toBe(error)
    })

    it('cancels scheduled refresh on clear', () => {
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet())
      tm.setRefreshHandler(refreshHandler)

      const exp = Math.floor(Date.now() / 1000) + 120
      storeTokens(tm, makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp }), expires_in: 120,
      }))

      tm.clear()
      vi.advanceTimersByTime(120_000)
      expect(refreshHandler).not.toHaveBeenCalled()
    })

    it('schedules a restored session after the refresh handler is registered', async () => {
      const exp = Math.floor(Date.now() / 1000) + 120
      sessionStorage.setItem('axis_iam_session', JSON.stringify({
        version: 6, owner: null, expiresAt: Date.now() + 120_000,
        tokens: makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }), expires_in: 120 }),
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      }))
      const restored = new TokenManager({ storage: 'sessionStorage' })
      restored.setPermissionsRefreshHandler(async () => ({user:makeTestUser(),roles:[],permissions:[]}))
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet({ refresh_token: 'rotated' }))
      restored.setRefreshHandler(refreshHandler)

      await vi.advanceTimersByTimeAsync(60_000)

      expect(refreshHandler).toHaveBeenCalledTimes(1)
      expect(restored.getRefreshToken()).toBe('rotated')
      expect(restored.getRefreshProvenance()).toBe('OAUTH_TOKEN_ENDPOINT')
    })

    it('atomically replaces roles and permissions after automatic refresh', async () => {
      const exp = Math.floor(Date.now() / 1000) + 120
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet({
        access_token: makeJwt({ sub: 'u', roles: ['stale-refreshed-role'], exp: exp + 3600 }),
        refresh_token: 'rotated',
      }))
      const authorizationHandler = vi.fn().mockResolvedValue({ user: makeTestUser(), roles: ['current-role'], permissions: ['orders:write'] })
      tm.setRefreshHandler(refreshHandler)
      tm.setPermissionsRefreshHandler(authorizationHandler)
      storeTokens(tm, makeTokenSet({ access_token: makeJwt({ sub: 'u', roles: ['old-role'], exp }), expires_in: 120 }))

      await vi.advanceTimersByTimeAsync(60_000)

      expect(tm.getUser()).toMatchObject({ roles: ['current-role'], permissions: ['orders:write'] })
    })
  })

  describe('session-scoped refresh transactions', () => {
    it('cancels queued refresh without signing out or sending transport', async () => {
      const handler = vi.fn(async () => makeTokenSet({ refresh_token: 'rotated' }))
      tm.setRefreshHandler(handler)
      storeTokens(tm, makeTokenSet())
      const pending = tm.refresh()
      tm.pause()
      await expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      expect(handler).not.toHaveBeenCalled()
      tm.resume()
      expect(tm.isAuthenticated()).toBe(true)
      expect(tm.getRefreshToken()).toBe('refresh-token-abc')
    })

    it('notifies expiry and denies authority while permissions are pending', async () => {
      let complete!: (state: AuthorizationState) => void
      tm.setRefreshHandler(async () => makeTokenSet({ refresh_token: 'rotated', expires_in: 1 }))
      tm.setPermissionsRefreshHandler(() => new Promise(resolve => { complete = resolve }))
      storeTokens(tm, makeTokenSet())
      const changed = vi.fn()
      tm.setTokensChangedHandler(changed)
      const pending = tm.refresh()
      await vi.advanceTimersByTimeAsync(1000)
      expect(changed).toHaveBeenLastCalledWith(null)
      expect(tm.getPermissions()).toEqual([])
      complete({ user: makeTestUser(), roles: ['member'], permissions: ['orders:read'] })
      await expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      expect(tm.getPermissions()).toEqual([])
      tm.dispose()
    })

    it.each(['pause', 'dispose'] as const)('old %s completion cannot clear a newer login', async method => {
      let complete!: (tokens: TokenSet) => void
      tm.setRefreshHandler(() => new Promise(resolve => { complete = resolve }))
      storeTokens(tm, makeTokenSet())
      const pending = tm.refresh()
      const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      await Promise.resolve()
      tm[method]()
      storeTokens(tm, makeTokenSet({ refresh_token: 'new-login' }))
      tm.resume()
      complete(makeTokenSet({ refresh_token: 'old-response' }))
      await rejected
      expect(tm.getRefreshToken()).toBe('new-login')
      expect(tm.getLastRefreshError()).toBeNull()
      tm.dispose()
    })

    it('never reuses a refresh token after pausing an already sent transaction', async () => {
      let resolve!: (tokens: TokenSet) => void
      const handler = vi.fn(() => new Promise<TokenSet>(done => { resolve = done }))
      tm.setRefreshHandler(handler)
      storeTokens(tm, makeTokenSet({ expires_in: 1 }))
      const first = tm.refresh()
      const rejected = expect(first).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      await Promise.resolve()
      tm.pause()
      tm.resume()
      await vi.advanceTimersByTimeAsync(600)
      expect(handler).toHaveBeenCalledOnce()
      resolve(makeTokenSet({ refresh_token: 'already-rotated' }))
      await rejected
      expect(tm.getRefreshToken()).toBeNull()
    })

    it('retains OAuth logout identity when refresh omits an ID token', async () => {
      tm.setRefreshHandler(async () => makeTokenSet({ refresh_token: 'rotated' }))
      storeTokens(tm, makeTokenSet({ id_token: 'original-identity' }))
      await tm.refresh()
      expect(tm.getIdToken()).toBe('original-identity')
    })

    it('notifies expiry while a refresh response is pending', async () => {
      let resolve!: (tokens: TokenSet) => void
      tm.setRefreshHandler(() => new Promise<TokenSet>(done => { resolve = done }))
      storeTokens(tm, makeTokenSet({ expires_in: 1 }))
      const changed = vi.fn()
      tm.setTokensChangedHandler(changed)
      const pending = tm.refresh()
      await vi.advanceTimersByTimeAsync(1000)
      expect(changed).toHaveBeenCalledWith(null)
      resolve(makeTokenSet({ refresh_token: 'rotated' }))
      await pending
    })

    it('joins timer and manual refresh, commits rotation and canonical authorization once', async () => {
      let resolve!: (tokens: TokenSet) => void
      const handler = vi.fn(() => new Promise<TokenSet>(done => { resolve = done }))
      tm.setRefreshHandler(handler)
      tm.setPermissionsRefreshHandler(async () => ({ user: makeTestUser(), roles: ['member'], permissions: ['orders:read'] }))
      storeTokens(tm, makeTokenSet({ expires_in: 60 }))
      await vi.advanceTimersByTimeAsync(30_000)
      const first = tm.refresh()
      expect(tm.refresh()).toBe(first)
      expect(handler).toHaveBeenCalledOnce()
      resolve(makeTokenSet({ refresh_token: 'rotated' }))
      await expect(first).resolves.toMatchObject({ refresh_token: 'rotated' })
      expect(tm.getRefreshToken()).toBe('rotated')
      expect(tm.getPermissions()).toEqual(['orders:read'])
    })

    it.each(['clear', 'new-login', 'dispose'] as const)('ignores an old refresh after %s', async mode => {
      let resolve!: (tokens: TokenSet) => void
      tm.setRefreshHandler(() => new Promise<TokenSet>(done => { resolve = done }))
      storeTokens(tm, makeTokenSet())
      const result = tm.refresh()
      const rejected = expect(result).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      await Promise.resolve()
      if (mode === 'clear') tm.clear()
      if (mode === 'dispose') tm.dispose()
      if (mode === 'new-login') storeTokens(tm, makeTokenSet({ refresh_token: 'new-login' }))
      resolve(makeTokenSet({ refresh_token: 'old-rotation' }))
      await rejected
      expect(tm.getRefreshToken()).toBe(mode === 'new-login' ? 'new-login' : null)
      if (mode !== 'dispose') expect(tm.getLastRefreshError()).toBeNull()
    })

    it('does not apply old permissions to a new login', async () => {
      let resolve!: (state: AuthorizationState) => void
      tm.setRefreshHandler(async () => makeTokenSet({ refresh_token: 'rotated' }))
      tm.setPermissionsRefreshHandler(() => new Promise(done => { resolve = done }))
      storeTokens(tm, makeTokenSet())
      const result = tm.refresh()
      const rejected = expect(result).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      await vi.advanceTimersByTimeAsync(0)
      storeTokens(tm, makeTokenSet({ refresh_token: 'new-login' }))
      tm.setAuthorization(['new-role'], ['new:permission'])
      resolve({ user: makeTestUser(), roles: ['old-role'], permissions: ['old:permission'] })
      await rejected
      expect(tm.getRoles()).toEqual(['new-role'])
      expect(tm.getPermissions()).toEqual(['new:permission'])
    })

    it.each([
      new IamNetworkError('transport containing a-secret'),
      new IamApiError('provider containing a-secret', { status: 503 }),
      new IamApiError('provider containing a-secret', { status: 429, retryAfterSeconds: 5 }),
    ])('retains valid state without automatic retries on temporary failure', async failure => {
      const handler = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(makeTokenSet({ refresh_token: 'retried' }))
      tm.setRefreshHandler(handler)
      storeTokens(tm, makeTokenSet({ expires_in: 60 }))
      await expect(tm.refresh()).rejects.toMatchObject({ reason: 'TEMPORARY_FAILURE', retryable: true })
      expect(tm.isAuthenticated()).toBe(true)
      expect(tm.getRefreshToken()).toBe('refresh-token-abc')
      expect(JSON.stringify(tm.getLastRefreshError())).not.toContain('a-secret')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(handler).toHaveBeenCalledOnce()
      await expect(tm.refresh()).resolves.toMatchObject({ refresh_token: 'retried' })
      expect(tm.getLastRefreshError()).toBeNull()
    })

    it('reports a terminal failure while removing all authority', async () => {
      tm.setRefreshHandler(async () => { throw new IamApiError('invalid grant', { status: 400, code: 'invalid_grant' }) })
      storeTokens(tm, makeTokenSet())
      tm.setAuthorization(['admin'], ['*:*'])
      await expect(tm.refresh()).rejects.toBeInstanceOf(IamTokenRefreshError)
      expect(tm.getAccessToken()).toBeNull()
      expect(tm.getPermissions()).toEqual([])
      expect(tm.getLastRefreshError()).toMatchObject({ reason: 'SESSION_REJECTED', retryable: false })
    })

    it('uses response expiry for scheduling even with a non-JWT token', async () => {
      const handler = vi.fn(async () => makeTokenSet({ refresh_token: 'rotated' }))
      tm.setRefreshHandler(handler)
      storeTokens(tm, makeTokenSet({ access_token: 'opaque-shaped-test-vector', expires_in: 60 }))
      await vi.advanceTimersByTimeAsync(29_999)
      expect(handler).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('uses response expiry rather than a contradictory JWT expiry', async () => {
      const handler = vi.fn(async () => makeTokenSet({ refresh_token: 'rotated' }))
      tm.setRefreshHandler(handler)
      storeTokens(tm, makeTokenSet({ access_token: makeJwt({ sub: 'u', exp: 1 }), expires_in: 120 }))
      await vi.advanceTimersByTimeAsync(59_999)
      expect(handler).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('restores the original expiry instead of renewing TTL on reload', async () => {
      const persistent = new TokenManager({ storage: 'sessionStorage' })
      storeTokens(persistent, makeTokenSet({ expires_in: 120 }))
      persistent.dispose()
      await vi.advanceTimersByTimeAsync(90_000)
      const restored = new TokenManager({ storage: 'sessionStorage' })
      const handler = vi.fn(async () => makeTokenSet({ refresh_token: 'rotated' }))
      restored.setPermissionsRefreshHandler(async () => ({user:makeTestUser(),roles:[],permissions:[]}))
      restored.setRefreshHandler(handler)
      await vi.advanceTimersByTimeAsync(14_999)
      expect(handler).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(handler).toHaveBeenCalledOnce()
      restored.dispose()
    })

    it.each([0, -1, NaN, Infinity, 1.5])('rejects invalid expiry metadata %s before publishing a session', expires_in => {
      expect(() => storeTokens(tm, makeTokenSet({ expires_in }))).toThrow('expires_in')
      expect(tm.getAccessToken()).toBeNull()
    })
  })

  describe('sessionStorage opt-in persistence', () => {
    it('does not access sessionStorage in memory mode even when browser storage is unavailable', () => {
      const tokens = makeTokenSet()
      sessionStorage.setItem('iam_tokens', JSON.stringify(tokens))
      sessionStorage.setItem('iam_permissions', JSON.stringify(['orders:read']))
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked read containing secret-token', 'SecurityError')
      })
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked write containing secret-token', 'SecurityError')
      })
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('blocked removal containing secret-token', 'SecurityError')
      })

      const tm2 = new TokenManager()
      storeTokens(tm2, tokens)
      tm2.clear()

      expect(tm2.getAccessToken()).toBeNull()
      expect(tm2.getPermissions()).toEqual([])
      expect(getItem).not.toHaveBeenCalled()
      expect(setItem).not.toHaveBeenCalled()
      expect(removeItem).not.toHaveBeenCalled()
    })

    it('reports an unavailable sessionStorage read with a sanitized configuration error', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked read containing secret-token', 'SecurityError')
      })

      expect(() => new TokenManager({ storage: 'sessionStorage' })).toThrow(IamConfigurationError)
      expect(() => new TokenManager({ storage: 'sessionStorage' })).toThrow('Token session storage read failed')
      try {
        new TokenManager({ storage: 'sessionStorage' })
      } catch (error) {
        expect(String(error)).not.toContain('secret-token')
        expect(String(error)).not.toContain('SecurityError')
      }
    })

    it('does not publish tokens or authorization when sessionStorage writes fail', () => {
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      const originalTokens = makeTokenSet({ refresh_token: 'original-refresh' })
      storeTokens(tm2, originalTokens)
      tm2.setAuthorization(['member'], ['orders:read'])
      const handler = vi.fn()
      tm2.setTokensChangedHandler(handler)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked write containing rotated-refresh', 'SecurityError')
      })

      expect(() => storeTokens(tm2, makeTokenSet({ refresh_token: 'rotated-refresh' })))
        .toThrow(IamConfigurationError)
      expect(tm2.getRefreshToken()).toBe('original-refresh')
      expect(tm2.getRoles()).toEqual(['member'])
      expect(tm2.getPermissions()).toEqual(['orders:read'])
      expect(handler).not.toHaveBeenCalled()

      // Authorization is a view in memory and is never written to token storage.
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session')!)).not.toHaveProperty('permissions')
    })

    it('persists tokens and owner but never authorization views when explicitly enabled', () => {
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      storeTokens(tm2, makeTokenSet())
      tm2.setPermissions(['orders:read'])

      const stored = sessionStorage.getItem('axis_iam_session')
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed).toMatchObject({
        version: 6, owner: { id: 'user-1', sessionId: 's1' }, expiresAt: Date.now() + 3600_000,
        tokens: { token_type: 'Bearer' },
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      })
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('restores tokens but requires fresh API views before authority', () => {
      const tokens = makeTokenSet()
      sessionStorage.setItem('axis_iam_session', JSON.stringify({
        version: 6, owner: null, expiresAt: Date.now() + 3600_000,
        tokens,
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      }))
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      expect(tm2.getAccessToken()).toBe(tokens.access_token)
      expect(tm2.getRoles()).toEqual([])
      expect(tm2.getPermissions()).toEqual([])
      expect(tm2.isAuthenticated()).toBe(false)
      expect(tm2.getRefreshProvenance()).toBe('OAUTH_TOKEN_ENDPOINT')
    })

    it.each([
      '{',
      JSON.stringify({ version: 1, tokens: makeTokenSet(), permissions: [], refreshProvenance: 'OAUTH_TOKEN_ENDPOINT' }),
      JSON.stringify({ version: 2, tokens: makeTokenSet(), permissions: [], refreshProvenance: 'OAUTH_TOKEN_ENDPOINT' }),
      JSON.stringify({ version: 2, tokens: makeTokenSet(), roles: [], permissions: [], refreshProvenance: null }),
      JSON.stringify({ version: 6, owner: null, expiresAt: Date.now() + 3600_000, tokens: makeTokenSet(), roles: [], permissions: [], authenticationProvenance: 'UNKNOWN', refreshProvenance: 'OAUTH_TOKEN_ENDPOINT' }),
      JSON.stringify({ version: 6, owner: null, expiresAt: Date.now() + 3600_000, tokens: makeTokenSet(), roles: [], permissions: [], authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE', refreshProvenance: 'UNKNOWN' }),
    ])('rejects and clears malformed, unknown-version, or invalid-provenance sessions', raw => {
      sessionStorage.setItem('axis_iam_session', raw)
      let thrown: unknown
      try {
        new TokenManager({ storage: 'sessionStorage' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(IamConfigurationError)
      expect(String(thrown)).toContain('Stored token session is invalid')
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it('preserves the primary corrupt-session error when best-effort cleanup fails', () => {
      sessionStorage.setItem('axis_iam_session', '{"access_token":"secret-token"')
      const originalRemoveItem = Storage.prototype.removeItem
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
        if (key === 'axis_iam_session') {
          throw new DOMException('blocked removal containing secret-token', 'SecurityError')
        }
        return originalRemoveItem.call(this, key)
      })

      try {
        new TokenManager({ storage: 'sessionStorage' })
        expect.unreachable('corrupt session must be rejected')
      } catch (error) {
        expect(error).toBeInstanceOf(IamConfigurationError)
        expect(String(error)).toContain('Stored token session is invalid')
        expect(String(error)).not.toContain('secret-token')
        expect(String(error)).not.toContain('SecurityError')
      }
    })

    it('deletes legacy keys without reading or migrating them', () => {
      sessionStorage.setItem('iam_tokens', JSON.stringify(makeTokenSet()))
      sessionStorage.setItem('iam_permissions', JSON.stringify(['*:*']))
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      expect(tm2.getAccessToken()).toBeNull()
      expect(tm2.getPermissions()).toEqual([])
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it('removes persisted tokens and permissions on clear when explicitly enabled', () => {
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      storeTokens(tm2, makeTokenSet())
      tm2.setPermissions(['orders:read'])

      tm2.clear()

      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('clears memory authority before reporting a persistent removal failure', () => {
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      storeTokens(tm2, makeTokenSet())
      tm2.setAuthorization(['admin'], ['orders:read'])
      const handler = vi.fn()
      tm2.setTokensChangedHandler(handler)
      const originalRemoveItem = Storage.prototype.removeItem
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
        if (key === 'axis_iam_session') {
          throw new DOMException('blocked removal containing secret-token', 'SecurityError')
        }
        return originalRemoveItem.call(this, key)
      })

      let thrown: unknown
      try {
        tm2.clear()
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(IamConfigurationError)
      expect(String(thrown)).toContain('Token session storage removal failed')
      expect(tm2.getAccessToken()).toBeNull()
      expect(tm2.getRoles()).toEqual([])
      expect(tm2.getPermissions()).toEqual([])
      expect(tm2.getAuthenticationProvenance()).toBeNull()
      expect(handler).toHaveBeenCalledWith(null)
    })
  })
})
