import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthAccountLinkingClient } from './oauth-account-linking'
import { IamApiError } from './types'
import type { AccountLoginMethod, LinkableIdentityProvider, OIDCConfiguration } from './types'

const ISSUER = 'https://auth.example.com'

const oidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
  end_session_endpoint: `${ISSUER}/logout`,
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

describe('oauth account linking client', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let accessToken: string | null
  let discover: ReturnType<typeof vi.fn<() => Promise<OIDCConfiguration>>>
  let client: OAuthAccountLinkingClient

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    accessToken = 'access-token'
    discover = vi.fn(async () => oidcConfig)
    client = new OAuthAccountLinkingClient({
      discover,
      getAccessToken: () => accessToken,
      resolveRedirectUri: (redirectUri) => new URL(redirectUri ?? '/callback', 'https://app.example.test').toString(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists current account login methods with bearer auth', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [passwordMethod, googleMethod],
    })

    const methods = await client.listAccountLoginMethods()

    expect(methods).toEqual([passwordMethod, googleMethod])
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/me/login-methods`, expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer access-token' },
    }))
  })

  it('lists linkable identity providers with bearer auth', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [linkableGoogle],
    })

    const providers = await client.listLinkableIdentityProviders()

    expect(providers).toEqual([linkableGoogle])
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/me/linkable-identity-providers`, expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer access-token' },
    }))
  })

  it('starts account linking without client secret or token replacement semantics', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorizationUrl: 'https://accounts.example.test/oauth2/auth',
        state: 'client-state',
        expiresAt: '2026-06-27T10:25:30Z',
      }),
    })

    const result = await client.startAccountLink('idp-google', {
      redirectUri: '/account-link/callback',
      state: 'client-state',
    })

    expect(result.authorizationUrl).toBe('https://accounts.example.test/oauth2/auth')
    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/identity-providers/idp-google/link/authorize`)
    expect(request?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
    }))
    const body = JSON.parse(request?.[1]?.body as string) as Record<string, string>
    expect(body).toEqual({
      redirectUri: 'https://app.example.test/account-link/callback',
      state: 'client-state',
    })
    expect(JSON.stringify(body)).not.toContain('clientSecret')
    expect(JSON.stringify(body)).not.toContain('client_secret')
  })

  it('exchanges account-link tickets against the current-user endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ method: googleMethod }),
    })

    const result = await client.exchangeAccountLinkTicket({
      linkTicket: 'fake-ticket',
      state: 'client-state',
    })

    expect(result.method).toEqual(googleMethod)
    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/identity-providers/link-ticket/exchange`)
    expect(request?.[1]?.headers).toMatchObject({ Authorization: 'Bearer access-token' })
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      linkTicket: 'fake-ticket',
      state: 'client-state',
    })
  })

  it('unlinks account login methods with URL-encoded method IDs', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    await client.unlinkAccountLoginMethod('idp:idp-google')

    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/me/login-methods/idp%3Aidp-google`, expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: 'Bearer access-token' },
    }))
  })

  it('fails closed before discovery when no current token is available', async () => {
    accessToken = null

    await expect(client.listAccountLoginMethods()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    expect(discover).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves typed API errors from IAM', async () => {
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

    const request = client.unlinkAccountLoginMethod('idp:idp-google')

    await expect(request).rejects.toBeInstanceOf(IamApiError)
    await expect(request).rejects.toMatchObject({
      status: 403,
      code: 'STEP_UP_REQUIRED',
      details: {
        trigger: 'MFA_CHANGE',
        methods: ['TOTP'],
      },
    })
  })
})
