import { IamApiError, IamConfigurationError } from './types'
import type {
  AuthMethodIdpProviderResponse,
  IamConfig,
  IdentityProviderOption,
  ProviderAuthorizationOptions,
  ProviderAuthorizationResponse,
} from './types'
import { isClickableIdentityProvider } from './identity-providers'
import { requestJson } from './http-client'
import { prepareAuthorizationCodeContext } from './oauth-callback'

export interface StartProviderAuthorizationInput {
  provider: IdentityProviderOption | AuthMethodIdpProviderResponse
  config: Pick<IamConfig, 'audience' | 'redirectUri' | 'scopes'>
  options?: ProviderAuthorizationOptions
  resolveRedirectUri: (redirectUri?: string) => string
  intent?: 'sign-in' | 'sign-up'
  assertCurrent?: () => void
}

type ProviderRegistrationGrantBody = {
  registrationGrantToken?: string
  registrationAccessCode?: string
}

export async function startProviderAuthorization(input: StartProviderAuthorizationInput): Promise<string> {
  const { provider, config, options = {}, resolveRedirectUri } = input

  if (!isEmbeddedSignInProvider(provider, input.intent)) {
    throw new Error('Identity provider is not available for embedded sign-in')
  }

  const registrationGrantBody = providerRegistrationGrantBody(options.registrationGrant)
  const { codeChallenge, state } = await prepareAuthorizationCodeContext(input.assertCurrent)
  const scopes = options.scopes ?? config.scopes ?? ['openid', 'profile', 'email', 'offline_access']
  const audience = options.audience ?? config.audience
  const body: {
    completionMode: 'AUTHORIZATION_CODE'
    redirectUri: string
    scope: string
    state: string
    codeChallenge: string
    codeChallengeMethod: 'S256'
    audience?: string
    registrationGrantToken?: string
    registrationAccessCode?: string
  } = {
    completionMode: 'AUTHORIZATION_CODE',
    redirectUri: resolveRedirectUri(options.redirectUri),
    scope: scopes.join(' '),
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
  }

  if (audience) {
    body.audience = audience
  }
  Object.assign(body, registrationGrantBody)

  const data = await requestJson<ProviderAuthorizationResponse>(provider.authorizationUrl, {
    method: 'POST',
    json: body,
  })
  input.assertCurrent?.()
  if (!data || typeof data.authorizationUrl !== 'string' || !data.authorizationUrl.trim()) {
    throw new IamConfigurationError('Provider authorization failed: missing authorization URL')
  }

  let authorizationUrl: URL
  try {
    authorizationUrl = new URL(data.authorizationUrl)
  } catch (error) {
    throw new IamConfigurationError('Provider authorization returned an invalid URL', error)
  }
  if (!['http:', 'https:'].includes(authorizationUrl.protocol))
    throw new IamConfigurationError('Provider authorization returned an unsafe URL')
  return authorizationUrl.toString()
}

function providerRegistrationGrantBody(input: unknown): ProviderRegistrationGrantBody {
  if (input === undefined) return {}
  if (!isRecord(input)) throw invalidRegistrationGrant()

  switch (input.type) {
    case 'EMAIL_LINK':
      return { registrationGrantToken: requireProof(input.registrationGrantToken) }
    case 'ACCESS_CODE':
      return { registrationAccessCode: requireProof(input.registrationAccessCode) }
    case 'ORG_INVITATION':
      throw new IamApiError('Organization invitation proof is not supported for provider authorization', {
        status: 400,
        code: 'REGISTRATION_GRANT_INVALID',
      })
    default:
      throw invalidRegistrationGrant()
  }
}

function requireProof(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidRegistrationGrant()
  return value
}

function invalidRegistrationGrant(): IamApiError {
  return new IamApiError('Registration grant proof is invalid.', {
    status: 400,
    code: 'REGISTRATION_GRANT_INVALID',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isEmbeddedSignInProvider(
  provider: IdentityProviderOption | AuthMethodIdpProviderResponse,
  intent: 'sign-in' | 'sign-up' = 'sign-in',
): provider is typeof provider & { authorizationUrl: string } {
  if (isAuthMethodIdpProvider(provider)) {
    return (
      provider.enabled &&
      provider.configured &&
      provider.clickable &&
      (intent === 'sign-up' ? provider.availableForSignup : provider.availableForLogin) &&
      typeof provider.authorizationUrl === 'string' &&
      provider.authorizationUrl.length > 0
    )
  }
  return isClickableIdentityProvider(provider)
}

function isAuthMethodIdpProvider(
  provider: IdentityProviderOption | AuthMethodIdpProviderResponse,
): provider is AuthMethodIdpProviderResponse {
  return 'availableForLogin' in provider && 'clickable' in provider && 'configured' in provider
}
