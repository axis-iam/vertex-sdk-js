import type { IdentityProviderOption, SocialProviderConfig } from './types'

const CLICKABLE_PROTOCOLS = new Set(['OIDC', 'OAUTH2'])

export function isClickableIdentityProvider(provider: IdentityProviderOption): boolean {
  return provider.enabled
    && provider.supportsBrokeredToken
    && Boolean(provider.authorizationUrl)
    && CLICKABLE_PROTOCOLS.has(provider.protocol.toUpperCase())
}

export function applyLegacySocialProviderOverrides(
  providers: IdentityProviderOption[],
  socialProviders: SocialProviderConfig[] = [],
): IdentityProviderOption[] {
  if (socialProviders.length === 0) return providers

  return providers.map((provider) => {
    const override = socialProviders.find((item) => legacyProviderMatches(provider, item))
    if (!override?.displayName) return provider
    return { ...provider, displayName: override.displayName }
  })
}

function legacyProviderMatches(provider: IdentityProviderOption, legacy: SocialProviderConfig): boolean {
  const key = legacy.provider.toLowerCase()
  return [
    provider.id,
    provider.providerType,
    provider.name,
  ].some((value) => value.toLowerCase() === key)
}
