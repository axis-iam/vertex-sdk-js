import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { usePermission } from './usePermission'
import { setupMockFetch, storeTestTokens, testProviderProps } from '../test-utils'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

describe('usePermission', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns true for exact permission match', async () => {
    storeTestTokens() // permissions: ['orders:read', 'orders:create', 'users:*']
    const { result } = renderHook(() => usePermission('orders:read'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current).toBe(true)
  })

  it('returns true for wildcard match', async () => {
    storeTestTokens()
    const { result } = renderHook(() => usePermission('users:delete'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current).toBe(true) // users:* matches users:delete
  })

  it('returns false for missing permission', async () => {
    storeTestTokens()
    const { result } = renderHook(() => usePermission('reports:read'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current).toBe(false)
  })

  it('returns false when unauthenticated', async () => {
    const { result } = renderHook(() => usePermission('orders:read'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current).toBe(false)
  })

  it('returns false for empty permissions', async () => {
    setupMockFetch([])  // API returns empty permissions too
    storeTestTokens(undefined, [])
    const { result } = renderHook(() => usePermission('orders:read'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current).toBe(false)
  })

  it('handles *:* wildcard', async () => {
    setupMockFetch(['*:*'])
    storeTestTokens(undefined, ['*:*'])
    const { result } = renderHook(() => usePermission('anything:here'), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current).toBe(true)
  })
})
