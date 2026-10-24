import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider, useIamContext } from '../provider/IamProvider'
import { useStepUp } from './useStepUp'
import { useAuth } from '../hooks/useAuth'
import { setupMockFetch, storeTestTokens, makeTestUser, testProviderProps } from '../test-utils'
function wrapper({ children }: { children: ReactNode }) { return createElement(IamProvider, testProviderProps(), children) }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status})
beforeEach(() => { sessionStorage.clear(); setupMockFetch() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('server-bound step-up', () => {
  it('displays safe MFA context without treating assurance as a grant', async () => {
    const user = makeTestUser(); user.authenticationContext.assuranceLevel = 'mfa'
    setupMockFetch(undefined, user); storeTestTokens()
    const h = renderHook(() => ({step:useStepUp(),auth:useAuth(),context:useIamContext()}), {wrapper})
    await waitFor(() => expect(h.result.current.auth.isAuthenticated).toBe(true))
    expect(h.result.current.step.authenticationContext?.assuranceLevel).toBe('mfa')
    expect(h.result.current.step).not.toHaveProperty('isSteppedUp')
  })
  it('starts a purpose-bound challenge and verifies without refresh or fabricated grant state', async () => {
    storeTestTokens()
    const h = renderHook(() => ({step:useStepUp(),auth:useAuth(),context:useIamContext()}), {wrapper})
    await waitFor(() => expect(h.result.current.auth.isAuthenticated).toBe(true))
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(response({challengeId:'challenge-1',availableMethods:['totp']})).mockResolvedValueOnce(response({verified:true,acr:'mfa'}))
    vi.stubGlobal('fetch', mock)
    const challenge = await h.result.current.step.start('PASSWORD_CHANGE','Change password')
    await challenge.verifyTotp('123456')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(mock.mock.calls.map(([url]) => String(url))).toEqual(['https://auth.test.com/api/v1/auth/step-up/start','https://auth.test.com/api/v1/auth/step-up/verify'])
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body))).toEqual({trigger:'PASSWORD_CHANGE',reason:'Change password'})
    expect(JSON.parse(String(mock.mock.calls[1][1]?.body))).toEqual({challengeId:'challenge-1',code:'123456'})
    act(() => h.result.current.context.client.tokenManager.clear())
    await expect(challenge.verifyTotp('123456')).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
    expect(mock).toHaveBeenCalledTimes(2)
  })
  it.each([false, null])('rejects an unverified result %s', async verified => {
    storeTestTokens()
    const h = renderHook(() => ({step:useStepUp(),auth:useAuth(),context:useIamContext()}), {wrapper})
    await waitFor(() => expect(h.result.current.auth.isAuthenticated).toBe(true))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({challengeId:'c',availableMethods:['totp']})).mockResolvedValueOnce(response({verified})))
    const c = await h.result.current.step.start('MFA_CHANGE')
    await expect(c.verifyTotp('bad')).rejects.toThrow('not verified')
  })
  it('rejects TOTP when the server offered only WebAuthn', async () => {
    storeTestTokens()
    const h=renderHook(()=>({step:useStepUp(),auth:useAuth()}),{wrapper})
    await waitFor(()=>expect(h.result.current.auth.isAuthenticated).toBe(true))
    const mock=vi.fn().mockResolvedValue(response({challengeId:'c',availableMethods:['webauthn']}))
    vi.stubGlobal('fetch',mock)
    const challenge=await h.result.current.step.start('MFA_CHANGE')
    await expect(challenge.verifyTotp('code')).rejects.toThrow('TOTP is unavailable')
    expect(mock).toHaveBeenCalledOnce()
  })
  it('rejects an unauthenticated start', async () => {
    const h=renderHook(() => useStepUp(), {wrapper})
    await expect(h.result.current.start('MFA_CHANGE')).rejects.toThrow('Not authenticated')
  })
})
