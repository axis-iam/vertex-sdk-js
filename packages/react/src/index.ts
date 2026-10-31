export type { AuthCapabilities, DefaultLogin, IdentifierMethods, SignupIdentifierKind } from '@axis-iam/vertex'
export type { IdentifierManagement, IdentifierManagementAction, IdentifierManagementCapability, IdentifierManagementDenial, IdentifierManagementRequirement, IdentityProviderTarget } from '@axis-iam/vertex'
export { phoneCountries, parsePhoneIdentifier, normalizePhoneIdentifier, PhoneIdentifierError } from './components/sign-in/phone-identifier'
export type { PhoneCountryOption, PhoneParseResult } from './components/sign-in/phone-identifier'
export { useAuthFlow, AuthFlowStateError } from './hooks/useAuthFlow'
export { AuthProviderWindow } from './core/auth-provider-window'
export type { AuthFlowState, AuthFlowActions, AuthFlowIntent, AuthCredentialMethod, UseAuthFlowOptions, UseAuthFlowResult } from './hooks/useAuthFlow'
// --- Provider ---
export { IamProvider } from './provider/IamProvider'
export type { IamProviderProps, IamContextValue } from './provider/IamProvider'
export type { IamColorScheme } from './provider/IamUiProvider'
export { iamLocalizationEnglish, iamLocalizationZhCN } from './localization'
export type { IamLocale, IamLocalization, PartialIamLocalization } from './localization'

// --- Core Hooks ---
export { useAuth } from './hooks/useAuth'
export { useIam } from './hooks/useIam'
export { usePasswordReset } from './hooks/usePasswordReset'
export type { UsePasswordResetResult } from './hooks/usePasswordReset'
export { useIdentityProviders } from './hooks/useIdentityProviders'
export type { UseIdentityProvidersOptions, UseIdentityProvidersResult } from './hooks/useIdentityProviders'
export { useProviderLogin } from './hooks/useProviderLogin'
export type { UseProviderLoginResult } from './hooks/useProviderLogin'
export { useRegistrationGrantPreview } from './hooks/useRegistrationGrantPreview'
export { useAccountLoginMethods } from './hooks/useAccountLoginMethods'
export type { UseAccountLoginMethodsOptions, UseAccountLoginMethodsResult } from './hooks/useAccountLoginMethods'
export { useChangePassword } from './hooks/useChangePassword'
export type { UseChangePasswordResult } from './hooks/useChangePassword'
export { useAccountProfile } from './hooks/useAccountProfile'
export type { UseAccountProfileOptions, UseAccountProfileResult } from './hooks/useAccountProfile'
export { useAccountSecurity } from './hooks/useAccountSecurity'
export type { UseAccountSecurityOptions, UseAccountSecurityResult } from './hooks/useAccountSecurity'
export { useAccountSessions } from './hooks/useAccountSessions'
export type { UseAccountSessionsOptions, UseAccountSessionsResult } from './hooks/useAccountSessions'
export { useAccountPermissions } from './hooks/useAccountPermissions'
export type { UseAccountPermissionsOptions, UseAccountPermissionsResult } from './hooks/useAccountPermissions'
export { useAccountOrganizations } from './hooks/useAccountOrganizations'
export type { UseAccountOrganizationsOptions, UseAccountOrganizationsResult } from './hooks/useAccountOrganizations'
export { useOrganizationSwitcher } from './hooks/useOrganizationSwitcher'
export type { UseOrganizationSwitcherOptions, UseOrganizationSwitcherResult } from './hooks/useOrganizationSwitcher'
export { useInvitationJourney } from './hooks/useInvitationJourney'
export type { UseInvitationJourneyOptions } from './hooks/useInvitationJourney'
export type { InvitationJourney, InvitationState, InvitationRegistration, InvitationAuthentication, InvitationJourneyApi, InvitationRegistrationInput } from '@axis-iam/vertex'
export { consumeInvitationContinuation } from '@axis-iam/vertex'
export { useLinkableIdentityProviders } from './hooks/useLinkableIdentityProviders'
export type { UseLinkableIdentityProvidersOptions, UseLinkableIdentityProvidersResult } from './hooks/useLinkableIdentityProviders'
// --- Permission ---
export { usePermission } from './permission/usePermission'
export { PermissionGate, Protect } from './permission/PermissionGate'
export type { PermissionGateProps } from './permission/PermissionGate'
export { useMenuFilter } from './permission/useMenuFilter'
export type { MenuItem } from './permission/useMenuFilter'

