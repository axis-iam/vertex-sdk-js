import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TokenManager } from './token-manager'
import type { TokenSet, IamUser } from './types'

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
}

describe('TokenManager', () => {
  let tm: TokenManager

  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    tm = new TokenManager()
  })

  afterEach(() => {
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
      expect(() => tm.store(tokens, 'DIRECT_AUTH', 'DIRECT_AUTH')).toThrow('requires a refresh token')
      expect(() => tm.store(tokens, 'OAUTH_AUTHORIZATION_CODE', null)).not.toThrow()
      expect(() => tm.store(tokens, 'DIRECT_AUTH', null)).not.toThrow()
    })

    it('rejects contradictory authentication and refresh provenance', () => {
      expect(() => tm.store(makeTokenSet(), 'DIRECT_AUTH', 'OAUTH_TOKEN_ENDPOINT'))
        .toThrow('Direct Auth tokens cannot use OAuth refresh provenance')
      expect(() => tm.store(makeTokenSet(), 'OAUTH_AUTHORIZATION_CODE', 'DIRECT_AUTH'))
        .toThrow('OAuth tokens cannot use Direct Auth refresh provenance')
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
        access_token: makeJwt({ sub: 'u', exp }),
      })
      storeTokens(tm, tokens)
      expect(tm.isAuthenticated()).toBe(false)
    })
  })

  describe('decodePayload', () => {
    it('decodes access token payload', () => {
      storeTokens(tm, makeTokenSet())
      const payload = tm.decodePayload()
      expect(payload?.sub).toBe('user-1')
      expect(payload?.email).toBe('a@b.com')
    })

    it('returns null when no tokens', () => {
      expect(tm.decodePayload()).toBeNull()
    })

    it('returns null for malformed token', () => {
      storeTokens(tm, makeTokenSet({ access_token: 'not-a-jwt' }))
      expect(tm.decodePayload()).toBeNull()
    })
  })

  describe('getUser', () => {
    it('extracts user from access token', () => {
      storeTokens(tm, makeTokenSet())
      const user = tm.getUser()
      expect(user?.id).toBe('user-1')
      expect(user?.email).toBe('a@b.com')
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
      expect(handler).toHaveBeenCalledTimes(1)
      const user: IamUser = handler.mock.calls[0][0]
      expect(user.id).toBe('user-1')
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
    it('does not refresh or clear an explicit Direct Auth session at zero delay for a 60-second token', async () => {
      const direct = new TokenManager({ storage: 'sessionStorage' })
      const refreshHandler = vi.fn().mockRejectedValue(new Error('Direct refresh rejected'))
      direct.setRefreshHandler(refreshHandler)
      const exp = Math.floor(Date.now() / 1000) + 60

      direct.store(
        makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }) }),
        'DIRECT_AUTH',
        'DIRECT_AUTH',
      )

      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(0)

      expect(refreshHandler).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()
      expect(new TokenManager({ storage: 'sessionStorage' }).isAuthenticated()).toBe(true)
    })

    it('refreshes a 60-second Direct Auth session after 30 seconds and persists rotated authorization', async () => {
      const direct = new TokenManager({ storage: 'sessionStorage' })
      const exp = Math.floor(Date.now() / 1000) + 60
      const refreshed = makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp: exp + 900 }),
        refresh_token: 'rotated-refresh-token',
      })
      const refreshHandler = vi.fn().mockResolvedValue(refreshed)
      const authorizationHandler = vi.fn().mockResolvedValue({ roles: ['member'], permissions: ['orders:read'] })
      direct.setRefreshHandler(refreshHandler)
      direct.setPermissionsRefreshHandler(authorizationHandler)
      direct.store(makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }) }), 'DIRECT_AUTH', 'DIRECT_AUTH')

      await vi.advanceTimersByTimeAsync(29_999)
      expect(refreshHandler).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()

      await vi.advanceTimersByTimeAsync(1)

      expect(refreshHandler).toHaveBeenCalledTimes(1)
      expect(authorizationHandler).toHaveBeenCalledTimes(1)
      expect(direct.getRefreshToken()).toBe('rotated-refresh-token')
      expect(direct.getAuthenticationProvenance()).toBe('DIRECT_AUTH')
      expect(direct.getRefreshProvenance()).toBe('DIRECT_AUTH')
      expect(direct.getRoles()).toEqual(['member'])
      expect(direct.getPermissions()).toEqual(['orders:read'])
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session')!)).toMatchObject({
        tokens: { refresh_token: 'rotated-refresh-token' },
        authenticationProvenance: 'DIRECT_AUTH',
        refreshProvenance: 'DIRECT_AUTH',
        permissions: ['orders:read'],
      })
    })

    it('clears a 60-second Direct Auth session only after its deferred refresh fails', async () => {
      const direct = new TokenManager({ storage: 'sessionStorage' })
      const refreshHandler = vi.fn().mockRejectedValue(new Error('Direct refresh rejected'))
      direct.setRefreshHandler(refreshHandler)
      const exp = Math.floor(Date.now() / 1000) + 60
      direct.store(makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }) }), 'DIRECT_AUTH', 'DIRECT_AUTH')

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
      ['Direct Auth', 'DIRECT_AUTH', 'DIRECT_AUTH'],
    ] as const)('retains the 60-second lead for 15-minute %s tokens', async (
      _name,
      authenticationProvenance,
      refreshProvenance,
    ) => {
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet())
      tm.setRefreshHandler(refreshHandler)
      const exp = Math.floor(Date.now() / 1000) + 900
      tm.store(makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }) }), authenticationProvenance, refreshProvenance)

      await vi.advanceTimersByTimeAsync(839_999)
      expect(refreshHandler).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(refreshHandler).toHaveBeenCalledTimes(1)
    })

    it('calls refresh handler before token expiry', async () => {
      const newTokenSet = makeTokenSet()
      const refreshHandler = vi.fn().mockResolvedValue(newTokenSet)
      tm.setRefreshHandler(refreshHandler)

      // Token expires in 120 seconds → refresh scheduled at 60s
      const exp = Math.floor(Date.now() / 1000) + 120
      storeTokens(tm, makeTokenSet({
        access_token: makeJwt({ sub: 'u', exp }),
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
        access_token: makeJwt({ sub: 'u', exp }),
      }))

      await vi.advanceTimersByTimeAsync(60_000)
      expect(tm.isAuthenticated()).toBe(false)
    })

    it('keeps authentication but preserves an observable error when permission refresh fails', async () => {
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet({ refresh_token: 'rotated' }))
      const permissionHandler = vi.fn().mockRejectedValue(new Error('permission service unavailable'))
      tm.setRefreshHandler(refreshHandler)
      tm.setPermissionsRefreshHandler(permissionHandler)
      const exp = Math.floor(Date.now() / 1000) + 120
      storeTokens(tm, makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }) }))

      await vi.advanceTimersByTimeAsync(60_000)
      expect(tm.isAuthenticated()).toBe(true)
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
        access_token: makeJwt({ sub: 'u', exp }),
      }))

      tm.clear()
      vi.advanceTimersByTime(120_000)
      expect(refreshHandler).not.toHaveBeenCalled()
    })

    it('schedules a restored session after the refresh handler is registered', async () => {
      const exp = Math.floor(Date.now() / 1000) + 120
      sessionStorage.setItem('axis_iam_session', JSON.stringify({
        version: 3,
        tokens: makeTokenSet({ access_token: makeJwt({ sub: 'u', exp }) }),
        roles: ['current-role'],
        permissions: ['orders:read'],
        authenticationProvenance: 'DIRECT_AUTH',
        refreshProvenance: 'DIRECT_AUTH',
      }))
      const restored = new TokenManager({ storage: 'sessionStorage' })
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet({ refresh_token: 'rotated' }))
      restored.setRefreshHandler(refreshHandler)

      await vi.advanceTimersByTimeAsync(60_000)

      expect(refreshHandler).toHaveBeenCalledTimes(1)
      expect(restored.getRefreshToken()).toBe('rotated')
      expect(restored.getRefreshProvenance()).toBe('DIRECT_AUTH')
    })

    it('atomically replaces roles and permissions after automatic refresh', async () => {
      const exp = Math.floor(Date.now() / 1000) + 120
      const refreshHandler = vi.fn().mockResolvedValue(makeTokenSet({
        access_token: makeJwt({ sub: 'u', roles: ['stale-refreshed-role'], exp: exp + 3600 }),
        refresh_token: 'rotated',
      }))
      const authorizationHandler = vi.fn().mockResolvedValue({ roles: ['current-role'], permissions: ['orders:write'] })
      tm.setRefreshHandler(refreshHandler)
      tm.setPermissionsRefreshHandler(authorizationHandler)
      storeTokens(tm, makeTokenSet({ access_token: makeJwt({ sub: 'u', roles: ['old-role'], exp }) }))

      await vi.advanceTimersByTimeAsync(60_000)

      expect(tm.getUser()).toMatchObject({ roles: ['current-role'], permissions: ['orders:write'] })
    })
  })

  describe('sessionStorage opt-in persistence', () => {
    it('does not load and removes stale tokens or permissions from sessionStorage by default', () => {
      const tokens = makeTokenSet()
      sessionStorage.setItem('iam_tokens', JSON.stringify(tokens))
      sessionStorage.setItem('iam_permissions', JSON.stringify(['orders:read']))

      const tm2 = new TokenManager()

      expect(tm2.getAccessToken()).toBeNull()
      expect(tm2.getPermissions()).toEqual([])
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('persists tokens and permissions to sessionStorage when explicitly enabled', () => {
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      storeTokens(tm2, makeTokenSet())
      tm2.setPermissions(['orders:read'])

      const stored = sessionStorage.getItem('axis_iam_session')
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed).toMatchObject({
        version: 3,
        tokens: { token_type: 'Bearer' },
        roles: [],
        permissions: ['orders:read'],
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      })
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('loads current roles and permissions from sessionStorage when explicitly enabled', () => {
      const tokens = makeTokenSet()
      sessionStorage.setItem('axis_iam_session', JSON.stringify({
        version: 3,
        tokens,
        roles: ['current-role'],
        permissions: ['orders:read'],
        authenticationProvenance: 'DIRECT_AUTH',
        refreshProvenance: 'DIRECT_AUTH',
      }))
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      expect(tm2.getAccessToken()).toBe(tokens.access_token)
      expect(tm2.getRoles()).toEqual(['current-role'])
      expect(tm2.getPermissions()).toEqual(['orders:read'])
      expect(tm2.getRefreshProvenance()).toBe('DIRECT_AUTH')
    })

    it.each([
      '{',
      JSON.stringify({ version: 1, tokens: makeTokenSet(), permissions: [], refreshProvenance: 'DIRECT_AUTH' }),
      JSON.stringify({ version: 2, tokens: makeTokenSet(), permissions: [], refreshProvenance: 'DIRECT_AUTH' }),
      JSON.stringify({ version: 2, tokens: makeTokenSet(), roles: [], permissions: [], refreshProvenance: null }),
      JSON.stringify({ version: 3, tokens: makeTokenSet(), roles: [], permissions: [], authenticationProvenance: 'UNKNOWN', refreshProvenance: 'OAUTH_TOKEN_ENDPOINT' }),
      JSON.stringify({ version: 3, tokens: makeTokenSet(), roles: [], permissions: [], authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE', refreshProvenance: 'UNKNOWN' }),
    ])('clears malformed, unknown-version, or invalid-provenance sessions', raw => {
      sessionStorage.setItem('axis_iam_session', raw)
      const tm2 = new TokenManager({ storage: 'sessionStorage' })
      expect(tm2.getAccessToken()).toBeNull()
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
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
  })
})
