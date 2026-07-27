import { useState, useCallback, useEffect } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { useBranding, brandingToAppearance } from './useBranding'
import type { Appearance } from './styles'
import { containerStyle, inputStyle, buttonStyle, labelStyle, errorStyle } from './styles'
import { IamApiError } from '../core/types'
import type {
  EmailVerificationMode,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  RegistrationGrantInput,
} from '../core/types'
import { requestJson } from '../core/http-client'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'
import type { IamLocalization } from '../localization'
import { BrandingLogo } from './BrandingLogo'

export interface SignUpUserInfo {
  id: string
  email: string
  username?: string | null
  status: string
  emailVerified: boolean
  roles: string[]
  /** Profile metadata returned by signup/profile APIs; not App User authorization attributes. */
  metadata?: Record<string, unknown>
}

type SignUpVerificationMode = EmailVerificationMode | 'UNKNOWN'

interface SignUpResult {
  user: SignUpUserInfo
  verificationMode: SignUpVerificationMode
  resendCooldownSeconds: number
}

export interface SignUpProps {
  mode?: 'redirect' | 'embedded'
  /** Optional short-lived registration proof held by the calling application. */
  registrationGrant?: RegistrationGrantInput
  onSuccess?: (user: SignUpUserInfo) => void
  onError?: (error: Error) => void
  appearance?: Appearance
  /** Compact presentation for a container that already supplies the auth dialog title and frame. */
  presentation?: 'standalone' | 'dialog'
}

/**
 * Pre-built sign-up component.
 *
 * @example
 * ```tsx
 * <SignUp mode="embedded" onSuccess={(user) => navigate('/welcome')} />
 * ```
 */
export function SignUp({ mode = 'redirect', registrationGrant, onSuccess, onError, appearance, presentation = 'standalone' }: SignUpProps) {
  const { client, login } = useIamContext()
  const { localization: l } = useIamUi()
  const { branding } = useBranding()
  const [a] = useIamAppearance(appearance, brandingToAppearance(branding))
  const [redirectError, setRedirectError] = useState<string | null>(null)

  const startRedirectSignup = useCallback(async () => {
    setRedirectError(null)
    try {
      if (!registrationGrant) {
        await login()
        return
      }
      assertHostedRegistrationGrant(registrationGrant)
      const policy = await client.getPublicAuthPolicy()
      assertAllowedRegistrationGrant(policy, registrationGrant)
      const config = await client.discover()
      window.location.href = buildHostedSignupUrl(config.issuer, client.config.clientId, registrationGrant)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(l.signUp.unavailable)
      setRedirectError(signUpErrorMessage(error, l))
      onError?.(error)
    }
  }, [client, l, login, onError, registrationGrant])

  if (mode === 'redirect') {
    return (
      <div style={shellStyle(a, presentation)}>
        {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>{l.signUp.title}</h2>}
        {redirectError && <p role="status" style={errorStyle(a)}>{redirectError}</p>}
        <button onClick={() => void startRedirectSignup()} style={buttonStyle(a, 'primary')}>
          {l.signUp.signUp}
        </button>
      </div>
    )
  }

  return <EmbeddedSignUp appearance={appearance} registrationGrant={registrationGrant} onSuccess={onSuccess} onError={onError} presentation={presentation} />
}

