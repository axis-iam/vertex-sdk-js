import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { testProviderProps } from '../test-utils'
import { usePasswordReset } from './usePasswordReset'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

function setupFetchMock() {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
    if (url.includes('/api/v1/auth/password/forgot')) return { ok: true, status: 204 }
    if (url.includes('/api/v1/auth/password/reset')) return { ok: true, status: 204 }
    return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) }
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

describe('usePasswordReset', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requests password reset with client_id and redirect_uri', async () => {
    const fetchMock = setupFetchMock()
    const { result } = renderHook(() => usePasswordReset(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    await act(async () => {
      await result.current.requestPasswordReset({
        email: 'user@example.com',
        redirectUri: 'https://app.example.com/reset-password',
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        client_id: 'test-app',
        redirect_uri: 'https://app.example.com/reset-password',
      }),
    })
  })

  it('resets password with token and newPassword', async () => {
    const fetchMock = setupFetchMock()
    const { result } = renderHook(() => usePasswordReset(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    await act(async () => {
      await result.current.resetPassword({
        token: 'reset-token',
        newPassword: 'NewPassword123!',
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'reset-token',
        newPassword: 'NewPassword123!',
      }),
    })
  })
})
