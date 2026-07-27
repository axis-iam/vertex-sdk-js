import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshOAuthToken } from './oauth-token-client'

describe('refreshOAuthToken', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('uses only the OAuth form refresh grant with the public client id', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt2', token_type: 'Bearer', expires_in: 300 }) })

    await refreshOAuthToken({ tokenEndpoint: 'https://issuer.example/oauth2/token', clientId: 'spa-client', refreshToken: 'rt1' })

    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toBe('https://issuer.example/oauth2/token')
    expect(request?.[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    expect(String(request?.[1]?.body)).toBe('grant_type=refresh_token&client_id=spa-client&refresh_token=rt1')
    expect(JSON.stringify(request?.[1])).not.toContain('secret')
  })

  it('rejects an unrotated OAuth refresh response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt1', token_type: 'Bearer', expires_in: 300 }) })
    await expect(refreshOAuthToken({ tokenEndpoint: 'https://issuer.example/oauth2/token', clientId: 'spa-client', refreshToken: 'rt1' }))
      .rejects.toThrow('refresh_token was not rotated')
  })
})
