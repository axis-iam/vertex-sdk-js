import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useImpersonation } from './useImpersonation'
import { setupMockFetch, storeTestTokens, makeTestJwt, testProviderProps } from '../test-utils'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

describe('useImpersonation', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('isImpersonating is false for normal session', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useImpersonation(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isImpersonating).toBe(false)
    expect(result.current.actorId).toBeUndefined()
  })

  it('detects impersonation from act claim', async () => {
    const jwt = makeTestJwt({ act: { sub: 'admin-789' } })
    storeTestTokens(jwt)
    const { result } = renderHook(() => useImpersonation(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isImpersonating).toBe(true)
    expect(result.current.actorId).toBe('admin-789')
  })

  it('endImpersonation calls API and clears tokens', async () => {
    const jwt = makeTestJwt({ act: { sub: 'admin-789', session_id: 'sess-001' } })
    storeTestTokens(jwt)
    const { result } = renderHook(() => useImpersonation(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    globalThis.fetch = fetchMock

    await act(async () => {
      await result.current.endImpersonation()
    })

    // Should have called the end-impersonation endpoint with sessionId
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/impersonate/sess-001/end')
  })

  it('isImpersonating is false when unauthenticated', async () => {
    const { result } = renderHook(() => useImpersonation(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isImpersonating).toBe(false)
  })
})
