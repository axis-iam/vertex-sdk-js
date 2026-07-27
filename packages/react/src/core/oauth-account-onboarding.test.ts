import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import type { TokenManager } from './token-manager'
import type { OIDCConfiguration, TokenSet } from './types'

const ISSUER = 'https://auth.example.com'

const mockOidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

const defaultConfig = {
  clientId: 'spa-client',
  issuerUri: ISSUER,
  redirectUri: '/callback',
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${body}.fake-sig`
}

function makeTokenSet(): TokenSet {
  return {
    access_token: makeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
  }
}

function storeOAuthTokens(manager: TokenManager, tokens: TokenSet): void {
  manager.store(tokens, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
}

describe('OAuthClient account organization onboarding surface', () => {
  let client: OAuthClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    client = new OAuthClient(defaultConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads account profile and security summary with bearer auth', async () => {
    const tokens = makeTokenSet()
    storeOAuthTokens(client.tokenManager, tokens)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          userId: 'user-1',
          applicationId: 'app-1',
          globalIdentityId: null,
          email: 'user@example.com',
          emailVerified: true,
          username: 'user',
          displayName: 'User',
          avatarUrl: null,
          status: 'ACTIVE',
          createdAt: '2026-07-06T00:00:00Z',
          updatedAt: '2026-07-06T00:00:00Z',
          currentOrganization: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          emailVerified: true,
          passwordCredentialPresent: true,
          mfaEnrolled: false,
          totpEnrolled: false,
          webAuthnEnrolled: false,
          activeSessionCount: 1,
        }),
      })

    const profile = await client.getAccountProfile()
    const security = await client.getAccountSecuritySummary()

    expect(profile.email).toBe('user@example.com')
    expect(security.passwordCredentialPresent).toBe(true)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/auth/me/profile`)
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${tokens.access_token}` })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${ISSUER}/api/v1/auth/me/security`)
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${tokens.access_token}` })
  })

  it('updates profile with only safe scalar fields', async () => {
    const tokens = makeTokenSet()
    storeOAuthTokens(client.tokenManager, tokens)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          userId: 'user-1',
          applicationId: 'app-1',
          globalIdentityId: null,
          email: 'user@example.com',
          emailVerified: true,
          username: 'new-user',
          displayName: 'New User',
          avatarUrl: null,
          status: 'ACTIVE',
          createdAt: '2026-07-06T00:00:00Z',
          updatedAt: '2026-07-06T01:00:00Z',
          currentOrganization: null,
        }),
      })

    await client.updateAccountProfile({ username: 'new-user', displayName: 'New User', avatarUrl: null })

    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/profile`)
    expect(request?.[1]?.method).toBe('PATCH')
    expect(request?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      username: 'new-user',
      displayName: 'New User',
      avatarUrl: null,
    })
  })

  it('lists organizations and returns switch continuation without mutating JWT org claims', async () => {
    const tokens = makeTokenSet()
    storeOAuthTokens(client.tokenManager, tokens)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([
          { organizationId: 'org-1', name: 'Acme', slug: 'acme', role: 'ADMIN', joinedAt: '2026-07-06T00:00:00Z', current: true },
          { organizationId: 'org-2', name: 'Beta', slug: 'beta', role: 'MEMBER', joinedAt: '2026-07-06T00:00:00Z', current: false },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          organizationId: 'org-2',
          continuation: 'TOKEN_REFRESH_REQUIRED',
          tokenRefreshRequired: true,
          message: 'Refresh token to receive the new organization context.',
        }),
      })

    const organizations = await client.listAccountOrganizations()
    const beforeUser = client.tokenManager.getUser()
    const response = await client.switchAccountOrganization('org-2')
    const afterUser = client.tokenManager.getUser()

    expect(organizations[1]?.organizationId).toBe('org-2')
    expect(response).toMatchObject({ organizationId: 'org-2', tokenRefreshRequired: true })
    expect(afterUser?.orgId).toBe(beforeUser?.orgId)
    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/me/organizations/current`)
    expect(request?.[1]?.method).toBe('POST')
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({ organizationId: 'org-2' })
  })

  it('changes password and manages current-user sessions with bearer auth', async () => {
    const tokens = makeTokenSet()
    storeOAuthTokens(client.tokenManager, tokens)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([
          {
            sessionId: 'sid-current',
            ipAddress: '127.0.0.1',
            userAgent: 'Vitest',
            deviceId: null,
            createdAt: '2026-07-07T00:00:00Z',
            lastSeenAt: '2026-07-07T01:00:00Z',
            current: true,
          },
        ]),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })

    await client.changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass' })
    const sessions = await client.listAccountSessions()
    await client.revokeAccountSession('sid-current')
    await client.revokeOtherAccountSessions()
    await client.logoutAccount({ refreshToken: 'refresh-token' })

    expect(sessions[0]?.current).toBe(true)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/auth/password/change`)
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${tokens.access_token}` })
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      currentPassword: 'old-pass',
      newPassword: 'new-pass',
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${ISSUER}/api/v1/auth/sessions`)
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`${ISSUER}/api/v1/auth/sessions/sid-current`)
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('DELETE')
    expect(fetchMock.mock.calls[4]?.[0]).toBe(`${ISSUER}/api/v1/auth/sessions`)
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe('DELETE')
    expect(fetchMock.mock.calls[5]?.[0]).toBe(`${ISSUER}/api/v1/auth/logout`)
    expect(JSON.parse(fetchMock.mock.calls[5]?.[1]?.body as string)).toEqual({ refresh_token: 'refresh-token' })
  })

  it('checks organization membership locally and remote current-user permissions', async () => {
    const tokens = makeTokenSet()
    storeOAuthTokens(client.tokenManager, tokens)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify([
          { organizationId: 'org-1', name: 'Acme', slug: 'acme', role: 'ADMIN', joinedAt: '2026-07-06T00:00:00Z', current: true },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          applicationId: 'app-1',
          organizationId: 'org-1',
          roles: ['admin'],
          permissions: ['orders:read', 'orders:*'],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          applicationId: 'app-1',
          organizationId: 'org-1',
          permission: 'orders:write',
          allowed: true,
          roles: ['admin'],
        }),
      })

    await expect(client.hasAccountOrganizationMembership('org-1')).resolves.toBe(true)
    const summary = await client.getAccountPermissionSummary('org-1')
    const check = await client.checkAccountPermission({ permission: 'orders:write', organizationId: 'org-1' })

    expect(summary.permissions).toContain('orders:read')
    expect(check.allowed).toBe(true)
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${ISSUER}/api/v1/auth/me/permissions?organizationId=org-1`)
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`${ISSUER}/api/v1/auth/me/permissions:check`)
    expect(JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string)).toEqual({
      permission: 'orders:write',
      organizationId: 'org-1',
    })
  })

  it('previews public organization invitation without bearer auth', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          applicationId: 'app-1',
          applicationName: 'Example App',
          organizationId: 'org-1',
          organizationName: 'Acme',
          inviteeEmail: 'u***@example.com',
          role: 'MEMBER',
          status: 'PENDING',
          expiresAt: '2026-07-07T00:00:00Z',
        }),
      })

    await client.previewOrganizationInvitation('public-token')

    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/organization-invitations/public-token`)
    expect(request?.[1]?.headers).toEqual({})
  })

  it('accepts unauthenticated invitation as login-required continuation', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          status: 'LOGIN_REQUIRED',
          continuation: 'LOGIN_OR_REGISTER_THEN_RETRY_ACCEPT',
          applicationId: 'app-1',
          organizationId: 'org-1',
          organizationName: 'Acme',
          role: 'MEMBER',
          acceptedAt: null,
        }),
      })

    const response = await client.acceptOrganizationInvitation('public-token')

    expect(response.status).toBe('LOGIN_REQUIRED')
    expect(response.continuation).toBe('LOGIN_OR_REGISTER_THEN_RETRY_ACCEPT')
    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/organization-invitations/public-token/accept`)
    expect(request?.[1]?.headers).toEqual({})
  })

  it('accepts authenticated invitation with current bearer token', async () => {
    const tokens = makeTokenSet()
    storeOAuthTokens(client.tokenManager, tokens)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          status: 'ACCEPTED',
          continuation: null,
          applicationId: 'app-1',
          organizationId: 'org-1',
          organizationName: 'Acme',
          role: 'MEMBER',
          acceptedAt: '2026-07-06T00:00:00Z',
        }),
      })

    const response = await client.acceptOrganizationInvitation('public-token')

    expect(response.status).toBe('ACCEPTED')
    const request = fetchMock.mock.calls.at(-1)
    expect(request?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${tokens.access_token}` })
  })

  it('sends and verifies email verification tokens through public action helpers', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          message: 'If eligible, a verification email has been sent. Please wait before retrying.',
          retryAfterSeconds: 60,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          message: 'Email verified',
          retryAfterSeconds: null,
        }),
      })

    const sent = await client.sendEmailVerification({ email: 'user@example.com' })
    const verified = await client.verifyEmail({ token: 'verify-token' })

    expect(sent.retryAfterSeconds).toBe(60)
    expect(verified.message).toBe('Email verified')
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/auth/email/verification/send`)
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      email: 'user@example.com',
      client_id: 'spa-client',
    })
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${ISSUER}/api/v1/auth/email/verification/verify`)
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({ token: 'verify-token' })
  })

  it('fails closed for authenticated account APIs without current token', async () => {
    await expect(client.getAccountProfile()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
