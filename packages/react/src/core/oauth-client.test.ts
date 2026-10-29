import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { OAuthClient } from './oauth-client'
import { makeTestUser } from '../test-utils'
import type { TokenManager } from './token-manager'
import { IamApiError, IamConfigurationError } from './types'
import type {
  AuthMethodIdpProviderResponse,
  IamConfig,
  IdentityProviderOption,
  OIDCConfiguration,
  PublicAuthMethodsResponse,
  TokenSet,
} from './types'

function view() { const u = makeTestUser();u.authenticationContext.clientId='my-app';u.authenticationContext.applicationId='app-1';return u }
const ISSUER = 'https://auth.example.com'

const mockOidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
  end_session_endpoint: `${ISSUER}/logout`,
}

const defaultConfig: IamConfig = {
  clientId: 'my-app',
  issuerUri: ISSUER,
  redirectUri: '/callback',
}

function storeOAuthTokens(manager: TokenManager, tokens: TokenSet): void {
  manager.store(tokens, 'OAUTH_AUTHORIZATION_CODE', tokens.refresh_token ? 'OAUTH_TOKEN_ENDPOINT' : null)
  manager.applyViews({user: view(), roles:[],permissions:[]})
}



const googleProvider: IdentityProviderOption = {
  id: 'idp-google',
  applicationId: 'app-1',
  providerType: 'GOOGLE',
  name: 'google',
  displayName: 'Google',
  enabled: true,
  protocol: 'OIDC',
  authorizationUrl: `${ISSUER}/api/v1/apps/my-app/identity-providers/idp-google/oidc/authorize`,
  samlAcsUrl: null,
  supportsBrokeredToken: true,
}

const googleAuthMethodProvider: AuthMethodIdpProviderResponse = {
  id: 'idp-google',
  providerType: 'GOOGLE',
  displayName: 'Google',
  enabled: true,
  configured: true,
  clickable: true,
  availableForLogin: true,
  availableForSignup: true,
  unavailableReason: null,
  authorizationUrl: `${ISSUER}/api/v1/apps/my-app/identity-providers/idp-google/oidc/authorize`,
}

const publicAuthPolicy = {
  defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
  allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'],
  allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'],
  passwordLoginEnabled: true,
  passwordlessEnabled: true,
  minPasswordLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecialChar: false,
  breachedPasswordCheck: false,
  totpEnabled: true,
  webauthnEnabled: false,
  mfaEnforcement: 'OPTIONAL',
  stepUpEnabled: true,
  stepUpTriggers: ['MFA_CHANGE'],
  deviceTrustDays: 30,
  maxTrustedDevices: 5,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  progressiveLockout: false,
  idpAutoProvisioningEnabled: false,
  signupMode: 'OPEN',
  allowedRegistrationGrantTypes: ['EMAIL_LINK', 'ACCESS_CODE', 'ORG_INVITATION'],
} as const