function EmbeddedSignUp({ appearance, registrationGrant, onSuccess, onError, presentation = 'standalone' }: Pick<SignUpProps, 'appearance' | 'registrationGrant' | 'onSuccess' | 'onError' | 'presentation'>) {
  const { client, login } = useIamContext()
  const { branding } = useBranding()
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance, brandingToAppearance(branding))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SignUpResult | null>(null)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendCountdown, setResendCountdown] = useState(0)
  const [authMethods, setAuthMethods] = useState<PublicAuthMethodsResponse | null>(null)
  const [authPolicy, setAuthPolicy] = useState<PublicAuthPolicyResponse | null>(null)
  const [authMethodsError, setAuthMethodsError] = useState<Error | null>(null)
  const [authMethodsLoading, setAuthMethodsLoading] = useState(true)
  const [registrationAccessCode, setRegistrationAccessCode] = useState('')

  useCountdown(resendCountdown, setResendCountdown)

  useEffect(() => {
    let cancelled = false
    setAuthMethodsLoading(true)
    setAuthMethodsError(null)
    Promise.all([client.getPublicAuthMethods(), client.getPublicAuthPolicy()])
      .then(([nextAuthMethods, nextAuthPolicy]) => {
        if (!cancelled) {
          setAuthMethods(nextAuthMethods)
          setAuthPolicy(nextAuthPolicy)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setAuthMethodsError(err instanceof Error ? err : new Error(l.signUp.unavailable))
      })
      .finally(() => {
        if (!cancelled) setAuthMethodsLoading(false)
      })
    return () => { cancelled = true }
  }, [client, l.signUp.unavailable])

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(l.signUp.passwordMismatch)
      return
    }
    if (password.length < 8) {
      setError(l.signUp.passwordMinLength)
      return
    }
    const activeRegistrationGrant = registrationGrant ?? accessCodeRegistrationGrant(registrationAccessCode)
    if (!authMethods || !authPolicy || !isPasswordSignupAvailable(authMethods) || authPolicy.signupMode === 'DISABLED') {
      setError(l.signUp.unavailable)
      return
    }
    if (activeRegistrationGrant && !isAllowedRegistrationGrant(authPolicy, activeRegistrationGrant)) {
      setError(l.signUp.grantNotAccepted)
      return
    }
    if (authPolicy.signupMode === 'INVITE_REQUIRED' && !activeRegistrationGrant) {
      setError(inviteRequiredMessage(authPolicy, l))
      return
    }

    setLoading(true)
    try {
      const config = await client.discover()
      const user = await requestJson<SignUpUserInfo>(`${config.issuer}/api/v1/auth/signup`, {
        method: 'POST',
        json: {
          email,
          password,
          client_id: client.config.clientId,
          ...(activeRegistrationGrant ? registrationGrantRequestBody(activeRegistrationGrant) : {}),
        },
      })
      const verificationMode: SignUpVerificationMode = user.status === 'PENDING'
        ? 'REQUIRED'
        : authMethods.emailVerificationMode
      const resendCooldownSeconds = authMethods.resend.emailVerificationCooldownSeconds
      setResult({ user, verificationMode, resendCooldownSeconds })
      setResendStatus('idle')
      setResendCountdown(shouldOfferVerificationResend(verificationMode) ? resendCooldownSeconds : 0)
      setRegistrationAccessCode('')
      onSuccess?.(user)
    } catch (err) {
      const msg = signUpErrorMessage(err, l)
      setError(msg)
      onError?.(err instanceof Error ? err : new Error(msg))
    } finally {
      setLoading(false)
    }
  }, [authMethods, authPolicy, client, email, password, confirmPassword, registrationAccessCode, registrationGrant, onSuccess, onError, l])

  const resendVerification = useCallback(async () => {
    if (!result) return
    setResendStatus('sending')
    try {
      await client.sendEmailVerification({ email: result.user.email })
      setResendStatus('sent')
      setResendCountdown(result.resendCooldownSeconds)
    } catch {
      setResendStatus('error')
    }
  }, [client, result])

  const renderShell = (children: ReactNode) => (
    <div style={shellStyle(a, presentation)}>
      {branding?.logoUrl && <BrandingLogo logoUrl={branding.logoUrl} alt={l.auth.logoAlt} />}
      {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>{l.signUp.title}</h2>}
      {children}
    </div>
  )

  if (!result && authMethodsLoading) {
    return renderShell(<p style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: 0 }}>{l.auth.loadingOptions}</p>)
  }

  if (!result && (authMethodsError || !authMethods || !authPolicy || !isPasswordSignupAvailable(authMethods) || authPolicy.signupMode === 'DISABLED')) {
    return renderShell(<p role="status" style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: 0 }}>{l.signUp.unavailable}</p>)
  }

  const requiresRegistrationGrant = authPolicy?.signupMode === 'INVITE_REQUIRED'
  const allowsAccessCode = authPolicy?.allowedRegistrationGrantTypes.includes('ACCESS_CODE') ?? false

  if (result) {
    const { user, verificationMode } = result
    const canSignIn = verificationMode === 'OFF' || verificationMode === 'OPTIONAL'
    const shouldOfferResend = shouldOfferVerificationResend(verificationMode)
    const title = verificationMode === 'REQUIRED' ? l.signUp.checkEmail : l.signUp.accountCreated
    const message = verificationMode === 'OFF'
      ? l.signUp.accountCreatedDetail(user.email)
      : verificationMode === 'OPTIONAL'
        ? l.signUp.verificationOptional(user.email)
        : verificationMode === 'REQUIRED'
          ? l.signUp.verificationRequired(user.email)
          : l.signUp.verificationUnknown

    return (
      <div style={shellStyle(a, presentation)}>
        {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 12px' }}>{title}</h2>}
        <p style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: '0 0 20px' }}>
          {message}
        </p>
        {shouldOfferResend && (
          <>
            <button
              type="button"
              onClick={() => void resendVerification()}
              disabled={resendStatus === 'sending' || resendCountdown > 0}
              style={{ ...buttonStyle(a, 'ghost'), marginBottom: canSignIn ? 12 : 0 }}
            >
              {resendStatus === 'sending'
                ? l.signUp.sending
                : resendCountdown > 0
                  ? l.signUp.resendIn(resendCountdown)
                  : l.signUp.resendVerification}
            </button>
            {resendStatus === 'sent' && (
              <p role="status" style={{ fontSize: 13, color: a.successColor, textAlign: 'center', margin: '0 0 12px' }}>
                {l.signUp.verificationEmailSent}
              </p>
            )}
            {resendStatus === 'error' && (
              <p role="status" style={errorStyle(a)}>
                {l.signUp.verificationEmailFailed}
              </p>
            )}
          </>
        )}
        {canSignIn && (
          <button type="button" onClick={() => login()} style={buttonStyle(a, 'primary')}>
            {l.auth.signIn}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={shellStyle(a, presentation)}>
      {branding?.logoUrl && <BrandingLogo logoUrl={branding.logoUrl} alt={l.auth.logoAlt} />}
      {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>{l.signUp.title}</h2>}

      {requiresRegistrationGrant && !registrationGrant && (
        <p role="status" style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: '0 0 16px' }}>
          {inviteRequiredMessage(authPolicy, l)}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.signUp.email}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={l.signUp.emailPlaceholder}
            required
            style={inputStyle(a)}
          />
        </div>

        {requiresRegistrationGrant && !registrationGrant && allowsAccessCode && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle(a)}>{l.signUp.accessCode}</label>
            <input
              type="text"
              value={registrationAccessCode}
              onChange={(e) => setRegistrationAccessCode(e.target.value)}
              placeholder={l.signUp.accessCodePlaceholder}
              autoComplete="one-time-code"
              required
              style={inputStyle(a)}
            />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.signUp.password}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={l.signUp.passwordPlaceholder}
            required
            minLength={8}
            style={inputStyle(a)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.signUp.confirmPassword}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={l.signUp.confirmPasswordPlaceholder}
            required
            style={inputStyle(a)}
          />
        </div>

        {error && <p style={errorStyle(a)}>{error}</p>}

        <button type="submit" disabled={loading} style={{ ...buttonStyle(a, 'primary'), marginTop: 8, opacity: loading ? 0.7 : 1 }}>
          {loading ? l.signUp.creatingAccount : l.signUp.createAccount}
        </button>
      </form>
    </div>
  )
}

