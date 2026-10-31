import type { IdentityProviderOption } from './types'

const CLICKABLE_PROTOCOLS = new Set(['OIDC', 'OAUTH2'])

export function isClickableIdentityProvider(provider: IdentityProviderOption): boolean {
  return provider.enabled
    && provider.supportsBrokeredToken
    && Boolean(provider.authorizationUrl)
    && CLICKABLE_PROTOCOLS.has(provider.protocol.toUpperCase())
}
