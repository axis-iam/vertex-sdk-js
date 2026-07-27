import { requestJson } from './http-client'
import {
  fetchPublicAuthMethods as requestPublicAuthMethods,
  fetchPublicAuthPolicy as requestPublicAuthPolicy,
} from './oauth-auth-methods-client'
import type {
  AppContinuation,
  IamConfig,
  IdentityProviderOption,
  OIDCConfiguration,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
} from './types'

export class OAuthPublicMetadataClient {
  private oidcConfig: OIDCConfiguration | null = null
  private discoveryPromise: Promise<OIDCConfiguration> | null = null
  private publicAuthPolicy: PublicAuthPolicyResponse | null = null
  private publicAuthPolicyPromise: Promise<PublicAuthPolicyResponse> | null = null
  private publicAuthMethods: PublicAuthMethodsResponse | null = null
  private publicAuthMethodsPromise: Promise<PublicAuthMethodsResponse> | null = null

  constructor(private readonly config: IamConfig) {}

  async discover(): Promise<OIDCConfiguration> {
    if (this.oidcConfig) return this.oidcConfig

    if (!this.discoveryPromise) {
      this.discoveryPromise = this.fetchDiscovery()
    }
    return this.discoveryPromise
  }

  async listIdentityProviders(): Promise<IdentityProviderOption[]> {
    const config = await this.discover()
    const data = await requestJson<IdentityProviderOption[] | { providers?: IdentityProviderOption[] }>(
      `${config.issuer}/api/v1/apps/${encodeURIComponent(this.config.clientId)}/identity-providers`,
    )
    return Array.isArray(data) ? data : data.providers ?? []
  }

  async getPublicAuthPolicy(): Promise<PublicAuthPolicyResponse> {
    if (this.publicAuthPolicy) return this.publicAuthPolicy

    if (!this.publicAuthPolicyPromise) {
      this.publicAuthPolicyPromise = this.fetchPublicAuthPolicy().catch((error) => {
        this.publicAuthPolicyPromise = null
        throw error
      })
    }
    return this.publicAuthPolicyPromise
  }

  async getPublicAuthMethods(): Promise<PublicAuthMethodsResponse> {
    if (this.publicAuthMethods) return this.publicAuthMethods

    if (!this.publicAuthMethodsPromise) {
      this.publicAuthMethodsPromise = this.fetchPublicAuthMethods().catch((error) => {
        this.publicAuthMethodsPromise = null
        throw error
      })
    }
    return this.publicAuthMethodsPromise
  }

  async getAppContinuation(): Promise<AppContinuation> {
    const authMethods = await this.getPublicAuthMethods()
    return {
      loginInitiationUri: authMethods.loginInitiationUri,
      postVerificationRedirectUri: authMethods.postVerificationRedirectUri,
      postLogoutRedirectUri: this.config.postLogoutRedirectUri ?? null,
    }
  }

  private async fetchDiscovery(): Promise<OIDCConfiguration> {
    const url = `${this.config.issuerUri}/.well-known/openid-configuration`
    this.oidcConfig = await requestJson<OIDCConfiguration>(url)
    return this.oidcConfig
  }

  private async fetchPublicAuthPolicy(): Promise<PublicAuthPolicyResponse> {
    const config = await this.discover()
    const data = await requestPublicAuthPolicy({
      issuer: config.issuer,
      clientId: this.config.clientId,
    })
    this.publicAuthPolicy = data
    return data
  }

  private async fetchPublicAuthMethods(): Promise<PublicAuthMethodsResponse> {
    const config = await this.discover()
    const data = await requestPublicAuthMethods({
      issuer: config.issuer,
      clientId: this.config.clientId,
    })
    this.publicAuthMethods = data
    return data
  }
}
