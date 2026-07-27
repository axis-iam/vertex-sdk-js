import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../../core/oauth-client'
import type { PublicAuthMethodsResponse } from '../../core/types'
import { useSignInFlow } from './useSignInFlow'

function authMethodsWith(options: { password?: boolean; emailOtp?: boolean; magicLink?: boolean; sms?: boolean }): PublicAuthMethodsResponse {
  return {
    clientId: 'test-app',
    passwordLoginEnabled: options.password ?? false,
    emailMagicLinkEnabled: options.magicLink ?? false,
    emailOtpEnabled: options.emailOtp ?? false,
    smsOtpEnabled: options.sms ?? false,
    socialLoginEnabled: false,
    signupEnabled: true,
    selfRegistrationEnabled: true,
    emailVerificationMode: 'OFF',
    idpAutoProvisioningEnabled: false,
    loginInitiationUri: null,
    postVerificationRedirectUri: null,
    methods: [
      { type: 'PASSWORD', enabled: true, configured: true, availableForLogin: options.password ?? false, availableForSignup: true, unavailableReason: null },
      { type: 'EMAIL_OTP', enabled: true, configured: true, availableForLogin: options.emailOtp ?? false, availableForSignup: true, unavailableReason: null },
      { type: 'EMAIL_MAGIC_LINK', enabled: true, configured: true, availableForLogin: options.magicLink ?? false, availableForSignup: true, unavailableReason: null },
      { type: 'SMS_OTP', enabled: true, configured: true, availableForLogin: options.sms ?? false, availableForSignup: true, unavailableReason: null },
    ],
    idpProviders: [],
    resend: {
      emailVerificationCooldownSeconds: 60,
    },
  }
}

function clientWith(authMethods: PublicAuthMethodsResponse): OAuthClient {
  const client = new OAuthClient({
    clientId: 'test-app',
    issuerUri: 'https://auth.test.com',
    redirectUri: 'https://app.test.com/callback',
    socialProviders: [],
  })
  vi.spyOn(client, 'getPublicAuthMethods').mockResolvedValue(authMethods)
  return client
}

function FlowHarness({ client }: { client: OAuthClient }) {
  const flow = useSignInFlow(client)
  const stateSelectedMethod = flow.state.step === 'method' ? flow.state.selectedMethod : null

  return (
    <div>
      <span data-testid="loading">{String(flow.authMethodsLoading)}</span>
      <span data-testid="step">{flow.state.step}</span>
      <span data-testid="methods">{flow.credentialMethods.map((method) => method.id).join(',')}</span>
      <span data-testid="selected">{flow.selectedMethod ?? 'none'}</span>
      <span data-testid="state-selected">{stateSelectedMethod ?? 'none'}</span>
      <button type="button" onClick={() => flow.dispatch({ type: 'continueIdentifier', value: 'user@test.com' })}>email</button>
      <button type="button" onClick={() => flow.dispatch({ type: 'continueIdentifier', value: '+8613800138000' })}>phone</button>
      <button type="button" onClick={() => flow.dispatch({ type: 'selectMethod', method: 'email_otp' })}>select email otp</button>
      <button type="button" onClick={() => flow.dispatch({ type: 'selectMethod', method: 'sms' })}>select sms</button>
    </div>
  )
}

describe('useSignInFlow', () => {
  it('auto-selects and stores the first backend-available method for an email identifier', async () => {
    render(createElement(FlowHarness, { client: clientWith(authMethodsWith({ password: true, emailOtp: true, sms: true })) }))

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))

    fireEvent.click(screen.getByText('email'))

    await waitFor(() => {
      expect(screen.getByTestId('methods').textContent).toBe('password,email_otp')
      expect(screen.getByTestId('selected').textContent).toBe('password')
      expect(screen.getByTestId('state-selected').textContent).toBe('password')
    })
  })

  it('reconciles stale selected methods against auth-methods discovery', async () => {
    render(createElement(FlowHarness, { client: clientWith(authMethodsWith({ password: true })) }))

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))

    fireEvent.click(screen.getByText('email'))
    await waitFor(() => expect(screen.getByTestId('state-selected').textContent).toBe('password'))

    fireEvent.click(screen.getByText('select email otp'))

    await waitFor(() => {
      expect(screen.getByTestId('selected').textContent).toBe('password')
      expect(screen.getByTestId('state-selected').textContent).toBe('password')
    })
  })

  it('chooses phone-compatible methods for phone identifiers', async () => {
    render(createElement(FlowHarness, { client: clientWith(authMethodsWith({ password: true, sms: true })) }))

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))

    fireEvent.click(screen.getByText('phone'))

    await waitFor(() => {
      expect(screen.getByTestId('methods').textContent).toBe('sms')
      expect(screen.getByTestId('selected').textContent).toBe('sms')
      expect(screen.getByTestId('state-selected').textContent).toBe('sms')
    })

    fireEvent.click(screen.getByText('select sms'))

    await waitFor(() => {
      expect(screen.getByTestId('selected').textContent).toBe('sms')
      expect(screen.getByTestId('state-selected').textContent).toBe('sms')
    })
  })
})
