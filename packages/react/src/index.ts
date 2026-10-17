export { useAuthFlow, AuthFlowStateError } from './hooks/useAuthFlow'
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
export { useOrganizationInvitation } from './hooks/useOrganizationInvitation'
export type { UseOrganizationInvitationOptions, UseOrganizationInvitationResult } from './hooks/useOrganizationInvitation'
export { useLinkableIdentityProviders } from './hooks/useLinkableIdentityProviders'
export type { UseLinkableIdentityProvidersOptions, UseLinkableIdentityProvidersResult } from './hooks/useLinkableIdentityProviders'
export { useAccountLinking } from './hooks/useAccountLinking'
export type { StartAccountLinkOptions, UseAccountLinkingOptions, UseAccountLinkingResult } from './hooks/useAccountLinking'
export { useAccountLinkCallback }
  from './hooks/useAccountLinkCallback'
export type {
  AccountLinkCallbackStatus,
  UseAccountLinkCallbackOptions,
  UseAccountLinkCallbackResult,
} from './hooks/useAccountLinkCallback'

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
export type { SignUpProps, SignUpUserInfo } from './components/SignUp'
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
  EmailVerificationMode,
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
  AccountLinkAuthorizeOptions,
  AccountLinkAuthorizeResult,
  AccountLinkCallbackResult,
  AccountLinkProtocol,
  AccountLinkTicketExchangeInput,
  AccountLoginMethod,
  AccountLoginMethodKind,
  ChangePasswordInput,
  EmailVerificationResponse,
  IdentityProviderOption,
  IdentityProviderProtocol,
  LinkableIdentityProvider,
  JWTPayload,
  TokenSet,
  OIDCConfiguration,
  OrganizationSwitchResponse,
  ProviderAuthorizationOptions,
  ProviderAuthorizationResponse,
  PublicOrganizationInvitationAcceptResponse,
  PublicOrganizationInvitationAcceptStatus,
  PublicOrganizationInvitationPreview,
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
  LogoutAccountOptions,
  LogoutOptions,
  LogoutUrlOptions,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SendEmailVerificationInput,
  VerifyEmailInput,
  SocialProviderConfig,
} from './core/types'
export { IamApiError, IamNetworkError, IamConfigurationError, IamTokenRefreshError, isIamApiError, isStepUpRequiredError } from './core/types'
export type { TokenRefreshFailureReason } from './core/types'
export { SessionInvalidatedError } from '@axis-iam/vertex'
export {
  ACCOUNT_LINK_STATE_KEY,
  clearPendingAccountLink,
  generateAccountLinkState,
  getPendingAccountLink,
  isActionableLinkProvider,
  storePendingAccountLink,
} from './core/account-linking'
export type {
  PendingAccountLinkProvider,
  PendingAccountLinkState,
  StorePendingAccountLinkOptions,
} from './core/account-linking'

// --- Re-export core permission utils for convenience ---
export { hasPermission, hasAllPermissions, hasAnyPermission, matchPermission } from '@axis-iam/vertex'

export { useBranding, BrandingFetchError } from './components/useBranding'
export type { BrandingConfig, BrandingIntent, UseBrandingResult } from './components/useBranding'
