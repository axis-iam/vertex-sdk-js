import { webcrypto } from 'node:crypto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { OAuthClient } from '../../core/oauth-client'
import { useAuthFlow } from '../../hooks/useAuthFlow'
import { flowCapabilities, flowPolicy } from '../../core/auth-flow-fixtures.test-support'
import { makeTestJwt, makeTestUser } from '../../test-utils'
vi.mock('../../provider/IamProvider', () => ({ useIamContext: () => ({ client }) }))
let client: OAuthClient
const token = (name: string) => ({
  access_token: makeTestJwt({ sub: name }),
  refresh_token: name,
  token_type: 'Bearer',
  expires_in: 3600,
})
let created: { state: string }
let transactionExpiry: string
const expiry = () => transactionExpiry
const view = () => ({ transactionId: 'ownership-transaction', state: 'AUTHENTICATED', expiresAt: expiry(), nextAction: 'complete' })
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
  transactionExpiry = new Date(Date.now() + 600000).toISOString()
  client = new OAuthClient({
    issuerUri: 'https://auth.test.com',
    clientId: 'test',
    redirectUri: 'https://app.test/callback',
  })
  vi.spyOn(client, 'discover').mockResolvedValue({ issuer: 'https://auth.test.com', token_endpoint: 'https://auth.test.com/token', authorization_endpoint: 'https://auth.test.com/authorize', userinfo_endpoint: 'https://auth.test.com/userinfo', jwks_uri: 'https://auth.test.com/jwks' } as Awaited<
    ReturnType<typeof client.discover>
  >)
  vi.spyOn(client, 'getPublicAuthMethods').mockResolvedValue(flowCapabilities)
  vi.spyOn(client, 'getPublicAuthPolicy').mockResolvedValue(flowPolicy)
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/transactions')) {
      created = JSON.parse(String(init?.body))
      return response({ transactionId: 'ownership-transaction', controlSecret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', expiresAt: expiry(), nextAction: 'authenticate' })
    }
    if (url.endsWith('/challenges')) return response({ transactionId: 'ownership-transaction', expiresAt: expiry(), challengeExpiresAt: expiry(), cooldownSeconds: 0, nextAction: 'authenticate' })
    if (url.endsWith('/authenticate')) return response(view())
    if (url.endsWith('/complete')) return response({ kind: 'authorization_code', code: 'one-use-code', state: created.state, expiresIn: 120 })
    if (url.endsWith('/token')) return response(token('successful-login'))
    if (url.endsWith('/me')) {
      const user = makeTestUser(); user.authenticationContext.clientId = 'test'
      return response(user)
    }
    if (url.endsWith('/me/permissions')) return response({ applicationId: 'app-test', organizationId: null, roles: [], permissions: [] })
    throw new Error('Unexpected ownership fixture route')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  client.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})
describe('shared transaction completion ownership', () => {
  it.each(['password', 'email_otp', 'sms'] as const)('%s completes through authorization code, token exchange and both bound views', async method => {
    const onSignInSuccess = vi.fn()
    const hook = renderHook(() => useAuthFlow({ onSignInSuccess }))
    await waitFor(() => expect(hook.result.current.state.step).toBe('identifier'))
    act(() => {
      hook.result.current.actions.continueWithIdentifier(method === 'sms' ? { kind: 'PHONE', value: '+15555550123' } : { kind: 'EMAIL', value: 'u@example.invalid' })
      hook.result.current.actions.selectMethod(method)
    })
    await act(async () => {
      if (method === 'password') await hook.result.current.actions.submitPassword('password')
      else { await hook.result.current.actions.sendCode(); await hook.result.current.actions.verifyCode('123456') }
    })
    expect(onSignInSuccess).toHaveBeenCalledOnce()
    expect(client.isAuthenticated()).toBe(true)
    expect(client.tokenManager.getRefreshToken()).toBe('successful-login')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1)
    expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
  })
  for (const method of ['password', 'email_otp', 'sms'] as const)
    it.each(['unmount', 'logout', 'dispose', 'new-login'] as const)(
      `${method} rejects old completion after %s`,
      async (replacement) => {
        const onSignInSuccess = vi.fn(),
          onError = vi.fn()
        const hook = renderHook(() => useAuthFlow({ onSignInSuccess, onError }))
        await waitFor(() => expect(hook.result.current.state.step).toBe('identifier'))
        act(() => {
          hook.result.current.actions.continueWithIdentifier(
            method === 'sms' ? { kind: 'PHONE', value: '+15555550123' } : { kind: 'EMAIL', value: 'u@example.invalid' },
          )
          hook.result.current.actions.selectMethod(method)
        })
        if (method !== 'password')
          await act(async () => {
            await hook.result.current.actions.sendCode()
          })
        let complete!: (response: Response) => void
        const original = fetchMock.getMockImplementation()!
        fetchMock.mockImplementation((input, init) => String(input).endsWith('/authenticate')
          ? new Promise(resolve => { complete = resolve }) : original(input, init))
        let request!: Promise<void>
        act(() => {
          request =
            method === 'password'
              ? hook.result.current.actions.submitPassword('password')
              : hook.result.current.actions.verifyCode('123456')
        })
        const rejected = expect(request).rejects.toBeInstanceOf(SessionInvalidatedError)
        await waitFor(() => expect(complete).toBeTypeOf('function'))
        act(() => {
          if (replacement === 'unmount') hook.unmount()
          if (replacement === 'logout') client.tokenManager.clear()
          if (replacement === 'dispose') client.dispose()
          if (replacement === 'new-login')
            client.tokenManager.store(token('new-login'), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
        })
        await act(async () => {
          complete(response(view()))
          await rejected
        })
        expect(client.tokenManager.getRefreshToken()).toBe(replacement === 'new-login' ? 'new-login' : null)
        expect(onSignInSuccess).not.toHaveBeenCalled()
        expect(onError).not.toHaveBeenCalled()
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/complete') || String(url).endsWith('/token'))).toBe(false)
      },
    )
})
