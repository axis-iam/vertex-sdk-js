import { requestJson } from './http-client'
import type { BrowserRequestOptions } from './http-client'
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
  captureOwner: () => () => void
}

export class OAuthAccountOnboardingClient {
  private readonly discover: () => Promise<OIDCConfiguration>
  private readonly getAccessToken: () => string | null
  private readonly captureOwner: () => () => void

  constructor(options: OAuthAccountOnboardingClientOptions) {
    this.discover = options.discover
    this.getAccessToken = options.getAccessToken
    this.captureOwner = options.captureOwner
  }

  async getAccountProfile(): Promise<AccountProfile> {
    return await this.request<AccountProfile>('/api/v1/auth/me/profile')
  }

  async updateAccountProfile(input: AccountUpdateProfileInput): Promise<AccountProfile> {
    return await this.request<AccountProfile>('/api/v1/auth/me/profile', {
      method: 'PATCH',
      json: input,
    })
  }

  async getAccountSecuritySummary(): Promise<AccountSecuritySummary> {
    return await this.request<AccountSecuritySummary>('/api/v1/auth/me/security')
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.request<void>('/api/v1/auth/password/change', {
      method: 'POST',
      json: input,
    })
  }

  async listAccountSessions(): Promise<AccountSession[]> {
    return await this.request<AccountSession[]>('/api/v1/auth/sessions')
  }

  async revokeAccountSession(sessionId: string): Promise<void> {
    await this.request<void>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    })
  }

  async revokeOtherAccountSessions(): Promise<void> {
    await this.request<void>('/api/v1/auth/sessions', {
      method: 'DELETE',
    })
  }

  async listAccountOrganizations(): Promise<AccountOrganization[]> {
    return await this.request<AccountOrganization[]>('/api/v1/auth/me/organizations')
  }

  async getCurrentAccountOrganization(): Promise<AccountOrganization | null> {
    return await this.request<AccountOrganization | null>('/api/v1/auth/me/organizations/current')
  }

  async switchAccountOrganization(organizationId: string): Promise<OrganizationSwitchResponse> {
    return await this.request<OrganizationSwitchResponse>('/api/v1/auth/me/organizations/current', {
      method: 'POST',
      json: { organizationId },
    })
  }

  async hasAccountOrganizationMembership(organizationId: string): Promise<boolean> {
    const organizations = await this.listAccountOrganizations()
    return organizations.some((organization) => organization.organizationId === organizationId)
  }

  async getAccountPermissionSummary(organizationId?: string | null): Promise<AccountPermissionSummary> {
    const params = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
    return await this.request<AccountPermissionSummary>(`/api/v1/auth/me/permissions${params}`)
  }

  async checkAccountPermission(input: AccountPermissionCheckInput): Promise<AccountPermissionCheckResponse> {
    return await this.request<AccountPermissionCheckResponse>('/api/v1/auth/me/permissions:check', {
      method: 'POST',
      json: input,
    })
  }

  private async request<T>(path: string, options: BrowserRequestOptions = {}): Promise<T> {
    const token = this.requireCurrentAccessToken()
    const assertCurrent = this.captureOwner()
    try {
      const config = await this.discover()
      assertCurrent()
      const result = await requestJson<T>(`${config.issuer}${path}`, { ...options, bearerToken: token })
      assertCurrent()
      return result
    } catch (error) {
      assertCurrent()
      throw error
    }
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
