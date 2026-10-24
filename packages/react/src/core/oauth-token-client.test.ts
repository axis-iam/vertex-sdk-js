import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeAuthorizationCode,
  refreshOAuthToken,
} from './oauth-token-client'

describe('refreshOAuthToken', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses only the OAuth form refresh grant with the public client id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt2',
        token_type: 'Bearer',
        expires_in: 300,
      }),
    })

    await refreshOAuthToken({
      tokenEndpoint: 'https://issuer.example/oauth2/token',
      clientId: 'spa-client',
      refreshToken: 'rt1',
    })

    const request = fetchMock.mock.calls[0]
    expect(request?.[0]).toBe('https://issuer.example/oauth2/token')
    expect(request?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(String(request?.[1]?.body)).toBe(
      'grant_type=refresh_token&client_id=spa-client&refresh_token=rt1',
    )
    expect(JSON.stringify(request?.[1])).not.toContain('secret')
  })

  it('rejects an unrotated OAuth refresh response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'at',
        refresh_token: 'rt1',
        token_type: 'Bearer',
        expires_in: 300,
      }),
    })
    await expect(
      refreshOAuthToken({
        tokenEndpoint: 'https://issuer.example/oauth2/token',
        clientId: 'spa-client',
        refreshToken: 'rt1',
      }),
    ).rejects.toMatchObject({
      code: 'TOKEN_REFRESH_UNCERTAIN',
      retryable: false,
    })
  })
  it.each(['network', 'server', 'json', 'tokens'] as const)(
    'exposes terminal refresh uncertainty after %s without retry',
    async (kind) => {
      if (kind === 'network') fetchMock.mockRejectedValue(new TypeError('lost'))
      else if (kind === 'server')
        fetchMock.mockResolvedValue(new Response('{}', { status: 503 }))
      else if (kind === 'json')
        fetchMock.mockResolvedValue(new Response('invalid JSON'))
      else
        fetchMock.mockResolvedValue(
          new Response(JSON.stringify({ access_token: 'at', expires_in: 0 })),
        )
      await expect(
        refreshOAuthToken({
          tokenEndpoint: 'https://issuer.example/token',
          clientId: 'public',
          refreshToken: 'rt',
        }),
      ).rejects.toMatchObject({
        code: 'TOKEN_REFRESH_UNCERTAIN',
        retryable: false,
      })
      expect(fetchMock).toHaveBeenCalledOnce()
    },
  )
  it('makes a sent authorization-code exchange uncertainty explicit without retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('lost'))
    await expect(
      exchangeAuthorizationCode({
        tokenEndpoint: 'https://issuer.example/token',
        clientId: 'public',
        code: 'one-use',
        redirectUri: 'https://app.test/callback',
        codeVerifier: 'private',
      }),
    ).rejects.toMatchObject({ code: 'TOKEN_EXCHANGE_UNCERTAIN' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
