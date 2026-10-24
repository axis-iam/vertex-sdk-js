import { describe, expect, it } from 'vitest'
import { isEmbeddedSignInProvider } from './oauth-provider-authorization'
import type { AuthMethodIdpProviderResponse, IdentityProviderOption } from './types'

const ISSUER = 'https://auth.example.com'
const PROVIDER_AUTHORIZE_URL = `${ISSUER}/api/v1/apps/my-app/identity-providers/idp-google/oidc/authorize`

const googleProvider: IdentityProviderOption = {
  id: 'idp-google',
  applicationId: 'app-1',
  providerType: 'GOOGLE',
  name: 'google',
  displayName: 'Google',
  enabled: true,
  protocol: 'OIDC',
  authorizationUrl: PROVIDER_AUTHORIZE_URL,
  samlAcsUrl: null,
  supportsBrokeredToken: true,
}

const googleAuthMethodProvider: AuthMethodIdpProviderResponse = {
  id: 'idp-google',
  providerType: 'GOOGLE',
  displayName: 'Google',
  enabled: true,
  configured: true,
  clickable: true,
  availableForLogin: true,
  availableForSignup: true,
  unavailableReason: null,
  authorizationUrl: PROVIDER_AUTHORIZE_URL,
}

describe('oauth provider authorization', () => {
  it('classifies embedded SignIn provider shapes consistently', () => {
    expect(isEmbeddedSignInProvider(googleProvider)).toBe(true)
    expect(isEmbeddedSignInProvider(googleAuthMethodProvider)).toBe(true)
    expect(isEmbeddedSignInProvider({
      ...googleProvider,
      protocol: 'SAML',
      authorizationUrl: null,
    })).toBe(false)
  })
})
