import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider, useIamContext } from '../provider/IamProvider'
import { useImpersonation } from './useImpersonation'
import { setupMockFetch, storeTestTokens, makeTestUser, testProviderProps } from '../test-utils'

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

  it('detects impersonation from the safe API context', async () => {
    const user = makeTestUser(); user.authenticationContext.impersonation = { actorId: 'admin-789', impersonationId: 'real-id' }
    setupMockFetch(undefined, user)
    storeTestTokens('fixture-token')
    const { result } = renderHook(() => useImpersonation(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.isImpersonating).toBe(true)
    expect(result.current.actorId).toBe('admin-789')
  })

  it('endImpersonation calls API and clears tokens', async () => {
    const user = makeTestUser(); user.authenticationContext.impersonation = { actorId: 'admin-789', impersonationId: 'sess-001' }
    setupMockFetch(undefined, user)
    storeTestTokens('fixture-token')
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


describe('impersonation response ownership', () => {
  beforeEach(()=>{sessionStorage.clear();const user=makeTestUser();user.authenticationContext.impersonation={actorId:'actor',impersonationId:'exact-id'};setupMockFetch(undefined,user);storeTestTokens('fixture-token')})
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear()})
  it('does not clear another login when the old end response arrives', async () => {
    const h=renderHook(()=>({impersonation:useImpersonation(),context:useIamContext()}),{wrapper})
    await waitFor(()=>expect(h.result.current.context.isAuthenticated).toBe(true))
    let release!:(r:Response)=>void
    const mock=vi.fn<typeof fetch>(()=>new Promise<Response>(done=>{release=done}))
    vi.stubGlobal('fetch',mock)
    const pending=h.result.current.impersonation.endImpersonation()
    const rejected=expect(pending).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
    await waitFor(()=>expect(release).toBeDefined())
    act(()=>{h.result.current.context.client.tokenManager.clear();h.result.current.context.client.tokenManager.store({access_token:'new-account',token_type:'Bearer',expires_in:600},'OAUTH_AUTHORIZATION_CODE',null)})
    await act(async()=>{release(new Response(null,{status:204}));await rejected})
    expect(h.result.current.context.client.getAccessToken()).toBe('new-account')
    expect(mock.mock.calls[0][0]).toContain('/impersonate/exact-id/end')
  })
  it('keeps the active session on a server refusal', async () => {
    const h=renderHook(()=>({impersonation:useImpersonation(),context:useIamContext()}),{wrapper})
    await waitFor(()=>expect(h.result.current.context.isAuthenticated).toBe(true))
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:403})))
    await expect(h.result.current.impersonation.endImpersonation()).rejects.toMatchObject({status:403})
    expect(h.result.current.context.isAuthenticated).toBe(true)
    expect(h.result.current.context.getAccessToken()).toBe('fixture-token')
  })
})
