import type {
  AccountLinkAuthorizeOptions,
  AccountLinkAuthorizeResult,
  AccountLinkCallbackResult,
  AccountLinkTicketExchangeInput,
  AccountLoginMethod,
  AccountOrganization,
  AccountPermissionCheckInput,
  AccountPermissionCheckResponse,
  AccountPermissionSummary,
  AccountProfile,
  AccountSecuritySummary,
  AccountSession,
  AccountUpdateProfileInput,
  AppContinuation,
  ChangePasswordInput,
  EmailVerificationResponse,
  AuthMethodIdpProviderResponse,
  IamConfig,
  IdentityProviderOption,
  LinkableIdentityProvider,
  LogoutOptions,
  LogoutAccountOptions,
  LogoutUrlOptions,
  OIDCConfiguration,
  OrganizationSwitchResponse,
  ProviderAuthorizationOptions,
  PublicOrganizationInvitationAcceptResponse,
  PublicOrganizationInvitationPreview,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  RegistrationGrantInput,
  RegistrationGrantPreviewResponse,
  RedirectCallbackOptions,
  RedirectCallbackResult,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SendEmailVerificationInput,
  VerifyEmailInput,
  TokenSet,
} from './types'
import { IamApiError } from './types'
import { TokenManager } from './token-manager'
import type { RefreshProvenance } from './token-manager'
import {
  cleanCallbackUrl,
  consumeAuthorizationCodeVerifier,
  prepareAuthorizationCodeContext,
  resolveCallbackUrl,
} from './oauth-callback'
import {
  exchangeAuthorizationCode,
  refreshOAuthToken,
} from './oauth-token-client'
import { refreshDirectAuthToken } from './direct-auth-token-client'
import { logoutDirectAuth } from './direct-auth-logout'
import {
  buildLogoutUrl,
  completeLogoutRedirect,
} from './oauth-logout'
import { fetchOAuthPermissionSummary } from './oauth-permissions-client'
import { normalizeOAuthError } from './oauth-errors'
import { startProviderAuthorization } from './oauth-provider-authorization'
import { OAuthAccountLinkingClient } from './oauth-account-linking'
import { OAuthPublicMetadataClient } from './oauth-public-metadata-client'
import { OAuthUserActionsClient } from './oauth-user-actions-client'
import { OAuthAccountOnboardingClient } from './oauth-account-onboarding'
import { RegistrationGrantClient } from './registration-grant-client'

export class OAuthClient {
  readonly clientId: string
  readonly config: IamConfig
  private readonly publicMetadata: OAuthPublicMetadataClient
  private readonly accountLinking: OAuthAccountLinkingClient
  private readonly accountOnboarding: OAuthAccountOnboardingClient
  private readonly userActions: OAuthUserActionsClient
  private readonly registrationGrants: RegistrationGrantClient
  readonly tokenManager: TokenManager

  constructor(config: IamConfig) {
    this.config = config
    this.clientId = config.clientId
    this.publicMetadata = new OAuthPublicMetadataClient(config)
    this.tokenManager = new TokenManager({ storage: config.tokenStorage })
    this.tokenManager.setRefreshHandler(() => this.refreshToken())
    this.tokenManager.setPermissionsRefreshHandler(async () => {
      await this.fetchPermissions()
      return {
        roles: this.tokenManager.getRoles(),
        permissions: this.tokenManager.getPermissions(),
      }
    })
    this.accountLinking = new OAuthAccountLinkingClient({
      discover: () => this.discover(),
      getAccessToken: () => this.tokenManager.isAuthenticated()
        ? this.tokenManager.getAccessToken()
        : null,
      resolveRedirectUri: (redirectUri) => this.resolveRedirectUri(redirectUri),
    })
    this.accountOnboarding = new OAuthAccountOnboardingClient({
      discover: () => this.discover(),
      getAccessToken: () => this.tokenManager.isAuthenticated()
        ? this.tokenManager.getAccessToken()
        : null,
    })
    this.userActions = new OAuthUserActionsClient({
      clientId: config.clientId,
      discover: () => this.discover(),
    })
    this.registrationGrants = new RegistrationGrantClient({
      clientId: config.clientId,
      discover: () => this.discover(),
    })
  }

  // --- OIDC Discovery ---

  async discover(): Promise<OIDCConfiguration> {
    return await this.publicMetadata.discover()
  }

