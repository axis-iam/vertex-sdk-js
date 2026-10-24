import { useEffect, useRef, useState } from 'react'
import { useAuthFlow } from '@axis-iam/vertex-react'
import type { AuthFlowState, UseAuthFlowOptions } from '@axis-iam/vertex-react'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import type { LoginIdentifier } from '@axis-iam/vertex'

/** Render inside IamProvider. Primary authentication uses a controlled transaction. */
export function CustomAuth(options: UseAuthFlowOptions) {
  const { state, actions } = useAuthFlow(options)
  const mounted = useRef(true)
  const attempt = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      attempt.current++
    }
  }, [])
  const [identifier, setIdentifier] = useState('')
  const [selectedKind, setSelectedKind] = useState<LoginIdentifier['kind'] | null>(null)
  const [alternativesOpen, setAlternativesOpen] = useState(false)
  const identifierInput = useRef<HTMLInputElement>(null)
  const alternativesTrigger = useRef<HTMLButtonElement>(null)
  const kinds = state.capabilities?.identifierMethods ?? []
  const kind = selectedKind && kinds.some(entry => entry.kind === selectedKind)
    ? selectedKind : state.capabilities?.defaultIdentifierKind ?? null
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mfaMethod, setMfaMethod] = useState<'TOTP' | 'RECOVERY_CODE'>('TOTP')
  const magicCallback = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.hash.slice(1)).get('kind') === 'AUTH_PROOF'
  // Changing the step remounts the secret input and clears the host-owned value.
  const [revision, setRevision] = useState(0)
  const leave = (action: () => void | Promise<void>) => {
    attempt.current++
    setRevision((value) => value + 1)
    setSecret('')
    setConfirm('')
    const result = action()
    if (result) consume(result)
  }
  const consume = (promise: Promise<unknown>) => {
    setSecret('')
    setConfirm('')
    void promise.catch((error) => {
      if (error instanceof SessionInvalidatedError) return
      // Typed failures are already in state.error and delivered to options.onError.
    })
  }
  if (state.step === 'loading') return <p role="status">Loading authentication options…</p>
  if (state.step === 'unavailable') return <section><p role="status">Authentication is unavailable.</p><button onClick={() => consume(actions.retryOptions())}>Retry</button></section>
  const submit = () => {
    if (state.step === 'identifier' && kind) leave(() => actions.continueWithIdentifier({ kind, value: identifier }))
    else if (state.step === 'method' && state.method === 'password') consume(actions.submitPassword(secret))
    else if (state.step === 'method' && state.codeSent) consume(actions.verifyCode(secret))
    else if (state.step === 'mfa') consume(actions.verifyMfa(secret,mfaMethod))
    else if (state.step === 'sign-up' && secret === confirm)
      consume(actions.signUp({ identifier: { kind: 'EMAIL', value: identifier }, password: secret }))
  }
  return (
    <section aria-label="Custom authentication">
      <h2>{state.intent === 'sign-up' ? 'Create account' : 'Sign in'}</h2>
      {state.step==='identifier' && typeof window!=='undefined' && (new URLSearchParams(window.location.search).has('kind') || new URLSearchParams(window.location.search).has('code')) && <button onClick={()=>consume(actions.resumeProviderCallback(window.location.href))}>Continue provider sign-in</button>}
      {state.completionPending && <button onClick={() => consume(actions.retryCompletion())}>Retry completion</button>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {((state.step === 'identifier' && kind) || state.step === 'sign-up') && (
          <label>
            {state.step === 'sign-up' || kind === 'EMAIL' ? 'Email' : kind === 'PHONE' ? 'Phone number' : 'Username'}
            <input
              ref={identifierInput}
              type={state.step === 'sign-up' || kind === 'EMAIL' ? 'email' : kind === 'PHONE' ? 'tel' : 'text'}
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              required
            />
          </label>
        )}
        {state.step === 'mfa' && (
          <select aria-label="MFA method" value={mfaMethod} onChange={event=>{
            if(event.target.value==='TOTP'||event.target.value==='RECOVERY_CODE'){
              setMfaMethod(event.target.value)
              setSecret('')
            }
          }}>
            <option value="TOTP">Authenticator</option>
            <option value="RECOVERY_CODE">Recovery code</option>
          </select>
        )}
        {needsSecret(state) && (
          <label key={`${state.step}:${revision}`}>
            {state.step === 'mfa'
              ? mfaMethod==='TOTP'?'Authenticator code':'Recovery code'
              : state.step === 'method' && state.method !== 'password'
                ? 'Verification code'
                : 'Password'}
            <input
              type={
                state.step === 'sign-up' || (state.step === 'mfa' && mfaMethod==='RECOVERY_CODE') || (state.step === 'method' && state.method === 'password')
                  ? 'password'
                  : 'text'
              }
              autoComplete={
                state.step === 'sign-up'
                  ? 'new-password'
                  : state.step === 'mfa' || (state.step === 'method' && state.method !== 'password')
                    ? 'one-time-code'
                    : 'current-password'
              }
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              required
            />
          </label>
        )}
        {state.step === 'sign-up' && (
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </label>
        )}
        {state.step === 'sign-up' && (
          <p>
            At least {state.policy?.minPasswordLength} characters. Follow the application’s uppercase,
            lowercase, digit and symbol requirements.
          </p>
        )}
        {state.step === 'method' && (
          <div>
            {state.methods.map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={state.method === method}
                onClick={() => leave(() => actions.selectMethod(method))}
              >
                {method}
              </button>
            ))}
          </div>
        )}
        {state.step === 'method' && (state.method === 'email_otp' || state.method === 'sms') && (
          <button
            type="button"
            disabled={state.pending !== null || state.retryAfterSeconds > 0}
            onClick={() => consume(actions.sendCode())}
          >
            {state.retryAfterSeconds ? `Resend in ${state.retryAfterSeconds}s` : 'Send code'}
          </button>
        )}
        {state.step === 'method' && state.method === 'magic_link' && (
          <button
            type="button"
            disabled={state.pending !== null || (!magicCallback && state.retryAfterSeconds > 0)}
            onClick={() => consume(magicCallback ? actions.completeMagicLink(window.location.href) : actions.sendMagicLink())}
          >
            {magicCallback?'Complete sign-in link':'Send sign-in link'}
          </button>
        )}
        {((state.step === 'identifier' && kind) || needsSecret(state)) && (
          <button disabled={state.pending !== null || (state.step === 'sign-up' && secret !== confirm)}>
            {state.pending ? 'Working…' : 'Continue'}
          </button>
        )}
      </form>
      {state.step === 'identifier' && kind && kinds.length > 1 && <>
        <button ref={alternativesTrigger} aria-expanded={alternativesOpen} onClick={() => setAlternativesOpen(open => !open)}>
          Use another sign-in method
        </button>
        {alternativesOpen && <div onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setAlternativesOpen(false)
            alternativesTrigger.current?.focus()
          }
        }}>
          {kinds.filter(entry => entry.kind !== kind).map(entry => <button key={entry.kind} onClick={() => {
            setSelectedKind(entry.kind)
            setIdentifier('')
            setSecret('')
            setConfirm('')
            setAlternativesOpen(false)
            identifierInput.current?.focus()
          }}>
            Sign in with {entry.kind === 'EMAIL' ? 'email' : entry.kind === 'PHONE' ? 'phone number' : 'username'}
          </button>)}
        </div>}
      </>}
      {state.step === 'verification' && (
        <p role="status">
          {state.registration.status === 'COMPLETED' ? 'Registration completed. Sign in to continue.' : 'Verify your email to create your account.'}
        </p>
      )}
      {state.step === 'verification' && state.registration.status === 'PENDING_VERIFICATION' && <>
        <label>Registration code<input value={secret} onChange={e => setSecret(e.target.value)} autoComplete="one-time-code" /></label>
        <button onClick={() => consume(actions.completeRegistration(secret))}>Complete registration</button>
        <button onClick={() => consume(actions.cancelRegistration())}>Cancel registration</button>
      </>}
      {state.verificationEmail && (
        <button
          disabled={state.pending !== null || state.retryAfterSeconds > 0}
          onClick={() => consume(actions.resendVerification())}
        >
          Resend verification email {state.retryAfterSeconds || ''}
        </button>
      )}
      {state.step === 'success' && <p role="status">Signed in.</p>}
      {state.error && <p role="alert">{state.error.name}: Please check your details and try again.</p>}
      {state.providers.map((provider) => (
        <button
          key={provider.id}
          disabled={state.pending !== null}
          onClick={() => {
            const owner = attempt.current
            void actions
              .startProvider(provider.id)
              .then((url) => {
                if (mounted.current && attempt.current === owner) window.location.assign(url)
              })
              .catch((error) => {
                if (error instanceof SessionInvalidatedError) return
              })
          }}
        >
          Continue with {provider.displayName}
        </button>
      ))}
      <button onClick={() => leave(actions.back)}>Back</button>
      <button onClick={() => leave(actions.cancel)}>Cancel</button>
      <button
        onClick={() => leave(() => actions.setIntent(state.intent === 'sign-in' ? 'sign-up' : 'sign-in'))}
      >
        Switch to {state.intent === 'sign-in' ? 'registration' : 'sign in'}
      </button>
    </section>
  )
}
function needsSecret(state: AuthFlowState) {
  return (
    state.step === 'sign-up' ||
    state.step === 'mfa' ||
    (state.step === 'method' && (state.method === 'password' || state.codeSent))
  )
}
