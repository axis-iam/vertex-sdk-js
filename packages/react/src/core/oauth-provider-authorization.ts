import type {
  AuthMethodIdpProviderResponse,
  IdentityProviderOption,
} from './types'
import { isClickableIdentityProvider } from './identity-providers'

export function isEmbeddedSignInProvider(
  provider: IdentityProviderOption | AuthMethodIdpProviderResponse,
  intent: 'sign-in' | 'sign-up' = 'sign-in',
): provider is typeof provider & { authorizationUrl: string } {
  if (isAuthMethodIdpProvider(provider)) {
    return (
      provider.enabled &&
      provider.configured &&
      provider.clickable &&
      (intent === 'sign-up'
        ? provider.availableForSignup
        : provider.availableForLogin) &&
      typeof provider.authorizationUrl === 'string' &&
      provider.authorizationUrl.length > 0
    )
  }
  return isClickableIdentityProvider(provider)
}

function isAuthMethodIdpProvider(
  provider: IdentityProviderOption | AuthMethodIdpProviderResponse,
): provider is AuthMethodIdpProviderResponse {
  return (
    'availableForLogin' in provider &&
    'clickable' in provider &&
    'configured' in provider
  )
}
