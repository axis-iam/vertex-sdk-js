import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { OAuthClient } from './oauth-client'
import type { TokenManager } from './token-manager'
import { IamApiError, IamConfigurationError } from './types'
import type { AccountLoginMethod, AuthMethodIdpProviderResponse, IamConfig, IdentityProviderOption, LinkableIdentityProvider, OIDCConfiguration, PublicAuthMethodsResponse, TokenSet } from './types'

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
}

function storeDirectTokens(manager: TokenManager, tokens: TokenSet): void {
  manager.store(tokens, 'DIRECT_AUTH', tokens.refresh_token ? 'DIRECT_AUTH' : null)
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

const samlProvider: IdentityProviderOption = {
  ...googleProvider,
  id: 'idp-saml',
  providerType: 'SAML',
  name: 'saml',
  displayName: 'SAML',
  protocol: 'SAML',
  authorizationUrl: null,
}

const passwordMethod: AccountLoginMethod = {
  methodId: 'credential:PASSWORD',
  kind: 'CREDENTIAL',
  credentialType: 'PASSWORD',
  identityProviderId: null,
  providerKey: null,
  providerType: null,
  protocol: null,
  displayName: 'Password',
  linkedAt: '2026-06-27T10:15:30Z',
  providerUserId: null,
  unlinkable: false,
}

const googleMethod: AccountLoginMethod = {
  methodId: 'idp:idp-google',
  kind: 'IDENTITY_PROVIDER',
  credentialType: null,
  identityProviderId: 'idp-google',
  providerKey: 'GOOGLE:idp-google',
  providerType: 'GOOGLE',
  protocol: 'OIDC',
  displayName: 'Google',
  linkedAt: '2026-06-27T10:20:30Z',
  providerUserId: 'masked',
  unlinkable: true,
}

const linkableGoogle: LinkableIdentityProvider = {
  id: 'idp-google',
  providerType: 'GOOGLE',
  protocol: 'OIDC',
  displayName: 'Google',
  enabled: true,
  linked: false,
  linkedAt: null,
  supportsAccountLinking: true,
}

const publicAuthPolicy = {
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
  emailVerificationMode: 'REQUIRED',
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
  emailVerificationMode: 'REQUIRED',
  idpAutoProvisioningEnabled: false,
  loginInitiationUri: 'https://app.example.com/login',
  postVerificationRedirectUri: 'https://app.example.com/login',
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
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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
    globalThis.fetch = fetchMock
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
      expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/.well-known/openid-configuration`, expect.objectContaining({
        method: 'GET',
        headers: {},
      }))
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
        version: 3,
        roles: [],
        permissions: ['orders:read'],
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
      expect(() => new OAuthClient({ ...defaultConfig, tokenStorage: 'sessionStorage' }))
        .toThrow(IamConfigurationError)
      getItem.mockRestore()

      const persistentClient = new OAuthClient({ ...defaultConfig, tokenStorage: 'sessionStorage' })
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('private browser write detail', 'SecurityError')
      })
      expect(() => storeOAuthTokens(persistentClient.tokenManager, makeTokenSet()))
        .toThrow(IamConfigurationError)
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
      expect(sessionStorage.getItem('iam_pkce_verifier')).toBeTruthy()
      expect(sessionStorage.getItem('iam_oauth_state')).toBeTruthy()
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
      expect(fetchMock).toHaveBeenLastCalledWith(`${ISSUER}/api/v1/apps/my-app/identity-providers`, expect.objectContaining({
        method: 'GET',
        headers: {},
      }))
    })

    it('starts selected provider authorization with Authorization Code and PKCE', async () => {
      const upstreamUrl = 'https://accounts.example.test/oauth2/auth'
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorizationUrl: upstreamUrl }),
      })

      const url = await client.startProviderAuthorizationFlow(googleProvider)
      expect(url).toBe(upstreamUrl)

      const providerRequest = fetchMock.mock.calls[0]
      expect(providerRequest?.[0]).toBe(googleProvider.authorizationUrl)
      expect(providerRequest?.[1]?.method).toBe('POST')
      expect(providerRequest?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })

      const body = JSON.parse(providerRequest?.[1]?.body as string) as Record<string, string>
      expect(body).toMatchObject({
        completionMode: 'AUTHORIZATION_CODE',
        scope: 'openid profile email offline_access',
        codeChallengeMethod: 'S256',
      })
      expect(body.redirectUri).toContain('/callback')
      expect(body.state).toBeTruthy()
      expect(body.codeChallenge).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain('clientSecret')
      expect(JSON.stringify(body)).not.toContain('client_secret')
      expect(sessionStorage.getItem('iam_pkce_verifier')).toBeTruthy()
      expect(sessionStorage.getItem('iam_oauth_state')).toBe(body.state)
    })

    it('starts auth-method provider authorization with Authorization Code and PKCE', async () => {
      const upstreamUrl = 'https://accounts.example.test/oauth2/auth'
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorizationUrl: upstreamUrl }),
      })

      const url = await client.startProviderAuthorizationFlow(googleAuthMethodProvider)
      expect(url).toBe(upstreamUrl)

      const providerRequest = fetchMock.mock.calls[0]
      expect(providerRequest?.[0]).toBe(googleAuthMethodProvider.authorizationUrl)
      expect(providerRequest?.[1]?.method).toBe('POST')
      const body = JSON.parse(providerRequest?.[1]?.body as string) as Record<string, string>
      expect(body).toMatchObject({
        completionMode: 'AUTHORIZATION_CODE',
        scope: 'openid profile email offline_access',
        codeChallengeMethod: 'S256',
      })
      expect(body.state).toBeTruthy()
      expect(body.codeChallenge).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain('clientSecret')
      expect(JSON.stringify(body)).not.toContain('client_secret')
    })

    it('can resolve a selected provider by id before authorization', async () => {
      const upstreamUrl = 'https://github.example.test/login/oauth/authorize'
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [googleProvider],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ authorizationUrl: upstreamUrl }),
        })

      const url = await client.startProviderAuthorizationFlow('idp-google')

      expect(url).toBe(upstreamUrl)
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/apps/my-app/identity-providers`)
      expect(fetchMock.mock.calls[2]?.[0]).toBe(googleProvider.authorizationUrl)
    })

    it('rejects unsupported providers before redirect', async () => {
      await expect(
        client.startProviderAuthorizationFlow(samlProvider),
      ).rejects.toThrow('Identity provider is not available for embedded sign-in')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps handleCallback compatible after selected provider login starts', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorizationUrl: 'https://accounts.example.test/oauth2/auth' }),
      })

      await client.startProviderAuthorizationFlow(googleProvider)
      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { state: string }

      const tokens = makeTokenSet()
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => tokens,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ applicationId: 'app-1', organizationId: null, roles: ['callback-current-role'], permissions: [] }),
        })

      const result = await client.handleCallback('java-iam-code', body.state)

      expect(result.access_token).toBe(tokens.access_token)
      expect(client.isAuthenticated()).toBe(true)
      expect(client.tokenManager.getUser()?.roles).toEqual(['callback-current-role'])
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

      expect(first.emailVerificationMode).toBe('REQUIRED')
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

      await expect(client.getPublicAuthPolicy()).rejects.toThrow('Auth policy response is missing registration policy fields')
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
        emailVerificationMode: 'REQUIRED',
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

      expect(first.emailVerificationMode).toBe('REQUIRED')
      expect(first.resend.emailVerificationCooldownSeconds).toBe(45)
      expect(second).toBe(first)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/apps/my-app/auth-methods`)
    })

    it('defaults email verification resend cooldown for older auth-method responses', async () => {
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

      await expect(client.getPublicAuthMethods()).resolves.toMatchObject({
        resend: {
          emailVerificationCooldownSeconds: 60,
        },
      })
    })

    it('fails when public auth methods lacks required fields', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ emailVerificationMode: 'REQUIRED' }),
        })

      await expect(client.getPublicAuthMethods()).rejects.toThrow('Auth methods response is missing required fields')
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
        emailVerificationMode: 'REQUIRED',
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

      await expect(
        client.handleCallback('code', 'wrong-state'),
      ).rejects.toThrow('OAuth state mismatch')
    })

    it('throws when PKCE verifier is missing', async () => {
      sessionStorage.setItem('iam_oauth_state', 'valid-state')
      // No verifier stored

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })

      await expect(
        client.handleCallback('code', 'valid-state'),
      ).rejects.toThrow('Missing PKCE code_verifier')
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

      await expect(
        client.handleCallback('bad-code', state),
      ).rejects.toThrow('invalid_grant')
    })

    it('handles and scrubs the current redirect callback URL', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockOidcConfig,
      })
      const url = await client.startAuthorizationFlow()
      const state = new URL(url).searchParams.get('state')!
      window.history.pushState({}, '', `/callback?code=auth-code-123&state=${state}&next=keep#section`)

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
      expect(window.location.search).toBe('?next=keep')
      expect(window.location.hash).toBe('#section')
    })

    it('returns an error callback result without calling the token endpoint', async () => {
      window.history.pushState({}, '', '/callback?error=access_denied&error_description=Denied')

      const result = await client.handleRedirectCallback()

      expect(result.status).toBe('error')
      if (result.status === 'error') {
        expect(result.error.message).toBe('Denied')
      }
      expect(fetchMock).not.toHaveBeenCalled()
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
      persistentClient.tokenManager.store(makeTokenSet({
        access_token: makeJwt({ sub: 'user-1', roles: ['old-role'], exp }),
      }), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
      persistentClient.tokenManager.setAuthorization(['old-role'], ['orders:read'])
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => makeTokenSet({
            access_token: makeJwt({ sub: 'user-1', roles: ['rotated-role'], exp: exp + 3600 }),
            refresh_token: 'rt-rotated',
          }),
        })
        .mockResolvedValueOnce({ ok: false, status: 401 })

      await vi.advanceTimersByTimeAsync(60_000)

      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
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

      const result = await client.refreshToken()
      expect(result.access_token).toBe(newTokens.access_token)
      const request = fetchMock.mock.calls[1]
      expect(request?.[0]).toBe(`${ISSUER}/token`)
      expect(request?.[1]).toMatchObject({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      expect(String(request?.[1]?.body)).toContain('grant_type=refresh_token')
      expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/v1/auth/token/refresh'))).toBe(false)
    })

    it('refreshes Direct Auth tokens only through the JSON Direct endpoint', async () => {
      client.tokenManager.store(makeTokenSet(), 'DIRECT_AUTH', 'DIRECT_AUTH')
      const newTokens = makeTokenSet({ refresh_token: 'rt-rotated' })
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => newTokens })

      await expect(client.refreshToken()).resolves.toEqual(newTokens)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/token/refresh`, expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'rt-abc', client_id: 'my-app' }),
      }))
      const request = fetchMock.mock.calls[0]?.[1]
      expect(request?.headers).not.toHaveProperty('Authorization')
      expect(JSON.stringify(request)).not.toContain('client_secret')
      expect(JSON.stringify(request)).not.toContain('clientSecret')
    })

    it('defers a 60-second Direct Auth automatic refresh and uses only the Direct endpoint', async () => {
      const persistentClient = new OAuthClient({ ...defaultConfig, tokenStorage: 'sessionStorage' })
      const exp = Math.floor(Date.now() / 1000) + 60
      const refreshed = makeTokenSet({
        access_token: makeJwt({ sub: 'user-1', exp: exp + 900 }),
        refresh_token: 'rt-rotated',
      })
      persistentClient.tokenManager.store(
        makeTokenSet({ access_token: makeJwt({ sub: 'user-1', exp }) }),
        'DIRECT_AUTH',
        'DIRECT_AUTH',
      )

      await vi.advanceTimersByTimeAsync(29_999)
      expect(fetchMock).not.toHaveBeenCalled()

      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => refreshed })
        .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ applicationId: 'app-1', organizationId: null, roles: ['member'], permissions: ['orders:read'] }),
        })

      await vi.advanceTimersByTimeAsync(1)

      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
        `${ISSUER}/api/v1/auth/token/refresh`,
        `${ISSUER}/.well-known/openid-configuration`,
        `${ISSUER}/api/v1/auth/me/permissions`,
      ])
      expect(fetchMock.mock.calls.some(call => String(call[0]) === mockOidcConfig.token_endpoint)).toBe(false)
      expect(persistentClient.tokenManager.getRefreshToken()).toBe('rt-rotated')
      expect(persistentClient.tokenManager.getRefreshProvenance()).toBe('DIRECT_AUTH')
      expect(persistentClient.tokenManager.getPermissions()).toEqual(['orders:read'])
    })

    it('throws when no refresh token available', async () => {
      // No tokens stored at all
      await expect(client.refreshToken()).rejects.toThrow('No refresh token available')
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

      await expect(client.refreshToken()).rejects.toThrow('IAM API request failed (401)')
      expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/v1/auth/token/refresh'))).toBe(false)
    })

    it('does not try OAuth after Direct Auth refresh fails', async () => {
      client.tokenManager.store(makeTokenSet(), 'DIRECT_AUTH', 'DIRECT_AUTH')
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 })

      await expect(client.refreshToken()).rejects.toThrow('IAM API request failed (401)')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/auth/token/refresh')
      expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith('/token'))).toBe(false)
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
        json: async () => ({ applicationId: 'app-1', organizationId: null, roles: ['current-admin'], permissions: ['orders:read'] }),
      })

      const permissions = await client.fetchPermissions()

      expect(permissions).toEqual(['orders:read'])
      expect(client.tokenManager.getUser()).toMatchObject({ roles: ['current-admin'], permissions: ['orders:read'] })
      expect(fetchMock).toHaveBeenLastCalledWith(`${ISSUER}/api/v1/auth/me/permissions`, expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `Bearer ${client.getAccessToken()}` },
      }))
    })

    it('retains an observable permission error instead of returning empty success', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      storeOAuthTokens(client.tokenManager, makeTokenSet())
      client.tokenManager.setAuthorization(['stale-role'], ['stale:permission'])
      fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })

      await expect(client.fetchPermissions()).rejects.toThrow('IAM API request failed (503)')
      expect(client.isAuthenticated()).toBe(true)
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
      expect(client.isAuthenticated()).toBe(true)
      expect(client.tokenManager.getUser()).toMatchObject({ roles: [], permissions: [] })
      expect(client.tokenManager.getLastPermissionError()?.message).toBe('IAM permissions response was malformed')
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

  describe('current-user account linking', () => {
    it('lists account login methods with bearer auth', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [passwordMethod, googleMethod],
        })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      const methods = await client.listAccountLoginMethods()

      expect(methods).toEqual([passwordMethod, googleMethod])
      expect(fetchMock).toHaveBeenLastCalledWith(`${ISSUER}/api/v1/auth/me/login-methods`, expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `Bearer ${client.getAccessToken()}` },
      }))
    })

    it('lists linkable identity providers with bearer auth', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [linkableGoogle],
        })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      const providers = await client.listLinkableIdentityProviders()

      expect(providers).toEqual([linkableGoogle])
      const request = fetchMock.mock.calls.at(-1)
      expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/linkable-identity-providers`)
      expect(request?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${client.getAccessToken()}` })
    })

    it('starts account link through IAM with current access token and no client secret', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            authorizationUrl: 'https://accounts.example.test/oauth2/auth',
            state: 'client-state',
            expiresAt: '2026-06-27T10:25:30Z',
          }),
        })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      const result = await client.startAccountLink('idp-google', {
        redirectUri: 'https://app.example.test/account-link/callback',
        state: 'client-state',
      })

      expect(result.authorizationUrl).toBe('https://accounts.example.test/oauth2/auth')
      const request = fetchMock.mock.calls.at(-1)
      expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/identity-providers/idp-google/link/authorize`)
      expect(request?.[1]?.method).toBe('POST')
      expect(request?.[1]?.headers).toMatchObject({
        Authorization: `Bearer ${client.getAccessToken()}`,
        'Content-Type': 'application/json',
      })
      const body = JSON.parse(request?.[1]?.body as string) as Record<string, string>
      expect(body).toEqual({
        redirectUri: 'https://app.example.test/account-link/callback',
        state: 'client-state',
      })
      expect(JSON.stringify(body)).not.toContain('clientSecret')
      expect(JSON.stringify(body)).not.toContain('client_secret')
    })

    it('exchanges account-link ticket without calling token endpoint or replacing tokens', async () => {
      const tokens = makeTokenSet()
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ method: googleMethod }),
        })
      storeOAuthTokens(client.tokenManager, tokens)

      const result = await client.exchangeAccountLinkTicket({
        linkTicket: 'fake-ticket',
        state: 'client-state',
      })

      expect(result.method).toEqual(googleMethod)
      expect(client.getAccessToken()).toBe(tokens.access_token)
      const urls = fetchMock.mock.calls.map((call) => String(call[0]))
      expect(urls).not.toContain(`${ISSUER}/token`)
      const request = fetchMock.mock.calls.at(-1)
      expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/identity-providers/link-ticket/exchange`)
      expect(request?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${tokens.access_token}` })
      expect(JSON.parse(request?.[1]?.body as string)).toEqual({
        linkTicket: 'fake-ticket',
        state: 'client-state',
      })
    })

    it('unlinks account login method with URL-encoded methodId', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      await client.unlinkAccountLoginMethod('idp:idp-google')

      const request = fetchMock.mock.calls.at(-1)
      expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/login-methods/idp%3Aidp-google`)
      expect(request?.[1]?.method).toBe('DELETE')
    })

    it('fails closed when account-linking API is called without a current token', async () => {
      await expect(client.listAccountLoginMethods()).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('preserves typed step-up errors from account-linking API calls', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({
            status: 403,
            error: 'STEP_UP_REQUIRED',
            message: 'Step-up authentication required',
            details: {
              trigger: 'MFA_CHANGE',
              methods: ['TOTP'],
            },
          }),
        })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      const request = client.unlinkAccountLoginMethod('idp:idp-google')
      await expect(request).rejects.toMatchObject({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        details: {
          trigger: 'MFA_CHANGE',
          methods: ['TOTP'],
        },
      })
      await expect(request).rejects.toBeInstanceOf(IamApiError)
    })

    it('preserves typed step-up errors for link start and ticket exchange', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockOidcConfig,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: async () => ({
            status: 403,
            error: 'STEP_UP_REQUIRED',
            message: 'Step-up authentication required',
            details: {
              trigger: 'MFA_CHANGE',
              methods: ['TOTP'],
            },
          }),
        })
      storeOAuthTokens(client.tokenManager, makeTokenSet())

      await expect(client.startAccountLink('idp-google', {
        redirectUri: 'https://app.example.test/account-link/callback',
        state: 'client-state',
      })).rejects.toMatchObject({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        details: { trigger: 'MFA_CHANGE', methods: ['TOTP'] },
      })

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          error: 'STEP_UP_REQUIRED',
          message: 'Step-up authentication required',
          details: {
            trigger: 'MFA_CHANGE',
            methods: ['TOTP'],
          },
        }),
      })

      await expect(client.exchangeAccountLinkTicket({
        linkTicket: 'fake-ticket',
        state: 'client-state',
      })).rejects.toMatchObject({
        status: 403,
        code: 'STEP_UP_REQUIRED',
        details: { trigger: 'MFA_CHANGE', methods: ['TOTP'] },
      })
    })
  })

  describe('logout', () => {
    it('routes a Direct Auth session with ID and refresh tokens only to Direct logout', async () => {
      storeDirectTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockImplementation(async (url: string) => {
        if (url === `${ISSUER}/.well-known/openid-configuration`) {
          return { ok: true, json: async () => mockOidcConfig }
        }
        if (url === `${ISSUER}/api/v1/auth/logout`) {
          return { ok: true, status: 204 }
        }
        throw new Error(`Unexpected request: ${url}`)
      })

      await expect(client.getLogoutUrl()).resolves.toBeNull()
      await expect(client.logout({ redirect: false })).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/logout`, expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${makeTokenSet().access_token}` }),
        body: JSON.stringify({ refresh_token: 'rt-abc' }),
      }))
    })

    it('clears the complete Direct Auth session and redirects locally after remote success', async () => {
      const directClient = new OAuthClient({
        ...defaultConfig,
        tokenStorage: 'sessionStorage',
        postLogoutRedirectUri: 'https://app.example.com/signed-out',
      })
      storeDirectTokens(directClient.tokenManager, makeTokenSet())
      directClient.tokenManager.setAuthorization(['admin'], ['orders:read'])
      directClient.tokenManager.setLastPermissionError(new Error('stale permission error'))
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: '' },
      })

      try {
        await directClient.logout({ redirect: true })

        expect(directClient.tokenManager.getAccessToken()).toBeNull()
        expect(directClient.tokenManager.getRefreshToken()).toBeNull()
        expect(directClient.tokenManager.getIdToken()).toBeNull()
        expect(directClient.tokenManager.getRoles()).toEqual([])
        expect(directClient.tokenManager.getPermissions()).toEqual([])
        expect(directClient.tokenManager.getLastPermissionError()).toBeNull()
        expect(directClient.tokenManager.getRefreshProvenance()).toBeNull()
        expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
        expect(window.location.href).toBe('https://app.example.com/signed-out')
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: originalLocation,
        })
      }
    })

    it('does not navigate after successful Direct Auth logout when redirect is false', async () => {
      storeDirectTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: 'https://app.example.com/current' },
      })

      try {
        await client.logout({
          redirect: false,
          postLogoutRedirectUri: 'https://app.example.com/signed-out',
        })
        expect(window.location.href).toBe('https://app.example.com/current')
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: originalLocation,
        })
      }
    })

    it('omits the Direct logout body when a Direct session has no refresh token', async () => {
      const { refresh_token: _refreshToken, ...tokensWithoutRefresh } = makeTokenSet()
      storeDirectTokens(client.tokenManager, tokensWithoutRefresh)
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })

      await client.logout({ redirect: false })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/logout`, expect.objectContaining({
        method: 'POST',
        headers: { Authorization: `Bearer ${tokensWithoutRefresh.access_token}` },
        body: undefined,
      }))
    })

    it('preserves Direct Auth logout routing after sessionStorage reload', async () => {
      const config: IamConfig = {
        ...defaultConfig,
        tokenStorage: 'sessionStorage',
      }
      const sourceClient = new OAuthClient(config)
      storeDirectTokens(sourceClient.tokenManager, makeTokenSet())
      const restoredClient = new OAuthClient(config)
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 })

      await restoredClient.logout({ redirect: false })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ISSUER}/api/v1/auth/logout`)
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it.each([401, 403, 409, 429, 500])(
      'clears Direct Auth state and exposes a sanitized error for HTTP %s without fallback',
      async (status) => {
        const bearer = makeTokenSet().access_token
        storeDirectTokens(client.tokenManager, makeTokenSet({ access_token: bearer }))
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status,
          headers: new Headers(),
          text: async () => JSON.stringify({
            error: `secret-${status}`,
            message: `bearer=${bearer}; refresh=rt-abc`,
            details: { token: bearer },
          }),
        })

        const error = await client.logout({
          redirect: true,
          postLogoutRedirectUri: 'https://app.example.com/signed-out',
        }).catch((caught: unknown) => caught)

        expect(error).toMatchObject({
          name: 'IamApiError',
          message: 'Direct logout request failed',
          status,
          code: 'LOGOUT_FAILED',
        })
        expect((error as IamApiError).details).toBeUndefined()
        expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
        expect(JSON.stringify({
          name: (error as Error).name,
          message: (error as Error).message,
          status: (error as IamApiError).status,
          code: (error as IamApiError).code,
        })).not.toContain(bearer)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ISSUER}/api/v1/auth/logout`)
        expect(client.isAuthenticated()).toBe(false)
        expect(client.tokenManager.getRefreshProvenance()).toBeNull()
      },
    )

    it('clears Direct Auth state and removes the transport cause without fallback', async () => {
      const tokens = makeTokenSet()
      storeDirectTokens(client.tokenManager, tokens)
      fetchMock.mockRejectedValueOnce(new Error(`transport leaked ${tokens.access_token} ${tokens.refresh_token}`))

      const error = await client.logout({ redirect: true }).catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        name: 'IamNetworkError',
        message: 'Direct logout request failed',
      })
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('times out Direct Auth logout once, clears state, and does not fall back', async () => {
      storeDirectTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('token-bearing timeout', 'AbortError')))
      }))

      const outcome = expect(client.logout({ redirect: true })).rejects.toMatchObject({
        name: 'IamNetworkError',
        message: 'Direct logout request timed out',
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await outcome

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('bounds a never-ending Direct Auth error body and clears state without fallback', async () => {
      storeDirectTokens(client.tokenManager, makeTokenSet())
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('body timeout', 'AbortError')))
        }),
      }))

      const outcome = expect(client.logout({ redirect: true })).rejects.toMatchObject({
        name: 'IamApiError',
        message: 'Direct logout request failed',
        status: 500,
        code: 'LOGOUT_FAILED',
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await outcome

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(client.isAuthenticated()).toBe(false)
    })

    it('uses only OIDC end-session for an OAuth token endpoint session', async () => {
      const oauthClient = new OAuthClient({
        ...defaultConfig,
        postLogoutRedirectUri: 'https://app.example.com/signed-out',
      })
      storeOAuthTokens(oauthClient.tokenManager, makeTokenSet())
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: '' },
      })

      try {
        await oauthClient.logout({ redirect: true })

        const logoutUrl = new URL(window.location.href)
        expect(logoutUrl.origin + logoutUrl.pathname).toBe(`${ISSUER}/logout`)
        expect(logoutUrl.searchParams.get('id_token_hint')).toBe('id-token')
        expect(logoutUrl.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/signed-out')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ISSUER}/.well-known/openid-configuration`)
        expect(oauthClient.isAuthenticated()).toBe(false)
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: originalLocation,
        })
      }
    })

    it('preserves OAuth end-session routing after sessionStorage reload', async () => {
      const config: IamConfig = {
        ...defaultConfig,
        tokenStorage: 'sessionStorage',
        postLogoutRedirectUri: 'https://app.example.com/signed-out',
      }
      const sourceClient = new OAuthClient(config)
      storeOAuthTokens(sourceClient.tokenManager, makeTokenSet())
      const restoredClient = new OAuthClient(config)
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: '' },
      })

      try {
        await restoredClient.logout({ redirect: true })
        expect(new URL(window.location.href).pathname).toBe('/logout')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0]?.[0]).toBe(`${ISSUER}/.well-known/openid-configuration`)
      } finally {
        Object.defineProperty(window, 'location', {
          configurable: true,
          value: originalLocation,
        })
      }
    })

    it('preserves OAuth protocol provenance after reload without offline_access', async () => {
      const config: IamConfig = {
        ...defaultConfig,
        tokenStorage: 'sessionStorage',
      }
      const sourceClient = new OAuthClient(config)
      const { refresh_token: _refreshToken, ...tokensWithoutRefresh } = makeTokenSet()
      storeOAuthTokens(sourceClient.tokenManager, tokensWithoutRefresh)
      const restoredClient = new OAuthClient(config)
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })

      const logoutUrl = await restoredClient.getLogoutUrl()

      expect(logoutUrl).toContain('/logout?')
      expect(restoredClient.tokenManager.getAuthenticationProvenance()).toBe('OAUTH_AUTHORIZATION_CODE')
      expect(restoredClient.tokenManager.getRefreshProvenance()).toBeNull()
    })

    it('builds OIDC logout for an OAuth session without offline_access or a refresh token', async () => {
      const { refresh_token: _refreshToken, ...tokensWithoutRefresh } = makeTokenSet()
      storeOAuthTokens(client.tokenManager, tokensWithoutRefresh)
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })

      const logoutUrl = await client.getLogoutUrl()

      expect(new URL(logoutUrl!).pathname).toBe('/logout')
      expect(new URL(logoutUrl!).searchParams.get('id_token_hint')).toBe('id-token')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('clears an OAuth session without offline_access locally when redirect is false', async () => {
      const { refresh_token: _refreshToken, ...tokensWithoutRefresh } = makeTokenSet()
      storeOAuthTokens(client.tokenManager, tokensWithoutRefresh)

      await expect(client.logout({ redirect: false })).resolves.toBeUndefined()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(client.isAuthenticated()).toBe(false)
    })

    it('fails closed during construction when persisted provenance is invalid', () => {
      sessionStorage.setItem('axis_iam_session', JSON.stringify({
        version: 3,
        tokens: makeTokenSet(),
        roles: [],
        permissions: [],
        authenticationProvenance: 'UNKNOWN',
        refreshProvenance: 'UNKNOWN',
      }))
      expect(() => new OAuthClient({
        ...defaultConfig,
        tokenStorage: 'sessionStorage',
      })).toThrow(IamConfigurationError)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it('does not resend stale Direct Auth tokens on a second logout', async () => {
      storeDirectTokens(client.tokenManager, makeTokenSet())
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

      await expect(client.logout({ redirect: true })).resolves.toBeUndefined()

      expect(client.isAuthenticated()).toBe(false)
    })
  })
})
