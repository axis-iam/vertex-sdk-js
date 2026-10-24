import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useIam } from './useIam'
import { setupMockFetch, storeTestTokens, makeTestUser, testProviderProps } from '../test-utils'

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

  it('returns roles from permissions API', async () => {
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
    expect(result.current.user).not.toHaveProperty('raw')
  })

  it('returns org context', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.orgId).toBeUndefined()
    expect(result.current.orgSlug).toBeUndefined()
    expect(result.current.orgRole).toBeUndefined()
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

  it('detects impersonation from API context', async () => {
    const user=makeTestUser();user.authenticationContext.impersonation={actorId:'admin-789',impersonationId:'real-id'}
    setupMockFetch(undefined,user)
    storeTestTokens('fixture-token')
    const { result } = renderHook(() => useIam(), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current.isImpersonating).toBe(true)
    expect(result.current.actorId).toBe('admin-789')
  })
})
