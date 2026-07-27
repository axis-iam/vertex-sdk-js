import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshDirectAuthToken } from './direct-auth-token-client'

describe('refreshDirectAuthToken', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock
  })

  it('uses the public JSON Direct Auth contract without credentials', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt2', token_type: 'Bearer', expires_in: 300 }) })

    await refreshDirectAuthToken({ issuer: 'https://issuer.example/', clientId: 'spa-client', refreshToken: 'rt1' })

    expect(fetchMock).toHaveBeenCalledWith('https://issuer.example/api/v1/auth/token/refresh', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'rt1', client_id: 'spa-client' }),
    }))
    const request = fetchMock.mock.calls[0]?.[1]
    expect(request?.headers).not.toHaveProperty('Authorization')
    expect(JSON.stringify(request)).not.toContain('secret')
  })

  it.each([
    [{ access_token: 'at', refresh_token: 'rt1', token_type: 'Bearer', expires_in: 300 }, 'refresh_token was not rotated'],
    [{ access_token: 'at', refresh_token: '', token_type: 'Bearer', expires_in: 300 }, 'refresh_token must be a non-empty string'],
    [{ refresh_token: 'rt2', token_type: 'Bearer', expires_in: 300 }, 'access_token must be a non-empty string'],
  ])('rejects invalid Direct refresh response %#', async (response, message) => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => response })
    await expect(refreshDirectAuthToken({ issuer: 'https://issuer.example', clientId: 'spa-client', refreshToken: 'rt1' }))
      .rejects.toThrow(message)
  })
})
