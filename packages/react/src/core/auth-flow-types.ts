import type {
  LoginIdentifier,
  RegistrationOperation,
  MfaProofMethod,
} from '@axis-iam/vertex'
import type {
  AuthMethodIdpProviderResponse,
  IamUser,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  RegistrationGrantInput,
} from './types'

export type AuthFlowIntent = 'sign-in' | 'sign-up'
export type AuthCredentialMethod =
  | 'password'
  | 'sms'
  | 'email_otp'
  | 'magic_link'
export type AuthFlowPending =
  | 'password'
  | 'send-code'
  | 'verify-code'
  | 'magic-link'
  | 'complete-magic-link'
  | 'retry-completion'
  | 'mfa'
  | 'sign-up'
  | 'resend-verification'
  | 'provider'
  | 'provider-callback'
  | 'complete-registration'
  | 'cancel-registration'
interface AuthFlowCommon {
  readonly intent: AuthFlowIntent
  readonly capabilities: PublicAuthMethodsResponse | null
  readonly policy: PublicAuthPolicyResponse | null
  readonly providers: readonly AuthMethodIdpProviderResponse[]
  readonly pending: AuthFlowPending | null
  readonly error: Error | null
  readonly retryAfterSeconds: number
  readonly verificationResendDeadline: number | null
  readonly registrationCancelUnconfirmed: boolean
  readonly verificationEmail: string | null
  readonly transactionExpiresAt: string | null
  readonly challengeExpiresAt: string | null
  readonly cancellationUnconfirmed: boolean
  readonly completionPending: boolean
}
export type AuthFlowState = AuthFlowCommon &
  (
    | { readonly step: 'loading' | 'unavailable' | 'identifier' | 'sign-up' }
    | {
        readonly step: 'method'
        readonly identifier: string
        readonly identifierKind: 'email' | 'phone' | 'username'
        readonly loginIdentifier: LoginIdentifier
        readonly method: AuthCredentialMethod | null
        readonly methods: readonly AuthCredentialMethod[]
        readonly codeSent: boolean
        readonly magicLinkSent: boolean
      }
    | {
        readonly step: 'mfa'
        readonly methods: readonly MfaProofMethod[]
        readonly identifier: string
      }
    | {
        readonly step: 'verification'
        readonly registration: RegistrationOperation
      }
    | { readonly step: 'success'; readonly user: IamUser }
  )
export class AuthFlowStateError extends Error {
  readonly code = 'AUTH_FLOW_STATE_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'AuthFlowStateError'
  }
}
export interface UseAuthFlowOptions {
  initialIntent?: AuthFlowIntent
  registrationGrant?: RegistrationGrantInput
  onSignInSuccess?: (user: IamUser) => void
  onSignUpSuccess?: (operation: RegistrationOperation) => void
  onError?: (error: Error) => void
}
export interface AuthFlowActions {
  retryOptions(): Promise<void>
  resumeProviderCallback(url: string): Promise<void>
  retryCompletion(): Promise<void>
  setIntent(intent: AuthFlowIntent): Promise<void>
  continueWithIdentifier(identifier: LoginIdentifier): void
  selectMethod(method: AuthCredentialMethod): void
  back(): Promise<void>
  cancel(): Promise<void>
  reset(): Promise<void>
  submitPassword(password: string): Promise<void>
  sendCode(): Promise<void>
  verifyCode(code: string): Promise<void>
  sendMagicLink(): Promise<void>
  completeMagicLink(url: string): Promise<void>
  verifyMfa(code: string, method?: MfaProofMethod): Promise<void>
  signUp(input: {
    identifier: LoginIdentifier
    password: string
    registrationGrant?: RegistrationGrantInput
  }): Promise<void>
  completeRegistration(code: string): Promise<void>
  cancelRegistration(): Promise<void>
  resumeRegistration(id: string): Promise<void>
  resendVerification(): Promise<void>
  startProvider(providerId: string, registrationGrant?: RegistrationGrantInput): Promise<string>
}
export interface UseAuthFlowResult {
  readonly state: AuthFlowState
  readonly actions: AuthFlowActions
}
