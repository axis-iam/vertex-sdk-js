import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { testProviderProps } from '../test-utils'
import { ResetPassword } from './ResetPassword'

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
    if (url.includes('/api/v1/auth/password/reset')) return { ok: true, status: 204 }
    return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) }
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

describe('ResetPassword', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requires token', async () => {
    setupFetchMock()
    renderWithProvider(createElement(ResetPassword))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'NewPassword123!' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'NewPassword123!' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('At least 8 characters').closest('form')!)
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(screen.getByText('Reset token is required')).toBeTruthy()
  })

  it('validates password confirmation', async () => {
    setupFetchMock()
    renderWithProvider(createElement(ResetPassword, { token: 'reset-token' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'NewPassword123!' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'Different123!' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('At least 8 characters').closest('form')!)
      await vi.advanceTimersByTimeAsync(10)
    })

    expect(screen.getByText('Passwords do not match')).toBeTruthy()
  })

  it('shows success without storing tokens or auto-login', async () => {
    const onSuccess = vi.fn()
    const onSignIn = vi.fn()
    const fetchMock = setupFetchMock()
    renderWithProvider(createElement(ResetPassword, { token: 'reset-token', onSuccess, onSignIn }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'NewPassword123!' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'NewPassword123!' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('At least 8 characters').closest('form')!)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'reset-token', newPassword: 'NewPassword123!' }),
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('iam_tokens')).toBeNull()
    expect(screen.getByText('Password reset')).toBeTruthy()
    fireEvent.click(screen.getByText('Sign in'))
    expect(onSignIn).toHaveBeenCalledTimes(1)
  })
})
