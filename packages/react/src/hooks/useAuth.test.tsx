import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useAuth } from './useAuth'
import { setupMockFetch, storeTestTokens, testProviderProps } from '../test-utils'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

describe('useAuth', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns unauthenticated state when no tokens', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.user).toBeNull()
  })

  it('returns authenticated state when tokens are stored', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user).not.toBeNull()
    expect(result.current.user?.email).toBe('test@example.com')
  })

  it('isLoaded becomes true after discovery', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    // Allow discovery promise to resolve
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isLoaded).toBe(true)
    expect(result.current.initializationError).toBeNull()
  })

  it('exposes initializationError when discovery fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isLoaded).toBe(true)
    expect(result.current.initializationError?.message).toContain('IAM API request failed')
  })

  it('keeps permissions fail-closed but exposes permissionFetchError', async () => {
    storeTestTokens()
    globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/v1/auth/me/permissions')) {
        return { ok: false, status: 503 }
      }
      return {
        ok: true,
        json: async () => ({
          issuer: 'https://auth.test.com',
          authorization_endpoint: 'https://auth.test.com/authorize',
          token_endpoint: 'https://auth.test.com/token',
          userinfo_endpoint: 'https://auth.test.com/userinfo',
          jwks_uri: 'https://auth.test.com/oauth2/jwks',
        }),
      }
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.user?.permissions).toEqual([])
    expect(result.current.permissionFetchError?.message).toContain('IAM API request failed')
  })

  it('provides getAccessToken function', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    const token = result.current.getAccessToken()
    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')
  })

  it('exposes callback, continuation, and logout helpers', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(typeof result.current.handleCallback).toBe('function')
    expect(typeof result.current.handleRedirectCallback).toBe('function')
    expect(typeof result.current.getAppContinuation).toBe('function')
    expect(typeof result.current.getLogoutUrl).toBe('function')
    expect(typeof result.current.logout).toBe('function')
  })

  it('getAccessToken returns null when not authenticated', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.getAccessToken()).toBeNull()
  })

  it('throws when used outside IamProvider', () => {
    expect(() => {
      renderHook(() => useAuth())
    }).toThrow('useIamContext must be used within <IamProvider>')
  })
})
