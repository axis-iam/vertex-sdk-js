import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isEmbeddedSignInProvider, startProviderAuthorization } from './oauth-provider-authorization'
import type { AuthMethodIdpProviderResponse, IamConfig, IdentityProviderOption, ProviderRegistrationGrantInput } from './types'

const ISSUER = 'https://auth.example.com'
const PROVIDER_AUTHORIZE_URL = `${ISSUER}/api/v1/apps/my-app/identity-providers/idp-google/oidc/authorize`

const config: Pick<IamConfig, 'audience' | 'redirectUri' | 'scopes'> = {
  redirectUri: '/callback',
  scopes: ['openid', 'profile', 'email'],
  audience: 'https://api.example.com',
}

const configWithoutScopes: Pick<IamConfig, 'audience' | 'redirectUri' | 'scopes'> = {
  redirectUri: '/callback',
  scopes: undefined,
  audience: 'https://api.example.com',
}

const googleProvider: IdentityProviderOption = {
  id: 'idp-google',
  applicationId: 'app-1',
  providerType: 'GOOGLE',
  name: 'google',
  displayName: 'Google',
  enabled: true,
  protocol: 'OIDC',
  authorizationUrl: PROVIDER_AUTHORIZE_URL,
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
  authorizationUrl: PROVIDER_AUTHORIZE_URL,
}

describe('oauth provider authorization', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts selected provider authorization with Authorization Code and PKCE', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authorizationUrl: 'https://accounts.example.test/oauth2/auth' }),
    })

    const url = await startProviderAuthorization({
      provider: googleProvider,
      config,
      resolveRedirectUri: (redirectUri) => `https://app.example.test${redirectUri ?? '/callback'}`,
    })

    expect(url).toBe('https://accounts.example.test/oauth2/auth')
    expect(fetchMock).toHaveBeenCalledWith(PROVIDER_AUTHORIZE_URL, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }))

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, string>
    expect(body).toMatchObject({
      completionMode: 'AUTHORIZATION_CODE',
      redirectUri: 'https://app.example.test/callback',
      scope: 'openid profile email',
      codeChallengeMethod: 'S256',
      audience: 'https://api.example.com',
    })
    expect(body.state).toBeTruthy()
    expect(body.codeChallenge).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('clientSecret')
    expect(JSON.stringify(body)).not.toContain('client_secret')
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBeTruthy()
    expect(sessionStorage.getItem('iam_oauth_state')).toBe(body.state)
  })

  it('uses option overrides without adding confidential browser fields', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authorizationUrl: 'https://accounts.example.test/custom' }),
    })

    await startProviderAuthorization({
      provider: googleAuthMethodProvider,
      config,
      options: {
        redirectUri: '/social/callback',
        scopes: ['openid'],
        audience: 'custom-audience',
      },
      resolveRedirectUri: (redirectUri) => `https://app.example.test${redirectUri ?? '/callback'}`,
    })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, string>
    expect(body).toMatchObject({
      redirectUri: 'https://app.example.test/social/callback',
      scope: 'openid',
      audience: 'custom-audience',
    })
    expect(JSON.stringify(body)).not.toContain('clientSecret')
    expect(JSON.stringify(body)).not.toContain('client_secret')
    expect(JSON.stringify(body)).not.toContain('client_credentials')
  })

  it('defaults provider authorization to offline_access', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ authorizationUrl: 'https://accounts.example.test/default' }) })
    await startProviderAuthorization({
      provider: googleProvider,
      config: configWithoutScopes,
      resolveRedirectUri: (redirectUri) => `https://app.example.test${redirectUri ?? '/callback'}`,
    })
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, string>
    expect(body.scope).toBe('openid profile email offline_access')
  })

  it.each([
    [{ type: 'EMAIL_LINK', registrationGrantToken: 'email-link-proof' }, 'registrationGrantToken'],
    [{ type: 'ACCESS_CODE', registrationAccessCode: '12345678' }, 'registrationAccessCode'],
  ] as const)('passes supported registration proof in the server-side provider request', async (registrationGrant, expectedField) => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ authorizationUrl: 'https://accounts.example.test/authorize' }) })

    await startProviderAuthorization({
      provider: googleProvider,
      config,
      options: { registrationGrant },
      resolveRedirectUri: (redirectUri) => `https://app.example.test${redirectUri ?? '/callback'}`,
    })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, string>
    expect(body[expectedField]).toBe(Object.values(registrationGrant)[1])
    expect(body.organizationInvitationToken).toBeUndefined()
  })

  it('rejects Organization invitation proof before provider authorization', async () => {
    await expect(startProviderAuthorization({
      provider: googleProvider,
      config,
      options: { registrationGrant: { type: 'ORG_INVITATION', organizationInvitationToken: 'invite-proof' } as unknown as ProviderRegistrationGrantInput },
      resolveRedirectUri: (redirectUri) => redirectUri ?? '/callback',
    })).rejects.toMatchObject({
      code: 'REGISTRATION_GRANT_INVALID',
      message: 'Organization invitation proof is not supported for provider authorization',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()
    expect(sessionStorage.getItem('iam_oauth_state')).toBeNull()
  })

  it('rejects unknown registration grant types before PKCE, state, or provider authorization', async () => {
    await expect(startProviderAuthorization({
      provider: googleProvider,
      config,
      options: { registrationGrant: { type: 'UNKNOWN', proof: 'untrusted-proof' } as unknown as ProviderRegistrationGrantInput },
      resolveRedirectUri: (redirectUri) => redirectUri ?? '/callback',
    })).rejects.toMatchObject({ code: 'REGISTRATION_GRANT_INVALID' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()
    expect(sessionStorage.getItem('iam_oauth_state')).toBeNull()
  })

  it.each([
    { type: 'EMAIL_LINK', registrationGrantToken: '  ' },
    { type: 'ACCESS_CODE', registrationAccessCode: '  ' },
  ] as const)('rejects blank provider proof before PKCE, state, or provider authorization', async (registrationGrant) => {
    await expect(startProviderAuthorization({
      provider: googleProvider,
      config,
      options: { registrationGrant },
      resolveRedirectUri: (redirectUri) => redirectUri ?? '/callback',
    })).rejects.toMatchObject({ code: 'REGISTRATION_GRANT_INVALID' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()
    expect(sessionStorage.getItem('iam_oauth_state')).toBeNull()
  })

  it('rejects unavailable providers before calling IAM', async () => {
    const unavailableProvider: AuthMethodIdpProviderResponse = {
      ...googleAuthMethodProvider,
      availableForLogin: false,
    }

    await expect(
      startProviderAuthorization({
        provider: unavailableProvider,
        config,
        resolveRedirectUri: (redirectUri) => redirectUri ?? '/callback',
      }),
    ).rejects.toThrow('Identity provider is not available for embedded sign-in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies embedded SignIn provider shapes consistently', () => {
    expect(isEmbeddedSignInProvider(googleProvider)).toBe(true)
    expect(isEmbeddedSignInProvider(googleAuthMethodProvider)).toBe(true)
    expect(isEmbeddedSignInProvider({
      ...googleProvider,
      protocol: 'SAML',
      authorizationUrl: null,
    })).toBe(false)
  })
})
