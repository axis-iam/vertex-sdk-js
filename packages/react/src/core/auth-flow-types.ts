import type {
  AuthMethodIdpProviderResponse,
  IamUser,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  RegistrationGrantInput,
  EmailVerificationMode,
} from './types'

export type AuthFlowIntent = 'sign-in' | 'sign-up'
export type AuthCredentialMethod = 'password' | 'sms' | 'email_otp' | 'magic_link'
export interface SignUpUserInfo {
  id: string
  email: string
  username?: string | null
  status: string
  emailVerified: boolean
  roles: string[]
  /** Profile metadata, never an authorization source. */
  metadata?: Record<string, unknown>
}
export interface AuthSignupResult {
  readonly user: SignUpUserInfo
  readonly verificationMode: EmailVerificationMode
}
export type AuthFlowPending =
  | 'password'
  | 'send-code'
  | 'verify-code'
  | 'magic-link'
  | 'complete-magic-link'
  | 'mfa'
  | 'sign-up'
  | 'resend-verification'
  | 'provider'
interface AuthFlowCommon {
  readonly intent: AuthFlowIntent
  readonly capabilities: PublicAuthMethodsResponse | null
  readonly policy: PublicAuthPolicyResponse | null
  readonly providers: readonly AuthMethodIdpProviderResponse[]
  readonly pending: AuthFlowPending | null
  readonly error: Error | null
  readonly retryAfterSeconds: number
  readonly verificationResendDeadline: number | null
  readonly verificationEmail: string | null
}
export type AuthFlowState = AuthFlowCommon &
  (
    | { readonly step: 'loading' | 'unavailable' | 'identifier' | 'sign-up' }
    | {
        readonly step: 'method'
        readonly identifier: string
        readonly identifierKind: 'email' | 'phone'
        readonly method: AuthCredentialMethod | null
        readonly methods: readonly AuthCredentialMethod[]
        readonly codeSent: boolean
        readonly magicLinkSent: boolean
      }
    | { readonly step: 'mfa'; readonly methods: readonly ['totp']; readonly identifier: string }
    | { readonly step: 'verification'; readonly result: AuthSignupResult }
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
  onSignUpSuccess?: (user: SignUpUserInfo) => void
  onError?: (error: Error) => void
}
export interface AuthFlowActions {
  setIntent(intent: AuthFlowIntent): void
  continueWithIdentifier(identifier: string): void
  selectMethod(method: AuthCredentialMethod): void
  back(): void
  cancel(): void
  reset(): void
  submitPassword(password: string): Promise<void>
  sendCode(): Promise<void>
  verifyCode(code: string): Promise<void>
  sendMagicLink(): Promise<void>
  completeMagicLink(token: string): Promise<void>
  verifyMfa(code: string): Promise<void>
  signUp(input: {
    email: string
    username?: string
    password: string
    registrationGrant?: RegistrationGrantInput
  }): Promise<void>
  resendVerification(): Promise<void>
  startProvider(providerId: string): Promise<string>
}
export interface UseAuthFlowResult {
  readonly state: AuthFlowState
  readonly actions: AuthFlowActions
}