function shellStyle(a: ReturnType<typeof useIamAppearance>[0], presentation: NonNullable<SignUpProps['presentation']>) {
  return presentation === 'dialog'
    ? { ...containerStyle(a), maxWidth: 'none', margin: 0, padding: 0, borderRadius: 0, backgroundColor: 'transparent' }
    : containerStyle(a)
}

function isPasswordSignupAvailable(authMethods: PublicAuthMethodsResponse): boolean {
  return authMethods.signupEnabled
    && authMethods.selfRegistrationEnabled
    && authMethods.methods.some((method) => method.type === 'PASSWORD' && method.availableForSignup)
}

function accessCodeRegistrationGrant(value: string): RegistrationGrantInput | undefined {
  return value.trim() ? { type: 'ACCESS_CODE', registrationAccessCode: value } : undefined
}

function isAllowedRegistrationGrant(policy: PublicAuthPolicyResponse, input: RegistrationGrantInput): boolean {
  return policy.allowedRegistrationGrantTypes.includes(input.type)
}

function assertAllowedRegistrationGrant(policy: PublicAuthPolicyResponse, input: RegistrationGrantInput): void {
  if (!isAllowedRegistrationGrant(policy, input)) {
    throw new IamApiError('This registration invitation is not accepted by this application.', {
      status: 400,
      code: 'REGISTRATION_GRANT_TYPE_NOT_ALLOWED',
    })
  }
}

