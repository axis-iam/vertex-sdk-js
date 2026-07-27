import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthUserActionsClient } from './oauth-user-actions-client'
import type { OIDCConfiguration } from './types'

const ISSUER = 'https://auth.example.com'

const oidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
  end_session_endpoint: `${ISSUER}/logout`,
}

describe('oauth user actions client', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let discover: ReturnType<typeof vi.fn<() => Promise<OIDCConfiguration>>>
  let client: OAuthUserActionsClient

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    discover = vi.fn(async () => oidcConfig)
    client = new OAuthUserActionsClient({
      clientId: 'my-app',
      discover,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends email verification without confidential client fields', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })

    await client.sendEmailVerification({ email: 'user@example.com' })

    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/email/verification/send`)
    expect(request?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }))
    const body = JSON.parse(request?.[1]?.body as string) as Record<string, string>
    expect(body).toEqual({
      email: 'user@example.com',
      client_id: 'my-app',
    })
    expect(JSON.stringify(body)).not.toContain('clientSecret')
    expect(JSON.stringify(body)).not.toContain('client_secret')
  })

  it('requests password reset with optional redirect URI', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })

    await client.requestPasswordReset({
      email: 'user@example.com',
      redirectUri: 'https://app.example.com/reset',
    })

    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/password/forgot`)
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      email: 'user@example.com',
      client_id: 'my-app',
      redirect_uri: 'https://app.example.com/reset',
    })
  })

  it('resets password with reset token only', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })

    await client.resetPassword({
      token: 'reset-token',
      newPassword: 'new-password',
    })

    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toBe(`${ISSUER}/api/v1/auth/password/reset`)
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      token: 'reset-token',
      newPassword: 'new-password',
    })
  })
})
