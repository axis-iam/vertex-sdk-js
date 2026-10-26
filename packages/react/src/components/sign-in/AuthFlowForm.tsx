import type { LoginIdentifier, MfaProofMethod } from '@axis-iam/vertex'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { useIamUi } from '../../provider/IamUiProvider'
import { localizeError } from '../../localization'
import type { UseAuthFlowResult } from '../../core/auth-flow-types'
import type { RegistrationGrantInput } from '../../core/types'
import type { Appearance } from '../styles'
import type { BrandingConfig } from '../useBranding'
import {
  buttonStyle,
  inputStyle,
  labelStyle,
  errorStyle,
  linkStyle,
} from '../styles'
import type { SignInProviderButtonRenderProps } from './types'
import { PhoneIdentifierInput } from './PhoneIdentifierInput'
import { normalizePhoneIdentifier, PhoneIdentifierError } from './phone-identifier'

export function AuthFlowForm({
  flow,
  appearance: a,
  renderProviderButton,
  onForgotPassword,
  forgotPasswordUrl,
  showIntentSwitch = true,
  allowSignUp = true,
  branding,
  registrationGrant,
}: {
  flow: UseAuthFlowResult
  appearance: Required<Appearance>
  renderProviderButton?: (props: SignInProviderButtonRenderProps) => ReactNode
  onForgotPassword?: () => void
  forgotPasswordUrl?: string
  showIntentSwitch?: boolean
  allowSignUp?: boolean
  branding?: BrandingConfig | null
  registrationGrant?: RegistrationGrantInput
}) {
  const { state: s, actions } = flow
  const { localization: l, locale } = useIamUi()
  const prefix = useId()
  const root = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const [identifier, setIdentifier] = useState('')
  const [selectedKind, setKind] = useState<LoginIdentifier['kind'] | null>(null)
  const kinds = s.capabilities?.identifierMethods ?? []
  const kind = selectedKind && kinds.some((entry) => entry.kind === selectedKind)
    ? selectedKind : s.capabilities?.defaultIdentifierKind ?? null
  const previousKind = useRef(kind)
  const [methodsExpanded, expandMethods] = useState(false)
  const methodTrigger = useRef<HTMLButtonElement>(null)
  const [registrationKind, setRegistrationKind] = useState<
    'EMAIL' | 'USERNAME'
  >('EMAIL')
  const [region, setRegion] = useState('')
  const typedIdentifier = (): LoginIdentifier => {
    if (kind === null) throw new Error('Identifier capability is unavailable')
    if (kind === 'PHONE') return { kind, value: normalizePhoneIdentifier(identifier, region || undefined).e164 }
    return { kind, value: identifier }
  }
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [mfaMethod, setMfaMethod] = useState<MfaProofMethod>('TOTP')
  const magicCallback =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.hash.slice(1)).get('kind') ===
      'AUTH_PROOF'
  const providerCallback = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('kind') || new URLSearchParams(window.location.search).has('code'))
  const [accessCode, setAccessCode] = useState('')
  const canRegister =
    s.step === 'sign-up' &&
    s.intent === 'sign-up' &&
    s.capabilities?.signupEnabled &&
    s.capabilities.selfRegistrationEnabled &&
    s.policy !== null &&
    s.policy.signupMode !== 'DISABLED'
  const acceptsAccessCode = Boolean(
    canRegister &&
      s.policy?.allowedRegistrationGrantTypes.includes('ACCESS_CODE') &&
      !registrationGrant,
  )
  const requiresAccessCode =
    acceptsAccessCode && s.policy?.signupMode === 'INVITE_REQUIRED'
  useEffect(() => {
    setAccessCode('')
  }, [
    s.intent,
    s.policy?.signupMode,
    s.policy?.allowedRegistrationGrantTypes.join(','),
    registrationGrant,
  ])
  const [validation, setValidation] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    setKind(null); setIdentifier(''); setRegion(''); expandMethods(false)
    setPassword(''); setConfirmPassword(''); setCode(''); setValidation(null); setNotice(null)
  }, [s.capabilities, s.intent])
  useEffect(() => {
    if (previousKind.current !== kind)
      root.current?.querySelector<HTMLInputElement>('input[name="identifier"]')?.focus()
    previousKind.current = kind
  }, [kind])
  const [, updateDeadline] = useState(0)
  const registrationExpiry = s.step === 'verification' ? s.registration.expiresAt : null
  const registrationExpired = registrationExpiry !== null && Date.parse(registrationExpiry) <= Date.now()
  useEffect(() => {
    if (!registrationExpiry || Date.parse(registrationExpiry) <= Date.now()) return
    const timer = setTimeout(() => { setCode(''); updateDeadline((value) => value + 1) }, Math.min(Date.parse(registrationExpiry) - Date.now(), 2147483647))
    return () => clearTimeout(timer)
  }, [registrationExpiry])
  const previousStep = useRef(s.step)
  const view = `${s.intent}:${s.step}:${s.step === 'method' ? `${s.identifier}:${s.method}` : ''}`
  const ownership = useRef({ view, revision: 0 })
  if (ownership.current.view !== view)
    ownership.current = { view, revision: ownership.current.revision + 1 }
  const leave = (action: () => void | Promise<void>) => {
    ownership.current.revision++
    const result = action()
    if (result) consume(result)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    setPassword('')
    setConfirmPassword('')
    setCode('')
    setValidation(null)
    setNotice(null)
    if (previousStep.current !== s.step && previousStep.current !== 'loading')
      root.current?.querySelector<HTMLElement>('input,button')?.focus()
    previousStep.current = s.step
  }, [s.step, s.intent, s.step === 'method' ? s.method : null, s.step === 'verification' ? s.registration.status : null])
  const busy = s.pending !== null
  const consume = (promise: Promise<unknown>, onSuccess?: () => void) => {
    const revision = ownership.current.revision
    const current = () =>
      mounted.current && ownership.current.revision === revision
    void promise
      .then(() => {
        if (current()) onSuccess?.()
      })
      .catch((error) => {
        if (error instanceof SessionInvalidatedError) return
        // The engine records typed failures; presentation consumes the rejection.
      })
      .finally(() => {
        if (current()) {
          setPassword('')
        }
      })
  }
  const sync = (action: () => void) => {
    setValidation(null)
    try {
      action()
    } catch (error) {
      if (error instanceof PhoneIdentifierError)
        setValidation(error.code === 'PHONE_REGION_REQUIRED' ? l.identity.phoneAmbiguous : l.identity.phoneInvalid)
      else setValidation(l.auth.identifierInvalid)
    }
  }
  const field = (
    name: string,
    label: string,
    type: string,
    value: string,
    set: (v: string) => void,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={`${prefix}-${name}`} style={labelStyle(a)}>
        {label}
      </label>
      <input
        id={`${prefix}-${name}`}
        name={name}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        required
        style={inputStyle(a)}
        aria-describedby={s.error || validation ? `${prefix}-error` : undefined}
        {...extra}
      />
    </div>
  )
  const button = (label: string, action?: () => void, disabled = busy) => (
    <button
      type={action ? 'button' : 'submit'}
      onClick={action}
      disabled={disabled}
      style={{ ...buttonStyle(a), opacity: disabled ? 0.65 : 1 }}
    >
      {label}
    </button>
  )
  const textButton = (label: string, action: () => void, disabled = busy, subtle = false) => (
    <button type="button" onClick={action} disabled={disabled}
      className="axis-auth-text-action"
      style={{ ...linkStyle(a), background: 'transparent', border: 0, minHeight: 44, padding: '8px 10px', font: 'inherit', textDecoration: undefined, cursor: disabled ? 'not-allowed' : 'pointer', color: disabled || subtle ? a.mutedTextColor : a.focusColor }}>
      {label}
    </button>
  )
  const resend = s.verificationEmail && (
    <div style={{ marginTop: 12, textAlign: 'center', minHeight: 44, color: a.mutedTextColor, fontSize: 14 }}>
      {s.retryAfterSeconds > 0 ? <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>{l.auth.resendIn(s.retryAfterSeconds)}</span> : <>
      <span>{l.identity.didNotReceive}</span>{textButton(
        busy
            ? l.auth.sending
            : l.auth.resend,
        () => {
          consume(actions.resendVerification(), () =>
            setNotice(l.auth.verificationEmailSent),
          )
        },
        busy || s.registrationCancelUnconfirmed,
      )}</>}
    </div>
  )
  const error =
    validation ??
    (s.error
      ? 'code' in s.error && s.error.code === 'REGISTRATION_RESTART_REQUIRED'
        ? l.identity.restart
        : 'code' in s.error &&
            s.error.code === 'PASSWORD_POLICY_VIOLATION' &&
            s.policy
          ? l.signUp.passwordRequirements(s.policy.minPasswordLength, s.policy)
          : localizeError(
              s.error,
              l,
              s.intent === 'sign-up' ? 'signUpFailed' : 'signInFailed',
            )
      : null)
  const formSubmit = (action: () => void) => (event: FormEvent) => {
    event.preventDefault()
    setValidation(null)
    setNotice(null)
    action()
  }
  const providers = s.providers.length > 0 && (
    <div style={{ display: 'grid', gap: 8, marginTop: 24 }}>
      {s.providers.map((provider) => {
        const onClick = async () => {
          const revision = ownership.current.revision
          try {
            const url = await actions.startProvider(provider.id, s.intent === 'sign-up' && acceptsAccessCode && accessCode.trim() ? { type: 'ACCESS_CODE', registrationAccessCode: accessCode } : undefined)
            if (mounted.current && ownership.current.revision === revision)
              window.location.href = url
          } catch (error) {
            if (error instanceof SessionInvalidatedError) return
          }
        }
        const props = {
          provider,
          label: l.auth.providerSignIn(provider.displayName),
          disabled: busy,
          isLoading: s.pending === 'provider',
          onClick,
        }
        return (
          <div key={provider.id}>
            {renderProviderButton ? (
              renderProviderButton(props)
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onClick()}
                style={buttonStyle(a, 'ghost')}
              >
                {props.isLoading ? l.auth.redirecting : props.label}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
  return (
    <div
      ref={root}
      className="axis-iam-auth-form"
      style={{ '--axis-auth-focus': a.focusColor } as React.CSSProperties}
    >
      <style>{`.axis-iam-auth-form input,.axis-iam-auth-form select,.axis-iam-auth-form button{font-family:inherit;letter-spacing:normal;text-transform:none}.axis-iam-auth-form input::placeholder{color:inherit;opacity:.72}.axis-iam-auth-form input:focus-visible,.axis-iam-auth-form select:focus-visible,.axis-iam-auth-form button:focus-visible,.axis-iam-auth-form a:focus-visible{outline:2px solid var(--axis-auth-focus);outline-offset:3px}.axis-iam-auth-form button:disabled{cursor:not-allowed}.axis-iam-auth-form button:not(:disabled):hover{filter:brightness(.95)}.axis-iam-auth-form .axis-auth-text-action{text-decoration:none}.axis-iam-auth-form .axis-auth-text-action:not(:disabled):hover{text-decoration:underline;text-underline-offset:3px}.axis-iam-auth-form{min-width:0;overflow-wrap:anywhere}@media(prefers-reduced-motion:reduce){.axis-iam-auth-form *{transition:none!important}}`}</style>
      {s.step === 'loading' && <p role="status">{l.auth.loadingOptions}</p>}
      {s.step === 'unavailable' && (
        <div><p role="status">
          {s.intent === 'sign-up'
            ? l.signUp.unavailable
            : s.error
              ? l.auth.optionsUnavailable
              : l.auth.noMethodAvailable}
        </p>{s.error && textButton(l.identity.retry, () => consume(actions.retryOptions()))}</div>
      )}
      {s.step === 'identifier' && providerCallback && (
        <div>{button(l.auth.continue, () => consume(actions.resumeProviderCallback(window.location.href)))}</div>
      )}
      {s.step === 'identifier' && !providerCallback && (
        <>
          {kind !== null && <form
            onSubmit={formSubmit(() =>
              sync(() => actions.continueWithIdentifier(typedIdentifier())),
            )}
          >
            {kind === 'PHONE' ? <PhoneIdentifierInput
              appearance={a}
              locale={locale}
              prefix={prefix}
              value={identifier}
              country={region}
              onValueChange={(value) => { setIdentifier(value); setValidation(null) }}
              onCountryChange={(value) => { setRegion(value); setValidation(null) }}
              labels={{ country: l.identity.phoneCountry, chooseCountry: l.identity.choosePhoneCountry, number: l.identity.phoneNumber }}
              error={validation}
            /> : field(
              'identifier',
              l.identity[kind],
              kind === 'EMAIL' ? 'email' : 'text',
              identifier,
              setIdentifier,
              {
                placeholder: kind === 'EMAIL' ? l.auth.emailPlaceholder : l.signUp.usernamePlaceholder,
                autoComplete: 'username',
              },
            )}
            {button(l.auth.continue)}
          </form>}
          {kinds.length > 1 && <div style={{ textAlign: 'center', marginTop: 12 }}
            onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); expandMethods(false); methodTrigger.current?.focus() } }}>
            <button ref={methodTrigger} type="button" aria-expanded={methodsExpanded} aria-controls={`${prefix}-other-methods`}
              onClick={() => expandMethods(!methodsExpanded)} style={{ ...linkStyle(a), minHeight: 44, border: 0, background: 'transparent', cursor: 'pointer' }}>
              {kinds.length === 2 ? l.identity.useKind(l.identity[kinds.find((entry) => entry.kind !== kind)!.kind]) : l.identity.otherMethods}
            </button>
            {methodsExpanded && <div id={`${prefix}-other-methods`} style={{ display: 'grid', gap: 8 }}>
              {kinds.filter((entry) => entry.kind !== kind).map((entry) => <button key={entry.kind} type="button"
                style={{ ...buttonStyle(a, 'ghost'), minHeight: 44 }}
                onClick={() => {
                  setKind(entry.kind); setIdentifier(''); setRegion(''); setPassword(''); setConfirmPassword(''); setCode(''); setValidation(null); setNotice(null); expandMethods(false)
                }}>{l.identity.useKind(l.identity[entry.kind])}</button>)}
            </div>}
          </div>}
          {providers}
        </>
      )}
      {s.completionPending && (
        <div>
          {button(l.identity.retry, () => consume(actions.retryCompletion()))}
          <button
            type="button"
            onClick={() => leave(actions.cancel)}
            style={linkStyle(a)}
          >
            {l.auth.back}
          </button>
        </div>
      )}
      {s.step === 'method' && !s.completionPending && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>
              {l.auth.signingInAs(s.identifier)}
            </span>
            <button
              type="button"
              onClick={() => leave(actions.back)}
              style={linkStyle(a)}
            >
              {l.auth.change}
            </button>
          </div>
          {s.methods.length > 1 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 20,
              }}
            >
              {s.methods.map((method) => (
                <button
                  key={method}
                  type="button"
                  aria-pressed={s.method === method}
                  onClick={() => leave(() => actions.selectMethod(method))}
                  style={{
                    ...buttonStyle(a, 'ghost'),
                    width: 'auto',
                    borderColor:
                      s.method === method ? a.focusColor : a.borderColor,
                  }}
                >
                  {l.auth.credentialMethod(method)}
                </button>
              ))}
            </div>
          )}
          {!s.method && <p role="status">{l.auth.noMethodForIdentifier}</p>}
          {s.method === 'password' && (
            <>
              <form
                onSubmit={formSubmit(() =>
                  consume(actions.submitPassword(password)),
                )}
              >
                {field(
                  'password',
                  l.auth.password,
                  'password',
                  password,
                  setPassword,
                  {
                    autoComplete: 'current-password',
                    placeholder: l.auth.passwordPlaceholder,
                  },
                )}
                {button(
                  busy
                    ? l.auth.signInBusy
                    : (branding?.loginButtonText ?? l.auth.signIn),
                )}
              </form>
              {(onForgotPassword || forgotPasswordUrl) && (
                <p style={{ margin: '12px 0 0' }}>
                  {onForgotPassword ? (
                    <button
                      type="button"
                      onClick={onForgotPassword}
                      style={linkStyle(a)}
                    >
                      {l.auth.forgotPassword}
                    </button>
                  ) : (
                    <a href={forgotPasswordUrl} style={linkStyle(a)}>
                      {l.auth.forgotPassword}
                    </a>
                  )}
                </p>
              )}
            </>
          )}
          {(s.method === 'email_otp' || s.method === 'sms') && (
            <form
              onSubmit={formSubmit(() => consume(actions.verifyCode(code)))}
            >
              <label
                htmlFor={`${prefix}-readonly-identifier`}
                style={labelStyle(a)}
              >
                {s.method === 'sms' ? l.auth.phone : l.auth.email}
              </label>
              <input
                id={`${prefix}-readonly-identifier`}
                type={s.method === 'sms' ? 'tel' : 'email'}
                value={s.identifier}
                readOnly
                placeholder={
                  s.method === 'sms'
                    ? l.auth.phonePlaceholder
                    : l.auth.emailPlaceholder
                }
                style={{ ...inputStyle(a), marginBottom: 16 }}
              />
              {button(
                s.retryAfterSeconds
                  ? l.auth.resendIn(s.retryAfterSeconds)
                  : s.codeSent
                    ? l.auth.resend
                    : l.auth.sendCode,
                () => consume(actions.sendCode()),
                busy || s.retryAfterSeconds > 0,
              )}
              {s.codeSent && (
                <div style={{ marginTop: 16 }}>
                  {field(
                    'code',
                    l.auth.verificationCode,
                    'text',
                    code,
                    setCode,
                    {
                      autoComplete: 'one-time-code',
                      inputMode: 'numeric',
                      maxLength: 6,
                      placeholder: l.auth.verificationCodePlaceholder,
                    },
                  )}
                  {button(
                    busy
                      ? l.auth.verifying
                      : (branding?.loginButtonText ?? l.auth.signIn),
                    undefined,
                    busy || code.length < 4,
                  )}
                </div>
              )}
            </form>
          )}
          {s.method === 'magic_link' && (
            <form
              onSubmit={formSubmit(() =>
                consume(
                  magicCallback
                    ? actions.completeMagicLink(window.location.href)
                    : actions.sendMagicLink(),
                ),
              )}
            >
              <label htmlFor={`${prefix}-magic-email`} style={labelStyle(a)}>
                {l.auth.email}
              </label>
              <input
                id={`${prefix}-magic-email`}
                type="email"
                readOnly
                value={s.identifier}
                placeholder={l.auth.emailPlaceholder}
                style={{ ...inputStyle(a), marginBottom: 16 }}
              />
              {s.magicLinkSent && (
                <>
                  <h3 style={{ fontSize: 18, margin: '16px 0 12px' }}>
                    {l.signUp.checkEmail}
                  </h3>
                  <p role="status">{l.auth.magicLinkSent(s.identifier)}</p>
                </>
              )}
              {button(
                magicCallback
                  ? l.auth.signIn
                  : s.retryAfterSeconds
                    ? l.auth.resendIn(s.retryAfterSeconds)
                    : busy
                      ? l.auth.sendingMagicLink
                      : l.auth.sendMagicLink,
                undefined,
                busy || (!magicCallback && s.retryAfterSeconds > 0),
              )}
            </form>
          )}
          {resend}
          {providers}
        </>
      )}
      {s.step === 'mfa' && !s.completionPending && (
        <form
          onSubmit={formSubmit(() =>
            consume(actions.verifyMfa(code, mfaMethod)),
          )}
        >
          <p style={{ fontSize: 14, color: a.mutedTextColor }}>
            {l.auth.mfaDescription}
          </p>
          <select
            aria-label={l.connectedAccounts.credential}
            value={mfaMethod}
            onChange={(event) => {
              if (
                event.target.value === 'TOTP' ||
                event.target.value === 'RECOVERY_CODE'
              ) {
                setMfaMethod(event.target.value)
                setCode('')
              }
            }}
            style={{ ...inputStyle(a), marginBottom: 16 }}
          >
            {s.methods.map((method) => (
              <option key={method} value={method}>
                {l.connectedAccounts.credentialType(method)}
              </option>
            ))}
          </select>
          {field(
            'mfa',
            mfaMethod === 'TOTP'
              ? l.auth.authenticatorCode
              : l.connectedAccounts.credentialType('RECOVERY_CODE'),
            mfaMethod === 'TOTP' ? 'text' : 'password',
            code,
            setCode,
            {
              autoComplete: 'one-time-code',
              inputMode: mfaMethod === 'TOTP' ? 'numeric' : 'text',
              maxLength: mfaMethod === 'TOTP' ? 6 : 128,
            },
          )}
          {button(
            busy ? l.auth.verifying : l.auth.verify,
            undefined,
            busy ||
              (mfaMethod === 'TOTP' ? code.length !== 6 : code.length < 4),
          )}
          <button
            type="button"
            onClick={() => leave(actions.back)}
            style={{ ...linkStyle(a), marginTop: 16 }}
          >
            {l.auth.back}
          </button>
        </form>
      )}
      {canRegister && (
        <>
          {s.policy?.signupMode === 'INVITE_REQUIRED' && (
            <p style={{ fontSize: 14, color: a.mutedTextColor }}>
              {s.policy.allowedRegistrationGrantTypes.includes('ACCESS_CODE')
                ? l.signUp.invitationOrAccessCodeRequired
                : l.signUp.invitationRequired}
            </p>
          )}
          {s.capabilities?.methods.some(
            (x) => x.type === 'PASSWORD' && x.availableForSignup,
          ) && (
            <form
              onSubmit={formSubmit(() => {
                if (password !== confirmPassword) {
                  setValidation(l.signUp.passwordMismatch)
                  return
                }
                consume(
                  actions.signUp({
                    identifier: { kind: registrationKind, value: identifier },
                    password,
                    ...(acceptsAccessCode && accessCode.trim()
                      ? {
                          registrationGrant: {
                            type: 'ACCESS_CODE',
                            registrationAccessCode: accessCode,
                          } as const,
                        }
                      : {}),
                  }),
                )
              })}
            >
              <label htmlFor={`${prefix}-signup-kind`} style={labelStyle(a)}>
                {l.identity.kind}
              </label>
              <select
                id={`${prefix}-signup-kind`}
                value={registrationKind}
                onChange={(e) =>
                  setRegistrationKind(
                    e.target.value === 'USERNAME' ? 'USERNAME' : 'EMAIL',
                  )
                }
                style={inputStyle(a)}
              >
                <option value="EMAIL">{l.identity.EMAIL}</option>
                <option value="USERNAME">{l.identity.USERNAME}</option>
              </select>
              {field(
                'identifier',
                l.identity[registrationKind],
                registrationKind === 'EMAIL' ? 'email' : 'text',
                identifier,
                setIdentifier,
                {
                  autoComplete: 'username',
                  placeholder:
                    registrationKind === 'EMAIL'
                      ? l.signUp.emailPlaceholder
                      : l.signUp.usernamePlaceholder,
                },
              )}
              {acceptsAccessCode &&
                field(
                  'access-code',
                  requiresAccessCode
                    ? l.signUp.accessCodeRequired
                    : l.signUp.accessCodeOptional,
                  'text',
                  accessCode,
                  setAccessCode,
                  {
                    required: requiresAccessCode,
                    autoComplete: 'one-time-code',
                    placeholder: l.signUp.accessCodePlaceholder,
                  },
                )}
              {field(
                'new-password',
                l.signUp.password,
                'password',
                password,
                setPassword,
                {
                  autoComplete: 'new-password',
                  minLength: s.policy?.minPasswordLength,
                  placeholder: l.signUp.password,
                },
              )}
              {s.policy && (
                <p
                  style={{
                    fontSize: 12,
                    color: a.mutedTextColor,
                    margin: '-8px 0 16px',
                  }}
                >
                  {l.signUp.passwordRequirements(
                    s.policy.minPasswordLength,
                    s.policy,
                  )}
                </p>
              )}
              {field(
                'confirm-password',
                l.signUp.confirmPassword,
                'password',
                confirmPassword,
                setConfirmPassword,
                {
                  autoComplete: 'new-password',
                  placeholder: l.signUp.confirmPasswordPlaceholder,
                },
              )}
              {button(
                busy
                  ? l.signUp.creatingAccount
                  : (branding?.signupButtonText ?? l.signUp.createAccount),
              )}
            </form>
          )}
          {providers}
        </>
      )}
      {showIntentSwitch &&
        ['identifier', 'method', 'sign-up', 'unavailable'].includes(s.step) &&
        (s.intent === 'sign-up' ||
          (allowSignUp &&
            s.capabilities?.signupEnabled &&
            s.capabilities.selfRegistrationEnabled &&
            s.policy &&
            s.policy.signupMode !== 'DISABLED' &&
            (s.capabilities.methods.some(
              (method) =>
                method.type === 'PASSWORD' && method.availableForSignup,
            ) ||
              s.capabilities.idpProviders.some(
                (provider) => provider.availableForSignup,
              )))) && (
          <p style={{ margin: '24px 0 0', textAlign: 'center', fontSize: 14 }}>
            <span>
              {s.intent === 'sign-in' ? l.auth.noAccount : l.auth.haveAccount}
            </span>{' '}
            <button
              type="button"
              onClick={() =>
                leave(() =>
                  actions.setIntent(
                    s.intent === 'sign-in' ? 'sign-up' : 'sign-in',
                  ),
                )
              }
              style={{
                ...linkStyle(a),
                border: 0,
                background: 'transparent',
                padding: 0,
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              {s.intent === 'sign-in' ? l.auth.signUp : l.auth.signIn}
            </button>
          </p>
        )}
      {s.step === 'verification' && (
        <>
          {s.registrationCancelUnconfirmed && (
            <p role="alert">{l.identity.cancelUnconfirmed}</p>
          )}
          {s.registrationCancelUnconfirmed && textButton(l.identity.reopen, () =>
            consume(actions.resumeRegistration(s.registration.registrationId)),
          )}
          <p role="status">
            {s.registration.status === 'COMPLETED'
              ? l.identity.registrationComplete
              : registrationExpired ? l.identity.EXPIRED : s.registration.status === 'PENDING_VERIFICATION'
                ? l.identity.registrationPending
                : l.identity.restart}
          </p>
          {s.registration.status === 'PENDING_VERIFICATION' && !registrationExpired && (
            <>
              {s.verificationEmail && <p style={{ color: a.mutedTextColor, overflowWrap: 'anywhere' }}>{s.verificationEmail}</p>}
              <form
                onSubmit={formSubmit(() =>
                  consume(actions.completeRegistration(code)),
                )}
              >
                {field(
                  'registration-code',
                  l.auth.verificationCode,
                  'text',
                  code,
                  setCode,
                  {
                    autoComplete: 'one-time-code',
                    inputMode: 'numeric',
                    maxLength: 6,
                    disabled: busy || s.registrationCancelUnconfirmed,
                  },
                )}
                {button(
                  l.identity.verifyRegistration,
                  undefined,
                  busy || s.registrationCancelUnconfirmed ||
                    (mfaMethod === 'TOTP'
                      ? code.length !== 6
                      : code.length < 4),
                )}
              </form>
              {resend}
              <div style={{ textAlign: 'center' }}>{textButton(l.identity.cancelRegistration, () =>
                consume(actions.cancelRegistration()),
                busy, true,
              )}</div>
            </>
          )}
          {(s.registration.status !== 'PENDING_VERIFICATION' || registrationExpired) && !s.registrationCancelUnconfirmed && <button
            type="button"
            onClick={() =>
              leave(() =>
                actions.setIntent(
                  s.registration.status === 'COMPLETED' ? 'sign-in' : 'sign-up',
                ),
              )
            }
            style={linkStyle(a)}
          >
            {s.registration.status === 'COMPLETED'
              ? l.auth.signIn
              : l.identity.restartRegistration}
          </button>}
        </>
      )}
      {s.step === 'success' && (
        <p role="status">{l.auth.signedInAs(s.user.email ?? '')}</p>
      )}
      {error && (
        <p
          id={`${prefix}-error`}
          role="alert"
          style={{ ...errorStyle(a), lineHeight: 1.5 }}
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ fontSize: 13, color: a.successColor }}>
          {notice}
        </p>
      )}
    </div>
  )
}