// --- Pre-built Components ---
export { SignIn } from './components/SignIn'
export type { SignInProps } from './components/SignIn'
export { SignUp } from './components/SignUp'
export type { SignUpProps, RegistrationOperation } from './components/SignUp'
export { AuthDialog, SignInButton, SignUpButton } from './components/AuthDialog'
export type { AuthDialogProps, AuthDialogView, AuthEntryButtonProps } from './components/AuthDialog'
export { ForgotPassword } from './components/ForgotPassword'
export type { ForgotPasswordProps } from './components/ForgotPassword'
export { ResetPassword } from './components/ResetPassword'
export type { ResetPasswordProps } from './components/ResetPassword'
export { UserButton } from './components/UserButton'
export type { UserButtonProps } from './components/UserButton'
export { OrgSwitcher, OrganizationSwitcher } from './components/OrgSwitcher'
export type { OrgSwitcherProps, OrganizationSwitcherProps } from './components/OrgSwitcher'
export { UserProfile } from './components/UserProfile'
export type { UserProfileProps } from './components/UserProfile'
export { ConnectedAccounts } from './components/ConnectedAccounts'
export type { ConnectedAccountsProps } from './components/ConnectedAccounts'
export { AccountProfilePanel } from './components/AccountProfilePanel'
export type { AccountProfilePanelProps } from './components/AccountProfilePanel'
export { PasswordChangeForm } from './components/PasswordChangeForm'
export type { PasswordChangeFormProps } from './components/PasswordChangeForm'
export { AccountSessionsPanel } from './components/AccountSessionsPanel'
export type { AccountSessionsPanelProps } from './components/AccountSessionsPanel'
export { AccountPermissionsPanel } from './components/AccountPermissionsPanel'
export type { AccountPermissionsPanelProps } from './components/AccountPermissionsPanel'
export { AccountCenter } from './components/AccountCenter'
export type { AccountCenterLabels, AccountCenterProps, AccountCenterSection } from './components/AccountCenter'
export { accountCenterEnglish, resolveAccountCenterLocalization } from './components/accountCenterConfig'
export type { AccountCenterColorScheme, AccountCenterLocalization } from './components/accountCenterConfig'
export { OrganizationInvitationAccept } from './components/OrganizationInvitationAccept'
export type { OrganizationInvitationAcceptProps } from './components/OrganizationInvitationAccept'
export type { Appearance } from './components/styles'

// --- Security ---
export { useStepUp } from './security/useStepUp'
export type { StepUpTrigger } from './security/useStepUp'
export { useImpersonation } from './security/useImpersonation'
export { useDevices } from './security/useDevices'
export type { Device } from './security/useDevices'

// --- Core Types ---
export { OAuthClient } from './core/oauth-client'
export type {
  IamConfig,
  IamApiErrorDetails,
  IamApiErrorOptions,
  IamUser,
  AppContinuation,
  AuthMethodAvailabilityResponse,
  AuthMethodIdpProviderResponse,
  AuthMethodType,
  AccountCredentialType,
  AccountOrganization,
  AccountPermissionCheckInput,
  AccountPermissionCheckResponse,
  AccountPermissionSummary,
  AccountProfile,
  AccountSecuritySummary,
  AccountSession,
  AccountUpdateProfileInput,
  AccountLinkProtocol,
  AccountLoginMethod,
  AccountLoginMethodKind,
  ChangePasswordInput,
  EmailVerificationResponse,
  IdentityProviderOption,
  IdentityProviderProtocol,
  LinkableIdentityProvider,
  CurrentUser,
  AuthenticationContext,
  TokenSet,
  OIDCConfiguration,
  OrganizationSwitchResponse,
  ProviderAuthorizationOptions,
  ProviderAuthorizationResponse,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  SignupMode,
  RegistrationGrantType,
  RegistrationGrantInput,
  ProviderRegistrationGrantInput,
  RegistrationGrantPreviewStatus,
  RegistrationGrantPreviewResponse,
  RedirectCallbackOptions,
  RedirectCallbackResult,
  LogoutOptions,
  LogoutUrlOptions,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SendEmailVerificationInput,
  VerifyEmailInput,
} from './core/types'
export { IamApiError, IamNetworkError, IamConfigurationError, IamTokenRefreshError, isIamApiError, isStepUpRequiredError } from './core/types'
export type { TokenRefreshFailureReason } from './core/types'
export { SessionInvalidatedError } from '@axis-iam/vertex'

// --- Re-export core permission utils for convenience ---
export { hasPermission, hasAllPermissions, hasAnyPermission, matchPermission } from '@axis-iam/vertex'

export { useBranding, BrandingFetchError } from './components/useBranding'
export type { BrandingConfig, BrandingIntent, UseBrandingResult } from './components/useBranding'

export { useIdentityOperations } from './hooks/useIdentityOperations'
export { IdentityClient } from './core/identity-client'
export type * from '@axis-iam/vertex'
export { assertIdentityWebAuthn } from './core/identity-webauthn'

export { IdentityOperationStore, identityOperationStore } from './core/identity-operation-store'
export type { IdentityOperationSnapshot, UncertainIdentityCreate } from './core/identity-operation-store'

export { ServerSessionClient } from './core/server-session-client'
export type { SessionIdentityOperation, OperationView } from './core/server-session-client'
export type { AuthClient } from './core/auth-client'
export { CookieSessionTransport, UnsupportedOperationError, SessionTransportError } from '@axis-iam/vertex'
export type { SessionTransport, SessionRequest } from '@axis-iam/vertex'
export { useServerSession } from './hooks/useServerSession'

export { AccountSecurityPanel } from './components/AccountSecurityPanel'
export type { AccountSecurityPanelProps } from './components/AccountSecurityPanel'
export { AccountSecurityDialog } from './components/AccountSecurityDialog'
export type { AccountSecurityDialogProps } from './components/AccountSecurityDialog'
export { AccountSecurityOperations } from './core/account-security-operations'
export { accountSecurityStore, AccountSecurityStore } from './core/account-security-store'
export type { AccountSecurityOperationState } from './core/account-security-store'
export type { AccountSecurityReceipt } from './core/account-security-receipt'
export { securityEnglish, securityZhCN } from './security-localization'
export type { SecurityLocalization } from './security-localization'
export type { MfaOperation, MfaOperationClient, MfaOperationType, MfaCapabilities, MfaProofOption, MfaOperationState, MfaSessionImpact, MfaTotpBeginResult, MfaCompletionResult, MfaOperationReauthentication } from '@axis-iam/vertex'