  // --- Authorization Code + PKCE ---

  async startAuthorizationFlow(): Promise<string> {
    const config = await this.discover()
    const { codeChallenge, state } = await prepareAuthorizationCodeContext()
    const scopes = this.config.scopes ?? ['openid', 'profile', 'email', 'offline_access']

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.resolveRedirectUri(),
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    if (this.config.audience) {
      params.set('audience', this.config.audience)
    }

    return `${config.authorization_endpoint}?${params.toString()}`
  }

  async listIdentityProviders(): Promise<IdentityProviderOption[]> {
    return await this.publicMetadata.listIdentityProviders()
  }

  async getPublicAuthPolicy(): Promise<PublicAuthPolicyResponse> {
    return await this.publicMetadata.getPublicAuthPolicy()
  }

  async previewRegistrationGrant(input: RegistrationGrantInput): Promise<RegistrationGrantPreviewResponse> {
    return await this.registrationGrants.preview(input)
  }

  async getPublicAuthMethods(): Promise<PublicAuthMethodsResponse> {
    return await this.publicMetadata.getPublicAuthMethods()
  }

  async getAppContinuation(): Promise<AppContinuation> {
    return await this.publicMetadata.getAppContinuation()
  }

  async startProviderAuthorizationFlow(
    providerIdOrOption: string | IdentityProviderOption | AuthMethodIdpProviderResponse,
    options: ProviderAuthorizationOptions = {},
  ): Promise<string> {
    const provider = typeof providerIdOrOption === 'string'
      ? await this.findIdentityProvider(providerIdOrOption)
      : providerIdOrOption

    return await startProviderAuthorization({
      provider,
      config: this.config,
      options,
      resolveRedirectUri: (redirectUri) => this.resolveRedirectUri(redirectUri),
    })
  }

  // --- Current-user account linking ---

  async listAccountLoginMethods(): Promise<AccountLoginMethod[]> {
    return await this.accountLinking.listAccountLoginMethods()
  }

  async listLinkableIdentityProviders(): Promise<LinkableIdentityProvider[]> {
    return await this.accountLinking.listLinkableIdentityProviders()
  }

  async startAccountLink(
    idpId: string,
    options: AccountLinkAuthorizeOptions = {},
  ): Promise<AccountLinkAuthorizeResult> {
    return await this.accountLinking.startAccountLink(idpId, options)
  }

  async exchangeAccountLinkTicket(input: AccountLinkTicketExchangeInput): Promise<AccountLinkCallbackResult> {
    return await this.accountLinking.exchangeAccountLinkTicket(input)
  }

  async unlinkAccountLoginMethod(methodId: string): Promise<void> {
    await this.accountLinking.unlinkAccountLoginMethod(methodId)
  }

  // --- Account center and Organization onboarding ---

  async getAccountProfile(): Promise<AccountProfile> {
    return await this.accountOnboarding.getAccountProfile()
  }

  async updateAccountProfile(input: AccountUpdateProfileInput): Promise<AccountProfile> {
    return await this.accountOnboarding.updateAccountProfile(input)
  }

  async getAccountSecuritySummary(): Promise<AccountSecuritySummary> {
    return await this.accountOnboarding.getAccountSecuritySummary()
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    await this.accountOnboarding.changePassword(input)
  }

  async listAccountSessions(): Promise<AccountSession[]> {
    return await this.accountOnboarding.listAccountSessions()
  }

  async revokeAccountSession(sessionId: string): Promise<void> {
    await this.accountOnboarding.revokeAccountSession(sessionId)
  }

  async revokeOtherAccountSessions(): Promise<void> {
    await this.accountOnboarding.revokeOtherAccountSessions()
  }

  async logoutAccount(options: LogoutAccountOptions = {}): Promise<void> {
    await this.accountOnboarding.logoutAccount({
      refreshToken: options.refreshToken ?? this.tokenManager.getRefreshToken(),
    })
  }

  async listAccountOrganizations(): Promise<AccountOrganization[]> {
    return await this.accountOnboarding.listAccountOrganizations()
  }

  async getCurrentAccountOrganization(): Promise<AccountOrganization | null> {
    return await this.accountOnboarding.getCurrentAccountOrganization()
  }

  async switchAccountOrganization(organizationId: string): Promise<OrganizationSwitchResponse> {
    return await this.accountOnboarding.switchAccountOrganization(organizationId)
  }

