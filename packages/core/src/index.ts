// --- Config ---
export type { IamBrowserConfig } from './config.js'

// --- Session coordination ---
export { SessionLifecycle, SessionInvalidatedError } from './session-lifecycle.js'
export type { SessionInvalidationReason } from './session-lifecycle.js'

// --- Authorization ---
export type { PermissionKey, PermissionDefinition } from './authz/permission.js'
export { permKey, toAuthority, fromAuthority } from './authz/permission.js'
export type { PermissionResolver } from './authz/resolver.js'
export {
  matchPermission,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from './authz/wildcard.js'

// --- JWT ---
export { JwtVerifier } from './jwt/verifier.js'
export type { IamJwtPayload } from './jwt/verifier.js'
export { IdTokenVerifier, IdTokenValidationError } from './jwt/id-token-verifier.js'

// --- Client DTOs ---
export type {
  RequestPasswordResetInput,
  ResetPasswordInput,
} from './client/types.js'
export type * from './client/identity.js'
export { IdentityManagementResponseError, parseIdentifierManagementCapability, parseIdentifierActions, parseIdentifierManagement, parseIdentityProviderTarget } from './client/identity-management.js'
export {
  MfaOperationResponseError, createMfaOperationRequestId, parseMfaProofOption, mfaOperationReference,
  parseMfaCapabilities,
  parseMfaChallengeResult,
  parseMfaCompletionResult,
  parseMfaOperation,
  parseMfaProviderAuthorization,
  parseMfaRecoveryCodes,
  parseMfaStepUpResult,
  parseMfaTotpBeginResult,
  parseMfaWebAuthnStartResult,
} from './client/account-security-operations.js'
export type * from './client/account-security-operations.js'
export { parseCurrentUser } from './client/current-user.js'
export type { CurrentUser, AuthenticationContext } from './client/current-user.js'
export { AuthenticationTransaction, AuthenticationTransactionError } from './client/authentication-transaction.js'
export type {
  AuthenticationTransactionConfig, AuthenticationView, AuthenticationChallenge, AuthenticationTokens,
  PrimaryAuthentication, PrimaryProofMethod, MfaProofMethod,
} from './client/authentication-transaction.js'

export { PendingAuthorizationStore, authorizationRandom, authorizationCallback } from './client/pending-authorization.js'
export type { PendingAuthorization } from './client/pending-authorization.js'

export { CookieSessionTransport, SessionTransportError, UnsupportedOperationError, providerAuthorization } from './client/session-transport.js'
export type { SessionTransport, SessionRequest, ProviderRegistrationProof } from './client/session-transport.js'
export { ServerSession, SessionLogin, parseServerSession, sessionRecord, sessionText } from './client/server-session.js'
export type { ServerSessionView, AuthenticationFlow, LoginView } from './client/server-session.js'
export { parseIdentifierRestrictions, parseAuthCapabilities, parseDefaultLogin, parseSignupIdentifierKinds, parsePasswordIdentifierKinds, AuthCapabilitiesError } from './client/auth-capabilities.js'
export type { IdentifierRestrictions, IdentifierPurposeRestrictions, PhoneIdentifierRestriction, AuthCapabilities, DefaultLogin, IdentifierMethods, SignupIdentifierKind, PasswordIdentifierKind } from './client/auth-capabilities.js'
export { InvitationJourneyClient, SessionInvitationJourneyClient, InvitationError, parseInvitationJourney, parseInvitationRegistration, parseInvitationAuthentication, consumeInvitationContinuation } from './client/invitation-journeys.js'
export type { InvitationJourney, InvitationState, InvitationRegistration, InvitationAuthentication, InvitationAuthMethod, InvitationAuthProvider, InvitationConfirm, InvitationRegistrationInput, InvitationClientConfig, InvitationJourneyApi, InvitationSessionRequest } from './client/invitation-journeys.js'
export { parseInvitationEnrollment, parseInvitationEnrollmentBegin } from './client/invitation-journeys.js'
export type { InvitationEnrollment, InvitationEnrollmentMethod, InvitationEnrollmentBegin, InvitationEnrollmentCompletion } from './client/invitation-journeys.js'
