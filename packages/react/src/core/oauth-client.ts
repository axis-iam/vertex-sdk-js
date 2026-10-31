import { validateIamConfig } from './iam-config'
import { AccountSecurityOperations } from './account-security-operations'
import type { AuthenticationFlow } from '@axis-iam/vertex'
import { registrationGrantBody } from './auth-flow-client'
import { IdentityClient } from './identity-client'
import type {
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
  LogoutUrlOptions,
  OIDCConfiguration,
  OrganizationSwitchResponse,
  ProviderAuthorizationOptions,
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
import { IamApiError, IamConfigurationError } from './types'
import {
  AuthenticationTransaction,
  IdTokenVerifier,
  IdTokenValidationError,
  PendingAuthorizationStore,
  authorizationCallback,
  parseCurrentUser,
  InvitationJourneyClient,
} from '@axis-iam/vertex'
import { requestJson } from './http-client'
import type { AuthorizationState } from './token-manager'
import { TokenManager } from './token-manager'
import {
  cleanCallbackUrl,
  consumeAuthorizationCodeContext,
  prepareAuthorizationCodeContext,
  resolveCallbackUrl,
} from './oauth-callback'
import {
  exchangeAuthorizationCode,
  refreshOAuthToken,
} from './oauth-token-client'
import { buildLogoutUrl, completeLogoutRedirect } from './oauth-logout'
import { fetchOAuthPermissionSummary } from './oauth-permissions-client'
import { normalizeOAuthError } from './oauth-errors'
import { isEmbeddedSignInProvider } from './oauth-provider-authorization'
import { OAuthAccountLinkingClient } from './oauth-account-linking'
import { OAuthPublicMetadataClient } from './oauth-public-metadata-client'
import { OAuthUserActionsClient } from './oauth-user-actions-client'
import { OAuthAccountOnboardingClient } from './oauth-account-onboarding'
import { RegistrationGrantClient } from './registration-grant-client'

export class OAuthClient {
  readonly mode = 'oauth_tokens' as const
  get state() {
    return this.tokenManager
  }
  async initialize() {
    this.tokenManager.resume()
    await this.discover()
    if (this.tokenManager.hasUsableToken()) await this.fetchPermissions()
  }
  readonly clientId: string
  readonly config: IamConfig
  private readonly publicMetadata: OAuthPublicMetadataClient
  private readonly accountLinking: OAuthAccountLinkingClient
  private readonly accountOnboarding: OAuthAccountOnboardingClient
  private readonly userActions: OAuthUserActionsClient
  private readonly registrationGrants: RegistrationGrantClient
  getRecoveryCodesRemaining = () => this.accountSecurity.getRecoveryCodesRemaining()
  readonly accountSecurity: AccountSecurityOperations
  getMfaCapabilities = (...args: Parameters<AccountSecurityOperations['getMfaCapabilities']>) => this.accountSecurity.getMfaCapabilities(...args)
  createMfaOperation = (...args: Parameters<AccountSecurityOperations['createMfaOperation']>) => this.accountSecurity.createMfaOperation(...args)
  getMfaOperation = (...args: Parameters<AccountSecurityOperations['getMfaOperation']>) => this.accountSecurity.getMfaOperation(...args)
  reauthenticateMfaOperation = (...args: Parameters<AccountSecurityOperations['reauthenticateMfaOperation']>) => this.accountSecurity.reauthenticateMfaOperation(...args)
  challengeMfaOperation = (...args: Parameters<AccountSecurityOperations['challengeMfaOperation']>) => this.accountSecurity.challengeMfaOperation(...args)
  authorizeMfaOperation = (...args: Parameters<AccountSecurityOperations['authorizeMfaOperation']>) => this.accountSecurity.authorizeMfaOperation(...args)
  completeMfaProviderAuthorization = (...args: Parameters<AccountSecurityOperations['completeMfaProviderAuthorization']>) => this.accountSecurity.completeMfaProviderAuthorization(...args)
  startMfaOperationStepUp = (...args: Parameters<AccountSecurityOperations['startMfaOperationStepUp']>) => this.accountSecurity.startMfaOperationStepUp(...args)
  verifyMfaOperationStepUp = (...args: Parameters<AccountSecurityOperations['verifyMfaOperationStepUp']>) => this.accountSecurity.verifyMfaOperationStepUp(...args)
  startMfaOperationWebAuthn = (...args: Parameters<AccountSecurityOperations['startMfaOperationWebAuthn']>) => this.accountSecurity.startMfaOperationWebAuthn(...args)
  verifyMfaOperationWebAuthn = (...args: Parameters<AccountSecurityOperations['verifyMfaOperationWebAuthn']>) => this.accountSecurity.verifyMfaOperationWebAuthn(...args)
  beginTotpEnrollmentOperation = (...args: Parameters<AccountSecurityOperations['beginTotpEnrollmentOperation']>) => this.accountSecurity.beginTotpEnrollmentOperation(...args)
  completeMfaOperation = (...args: Parameters<AccountSecurityOperations['completeMfaOperation']>) => this.accountSecurity.completeMfaOperation(...args)
  cancelMfaOperation = (...args: Parameters<AccountSecurityOperations['cancelMfaOperation']>) => this.accountSecurity.cancelMfaOperation(...args)
  readonly identity: IdentityClient
  readonly tokenManager: TokenManager
  private invitationClient?: InvitationJourneyClient
  private invitationUnsubscribe?: () => void
  get invitations(): InvitationJourneyClient {
    if (this.invitationClient) return this.invitationClient
    const owner = () => {
      const u = this.tokenManager.getUser()
      return u ? JSON.stringify([u.authenticationContext.applicationId, u.authenticationContext.clientId, u.id]) : null
    }
    let previous = owner()
    this.invitationUnsubscribe = this.tokenManager.subscribe(() => {
      const current = owner()
      if (previous !== null && previous !== current) this.invitationClient?.clear()
      previous = current
    })
    return this.invitationClient = new InvitationJourneyClient({
      issuer: this.config.issuerUri, clientId: this.clientId,
      getAccessToken: () => this.tokenManager.hasUsableToken() ? this.tokenManager.getAccessToken() : null,
    })
  }
  private authentication: AuthenticationTransaction | null = null
  private authenticationRevision = 0

  constructor(config: IamConfig, options: { startPaused?: boolean } = {}) {
    validateIamConfig(config)
    if (config.sessionMode === 'server_session' || config.sessionTransport)
      throw new IamConfigurationError(
        'Use ServerSessionClient for server_session',
      )
    this.config = config
    this.clientId = config.clientId
    this.publicMetadata = new OAuthPublicMetadataClient(config)
    this.tokenManager = new TokenManager({
      storage: config.tokenStorage,
      startPaused: options.startPaused,
    })
    this.identity = new IdentityClient(this)
    this.accountSecurity = new AccountSecurityOperations(this)
    this.tokenManager.setRefreshHandler(() => this.requestTokenRefresh())
    this.tokenManager.setPermissionsRefreshHandler(() =>
      this.fetchAuthorizationState(),
    )
    this.accountLinking = new OAuthAccountLinkingClient({
      discover: () => this.discover(),
      getAccessToken: () =>
        this.tokenManager.hasUsableToken()
          ? this.tokenManager.getAccessToken()
          : null,
      resolveRedirectUri: (redirectUri) => this.resolveRedirectUri(redirectUri),
    })
    this.accountOnboarding = new OAuthAccountOnboardingClient({
      discover: () => this.discover(),
      getAccessToken: () =>
        this.tokenManager.hasUsableToken()
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

  /** Public primary authentication; Custom, Embedded and Dialog share this protocol. */
  async beginAuthentication(): Promise<AuthenticationTransaction> {
    const revision = ++this.authenticationRevision
    this.authentication?.invalidate()
    this.authentication = null
    const config = await this.authenticationConfig()
    const assertOwner = () => {
      config.assertOwner()
      if (revision !== this.authenticationRevision)
        throw new IamConfigurationError('Authentication owner changed')
    }
    assertOwner()
    const transaction = await AuthenticationTransaction.start({
      ...config,
      assertOwner,
    })
    assertOwner()
    this.authentication = transaction
    return transaction
  }

  async resumeMagicLink(url: string): Promise<AuthenticationTransaction> {
    if (this.tokenManager.getAccessToken()) {
      AuthenticationTransaction.discardNavigation({
        issuer: this.config.issuerUri,
        clientId: this.clientId,
      })
      throw new IamConfigurationError(
        'A signed-in account cannot resume pending authentication',
      )
    }
    if (this.authentication) return this.authentication
    const revision = ++this.authenticationRevision
    const config = await this.authenticationConfig()
    const assertOwner = () => {
      config.assertOwner()
      if (revision !== this.authenticationRevision)
        throw new IamConfigurationError('Authentication owner changed')
    }
    const transaction = AuthenticationTransaction.restoreMagicLink(
      { ...config, assertOwner },
      url,
    )
    this.authentication = transaction
    return transaction
  }

  async completeAuthentication(
    transaction: AuthenticationFlow,
    onCommitted?: () => void,
  ): Promise<TokenSet> {
    if (
      !(transaction instanceof AuthenticationTransaction) ||
      transaction !== this.authentication
    )
      throw new IamConfigurationError('Authentication owner changed')
    const generation = this.tokenManager.generation
    const tokens = await transaction.exchange()
    this.tokenManager.assertCurrent(generation)
    this.authentication = null
    this.tokenManager.store(
      tokens,
      'OAUTH_AUTHORIZATION_CODE',
      tokens.refresh_token ? 'OAUTH_TOKEN_ENDPOINT' : null,
    )
    onCommitted?.()
    await this.fetchPermissions()
    return tokens
  }

  private async authenticationConfig() {
    const generation = this.tokenManager.generation
    const discovery = await this.discover()
    this.tokenManager.assertCurrent(generation)
    return {
      issuer: discovery.issuer,
      tokenEndpoint: discovery.token_endpoint,
      clientId: this.clientId,
      redirectUri: this.resolveRedirectUri(),
      scopes: this.config.scopes ?? [
        'openid',
        'profile',
        'email',
        'offline_access',
      ],
      assertOwner: () => this.tokenManager.assertCurrent(generation),
    }
  }

  // --- Authorization Code + PKCE ---

  async startAuthorizationFlow(
    options: { locale?: string } = {},
  ): Promise<string> {
    const generation = this.tokenManager.generation
    const revision = ++this.authenticationRevision
    const assertCurrent = () => {
      this.tokenManager.assertCurrent(generation)
      if (revision !== this.authenticationRevision)
        throw new IamConfigurationError('Authentication owner changed')
    }
    const config = await this.discover()
    assertCurrent()
    if (config.issuer !== this.config.issuerUri)
      throw new IdTokenValidationError()
    const scopes = this.config.scopes ?? [
      'openid',
      'profile',
      'email',
      'offline_access',
    ]
    const { codeChallenge, state, nonce } =
      await prepareAuthorizationCodeContext(
        {
          issuer: config.issuer,
          clientId: this.clientId,
          redirectUri: this.resolveRedirectUri(),
        },
        assertCurrent,
        scopes.includes('openid'),
      )

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.resolveRedirectUri(),
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    if (nonce) params.set('nonce', nonce)

    if (this.config.audience) {
      params.set('audience', this.config.audience)
    }
    if (options.locale) params.set('ui_locales', options.locale)

    return `${config.authorization_endpoint}?${params.toString()}`
  }

  async listIdentityProviders(): Promise<IdentityProviderOption[]> {
    return await this.publicMetadata.listIdentityProviders()
  }

  async getPublicAuthPolicy(): Promise<PublicAuthPolicyResponse> {
    return await this.publicMetadata.getPublicAuthPolicy()
  }

  async previewRegistrationGrant(
    input: RegistrationGrantInput,
  ): Promise<RegistrationGrantPreviewResponse> {
    return await this.registrationGrants.preview(input)
  }

  async getPublicAuthMethods(): Promise<PublicAuthMethodsResponse> {
    return await this.publicMetadata.getPublicAuthMethods()
  }

  async getAppContinuation(): Promise<AppContinuation> {
    return await this.publicMetadata.getAppContinuation()
  }

  async startProviderAuthorizationFlow(
    providerIdOrOption:
      | string
      | IdentityProviderOption
      | AuthMethodIdpProviderResponse,
    options: ProviderAuthorizationOptions = {},
  ): Promise<string> {
    const generation = this.tokenManager.generation
    const assertCurrent = () => this.tokenManager.assertCurrent(generation)
    const provider =
      typeof providerIdOrOption === 'string'
        ? await this.findIdentityProvider(providerIdOrOption)
        : providerIdOrOption
    assertCurrent()

    if (!isEmbeddedSignInProvider(provider))
      throw new IamConfigurationError('Provider is unavailable')
    if (options.audience || options.redirectUri || options.scopes)
      throw new IamConfigurationError(
        'Transaction provider options must use the client configuration',
      )
    const transaction = await this.beginAuthentication()
    assertCurrent()
    const result = await transaction.authorizeProvider(
      provider.id,
      registrationGrantBody(options.registrationGrant),
    )
    assertCurrent()
    return result.authorizationUrl
  }

  async resumeProviderCallback(
    url: string,
    onCommitted?: () => void,
    assertAttempt?: () => void,
  ) {
    if (this.tokenManager.getAccessToken()) {
      AuthenticationTransaction.discardNavigation({
        issuer: this.config.issuerUri,
        clientId: this.clientId,
      })
      throw new IamConfigurationError(
        'A signed-in account cannot resume pending authentication',
      )
    }
    const revision = ++this.authenticationRevision
    const config = await this.authenticationConfig()
    const assertOwner = () => {
      assertAttempt?.()
      config.assertOwner()
      if (revision !== this.authenticationRevision)
        throw new IamConfigurationError('Authentication owner changed')
    }
    const transaction = AuthenticationTransaction.restoreProvider(
      { ...config, assertOwner },
      url,
    )
    this.authentication?.invalidate(true)
    this.authentication = transaction
    const result = await transaction.completeProviderCallback(url)
    if ('state' in result)
      return { kind: 'continuation' as const, transaction, view: result }
    this.authentication = null
    this.tokenManager.store(
      result,
      'OAUTH_AUTHORIZATION_CODE',
      result.refresh_token ? 'OAUTH_TOKEN_ENDPOINT' : null,
    )
    onCommitted?.()
    await this.fetchPermissions()
    return { kind: 'tokens' as const, tokens: result }
  }

  // --- Current-user account linking ---

  async listAccountLoginMethods(): Promise<
    import('@axis-iam/vertex').AccountLoginMethods
  > {
    return await this.identity.loginMethods()
  }

  async listLinkableIdentityProviders(): Promise<LinkableIdentityProvider[]> {
    const generation = this.tokenManager.generation
    const providers = await this.accountLinking.listLinkableIdentityProviders()
    this.tokenManager.assertCurrent(generation)
    return providers
  }

  // --- Account center and Organization onboarding ---

  async getAccountProfile(): Promise<AccountProfile> {
    return await this.accountOnboarding.getAccountProfile()
  }

  async updateAccountProfile(
    input: AccountUpdateProfileInput,
  ): Promise<AccountProfile> {
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

  async logoutAccount(): Promise<void> {
    await this.logout({ redirect: false })
  }

  async listAccountOrganizations(): Promise<AccountOrganization[]> {
    return await this.accountOnboarding.listAccountOrganizations()
  }

  async getCurrentAccountOrganization(): Promise<AccountOrganization | null> {
    return await this.accountOnboarding.getCurrentAccountOrganization()
  }

  async switchAccountOrganization(
    organizationId: string,
  ): Promise<OrganizationSwitchResponse> {
    return await this.accountOnboarding.switchAccountOrganization(
      organizationId,
    )
  }

  async hasAccountOrganizationMembership(
    organizationId: string,
  ): Promise<boolean> {
    return await this.accountOnboarding.hasAccountOrganizationMembership(
      organizationId,
    )
  }

  async getAccountPermissionSummary(
    organizationId?: string | null,
  ): Promise<AccountPermissionSummary> {
    return await this.accountOnboarding.getAccountPermissionSummary(
      organizationId,
    )
  }

  async checkAccountPermission(
    input: AccountPermissionCheckInput,
  ): Promise<AccountPermissionCheckResponse> {
    return await this.accountOnboarding.checkAccountPermission(input)
  }

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    if (this.tokenManager.getAccessToken()) {
      PendingAuthorizationStore.discard({
        issuer: this.config.issuerUri,
        clientId: this.clientId,
      })
      throw new IamConfigurationError(
        'A signed-in account cannot consume pending login',
      )
    }
    const generation = this.tokenManager.generation
    const config = await this.discover()
    this.tokenManager.assertCurrent(generation)
    const revision = ++this.authenticationRevision
    const pending = consumeAuthorizationCodeContext(state, {
      issuer: config.issuer,
      clientId: this.clientId,
      redirectUri: this.resolveRedirectUri(),
    })
    const openid = (this.config.scopes ?? ['openid']).includes('openid')
    if ((openid && !pending.nonce) || (!openid && pending.nonce))
      throw new IdTokenValidationError()

    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint: config.token_endpoint,
      clientId: this.config.clientId,
      code,
      redirectUri: this.resolveRedirectUri(),
      codeVerifier: pending.verifier,
    })
    if (openid) {
      if (config.issuer !== this.config.issuerUri)
        throw new IdTokenValidationError()
      await new IdTokenVerifier({
        issuer: config.issuer,
        clientId: this.clientId,
        jwksUri: config.jwks_uri,
      }).verify(tokens.id_token, pending.nonce!)
    }
    this.tokenManager.assertCurrent(generation)
    if (revision !== this.authenticationRevision)
      throw new IamConfigurationError('Authentication owner changed')
    if (Date.parse(pending.expiresAt) <= Date.now())
      throw new IdTokenValidationError()
    PendingAuthorizationStore.assertNoReplacement()
    this.tokenManager.store(
      tokens,
      'OAUTH_AUTHORIZATION_CODE',
      tokens.refresh_token ? 'OAUTH_TOKEN_ENDPOINT' : null,
    )

    // Fetch permissions after obtaining tokens
    await this.fetchPermissions()

    return tokens
  }

  async handleRedirectCallback(
    options: RedirectCallbackOptions = {},
  ): Promise<RedirectCallbackResult> {
    const callbackUrl = resolveCallbackUrl(options.url, this.resolveUrlBase())
    if (!callbackUrl) {
      return { status: 'idle' }
    }

    const params = callbackUrl.searchParams
    const code = params.get('code')
    const state = params.get('state')
    const callbackError = params.get('error')
    const errorDescription = params.get('error_description')
    const hasCallbackParams = Boolean(
      code || state || callbackError || errorDescription || params.has('kind'),
    )

    if (!hasCallbackParams) {
      return { status: 'idle' }
    }

    try {
      const generation = this.tokenManager.generation
      const discovery = await this.discover()
      this.tokenManager.assertCurrent(generation)
      const pending = PendingAuthorizationStore.read({
        issuer: discovery.issuer,
        clientId: this.clientId,
        redirectUri: this.resolveRedirectUri(),
      })
      if (pending.entryMode === 'CUSTOM') {
        const result = await this.resumeProviderCallback(callbackUrl.href)
        if (result.kind === 'continuation')
          return {
            status: 'continuation',
            transaction: result.transaction,
            view: result.view,
          }
        return { status: 'success', tokens: result.tokens }
      }
      authorizationCallback(
        callbackUrl.href,
        this.resolveRedirectUri(),
        callbackError
          ? errorDescription
            ? ['error', 'error_description', 'state']
            : ['error', 'state']
          : ['code', 'state'],
      )
      if (callbackError) {
        consumeAuthorizationCodeContext(state ?? '', {
          issuer: discovery.issuer,
          clientId: this.clientId,
          redirectUri: this.resolveRedirectUri(),
        })
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
    const generation = this.tokenManager.generation
    const token = this.tokenManager.getAccessToken()
    if (!token)
      throw new IamApiError('Session unavailable', {
        status: 401,
        code: 'UNAUTHORIZED',
      })

    this.tokenManager.beginViewLoad()
    try {
      const authorization = await this.fetchAuthorizationState()
      this.tokenManager.assertCurrent(generation, token)
      this.tokenManager.applyViews(authorization)
      this.tokenManager.setLastPermissionError(null)
      return [...authorization.permissions]
    } catch (err) {
      this.tokenManager.assertCurrent(generation, token)
      const normalized = normalizeOAuthError(err)
      if (normalized instanceof IamApiError && normalized.status === 401) {
        this.tokenManager.clear()
        throw normalized
      }
      this.tokenManager.failViewLoad(normalized)
      throw normalized
    }
  }

  private async fetchAuthorizationState(): Promise<AuthorizationState> {
    const token = this.tokenManager.getAccessToken()
    const generation = this.tokenManager.generation
    if (!token || !this.tokenManager.hasUsableToken())
      throw new IamApiError('Session unavailable', {
        status: 401,
        code: 'UNAUTHORIZED',
      })
    const config = await this.discover()
    this.tokenManager.assertCurrent(generation, token)
    const [raw, summary] = await Promise.all([
      requestJson<unknown>(
        new URL('/api/v1/auth/me', config.issuer).toString(),
        { bearerToken: token },
      ),
      fetchOAuthPermissionSummary({
        issuer: config.issuer,
        accessToken: token,
      }),
    ])
    this.tokenManager.assertCurrent(generation, token)
    if (!this.tokenManager.hasUsableToken())
      throw new IamApiError('Session expired', {
        status: 401,
        code: 'UNAUTHORIZED',
      })
    const user = parseCurrentUser(raw)
    const c = user.authenticationContext
    if (
      c.clientId !== this.clientId ||
      c.applicationId !== summary.applicationId ||
      c.organizationId !== summary.organizationId
    )
      throw new IamConfigurationError(
        'Current-user and permissions context mismatch',
      )
    return { user, roles: summary.roles, permissions: summary.permissions }
  }

  // --- Password Reset ---

  async sendEmailVerification(
    input: SendEmailVerificationInput,
  ): Promise<EmailVerificationResponse> {
    return await this.userActions.sendEmailVerification(input)
  }

  async verifyEmail(
    input: VerifyEmailInput,
  ): Promise<EmailVerificationResponse> {
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

  refreshToken(): Promise<TokenSet> {
    return this.tokenManager.refresh()
  }

  private async requestTokenRefresh(): Promise<TokenSet> {
    const refreshToken = this.tokenManager.getRefreshToken()
    if (!refreshToken) {
      throw new Error('No refresh token available')
    }

    const config = await this.discover()
    return await refreshOAuthToken({
      tokenEndpoint: config.token_endpoint,
      clientId: this.config.clientId,
      refreshToken,
    })
  }

  // --- Logout ---

  async getLogoutUrl(options: LogoutUrlOptions = {}): Promise<string | null> {
    if (
      this.tokenManager.getAuthenticationProvenance() !==
      'OAUTH_AUTHORIZATION_CODE'
    )
      return null

    const idToken = this.tokenManager.getIdToken()
    if (!idToken) return null

    const config = await this.discover()
    const postLogoutUri =
      options.postLogoutRedirectUri ?? this.config.postLogoutRedirectUri ?? null

    return buildLogoutUrl({
      endSessionEndpoint: config.end_session_endpoint,
      idToken,
      postLogoutRedirectUri: postLogoutUri,
    })
  }

  async logout(options: LogoutOptions = {}): Promise<void> {
    this.invitationClient?.clear()
    ++this.authenticationRevision
    this.authentication?.invalidate()
    this.authentication = null
    AuthenticationTransaction.discardNavigation({
      issuer: this.config.issuerUri,
      clientId: this.clientId,
    })
    const redirect = options.redirect === true
    const postLogoutRedirectUri =
      options.postLogoutRedirectUri ?? this.config.postLogoutRedirectUri ?? null
    const accessToken = this.tokenManager.getAccessToken()
    const idToken = this.tokenManager.getIdToken()
    const authenticationProvenance =
      this.tokenManager.getAuthenticationProvenance()

    if (!accessToken || !authenticationProvenance) {
      this.tokenManager.clear()
      throw new Error(
        'Logout requires an authenticated session with explicit authentication provenance',
      )
    }

    // Invalidate pending work before awaiting revocation/discovery. A new login owns new state.
    this.tokenManager.clear()
    const generation = this.tokenManager.generation

    await requestJson<void>(
      new URL('/api/v1/auth/logout', this.config.issuerUri).href,
      { method: 'POST', bearerToken: accessToken },
    )
    this.tokenManager.assertCurrent(generation)
    let logoutUrl: string | null = null

    if (redirect && idToken) {
      const config = await this.discover()
      this.tokenManager.assertCurrent(generation)
      logoutUrl = buildLogoutUrl({
        endSessionEndpoint: config.end_session_endpoint,
        idToken,
        postLogoutRedirectUri,
      })
    }

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

  dispose(): void {
    this.invitationClient?.clear()
    this.invitationUnsubscribe?.()
    this.invitationUnsubscribe = undefined
    this.invitationClient = undefined
    ++this.authenticationRevision
    this.authentication?.invalidate(true)
    this.authentication = null
    this.tokenManager.dispose()
  }

  // --- Internal ---

  private async findIdentityProvider(
    providerId: string,
  ): Promise<IdentityProviderOption> {
    const providers = await this.listIdentityProviders()
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) {
      throw new Error(
        'Identity provider is not available for this application client',
      )
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
    return redirectUri.startsWith('http://') ||
      redirectUri.startsWith('https://')
      ? redirectUri
      : 'http://localhost/'
  }
}