const publicAuthMethods: PublicAuthMethodsResponse = {
  clientId: 'my-app',
  passwordLoginEnabled: true,
  emailMagicLinkEnabled: true,
  emailOtpEnabled: false,
  smsOtpEnabled: false,
  socialLoginEnabled: true,
  signupEnabled: true,
  selfRegistrationEnabled: true,
  idpAutoProvisioningEnabled: false,
  loginInitiationUri: 'https://app.example.com/login',
  postVerificationRedirectUri: 'https://app.example.com/login',
  identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_MAGIC_LINK'] }, { kind: 'PHONE', methods: ['PASSWORD'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }],
  defaultIdentifierKind: 'EMAIL',
  defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
  allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'],
  allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'],
  methods: [
    {
      type: 'PASSWORD',
      enabled: true,
      configured: true,
      availableForLogin: true,
      availableForSignup: true,
      unavailableReason: null,
    },
    {
      type: 'EMAIL_MAGIC_LINK',
      enabled: true,
      configured: true,
      availableForLogin: true,
      availableForSignup: false,
      unavailableReason: null,
    },
  ],
  idpProviders: [googleAuthMethodProvider],
  resend: {
    emailVerificationCooldownSeconds: 45,
  },
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${body}.fake-sig`
}

function makeTokenSet(overrides: Partial<TokenSet> = {}): TokenSet {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: makeJwt({ sub: 'user-1', exp }),
    refresh_token: 'rt-abc',
    id_token: 'id-token',
    token_type: 'Bearer',
    expires_in: 3600,
    ...overrides,
  }
}

describe('OAuthClient', () => {
  let client: OAuthClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    fetchMock = vi.fn()
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/me')) return {ok:true,json:async()=>view()}
      return fetchMock(input,init)
    }) as typeof fetch
    client = new OAuthClient(defaultConfig)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('discover', () => {
    it('fetches OIDC configuration', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      const config = await client.discover()
      expect(config.issuer).toBe(ISSUER)
      expect(config.authorization_endpoint).toBe(`${ISSUER}/authorize`)
      expect(config.jwks_uri).toBe(`${ISSUER}/oauth2/jwks`)
      expect(fetchMock).toHaveBeenCalledWith(
        `${ISSUER}/.well-known/openid-configuration`,
        expect.objectContaining({
          method: 'GET',
          headers: {},
        }),
      )
    })

    it('caches discovery result', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      await client.discover()
      await client.discover()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('throws on discovery failure', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
      await expect(client.discover()).rejects.toThrow('IAM API request failed (500)')
    })
  })

  describe('token storage policy', () => {
    it('keeps OAuthClient tokens memory-only by default', () => {
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      client.tokenManager.setPermissions(['orders:read'])

      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('persists OAuthClient tokens only when sessionStorage is explicitly enabled', () => {
      const persistentClient = new OAuthClient({
        ...defaultConfig,
        tokenStorage: 'sessionStorage',
      })

      storeOAuthTokens(persistentClient.tokenManager, makeTokenSet())
      persistentClient.tokenManager.setPermissions(['orders:read'])

      expect(JSON.parse(sessionStorage.getItem('axis_iam_session') ?? '{}')).toMatchObject({
        version: 6,
        expiresAt: Date.now() + 3600_000,
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      })
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('propagates typed sessionStorage read, write, and removal failures', () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('private browser read detail', 'SecurityError')
      })
      expect(() => new OAuthClient({ ...defaultConfig, tokenStorage: 'sessionStorage' })).toThrow(
        IamConfigurationError,
      )
      getItem.mockRestore()

      const persistentClient = new OAuthClient({ ...defaultConfig, tokenStorage: 'sessionStorage' })
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('private browser write detail', 'SecurityError')
      })
      expect(() => storeOAuthTokens(persistentClient.tokenManager, makeTokenSet())).toThrow(
        IamConfigurationError,
      )
      expect(persistentClient.isAuthenticated()).toBe(false)
      setItem.mockRestore()

      storeOAuthTokens(persistentClient.tokenManager, makeTokenSet())
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('private browser removal detail', 'SecurityError')
      })
      expect(() => persistentClient.tokenManager.clear()).toThrow(IamConfigurationError)
      expect(persistentClient.isAuthenticated()).toBe(false)
      removeItem.mockRestore()
    })
  })

  describe('startAuthorizationFlow', () => {
    it('builds authorization URL with PKCE', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      const url = await client.startAuthorizationFlow()
      const parsed = new URL(url)

      expect(parsed.origin + parsed.pathname).toBe(`${ISSUER}/authorize`)
      expect(parsed.searchParams.get('response_type')).toBe('code')
      expect(parsed.searchParams.get('client_id')).toBe('my-app')
      expect(parsed.searchParams.has('client_secret')).toBe(false)
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
      expect(parsed.searchParams.get('code_challenge')).toBeTruthy()
      expect(parsed.searchParams.get('state')).toBeTruthy()
      expect(parsed.searchParams.get('scope')).toBe('openid profile email offline_access')
    })

    it('includes audience when configured', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      const clientWithAudience = new OAuthClient({
        ...defaultConfig,
        audience: 'https://api.example.com',
      })

      const url = await clientWithAudience.startAuthorizationFlow()
      const parsed = new URL(url)
      expect(parsed.searchParams.get('audience')).toBe('https://api.example.com')
    })

    it('stores PKCE verifier and state in sessionStorage', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      await client.startAuthorizationFlow()
      expect(JSON.parse(sessionStorage.getItem('axis_iam_pending_authorization')!).entryMode).toBe('HOSTED')
      expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()
    })
  })

  describe('identity provider discovery', () => {
    it('lists public identity providers for the current ApplicationClient', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [googleProvider],
        })

      const providers = await client.listIdentityProviders()

      expect(providers).toEqual([googleProvider])
      expect(fetchMock).toHaveBeenLastCalledWith(
        `${ISSUER}/api/v1/apps/my-app/identity-providers`,
        expect.objectContaining({
          method: 'GET',
          headers: {},
        }),
      )
    })

  })

  describe('public auth policy', () => {
    it('fetches and caches resolved public auth policy for the current ApplicationClient', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => publicAuthPolicy,
        })

      const first = await client.getPublicAuthPolicy()
      const second = await client.getPublicAuthPolicy()

      expect(first).not.toHaveProperty('emailVerificationMode')
      expect(second).toBe(first)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/apps/my-app/auth-policy`)
    })

    it('fails when public auth policy lacks email verification fields', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ passwordLoginEnabled: true }),
        })

      await expect(client.getPublicAuthPolicy()).rejects.toThrow(
        'Auth policy response is missing registration policy fields',
      )
    })

    it('does not cache a failed public auth policy request', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'temporarily unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => publicAuthPolicy,
        })

      await expect(client.getPublicAuthPolicy()).rejects.toThrow('temporarily unavailable')
      await expect(client.getPublicAuthPolicy()).resolves.toMatchObject({
      })
    })
  })

  describe('public auth methods', () => {
    it('fetches and caches resolved public auth methods for the current ApplicationClient', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => publicAuthMethods,
        })

      const first = await client.getPublicAuthMethods()
      const second = await client.getPublicAuthMethods()

      expect(first).not.toHaveProperty('emailVerificationMode')
      expect(first.resend.emailVerificationCooldownSeconds).toBe(45)
      expect(second).toBe(first)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/apps/my-app/auth-methods`)
    })

    it('rejects missing resend metadata rather than inventing a cooldown', async () => {
      const { resend: _resend, ...legacyResponse } = publicAuthMethods
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => legacyResponse,
        })

      await expect(client.getPublicAuthMethods()).rejects.toThrow('Auth methods response is missing required fields')
    })

    it('fails when public auth methods lacks required fields', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ }),
        })

      await expect(client.getPublicAuthMethods()).rejects.toThrow(
        'Auth methods response is missing required fields',
      )
    })

    it('does not cache a failed public auth methods request', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          json: async () => ({ message: 'temporarily unavailable' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => publicAuthMethods,
        })

      await expect(client.getPublicAuthMethods()).rejects.toThrow('temporarily unavailable')
      await expect(client.getPublicAuthMethods()).resolves.toMatchObject({
      })
    })

    it('returns app continuation values without an internal application id', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => publicAuthMethods,
        })

      const clientWithLogout = new OAuthClient({
        ...defaultConfig,
        postLogoutRedirectUri: 'https://app.example.com/signed-out',
      })

      const continuation = await clientWithLogout.getAppContinuation()
      expect(continuation).toEqual({
        loginInitiationUri: 'https://app.example.com/login',
        postVerificationRedirectUri: 'https://app.example.com/login',
        postLogoutRedirectUri: 'https://app.example.com/signed-out',
      })
      expect('applicationId' in continuation).toBe(false)
    })
  })

  describe('handleCallback', () => {
    beforeEach(() => {
      client.dispose()
      client = new OAuthClient({ ...defaultConfig, scopes: ['profile'] })
    })
    it('exchanges code for tokens', async () => {
      // Setup: start auth flow first to store state and verifier
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })
      const url = await client.startAuthorizationFlow()
      const state = new URL(url).searchParams.get('state')!

      const tokens = makeTokenSet()
      // Discovery is cached; next fetch is the token exchange
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => tokens,
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ applicationId: 'app-1', organizationId: null, roles: [], permissions: [] }),
      })

      const result = await client.handleCallback('auth-code-123', state)
      expect(result.access_token).toBe(tokens.access_token)
      expect(client.isAuthenticated()).toBe(true)
      expect(client.tokenManager.getRefreshProvenance()).toBe('OAUTH_TOKEN_ENDPOINT')

      const tokenRequest = fetchMock.mock.calls.at(-2)
      expect(tokenRequest?.[0]).toBe(`${ISSUER}/token`)
      expect(tokenRequest?.[1]?.body.toString()).toContain('grant_type=authorization_code')
      expect(tokenRequest?.[1]?.body.toString()).toContain('code_verifier=')
      expect(tokenRequest?.[1]?.body.toString()).not.toContain('client_secret')
    })

    it('throws on state mismatch', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })
      await client.startAuthorizationFlow()

      await expect(client.handleCallback('code', 'wrong-state')).rejects.toThrow('OAuth state mismatch')
    })

    it('throws when PKCE verifier is missing', async () => {
      sessionStorage.setItem('iam_oauth_state', 'valid-state')
      // No verifier stored

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      await expect(client.handleCallback('code', 'valid-state')).rejects.toMatchObject({code:'AUTH_CONTROL_LOST'})
    })

    it('throws on token exchange failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })
      const url = await client.startAuthorizationFlow()
      const state = new URL(url).searchParams.get('state')!

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      })

      await expect(client.handleCallback('bad-code', state)).rejects.toThrow('invalid_grant')
    })

    it('handles and scrubs the current redirect callback URL', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })
      const url = await client.startAuthorizationFlow()
      const state = new URL(url).searchParams.get('state')!
      window.history.pushState({}, '', `/callback?code=auth-code-123&state=${state}`)

      const tokens = makeTokenSet()
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => tokens,
      })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ applicationId: 'app-1', organizationId: null, roles: [], permissions: [] }),
      })

      const result = await client.handleRedirectCallback()

      expect(result).toMatchObject({ status: 'success', tokens })
      expect(window.location.pathname).toBe('/callback')
      expect(window.location.search).toBe('')
      expect(window.location.hash).toBe('')
    })

    it('returns an error callback result without calling the token endpoint', async () => {
      fetchMock.mockResolvedValueOnce({ok:true,json:async()=>mockOidcConfig})
      const authorization=new URL(await client.startAuthorizationFlow())
      window.history.pushState({}, '', `/callback?error=access_denied&error_description=Denied&state=${authorization.searchParams.get('state')}`)

      const result = await client.handleRedirectCallback()

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error.message).toBe('Denied')
      }
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(window.location.search).toBe('')
    })

    it('returns idle when the URL is not an OAuth callback', async () => {
      const result = await client.handleRedirectCallback({ url: 'https://app.example.com/dashboard' })

      expect(result).toEqual({ status: 'idle' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps callback parameters when cleanUrl is false', async () => {
      window.history.pushState({}, '', '/callback?error=access_denied')

      const result = await client.handleRedirectCallback({ cleanUrl: false })

      expect(result.status).toBe('error')
      expect(window.location.search).toBe('?error=access_denied')
    })
  })

  describe('refreshToken', () => {
    it('clears the rotated session when automatic refresh canonical permissions returns 401', async () => {
      const persistentClient = new OAuthClient({ ...defaultConfig, tokenStorage: 'sessionStorage' })
      const exp = Math.floor(Date.now() / 1000) + 120
      persistentClient.tokenManager.store(
        makeTokenSet({
          access_token: makeJwt({ sub: 'user-1', roles: ['old-role'], exp }),
          expires_in: 120,
        }),
        'OAUTH_AUTHORIZATION_CODE',
        'OAUTH_TOKEN_ENDPOINT',
      )
      persistentClient.tokenManager.setAuthorization(['old-role'], ['orders:read'])
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
        .mockResolvedValueOnce({
          ok: true,
          json: async () =>
            makeTokenSet({
              access_token: makeJwt({ sub: 'user-1', roles: ['rotated-role'], exp: exp + 3600 }),
              refresh_token: 'rt-rotated',
            }),
        })
        .mockResolvedValueOnce({ ok: false, status: 401 })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
        `${ISSUER}/.well-known/openid-configuration`,
        `${ISSUER}/token`,
        `${ISSUER}/api/v1/auth/me/permissions`,
      ])
      expect(persistentClient.isAuthenticated()).toBe(false)
      expect(persistentClient.tokenManager.getAccessToken()).toBeNull()
      expect(persistentClient.tokenManager.getRefreshToken()).toBeNull()
      expect(persistentClient.tokenManager.getRoles()).toEqual([])
      expect(persistentClient.tokenManager.getPermissions()).toEqual([])
      expect(persistentClient.tokenManager.getRefreshProvenance()).toBeNull()
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it('refreshes OAuth tokens only through the discovered token endpoint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      // Store initial tokens with refresh_token
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      const newTokens = makeTokenSet({ refresh_token: 'rt-rotated' })
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => newTokens,
      })

      fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({applicationId:'app-1',organizationId:null,roles:[],permissions:[]})})
      const result = await client.refreshToken()
      expect(result.access_token).toBe(newTokens.access_token)
      const request = fetchMock.mock.calls[1]
      expect(request?.[0]).toBe(`${ISSUER}/token`)
      expect(request?.[1]).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      expect(String(request?.[1]?.body)).toContain('grant_type=refresh_token')
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/token/refresh')),
      ).toBe(false)
    })



    it('throws when no refresh token available', async () => {
      // No tokens stored at all
      await expect(client.refreshToken()).rejects.toMatchObject({
        reason: 'SESSION_UNAVAILABLE',
        retryable: false,
      })
    })

    it('throws on refresh failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      storeOAuthTokens(client.tokenManager, makeTokenSet())

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      })

      await expect(client.refreshToken()).rejects.toMatchObject({
        reason: 'SESSION_REJECTED',
        status: 401,
        retryable: false,
      })
      expect(
        fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/token/refresh')),
      ).toBe(false)
    })


    it('keeps a new login when an older Direct logout completes', async () => {
      let complete!: (response: Response) => void
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      )
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      const pending = client.logout({ redirect: false })
      const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
      expect(client.getAccessToken()).toBeNull()
      storeOAuthTokens(client.tokenManager, makeTokenSet({ refresh_token: 'new-session' }))
      complete(new Response(null, { status: 204 }))
      await rejected
      expect(client.tokenManager.getRefreshToken()).toBe('new-session')
    })

    it('uses one Direct request for concurrent manual refresh callers', async () => {
      let complete!: (response: Response) => void
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input).includes('openid-configuration'))
          return new Response(JSON.stringify(mockOidcConfig))
        if (String(input).endsWith('/permissions'))
          return new Response(
            JSON.stringify({
              applicationId: 'app-1',
              organizationId: null,
              roles: ['member'],
              permissions: [],
            }),
          )
        return await new Promise<Response>((resolve) => {
          complete = resolve
        })
      })
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      const first = client.refreshToken()
      expect(client.refreshToken()).toBe(first)
      await Promise.resolve()
      complete(new Response(JSON.stringify(makeTokenSet({ refresh_token: 'rotated' }))))
      await first
      expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/token/refresh'))).toHaveLength(
        1,
      )
      expect(client.tokenManager.getRefreshToken()).toBe('rotated')
      expect(client.tokenManager.getRoles()).toEqual(['member'])
    })
  })

  describe('fetchPermissions', () => {
    it('fetches current-user permissions from the canonical auth endpoint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          applicationId: 'app-1',
          organizationId: null,
          roles: ['current-admin'],
          permissions: ['orders:read'],
        }),
      })

      const permissions = await client.fetchPermissions()

      expect(permissions).toEqual(['orders:read'])
      expect(client.tokenManager.getUser()).toMatchObject({
        roles: ['current-admin'],
        permissions: ['orders:read'],
      })
      expect(fetchMock).toHaveBeenLastCalledWith(
        `${ISSUER}/api/v1/auth/me/permissions`,
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: `Bearer ${client.getAccessToken()}` },
        }),
      )
    })

    it('retains an observable permission error instead of returning empty success', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      client.tokenManager.setAuthorization(['stale-role'], ['stale:permission'])
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })

      await expect(client.fetchPermissions()).rejects.toThrow('IAM API request failed (503)')
      expect(client.isAuthenticated()).toBe(false)
      expect(client.tokenManager.getRoles()).toEqual([])
      expect(client.tokenManager.getPermissions()).toEqual([])
      expect(client.tokenManager.getLastPermissionError()?.message).toBe('IAM API request failed (503)')
    })

    it('accepts a valid zero-role canonical summary without clearing authentication', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ applicationId: 'app-1', organizationId: null, roles: [], permissions: [] }),
      })

      await expect(client.fetchPermissions()).resolves.toEqual([])
      expect(client.isAuthenticated()).toBe(true)
      expect(client.tokenManager.getUser()).toMatchObject({ roles: [], permissions: [] })
    })

    it('fails closed on a malformed canonical summary while preserving valid authentication', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      client.tokenManager.setAuthorization(['stale-role'], ['stale:permission'])
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ applicationId: 123, organizationId: null, roles: 'admin', permissions: [] }),
      })

      await expect(client.fetchPermissions()).rejects.toThrow('IAM permissions response was malformed')
      expect(client.isAuthenticated()).toBe(false)
      expect(client.tokenManager.getUser()).toBeNull()
      expect(client.tokenManager.getLastPermissionError()?.message).toBe(
        'IAM permissions response was malformed',
      )
    })

    it('clears identity when the canonical permission request rejects authentication', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })

      await expect(client.fetchPermissions()).rejects.toThrow('IAM API request failed (401)')
      expect(client.isAuthenticated()).toBe(false)
      expect(client.tokenManager.getUser()).toBeNull()
    })
  })

  describe('email verification', () => {
    it('sends verification email with client_id and no application context header', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Verification email sent' }),
        })

      await client.sendEmailVerification({ email: 'user@example.com' })

      const request = fetchMock.mock.calls.at(-1)
      expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/email/verification/send`)
      expect(request?.[1]?.method).toBe('POST')
      expect(request?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(request?.[1]?.body as string)).toEqual({
        email: 'user@example.com',
        client_id: 'my-app',
      })
      expect(request?.[1]?.headers).not.toHaveProperty('X-Application-Id')
    })
  })

  describe('logout', () => {
    it('fails closed during construction when persisted provenance is invalid', () => {
      sessionStorage.setItem(
        'axis_iam_session',
        JSON.stringify({
          version: 4,
          expiresAt: Date.now() + 3600_000,
          tokens: makeTokenSet(),
          roles: [],
          permissions: [],
          authenticationProvenance: 'UNKNOWN',
          refreshProvenance: 'UNKNOWN',
        }),
      )
      expect(
        () =>
          new OAuthClient({
            ...defaultConfig,
            tokenStorage: 'sessionStorage',
          }),
      ).toThrow(IamConfigurationError)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it('does not resend stale Direct Auth tokens on a second logout', async () => {
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })

      await client.logout({ redirect: false })
      await expect(client.logout({ redirect: false })).rejects.toThrow(
        'Logout requires an authenticated session with explicit authentication provenance',
      )

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('clears tokens', () => {
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      expect(client.isAuthenticated()).toBe(true)
      client.logout()
      expect(client.isAuthenticated()).toBe(false)
    })

    it('builds logout URL with id_token_hint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      const clientWithLogout = new OAuthClient({
        ...defaultConfig,
        postLogoutRedirectUri: 'https://app.example.com/signed-out',
      })
      storeOAuthTokens(clientWithLogout.tokenManager, makeTokenSet())
      const logoutUrl = await clientWithLogout.getLogoutUrl()
      expect(logoutUrl).toBeTruthy()
      const parsed = new URL(logoutUrl!)
      expect(parsed.origin + parsed.pathname).toBe(`${ISSUER}/logout`)
      expect(parsed.searchParams.get('id_token_hint')).toBe('id-token')
      expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/signed-out')
    })

    it('uses a per-call post logout redirect URI', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      storeOAuthTokens(client.tokenManager, makeTokenSet())
      const logoutUrl = await client.getLogoutUrl({
        postLogoutRedirectUri: 'https://app.example.com/after-logout',
      })

      const parsed = new URL(logoutUrl!)
      expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/after-logout')
    })

    it('does not build IAM logout without an id token hint', async () => {
      const { id_token: _idToken, ...tokensWithoutIdToken } = makeTokenSet()
      storeOAuthTokens(client.tokenManager, tokensWithoutIdToken)

      await expect(client.getLogoutUrl()).resolves.toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not build IAM logout without an end session endpoint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockOidcConfig,
          end_session_endpoint: undefined,
        }),
      })

      storeOAuthTokens(client.tokenManager, makeTokenSet())

      await expect(client.getLogoutUrl()).resolves.toBeNull()
    })

    it('clears local tokens when IAM logout discovery fails', async () => {
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockRejectedValueOnce(new Error('discovery unavailable'))

      await expect(client.logout({ redirect: true })).rejects.toBeInstanceOf(Error)

      expect(client.isAuthenticated()).toBe(false)
    })
  })
})
