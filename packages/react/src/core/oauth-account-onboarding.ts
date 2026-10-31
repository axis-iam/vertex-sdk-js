import { requestJson } from './http-client'
import { IamApiError } from './types'
import type {
  AccountOrganization,
  AccountPermissionCheckInput,
  AccountPermissionCheckResponse,
  AccountPermissionSummary,
  AccountProfile,
  AccountSecuritySummary,
  AccountSession,
  AccountUpdateProfileInput,
  ChangePasswordInput,
  OIDCConfiguration,
  OrganizationSwitchResponse,
} from './types'

export interface OAuthAccountOnboardingClientOptions {
  discover: () => Promise<OIDCConfiguration>
  getAccessToken: () => string | null
}

export class OAuthAccountOnboardingClient {
  private readonly discover: () => Promise<OIDCConfiguration>
  private readonly getAccessToken: () => string | null

  constructor(options: OAuthAccountOnboardingClientOptions) {
    this.discover = options.discover
    this.getAccessToken = options.getAccessToken
  }

  async getAccountProfile(): Promise<AccountProfile> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountProfile>(`${config.issuer}/api/v1/auth/me/profile`, {
      bearerToken: token,
    })
  }

  async updateAccountProfile(input: AccountUpdateProfileInput): Promise<AccountProfile> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountProfile>(`${config.issuer}/api/v1/auth/me/profile`, {
      method: 'PATCH',
      json: input,
      bearerToken: token,
    })
  }

  async getAccountSecuritySummary(): Promise<AccountSecuritySummary> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountSecuritySummary>(`${config.issuer}/api/v1/auth/me/security`, {
      bearerToken: token,
    })
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    await requestJson<void>(`${config.issuer}/api/v1/auth/password/change`, {
      method: 'POST',
      json: input,
      bearerToken: token,
    })
  }

  async listAccountSessions(): Promise<AccountSession[]> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountSession[]>(`${config.issuer}/api/v1/auth/sessions`, {
      bearerToken: token,
    })
  }

  async revokeAccountSession(sessionId: string): Promise<void> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    await requestJson<void>(`${config.issuer}/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      bearerToken: token,
    })
  }

  async revokeOtherAccountSessions(): Promise<void> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    await requestJson<void>(`${config.issuer}/api/v1/auth/sessions`, {
      method: 'DELETE',
      bearerToken: token,
    })
  }

  async listAccountOrganizations(): Promise<AccountOrganization[]> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountOrganization[]>(`${config.issuer}/api/v1/auth/me/organizations`, {
      bearerToken: token,
    })
  }

  async getCurrentAccountOrganization(): Promise<AccountOrganization | null> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountOrganization | null>(`${config.issuer}/api/v1/auth/me/organizations/current`, {
      bearerToken: token,
    })
  }

  async switchAccountOrganization(organizationId: string): Promise<OrganizationSwitchResponse> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<OrganizationSwitchResponse>(`${config.issuer}/api/v1/auth/me/organizations/current`, {
      method: 'POST',
      json: { organizationId },
      bearerToken: token,
    })
  }

  async hasAccountOrganizationMembership(organizationId: string): Promise<boolean> {
    const organizations = await this.listAccountOrganizations()
    return organizations.some((organization) => organization.organizationId === organizationId)
  }

  async getAccountPermissionSummary(organizationId?: string | null): Promise<AccountPermissionSummary> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    const params = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
    return await requestJson<AccountPermissionSummary>(`${config.issuer}/api/v1/auth/me/permissions${params}`, {
      bearerToken: token,
    })
  }

  async checkAccountPermission(input: AccountPermissionCheckInput): Promise<AccountPermissionCheckResponse> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    return await requestJson<AccountPermissionCheckResponse>(`${config.issuer}/api/v1/auth/me/permissions:check`, {
      method: 'POST',
      json: input,
      bearerToken: token,
    })
  }

  private requireCurrentAccessToken(): string {
    const token = this.getAccessToken()
    if (!token) {
      throw new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
    }
    return token
  }
}
