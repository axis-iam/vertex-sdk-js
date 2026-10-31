import type { LoginIdentifier, MfaProofMethod } from '@axis-iam/vertex'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { useIamUi } from '../../provider/IamUiProvider'
import { localizeError } from '../../localization'
import type { AuthCredentialMethod, UseAuthFlowResult } from '../../core/auth-flow-types'
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
import { getAvailableCredentialMethods } from './sign-in-flow'
import { hasLocalRegistration } from '../../core/auth-flow-client'
import { PhoneIdentifierInput } from './PhoneIdentifierInput'
import { normalizePhoneIdentifier, PhoneIdentifierError } from './phone-identifier'
import { AuthProviderWindow } from '../../core/auth-provider-window'
import { useIamContext } from '../../provider/IamProvider'

export function AuthFlowForm({
  flow,
  appearance: a,
  renderProviderButton,
  providerNavigation = 'redirect',
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
  providerNavigation?: 'redirect' | 'popup'
  onForgotPassword?: () => void
  forgotPasswordUrl?: string
  showIntentSwitch?: boolean
  allowSignUp?: boolean
  branding?: BrandingConfig | null
  registrationGrant?: RegistrationGrantInput
}) {
  const { state: s, actions } = flow
  const { localization: l, locale } = useIamUi()
  const { client } = useIamContext()
  const providerPopup = useMemo(() => new AuthProviderWindow(client.config.redirectUri), [client])
  const [providerWindowStarted, setProviderWindowStarted] = useState(false)
  useEffect(() => () => providerPopup.close(), [providerPopup])
  const prefix = useId()
  const root = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const [identifier, setIdentifier] = useState('')
  const [selectedKind, setKind] = useState<LoginIdentifier['kind'] | null>(null)
  const kinds = s.capabilities?.identifierMethods ?? []
  const kind = selectedKind && kinds.some((entry) => entry.kind === selectedKind)
    ? selectedKind : s.capabilities?.defaultIdentifierKind ?? null
  const previousKind = useRef(kind)
  const [selectedMethod, setSelectedMethod] = useState<AuthCredentialMethod | null>(null)
  const methods = s.capabilities && kind ? getAvailableCredentialMethods(s.capabilities, kind === 'EMAIL' ? 'email' : kind === 'PHONE' ? 'phone' : 'username').map(m => m.id) : []
  const credential = selectedMethod && methods.includes(selectedMethod) ? selectedMethod : methods[0] ?? null
  const signupKinds = s.capabilities?.allowedSignupIdentifierKinds ?? []
  const [selectedRegistrationKind, setRegistrationKind] = useState<'EMAIL' | 'USERNAME' | null>(null)
  const registrationKind = selectedRegistrationKind && signupKinds.includes(selectedRegistrationKind) ? selectedRegistrationKind : signupKinds[0] ?? null
  const [region, setRegion] = useState('')
  const typedIdentifier = (): LoginIdentifier => {
    if (kind === null) throw new Error('Identifier capability is unavailable')
    if (kind === 'PHONE') return { kind, value: normalizePhoneIdentifier(identifier, region || undefined, s.capabilities?.identifierRestrictions.login.phone.allowedRegions).e164 }
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
    setKind(null); setIdentifier(''); setRegion(''); setSelectedMethod(null)
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
  const clearProofs = () => { setPassword(''); setConfirmPassword(''); setCode(''); setValidation(null); setNotice(null) }
  const segments = <T extends string,>(items: readonly T[], active: T | null, choose: (value: T) => void, label: (value: T) => string, name: string) => (
    <div role="group" aria-label={name} className="axis-auth-segments" style={{ display: 'flex', gap: 4, padding: 4, background: a.subtleColor, borderRadius: a.borderRadius, marginBottom: 16 }}>
      {items.map(value => <button key={value} type="button" aria-pressed={active === value} disabled={busy}
        onClick={() => choose(value)} onKeyDown={event => { if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return; event.preventDefault(); const i = items.indexOf(value); const next = items[(i + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]!; choose(next); const buttons = event.currentTarget.parentElement?.querySelectorAll('button'); buttons?.[items.indexOf(next)]?.focus() }}
        style={{ flex: '1 1 0', minWidth: 0, minHeight: 44, padding: '8px 6px', borderRadius: a.borderRadius, border: `1px solid ${active === value ? a.borderColor : 'transparent'}`, background: active === value ? a.backgroundColor : 'transparent', color: active === value ? a.textColor : a.mutedTextColor, fontSize: 14, fontWeight: active === value ? 600 : 400, cursor: 'pointer' }}>{label(value)}</button>)}
    </div>
  )
  const challengeExpired = s.challengeExpiresAt !== null && Date.parse(s.challengeExpiresAt) <= Date.now()
  useEffect(() => {
    if (!s.challengeExpiresAt || challengeExpired) return
    const timer = setTimeout(() => { setCode(''); updateDeadline(value => value + 1) }, Math.min(Date.parse(s.challengeExpiresAt) - Date.now(), 2147483647))
    return () => clearTimeout(timer)
  }, [s.challengeExpiresAt, challengeExpired])
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
            const authorize = () => actions.startProvider(provider.id, s.intent === 'sign-up' && acceptsAccessCode && accessCode.trim() ? { type: 'ACCESS_CODE', registrationAccessCode: accessCode } : undefined)
            if (providerNavigation === 'popup') {
              await providerPopup.start(authorize)
              if (mounted.current) setProviderWindowStarted(true)
              return
            }
            const url = await authorize()
            if (mounted.current && ownership.current.revision === revision)
              window.location.href = url
          } catch (error) {
            if (error instanceof SessionInvalidatedError) return
            if (mounted.current) setValidation(localizeError(error, l, 'signInFailed'))
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
      {providerWindowStarted && <button type="button" disabled={busy} style={buttonStyle(a, 'ghost')} onClick={() => {
        try {
          const callback = providerPopup.callback()
          void actions.resumeProviderCallback(callback).then(() => {
            providerPopup.close(); if (mounted.current) setProviderWindowStarted(false)
          }).catch(error => { if (mounted.current) setValidation(localizeError(error, l, 'signInFailed')) })
        } catch (error) { setValidation(localizeError(error, l, 'signInFailed')) }
      }}>{l.invitation.loginCompleted}</button>}
      {s.step === 'unavailable' && (
        <div><p role="status">
          {s.intent === 'sign-up'
            ? l.signUp.unavailable
            : s.error
              ? l.auth.optionsUnavailable
              : l.auth.noMethodAvailable}
        </p>{textButton(l.identity.retry, () => consume(actions.retryOptions()))}</div>
      )}
      {s.step === 'identifier' && providerCallback && (
        <div>{button(l.auth.continue, () => consume(actions.resumeProviderCallback(window.location.href)))}</div>
      )}
      {s.completionPending && <div>{button(l.identity.retry, () => consume(actions.retryCompletion()))}{textButton(l.auth.back, () => leave(actions.cancel))}</div>}
      {((s.step === 'identifier' && !providerCallback) || (s.step === 'method' && !s.completionPending)) && <>
        {kind !== null && (s.step !== 'method' || (!s.codeSent && !s.magicLinkSent)) && <form onSubmit={formSubmit(() => sync(() => {
          const value = typedIdentifier()
          if (s.step !== 'method' || s.loginIdentifier.kind !== value.kind || s.loginIdentifier.value !== value.value) {
            actions.continueWithIdentifier(value)
          }
          if (credential) actions.selectMethod(credential)
          if (credential === 'password') consume(actions.submitPassword(password))
          else if (credential === 'magic_link') consume(magicCallback ? actions.completeMagicLink(window.location.href) : actions.sendMagicLink())
          else consume(actions.sendCode())
        }))}>
          {kinds.length > 1 && segments(kinds.map(entry => entry.kind), kind, next => {
            const switchKind = () => { setKind(next); setIdentifier(''); setRegion(''); setSelectedMethod(null); clearProofs() }
            if (s.step === 'method') consume(actions.back(), switchKind)
            else switchKind()
          }, entry => l.identity[entry], l.identity.kind)}
          {kind === 'PHONE' ? <PhoneIdentifierInput allowedRegions={s.capabilities?.identifierRestrictions.login.phone.allowedRegions} appearance={a} locale={locale} prefix={prefix} value={identifier} country={region}
            onValueChange={value => { setIdentifier(value); setValidation(null) }} onCountryChange={value => { setRegion(value); setValidation(null) }}
            labels={{ country: l.identity.phoneCountry, chooseCountry: l.identity.choosePhoneCountry, number: l.identity.phoneNumber }} disabled={busy} error={validation} />
            : field('identifier', l.identity[kind], kind === 'EMAIL' ? 'email' : 'text', identifier, setIdentifier, { autoComplete: 'username', disabled: busy, placeholder: kind === 'EMAIL' ? l.auth.emailPlaceholder : l.signUp.usernamePlaceholder })}
          {methods.length > 1 && segments(methods, credential, next => { setSelectedMethod(next); clearProofs(); if (s.step === 'method') actions.selectMethod(next) }, method => l.auth.credentialMethod(method), l.connectedAccounts.credential)}
          {credential === 'password' && field('password', l.auth.password, 'password', password, setPassword, { autoComplete: 'current-password', placeholder: l.auth.passwordPlaceholder, disabled: busy })}
          {credential && button(busy ? l.auth.signInBusy : credential === 'password' ? (branding?.loginButtonText ?? l.auth.signIn) : credential === 'magic_link' ? magicCallback ? l.auth.signIn : l.auth.sendMagicLink : l.auth.sendCode, undefined, busy || s.cancellationUnconfirmed || (credential !== 'password' && s.retryAfterSeconds > 0))}
          {credential === 'password' && (onForgotPassword || forgotPasswordUrl) && <p style={{ margin: '12px 0 0' }}>{onForgotPassword ? textButton(l.auth.forgotPassword, onForgotPassword) : <a href={forgotPasswordUrl} style={linkStyle(a)}>{l.auth.forgotPassword}</a>}</p>}
        </form>}
        {s.step === 'method' && !s.codeSent && !s.magicLinkSent && textButton(l.auth.change, () => consume(actions.back(), clearProofs), false)}
        {s.step === 'method' && (s.codeSent || s.magicLinkSent) && <div>
          <p style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{l.auth.signingInAs(s.identifier)}</p>
          {s.magicLinkSent ? <>
            <h3 style={{ fontSize: 18, margin: '16px 0 12px' }}>{l.signUp.checkEmail}</h3>
            <p role="status">{l.auth.magicLinkSent(s.identifier)}</p>
            {magicCallback && button(l.auth.signIn, () => consume(actions.completeMagicLink(window.location.href)))}
          </> : <form onSubmit={formSubmit(() => consume(actions.verifyCode(code)))}>
            {field('code', l.auth.verificationCode, 'text', code, setCode, { autoComplete: 'one-time-code', inputMode: 'numeric', maxLength: 6, placeholder: l.auth.verificationCodePlaceholder, disabled: busy || challengeExpired })}
            {button(busy ? l.auth.verifying : l.auth.verify, undefined, busy || challengeExpired || code.length < 4)}
          </form>}
          {challengeExpired && <p role="status">{l.auth.challengeExpired}</p>}
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {textButton(l.auth.change, () => consume(actions.back(), () => { setIdentifier(s.identifier); clearProofs() }))}
            {s.retryAfterSeconds > 0 ? <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>{l.auth.resendIn(s.retryAfterSeconds)}</span> : textButton(l.auth.resend, () => consume(s.magicLinkSent ? actions.sendMagicLink() : actions.sendCode()))}
          </div>
          {textButton(l.auth.back, () => consume(actions.back(), clearProofs), busy, true)}
        </div>}
        {resend}
        {providers}
      </>}
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
          {registrationKind !== null && s.capabilities && hasLocalRegistration(s.capabilities, registrationKind) && (
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
              {signupKinds.length > 1 && segments(signupKinds, registrationKind, next => { setRegistrationKind(next); setIdentifier(''); clearProofs() }, entry => l.identity[entry], l.identity.kind)}
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
            (hasLocalRegistration(s.capabilities) ||
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