function assertHostedRegistrationGrant(input: RegistrationGrantInput): void {
  if (!isRegistrationGrantRecord(input)) throw invalidRegistrationGrant()

  switch (input.type) {
    case 'EMAIL_LINK':
      requireRegistrationGrantProof(input.registrationGrantToken)
      return
    case 'ACCESS_CODE':
      requireRegistrationGrantProof(input.registrationAccessCode)
      return
    case 'ORG_INVITATION':
      throw new IamApiError('Organization invitation proof is not supported for hosted sign-up.', {
        status: 400,
        code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED',
      })
    default:
      throw invalidRegistrationGrant()
  }
}

export function buildHostedSignupUrl(issuer: string, clientId: string, input: RegistrationGrantInput): string {
  assertHostedRegistrationGrant(input)
  const url = new URL('/signup', issuer)
  url.searchParams.set('client_id', clientId)
  switch (input.type) {
    case 'EMAIL_LINK':
      url.searchParams.set('registrationGrantToken', requireRegistrationGrantProof(input.registrationGrantToken))
      break
    case 'ACCESS_CODE':
      url.searchParams.set('registrationAccessCode', requireRegistrationGrantProof(input.registrationAccessCode))
      break
    case 'ORG_INVITATION':
      throw new IamApiError('Organization invitation proof is not supported for hosted sign-up.', {
        status: 400,
        code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED',
      })
    default:
      throw invalidRegistrationGrant()
  }
  return url.toString()
}

function requireRegistrationGrantProof(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidRegistrationGrant()
  return value
}

function invalidRegistrationGrant(): IamApiError {
  return new IamApiError('Registration invitation is invalid.', { status: 400, code: 'REGISTRATION_GRANT_INVALID' })
}

function isRegistrationGrantRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function inviteRequiredMessage(policy: PublicAuthPolicyResponse, localization: IamLocalization): string {
  return policy.allowedRegistrationGrantTypes.includes('ACCESS_CODE')
    ? localization.signUp.invitationOrAccessCodeRequired
    : localization.signUp.invitationRequired
}

function registrationGrantRequestBody(input: RegistrationGrantInput): Record<string, string> {
  if (!isRegistrationGrantRecord(input)) throw invalidRegistrationGrant()

  switch (input.type) {
    case 'EMAIL_LINK':
      return { registrationGrantToken: requireRegistrationGrantProof(input.registrationGrantToken) }
    case 'ACCESS_CODE':
      return { registrationAccessCode: requireRegistrationGrantProof(input.registrationAccessCode) }
    case 'ORG_INVITATION':
      return { organizationInvitationToken: requireRegistrationGrantProof(input.organizationInvitationToken) }
    default:
      throw invalidRegistrationGrant()
  }
}

function signUpErrorMessage(error: unknown, localization: IamLocalization): string {
  return localizeError(error, localization, 'signUpFailed')
}

function shouldOfferVerificationResend(verificationMode: SignUpVerificationMode): boolean {
  return verificationMode === 'OPTIONAL' || verificationMode === 'REQUIRED' || verificationMode === 'UNKNOWN'
}

function useCountdown(value: number, setValue: (next: number | ((current: number) => number)) => void): void {
  useEffect(() => {
    if (value <= 0) return
    const timer = setInterval(() => {
      setValue((current) => current <= 1 ? 0 : current - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [setValue, value])
}
