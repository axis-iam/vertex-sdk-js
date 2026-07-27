import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useStepUp } from './useStepUp'
import { setupMockFetch, storeTestTokens, makeTestJwt, testProviderProps } from '../test-utils'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

describe('useStepUp', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('isSteppedUp is false without MFA acr', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useStepUp(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isSteppedUp).toBe(false)
  })

  it('isSteppedUp is true when acr is urn:iam:acr:mfa', async () => {
    const jwt = makeTestJwt({ acr: 'urn:iam:acr:mfa' })
    storeTestTokens(jwt)
    const { result } = renderHook(() => useStepUp(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isSteppedUp).toBe(true)
  })

  it('stepUp sends challenge request and refreshes token', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useStepUp(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    // Mock: challenge endpoint + token refresh
    const newJwt = makeTestJwt({ acr: 'urn:iam:acr:mfa' })
    const fetchMock = vi.fn()
      // Step-up challenge
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      // Refresh token (from refreshToken → discover is cached, so this is the token endpoint)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: newJwt,
          refresh_token: 'new-rt',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: ['orders:read'] }) })
    globalThis.fetch = fetchMock

    await act(async () => {
      await result.current.stepUp({ reason: 'Confirm payment' })
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    // Verify challenge was sent
    const challengeCall = fetchMock.mock.calls[0]
    expect(challengeCall[0]).toContain('/step-up/challenge')
    expect(JSON.parse(challengeCall[1].body)).toEqual({ reason: 'Confirm payment' })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://auth.test.com/token')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://auth.test.com/api/v1/auth/me/permissions')
  })

  it('stepUp throws when not authenticated', async () => {
    const { result } = renderHook(() => useStepUp(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    await expect(
      act(() => result.current.stepUp()),
    ).rejects.toThrow('Not authenticated')
  })
})
