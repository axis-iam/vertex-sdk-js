import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IamProvider } from '../provider/IamProvider'
import { SignIn } from './SignIn'
import { AuthDialog } from './AuthDialog'
import { useAuthFlow } from '../hooks/useAuthFlow'
import {
  flowCapabilities,
  flowPolicy,
} from '../core/auth-flow-fixtures.test-support'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function Custom() {
  const { state } = useAuthFlow()
  return (
    <div>
      {state.step === 'identifier' ? 'Custom metadata ready' : state.step}
    </div>
  )
}
it.each(['Embedded', 'Dialog', 'Custom'])(
  'opens %s with current metadata and no retired verification mode',
  async (entry) => {
    expect(flowCapabilities).not.toHaveProperty('emailVerificationMode')
    expect(flowPolicy).not.toHaveProperty('emailVerificationMode')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const value = input.endsWith('/auth-methods')
          ? flowCapabilities
          : input.endsWith('/auth-policy')
            ? flowPolicy
            : input.endsWith('openid-configuration')
              ? {
                  issuer: 'https://iam.test',
                  authorization_endpoint: 'https://iam.test/authorize',
                  token_endpoint: 'https://iam.test/token',
                  jwks_uri: 'https://iam.test/jwks',
                }
              : null
        return new Response(JSON.stringify(value), {
          status: value ? 200 : 404,
        })
      }),
    )
    render(
      <IamProvider
        clientId="flow-test"
        issuerUri="https://iam.test"
        redirectUri="http://localhost/callback"
      >
        {entry === 'Embedded' ? (
          <SignIn mode="embedded" />
        ) : entry === 'Dialog' ? (
          <AuthDialog open onOpenChange={() => {}} />
        ) : (
          <Custom />
        )}
      </IamProvider>,
    )
    if (entry === 'Custom')
      expect(await screen.findByText('Custom metadata ready')).toBeTruthy()
    else {
      const input = await screen.findByPlaceholderText(
        'you@example.com or +86 13800138000',
      )
      expect(input).toBeTruthy()
      expect(
        screen.queryByText('Invalid auth capability/policy response'),
      ).toBeNull()
      fireEvent.change(input, { target: { value: 'user@example.invalid' } })
      fireEvent.submit(input.closest('form')!)
      expect(
        await screen.findByPlaceholderText('Enter your password'),
      ).toBeTruthy()
    }
  },
)
