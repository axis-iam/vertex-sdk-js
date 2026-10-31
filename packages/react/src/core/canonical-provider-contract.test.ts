import { afterEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import { ServerSessionClient } from './server-session-client'
import { isClickableIdentityProvider } from './identity-providers'
import { isEmbeddedSignInProvider } from './oauth-provider-authorization'
import { getAvailableProviderOptions } from '../components/sign-in/sign-in-flow'
import { flowCapabilities } from './auth-flow-fixtures.test-support'
import { IamConfigurationError } from './types'
import type { AuthMethodIdpProviderResponse, IamConfig, IdentityProviderOption } from './types'

const config: IamConfig = {
  clientId: 'canonical-client', issuerUri: 'https://iam.example.invalid',
  redirectUri: 'https://app.example.invalid/callback', audience: 'application-resource',
}
const provider = flowCapabilities.idpProviders[0]!
const discoveryProvider: IdentityProviderOption = {
  id: 'provider-exact-id', applicationId: 'app', providerType: 'OIDC', name: 'backend-name', displayName: 'Backend label',
  enabled: true, protocol: 'OIDC', supportsBrokeredToken: true,
  authorizationUrl: 'https://iam.example.invalid/provider', samlAcsUrl: null,
}
afterEach(() => vi.restoreAllMocks())

describe('canonical provider contract', () => {
  it('keeps exact IDs and backend labels when providers share type or display name', () => {
    const providers = [provider, { ...provider, id: 'other-id' },
      { ...provider, id: 'PROVIDER', displayName: 'Other backend label' }]
    const actual = getAvailableProviderOptions({ ...flowCapabilities, idpProviders: providers })
    expect(actual).toEqual(providers)
    actual.forEach((value, index) => expect(value).toBe(providers[index]))
  })

  it.each([
    { enabled: false }, { configured: false }, { clickable: false },
    { availableForLogin: false }, { authorizationUrl: null }, { authorizationUrl: '' },
  ] satisfies Partial<AuthMethodIdpProviderResponse>[])('does not activate unavailable provider %j', patch => {
    const value = { ...provider, ...patch }
    expect(getAvailableProviderOptions({ ...flowCapabilities, idpProviders: [value] })).toEqual([])
    expect(isEmbeddedSignInProvider(value)).toBe(false)
  })

  it('uses the explicit intent, global social gate and empty discovered list', () => {
    const value = { ...provider, availableForSignup: false }
    const capabilities = { ...flowCapabilities, idpProviders: [value] }
    expect(getAvailableProviderOptions(capabilities, 'sign-in')).toEqual([value])
    expect(getAvailableProviderOptions(capabilities, 'sign-up')).toEqual([])
    expect(getAvailableProviderOptions({ ...capabilities, socialLoginEnabled: false })).toEqual([])
    expect(getAvailableProviderOptions({ ...capabilities, idpProviders: [] })).toEqual([])
  })

  it.each([
    { enabled: false }, { supportsBrokeredToken: false }, { protocol: 'SAML' },
    { protocol: 'UNSUPPORTED' }, { authorizationUrl: null }, { authorizationUrl: '' },
  ] satisfies Partial<IdentityProviderOption>[])('preserves discovery clickability for %j', patch => {
    expect(isClickableIdentityProvider({ ...discoveryProvider, ...patch })).toBe(false)
  })

  it('accepts only discovered supported provider protocols without renaming', () => {
    expect(isClickableIdentityProvider(discoveryProvider)).toBe(true)
    expect(isClickableIdentityProvider({ ...discoveryProvider, protocol: 'OAUTH2' })).toBe(true)
    expect(discoveryProvider.displayName).toBe('Backend label')
  })

  it.each(['authMethods', 'socialProviders'])('rejects retired %s before either mode creates side effects', key => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const request = vi.fn().mockRejectedValue(new Error('unexpected session request'))
    for (const value of [undefined, [], [{ provider: 'OIDC', displayName: 'Spoofed', clientId: 'retired' }]]) {
      const invalid = { ...config, [key]: value }
      expect(() => new OAuthClient(invalid)).toThrow(IamConfigurationError)
      expect(() => new OAuthClient(invalid)).toThrow(`Unsupported IAM configuration option: ${key}`)
      expect(() => new ServerSessionClient({ ...invalid, sessionMode: 'server_session', sessionTransport: { request } })).toThrow(IamConfigurationError)
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps canonical clientId, resource audience, memory mode and account security composition', () => {
    const client = new OAuthClient(config)
    expect(client.clientId).toBe(config.clientId)
    expect(client.config.audience).toBe('application-resource')
    expect(client.accountSecurity).toBeDefined()
    client.dispose()
    const session = new ServerSessionClient({ ...config, sessionMode: 'server_session', sessionTransport: { request: vi.fn() } })
    expect(session.clientId).toBe(config.clientId)
    expect(session.accountSecurity).toBeDefined()
    session.dispose()
  })
})
