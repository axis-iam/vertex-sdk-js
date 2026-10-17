import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { OAuthClient } from '../../core/oauth-client'
import { useAuthFlow } from '../../hooks/useAuthFlow'
import { flowCapabilities, flowPolicy } from '../../core/auth-flow-fixtures.test-support'
import { makeTestJwt } from '../../test-utils'
vi.mock('../../provider/IamProvider', () => ({ useIamContext: () => ({ client }) }))
let client: OAuthClient
const token = (name: string) => ({
  access_token: makeTestJwt({ sub: name }),
  refresh_token: name,
  token_type: 'Bearer',
  expires_in: 3600,
})
beforeEach(() => {
  client = new OAuthClient({
    issuerUri: 'https://auth.test.com',
    clientId: 'test',
    redirectUri: 'https://app.test/callback',
  })
  vi.spyOn(client, 'discover').mockResolvedValue({ issuer: 'https://auth.test.com' } as Awaited<
    ReturnType<typeof client.discover>
  >)
  vi.spyOn(client, 'getPublicAuthMethods').mockResolvedValue(flowCapabilities)
  vi.spyOn(client, 'getPublicAuthPolicy').mockResolvedValue(flowPolicy)
})
afterEach(() => {
  client.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('shared Direct completion ownership', () => {
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
            method === 'sms' ? '+15555550123' : 'u@example.invalid',
          )
          hook.result.current.actions.selectMethod(method)
        })
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
        if (method !== 'password')
          await act(async () => {
            await hook.result.current.actions.sendCode()
          })
        let complete!: (response: Response) => void
        fetchMock.mockImplementation(
          () =>
            new Promise((resolve) => {
              complete = resolve
            }),
        )
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
            client.tokenManager.store(token('new-login'), 'DIRECT_AUTH', 'DIRECT_AUTH')
        })
        await act(async () => {
          complete(new Response(JSON.stringify(token('old-login')), { status: 200 }))
          await rejected
        })
        expect(client.tokenManager.getRefreshToken()).toBe(replacement === 'new-login' ? 'new-login' : null)
        expect(onSignInSuccess).not.toHaveBeenCalled()
        expect(onError).not.toHaveBeenCalled()
      },
    )
})
