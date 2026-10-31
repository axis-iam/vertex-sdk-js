import { useEffect, useMemo, useState } from 'react'
import { AuthProviderWindow, useAuthFlow, phoneCountries, parsePhoneIdentifier, normalizePhoneIdentifier } from '@axis-iam/vertex-react'
import type { AuthCredentialMethod, UseAuthFlowOptions } from '@axis-iam/vertex-react'
import type { LoginIdentifier, SignupIdentifierKind } from '@axis-iam/vertex'

/** Host-owned markup. Capabilities, transactions and signup gates remain authoritative. */
export function CustomAuth(options: UseAuthFlowOptions & { providerPopupRedirectUri?: string }) {
  const { state: s, actions } = useAuthFlow(options)
  const [identifier, setIdentifier] = useState('')
  const [country, setCountry] = useState('')
  const [selectedKind, setKind] = useState<LoginIdentifier['kind'] | null>(null)
  const [signupKind, setSignupKind] = useState<SignupIdentifierKind | null>(null)
  const [selectedMethod, setMethod] = useState<AuthCredentialMethod | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [providerPending, setProviderPending] = useState(false)
  const providerPopup = useMemo(() => options.providerPopupRedirectUri ? new AuthProviderWindow(options.providerPopupRedirectUri) : null, [options.providerPopupRedirectUri])
  useEffect(() => () => providerPopup?.close(), [providerPopup])
  const kinds = s.capabilities?.identifierMethods ?? []
  const kind = selectedKind ?? s.capabilities?.defaultIdentifierKind ?? null
  const registrationKinds = s.capabilities?.allowedSignupIdentifierKinds ?? []
  const registrationKind = signupKind ?? registrationKinds[0] ?? null
  const methods = kinds.find(entry => entry.kind === kind)?.methods.map(method =>
    method === 'PASSWORD' ? 'password' : method === 'EMAIL_OTP' ? 'email_otp' : method === 'EMAIL_MAGIC_LINK' ? 'magic_link' : 'sms') ?? []
  const method = selectedMethod ?? methods[0] ?? null
  const busy = s.pending !== null
  const waiting = s.step === 'method' && (s.codeSent || s.magicLinkSent)
  const clearProof = () => { setPassword(''); setCode(''); setLocalError(null) }
  useEffect(() => { setIdentifier(''); setCountry(''); setKind(null); setSignupKind(null); setMethod(null); setPassword(''); setCode(''); setLocalError(null) }, [s.intent, s.capabilities])
  const run = (promise: Promise<unknown>) => { void promise.catch(() => { /* Public state.error carries typed failures. */ }).finally(() => setPassword('')) }
  const submit = () => {
    try {
      setLocalError(null)
      if (s.step === 'sign-up' && registrationKind) {
        run(actions.signUp({ identifier: { kind: registrationKind, value: identifier }, password }))
      } else if (s.step === 'mfa') run(actions.verifyMfa(code))
      else if (s.step === 'verification') run(actions.completeRegistration(code))
      else if (s.step === 'method' && s.codeSent) run(actions.verifyCode(code))
      else if (kind && method) {
        const value: LoginIdentifier = kind === 'PHONE' ? { kind, value: normalizePhoneIdentifier(identifier, country || undefined, s.capabilities?.identifierRestrictions.login.phone.allowedRegions).e164 } : { kind, value: identifier }
        if (s.step === 'identifier' || (s.step === 'method' && s.identifier !== value.value)) actions.continueWithIdentifier(value)
        actions.selectMethod(method)
        run(method === 'password' ? actions.submitPassword(password) : method === 'magic_link' ? actions.sendMagicLink() : actions.sendCode())
      }
    } catch (error) { setLocalError(error instanceof Error ? error.message : 'Authentication could not continue') }
  }
  const canSignup = s.capabilities?.signupEnabled && s.capabilities.selfRegistrationEnabled && s.policy?.signupMode !== 'DISABLED' &&
    (registrationKinds.length > 0 || s.providers.some(provider => provider.availableForSignup))
  if (s.step === 'loading') return <p role="status">Loading authentication options...</p>
  if (s.step === 'success') return <p role="status">Signed in.</p>
  return <section aria-label="Custom authentication">
    <h2>{s.intent === 'sign-up' ? 'Create account' : 'Sign in'}</h2>
    {s.step === 'unavailable' ? <><p role="status">Authentication is unavailable.</p><button onClick={() => run(actions.retryOptions())}>Retry</button></> : <>
      {s.completionPending && <button onClick={() => run(actions.retryCompletion())}>Retry completion</button>}
      {!waiting && (s.step === 'identifier' || s.step === 'method') && kinds.length > 1 && <div role="group" aria-label="Identifier kind">{kinds.map(entry => <button key={entry.kind} aria-pressed={kind === entry.kind} disabled={busy} onClick={() => { if (s.step === 'method') run(actions.back()); setKind(entry.kind); setIdentifier(''); setCountry(''); setMethod(null); clearProof() }}>{entry.kind}</button>)}</div>}
      {s.step === 'sign-up' && registrationKinds.length > 1 && <div role="group" aria-label="Signup identifier">{registrationKinds.map(value => <button key={value} disabled={busy} aria-pressed={registrationKind === value} onClick={() => { setSignupKind(value); setIdentifier(''); clearProof() }}>{value}</button>)}</div>}
      {((!waiting && (s.step === 'identifier' || s.step === 'method') && kind) || (s.step === 'sign-up' && registrationKind)) && <form onSubmit={event => { event.preventDefault(); submit() }}>
        {s.intent === 'sign-in' && kind === 'PHONE' && <label>Country / region<select value={country} onChange={event => { setCountry(event.target.value); setIdentifier(''); setLocalError(null) }}><option value="">Choose country / region</option>{phoneCountries('en', s.capabilities?.identifierRestrictions.login.phone.allowedRegions).map(option => <option key={option.code} value={option.code}>{option.name} {option.callingCode}</option>)}</select></label>}
        <label>{s.intent === 'sign-up' ? registrationKind : kind}<input autoComplete="username" type={(s.intent === 'sign-up' ? registrationKind : kind) === 'EMAIL' ? 'email' : 'text'} value={identifier} onChange={event => { const value = event.target.value; if (s.intent === 'sign-in' && kind === 'PHONE' && value.trim().startsWith('+')) { const parsed = parsePhoneIdentifier(value); setCountry(parsed?.country ?? ''); setIdentifier(parsed?.nationalNumber ?? value) } else setIdentifier(value) }} required /></label>
        {s.intent === 'sign-in' && methods.length > 1 && <div role="group" aria-label="Credential method">{methods.map(value => <button key={value} type="button" disabled={busy} aria-pressed={method === value} onClick={() => { setMethod(value); clearProof(); if (s.step === 'method') actions.selectMethod(value) }}>{value}</button>)}</div>}
        {(s.intent === 'sign-up' || method === 'password') && <label>Password<input type="password" autoComplete={s.intent === 'sign-up' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} required /></label>}
        <button disabled={busy || s.retryAfterSeconds > 0}>{busy ? 'Working...' : s.intent === 'sign-up' ? 'Create account' : method === 'password' ? 'Sign in' : method === 'magic_link' ? 'Send sign-in link' : 'Send code'}</button>
      </form>}
      {(s.step === 'mfa' || (s.step === 'method' && s.codeSent) || (s.step === 'verification' && s.registration.status === 'PENDING_VERIFICATION')) && <form onSubmit={event => { event.preventDefault(); submit() }}><label>Verification code<input value={code} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" required /></label><button disabled={busy || s.registrationCancelUnconfirmed}>Verify</button></form>}
      {s.step === 'method' && s.magicLinkSent && <p role="status">Check your inbox. The actual link callback completes this step.</p>}
      {waiting && <><p>{s.identifier}</p><button disabled={busy} onClick={() => { clearProof(); run(actions.back()) }}>Change identifier</button><button disabled={busy || s.retryAfterSeconds > 0} onClick={() => run(s.magicLinkSent ? actions.sendMagicLink() : actions.sendCode())}>{s.retryAfterSeconds ? `Resend in ${s.retryAfterSeconds}s` : 'Resend'}</button></>}
      {s.step === 'verification' && <><p role="status">{s.registration.status}</p>{s.registration.status === 'PENDING_VERIFICATION' && <><button disabled={busy || s.retryAfterSeconds > 0 || s.registrationCancelUnconfirmed} onClick={() => run(actions.resendVerification())}>Resend</button><button disabled={busy} onClick={() => run(actions.cancelRegistration())}>Cancel registration</button></>}{s.registrationCancelUnconfirmed && <button onClick={() => run(actions.resumeRegistration(s.registration.registrationId))}>Refresh status</button>}</>}
      {s.providers.map(provider => <button key={provider.id} disabled={busy} onClick={() => {
        const work = providerPopup ? providerPopup.start(() => actions.startProvider(provider.id)).then(() => setProviderPending(true))
          : actions.startProvider(provider.id).then(url => window.location.assign(url))
        void work.catch(() => setLocalError('Provider sign-in could not open. Check the browser popup setting.'))
      }}>Continue with {provider.displayName}</button>)}
      {providerPending && providerPopup && <button disabled={busy} onClick={() => {
        try { run(actions.resumeProviderCallback(providerPopup.callback()).then(() => { providerPopup.close(); setProviderPending(false) })) }
        catch { setLocalError('Provider has not returned to the registered callback.') }
      }}>I have signed in</button>}
    </>}
    {(s.intent === 'sign-up' || canSignup) && ['identifier', 'method', 'unavailable', 'sign-up'].includes(s.step) && <button disabled={busy} onClick={() => { clearProof(); run(actions.setIntent(s.intent === 'sign-in' ? 'sign-up' : 'sign-in')) }}>{s.intent === 'sign-in' ? 'Create account' : 'Sign in instead'}</button>}
    {(s.error || localError) && <p role="alert">{localError ?? 'Authentication could not continue. Check your details and retry.'}</p>}
  </section>
}
