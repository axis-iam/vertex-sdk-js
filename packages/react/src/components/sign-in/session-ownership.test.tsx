import { createElement } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IamUiProvider } from '../../provider/IamUiProvider'
import { OAuthClient } from '../../core/oauth-client'
import { makeTestJwt } from '../../test-utils'
import { resolveAppearance } from '../styles'
import { PasswordStep } from './PasswordStep'
import { EmailOtpStep } from './EmailOtpStep'
import { SmsOtpStep } from './SmsOtpStep'

const token = (name: string) => ({ access_token: makeTestJwt({ sub: name }), refresh_token: name, token_type: 'Bearer', expires_in: 3600 })
afterEach(() => vi.restoreAllMocks())
describe('final Direct authentication response ownership', () => {
  for (const form of ['Password', 'EmailOTP', 'SmsOTP'] as const) {
    it.each(['unmount', 'logout', 'dispose', 'new-login'] as const)(`${form} ignores completion after %s`, async replacement => {
      const client = new OAuthClient({ issuerUri: 'https://auth.test.com', clientId: 'test', redirectUri: '/callback' })
      vi.spyOn(client, 'discover').mockResolvedValue({ issuer: 'https://auth.test.com' } as Awaited<ReturnType<typeof client.discover>>)
      let complete!: (response: Response) => void
      const fetchMock = vi.fn(() => new Promise<Response>(resolve => { complete = resolve }))
      vi.stubGlobal('fetch', fetchMock)
      const onSuccess = vi.fn()
      const onError = vi.fn()
      const common = { client, appearance: resolveAppearance(), onSuccess, onError }
      const element = form === 'Password'
        ? createElement(PasswordStep, { ...common, identifier: 'user@example.invalid', resendCooldownSeconds: 60 })
        : form === 'EmailOTP'
          ? createElement(EmailOtpStep, { ...common, email: 'user@example.invalid' })
          : createElement(SmsOtpStep, { ...common, phone: '+15555550123' })
      const view = render(createElement(IamUiProvider, { children: element }))
      fireEvent.submit(view.container.querySelector('form')!)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      if (replacement === 'unmount') view.unmount()
      if (replacement === 'logout') client.tokenManager.clear()
      if (replacement === 'dispose') client.dispose()
      if (replacement === 'new-login') client.tokenManager.store(token('new-login'), 'DIRECT_AUTH', 'DIRECT_AUTH')
      await act(async () => { complete(new Response(JSON.stringify(token('old-login')), { status: 200 })) })
      expect(client.tokenManager.getRefreshToken()).toBe(replacement === 'new-login' ? 'new-login' : null)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      view.unmount()
      client.dispose()
      vi.unstubAllGlobals()
    })
  }
})
