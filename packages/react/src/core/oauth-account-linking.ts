import { requestJson } from './http-client'
import { IamApiError } from './types'
import type { LinkableIdentityProvider, OIDCConfiguration } from './types'
import { record } from './identity-client'
export interface OAuthAccountLinkingClientOptions {
  discover: () => Promise<OIDCConfiguration>
  getAccessToken: () => string | null
  resolveRedirectUri: (redirectUri?: string) => string
}
export class OAuthAccountLinkingClient {
  constructor(private readonly options: OAuthAccountLinkingClientOptions) {}
  async listLinkableIdentityProviders(): Promise<LinkableIdentityProvider[]> {
    const token = this.options.getAccessToken()
    if (!token) throw new IamApiError('Authentication required', { status: 401, code: 'UNAUTHENTICATED' })
    const config = await this.options.discover()
    const data = await requestJson<unknown>(new URL('/api/v1/auth/me/linkable-identity-providers', config.issuer).toString(), { bearerToken: token })
    if (!Array.isArray(data)) throw new Error('Invalid linkable providers response')
    return data.map(value => {
      const p = record(value)
      if (typeof p.id !== 'string' || typeof p.providerType !== 'string' || typeof p.protocol !== 'string' ||
          typeof p.displayName !== 'string' || typeof p.enabled !== 'boolean' || typeof p.linked !== 'boolean' ||
          typeof p.supportsAccountLinking !== 'boolean' || typeof p.canLink !== 'boolean' || typeof p.canReauthenticate !== 'boolean' ||
          !Array.isArray(p.unavailableReasons) || !p.unavailableReasons.every((x): x is string => typeof x === 'string') ||
          (p.linkedAt != null && typeof p.linkedAt !== 'string')) throw new Error('Invalid linkable providers response')
      return { id: p.id, providerType: p.providerType, protocol: p.protocol, displayName: p.displayName,
        enabled: p.enabled, linked: p.linked, linkedAt: p.linkedAt ?? null,
        supportsAccountLinking: p.supportsAccountLinking, canLink: p.canLink, canReauthenticate: p.canReauthenticate,
        unavailableReasons: p.unavailableReasons }
    })
  }
}
