import type { MfaProofOption, MfaSessionImpact } from './account-security-operations.js'
/** Explicit identifier kinds are never inferred from the value. */
export type LoginIdentifier =
  | { kind: 'EMAIL' | 'USERNAME'; value: string; region?: never }
  | { kind: 'PHONE'; value: string; region?: string }

export type IdentifierManagementAction = 'VERIFY' | 'SET_PRIMARY' | 'REMOVE' | 'REPLACE' | 'TRANSFER'
export type IdentifierManagementDenial =
  | 'ACCOUNT_INACTIVE' | 'MANAGED_IDENTIFIER' | 'METHOD_UNAVAILABLE' | 'REAUTH_METHOD_UNAVAILABLE'
  | 'TARGET_PROOF_UNAVAILABLE' | 'IDENTIFIER_ALREADY_EXISTS' | 'NOT_APPLICABLE' | 'ALREADY_VERIFIED'
  | 'ALREADY_PRIMARY' | 'IDENTIFIER_UNVERIFIED' | 'IDENTIFIER_RANGE_REJECTED' | 'LAST_LOGIN_METHOD' | 'PRIMARY_REPLACEMENT_UNAVAILABLE'
export type IdentifierManagementRequirement =
  | 'CURRENT_ACCOUNT_PROOF' | 'NEW_IDENTIFIER' | 'TARGET_EMAIL_OTP' | 'TARGET_PHONE_OTP'
  | 'REPLACEMENT_PRIMARY' | 'REMOVE_OLD' | 'COUNTERPART_CONFIRMATION' | 'REMAINING_LOGIN_PATH'
export interface IdentifierManagementCapability {
  allowed: boolean
  unavailableReasons: IdentifierManagementDenial[]
  requirements: IdentifierManagementRequirement[]
  replacementPrimaryIds: string[]
}
/** Authenticated snapshot only; every mutation is revalidated by the server. */
export interface IdentifierManagement {
  add: Record<LoginIdentifier['kind'], IdentifierManagementCapability>
  proofOptions: MfaProofOption[]
}
export interface IdentityProviderTarget {
  providerId: string
  maskedDisplayName: string | null
  maskedEmail: string | null
  reference: string
}
export interface AccountIdentifier {
  id: string
  kind: LoginIdentifier['kind']
  displayValue: string
  status: 'ACTIVE' | 'INACTIVE'
  verificationState: string
  verifiedAt?: string | null
  verificationSource?: string | null
  isPrimary: boolean
  managedBy?: string | null
  capabilities: Record<IdentifierManagementAction, IdentifierManagementCapability>
}
export interface AccountIdentifiers {
  loginMethodVersion: number
  items: AccountIdentifier[]
  management: IdentifierManagement
}
export interface LoginMethod {
  methodId: string
  kind: string
  roles: ('FIRST_FACTOR' | 'SECOND_FACTOR' | 'RECOVERY')[]
  status: 'AVAILABLE' | 'UNAVAILABLE'
  identifierId?: string | null
  credentialId?: string | null
  identityId?: string | null
  providerId?: string | null
  capabilities: Record<string, boolean>
  unavailableReasons: string[]
}
export interface AccountLoginMethods {
  loginMethodVersion: number
  methods: LoginMethod[]
}
type OperationPayloads = {
  ADD: { identifier: LoginIdentifier }
  VERIFY: { identifierId: string }
  SET_PRIMARY: { identifierId: string }
  REMOVE: { identifierId: string; replacementPrimaryId?: string }
  REPLACE: {
    identifierId: string
    replacement: LoginIdentifier
    removeOld: boolean
    replacementPrimaryId?: string
  }
  LINK: { providerId: string }
  UNLINK: { methodId: string }
  TRANSFER: { identifierId: string; targetUserId: string; sourceReplacementPrimaryId?: string }
}
export type CreateIdentityOperation = {
  [K in keyof OperationPayloads]: {
    type: K
    expectedLoginMethodVersion: number
    payload: OperationPayloads[K]
  }
}[keyof OperationPayloads]
export type IdentityOperationState =
  | 'AWAITING_REAUTH' | 'AWAITING_PROOF' | 'READY'
  | 'COMMITTED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED'
export type IdentityProofPurpose = 'CURRENT_ACCOUNT' | 'TARGET_OWNERSHIP' | 'TRANSFER_COUNTERPART'
export type TargetProofMethod = 'EMAIL_OTP' | 'PHONE_OTP'
export type OperationReauthentication =
  | { method: 'PASSWORD'; password: string }
  | { method: 'EMAIL_OTP'; challengeId: string; code: string }
export interface IdentityOperation {
  id: string
  type: keyof OperationPayloads | 'ACCOUNT_DELETE'
  state: IdentityOperationState
  expiresAt: string
  requiredProofs: {
    purpose: IdentityProofPurpose
    methods: string[]
    strength: string
    satisfied: boolean
  }[]
  completion?: { completedAt: string; finalLoginMethodVersion: number; sessionImpact: MfaSessionImpact } | null
  proofOptions: MfaProofOption[]
  providerTarget: IdentityProviderTarget | null
  result?: Record<string, string> | null
  maskedIdentifier?: string | null
  nextChallengeAt?: string | null
}
export interface CompleteIdentityOperation {
  proofs: { purpose: 'TARGET_OWNERSHIP'; method: TargetProofMethod; code: string }[]
}
export interface IdentityProviderAuthorization {
  authorizationId: string
  authorizationUrl: string
  expiresAt: string
}
export interface AuthorizeIdentityOperation {
  purpose: IdentityProofPurpose
  methodId?: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}
export interface RegistrationOperation {
  registrationId: string
  status: 'PENDING_VERIFICATION' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
  expiresAt: string
  nextAction: 'VERIFY_EMAIL' | 'LOGIN' | 'RESTART'
  nextChallengeAt?: string | null
}
export type RegistrationIdentifier = { kind: 'EMAIL' | 'USERNAME'; value: string; region?: never }
export interface StartRegistration {
  identifier: RegistrationIdentifier
  password: string
  uiLocales?: string
  registrationGrantToken?: string
  registrationAccessCode?: string
  organizationInvitationToken?: string
}
export interface RecoveryOperation {
  id: string
  method: 'LOCAL_PASSWORD' | 'PROVIDER' | 'WEBAUTHN'
  state: string
  expiresAt: string
  verificationEvidenceRef: string
  verifiedDeliveryChannelRef: string
  nextChallengeAt?: string | null
}
export type CompleteRecovery =
  | { password: string; code?: string }
  | { authorizationId: string; codeVerifier: string }
  | { requestId: string; credential: string }
