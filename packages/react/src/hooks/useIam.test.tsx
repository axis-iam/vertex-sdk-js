import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useIam } from './useIam'
import { setupMockFetch, storeTestTokens, makeTestJwt, testProviderProps } from '../test-utils'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

describe('useIam', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns user info when authenticated', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user?.id).toBe('user-1')
    expect(result.current.user?.email).toBe('test@example.com')
  })

  it('returns roles from JWT', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.roles).toEqual(['admin'])
  })

  it('returns permissions resolved from auth permissions API when JWT omits permissions', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.permissions).toEqual(['orders:read', 'orders:create', 'users:*'])
    expect(result.current.user?.raw.permissions).toBeUndefined()
  })

  it('returns org context', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.orgId).toBe('org-1')
    expect(result.current.orgSlug).toBe('acme')
    expect(result.current.orgRole).toBe('ADMIN')
  })

  it('returns empty arrays and defaults when unauthenticated', async () => {
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.roles).toEqual([])
    expect(result.current.permissions).toEqual([])
    expect(result.current.orgId).toBeUndefined()
    expect(result.current.isImpersonating).toBe(false)
  })

  it('detects impersonation from act claim', async () => {
    const jwt = makeTestJwt({ act: { sub: 'admin-789' } })
    storeTestTokens(jwt)
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.isImpersonating).toBe(true)
    expect(result.current.actorId).toBe('admin-789')
  })
})