  async hasAccountOrganizationMembership(organizationId: string): Promise<boolean> {
    return await this.accountOnboarding.hasAccountOrganizationMembership(organizationId)
  }

  async getAccountPermissionSummary(organizationId?: string | null): Promise<AccountPermissionSummary> {
    return await this.accountOnboarding.getAccountPermissionSummary(organizationId)
  }

  async checkAccountPermission(input: AccountPermissionCheckInput): Promise<AccountPermissionCheckResponse> {
    return await this.accountOnboarding.checkAccountPermission(input)
  }

  async previewOrganizationInvitation(token: string): Promise<PublicOrganizationInvitationPreview> {
    return await this.accountOnboarding.previewOrganizationInvitation(token)
  }

  async acceptOrganizationInvitation(token: string): Promise<PublicOrganizationInvitationAcceptResponse> {
    return await this.accountOnboarding.acceptOrganizationInvitation(token)
  }

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const codeVerifier = consumeAuthorizationCodeVerifier(state)

    const config = await this.discover()

    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: config.token_endpoint,
      clientId: this.config.clientId,
      code,
      redirectUri: this.resolveRedirectUri(),
      codeVerifier,
    })
    this.tokenManager.store(
      tokens,
      'OAUTH_AUTHORIZATION_CODE',
      tokens.refresh_token ? 'OAUTH_TOKEN_ENDPOINT' : null,
    )

    // Fetch permissions after obtaining tokens
    await this.fetchPermissions()

    return tokens
  }

  async handleRedirectCallback(options: RedirectCallbackOptions = {}): Promise<RedirectCallbackResult> {
    const callbackUrl = resolveCallbackUrl(options.url, this.resolveUrlBase())
    if (!callbackUrl) {
      return { status: 'idle' }
    }

    const params = callbackUrl.searchParams
    const code = params.get('code')
    const state = params.get('state')
    const callbackError = params.get('error')
    const errorDescription = params.get('error_description')
    const hasCallbackParams = Boolean(code || state || callbackError || errorDescription)

    if (!hasCallbackParams) {
      return { status: 'idle' }
    }

    try {
      if (callbackError) {
        return {
          status: 'error',
          error: new Error(errorDescription || callbackError),
        }
      }

      if (!code || !state) {
        return {
          status: 'error',
          error: new Error('OAuth callback is missing code or state'),
        }
      }

      const tokens = await this.handleCallback(code, state)
      return { status: 'success', tokens }
    } catch (error) {
      return { status: 'error', error: normalizeOAuthError(error) }
    } finally {
      cleanCallbackUrl(callbackUrl, options.cleanUrl)
    }
  }

  // --- Permissions ---

  /**
   * Fetch user permissions from the server.
   * Called after OAuth callback and token refresh.
   * Endpoint: GET /api/v1/auth/me/permissions (current-user permissions)
   */
  async fetchPermissions(): Promise<string[]> {
    const token = this.tokenManager.getAccessToken()
    if (!token) return []

    try {
      const authorization = await this.fetchAuthorizationState()
      this.tokenManager.setAuthorization(authorization.roles, authorization.permissions)
      this.tokenManager.setLastPermissionError(null)
      return [...authorization.permissions]
    } catch (err) {
      const normalized = normalizeOAuthError(err)
      if (normalized instanceof IamApiError && normalized.status === 401) {
        this.tokenManager.clear()
        throw normalized
      }
      this.tokenManager.setAuthorization([], [])
      this.tokenManager.setLastPermissionError(normalized)
      throw normalized
    }
  }

  private async fetchAuthorizationState(): Promise<{ roles: string[]; permissions: string[] }> {
    const token = this.tokenManager.getAccessToken()
    if (!token) return { roles: [], permissions: [] }
    const config = await this.discover()
    const summary = await fetchOAuthPermissionSummary({
      issuer: config.issuer,
      accessToken: token,
    })
    return { roles: summary.roles, permissions: summary.permissions }
  }

  // --- Password Reset ---

  async sendEmailVerification(input: SendEmailVerificationInput): Promise<EmailVerificationResponse> {
    return await this.userActions.sendEmailVerification(input)
  }

  async verifyEmail(input: VerifyEmailInput): Promise<EmailVerificationResponse> {
    return await this.userActions.verifyEmail(input)
  }

  async requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
    await this.userActions.requestPasswordReset(input)
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    await this.userActions.resetPassword(input)
  }

  /**
   * Set permissions directly (e.g., from embedded login response).
   */
  setPermissions(permissions: string[]): void {
    this.tokenManager.setPermissions(permissions)
  }

  // --- Token Refresh ---

  async refreshToken(): Promise<TokenSet> {
    const refreshToken = this.tokenManager.getRefreshToken()
    if (!refreshToken) {
      throw new Error('No refresh token available')
    }

    const provenance = this.requireRefreshProvenance()
    if (provenance === 'DIRECT_AUTH') {
      return await refreshDirectAuthToken({
        issuer: this.config.issuerUri,
        clientId: this.config.clientId,
        refreshToken,
      })
    }

    const config = await this.discover()
    return await refreshOAuthToken({ tokenEndpoint: config.token_endpoint, clientId: this.config.clientId, refreshToken })
  }

  private requireRefreshProvenance(): RefreshProvenance {
    const provenance = this.tokenManager.getRefreshProvenance()
    if (!provenance) throw new Error('Refresh token provenance is missing')
    return provenance
  }

  // --- Logout ---

  async getLogoutUrl(options: LogoutUrlOptions = {}): Promise<string | null> {
    if (this.tokenManager.getAuthenticationProvenance() !== 'OAUTH_AUTHORIZATION_CODE') return null

    const idToken = this.tokenManager.getIdToken()
    if (!idToken) return null

    const config = await this.discover()
    const postLogoutUri = options.postLogoutRedirectUri ?? this.config.postLogoutRedirectUri ?? null

    return buildLogoutUrl({
      endSessionEndpoint: config.end_session_endpoint,
      idToken,
      postLogoutRedirectUri: postLogoutUri,
    })
  }

  async logout(options: LogoutOptions = {}): Promise<void> {
    const redirect = options.redirect === true
    const postLogoutRedirectUri = options.postLogoutRedirectUri ?? this.config.postLogoutRedirectUri ?? null
    const accessToken = this.tokenManager.getAccessToken()
    const refreshToken = this.tokenManager.getRefreshToken()
    const idToken = this.tokenManager.getIdToken()
    const authenticationProvenance = this.tokenManager.getAuthenticationProvenance()

    if (!accessToken || !authenticationProvenance) {
      this.tokenManager.clear()
      throw new Error('Logout requires an authenticated session with explicit authentication provenance')
    }

    if (authenticationProvenance === 'DIRECT_AUTH') {
      try {
        await logoutDirectAuth({
          issuer: this.config.issuerUri,
          accessToken,
          refreshToken,
        })
      } finally {
        this.tokenManager.clear()
      }
      completeLogoutRedirect({
        options,
        logoutUrl: null,
        postLogoutRedirectUri,
      })
      return
    }

    let logoutUrl: string | null = null

    if (redirect && idToken) {
      try {
        const config = await this.discover()
        logoutUrl = buildLogoutUrl({
          endSessionEndpoint: config.end_session_endpoint,
          idToken,
          postLogoutRedirectUri,
        })
      } catch {
        logoutUrl = null
      }
    }

    this.tokenManager.clear()
    completeLogoutRedirect({
      options,
      logoutUrl,
      postLogoutRedirectUri,
    })
  }

  // --- Auth Helpers ---

  isAuthenticated(): boolean {
    return this.tokenManager.isAuthenticated()
  }

  getAccessToken(): string | null {
    return this.tokenManager.getAccessToken()
  }

  // --- Internal ---

  private async findIdentityProvider(providerId: string): Promise<IdentityProviderOption> {
    const providers = await this.listIdentityProviders()
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) {
      throw new Error('Identity provider is not available for this application client')
    }
    return provider
  }

  private resolveRedirectUri(redirectUri?: string): string {
    const uri = redirectUri ?? this.config.redirectUri
    // Absolute URL → use as-is; relative → resolve against current origin
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return uri
    }
    if (typeof window !== 'undefined') {
      return new URL(uri, window.location.origin).toString()
    }
    return uri
  }

  private resolveUrlBase(): string {
    if (typeof window !== 'undefined') {
      return window.location.href
    }
    const redirectUri = this.resolveRedirectUri()
    return redirectUri.startsWith('http://') || redirectUri.startsWith('https://')
      ? redirectUri
      : 'http://localhost/'
  }
}
