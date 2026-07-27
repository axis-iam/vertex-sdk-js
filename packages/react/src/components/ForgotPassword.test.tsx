import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { testProviderProps } from '../test-utils'
import { ForgotPassword } from './ForgotPassword'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

function setupFetchMock() {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
    if (url.includes('/branding')) return { ok: false, status: 404 }
    if (url.includes('/api/v1/auth/password/forgot')) return { ok: true, status: 204 }
    return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) }
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

describe('ForgotPassword', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('validates email before submit', async () => {
    setupFetchMock()
    renderWithProvider(createElement(ForgotPassword))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'invalid' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(screen.getByText('Enter a valid email address')).toBeTruthy()
  })

  it('shows neutral success after request', async () => {
    const onSuccess = vi.fn()
    setupFetchMock()
    renderWithProvider(createElement(ForgotPassword, {
      redirectUri: 'https://app.example.com/reset-password',
      onSuccess,
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Check your email')).toBeTruthy()
    expect(screen.getByText('If an account exists, a password reset link has been sent.')).toBeTruthy()
  })
})
