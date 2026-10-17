import { useEffect, useRef, useState } from 'react'
import { useAuthFlow } from '@axis-iam/vertex-react'
import type { AuthFlowState, UseAuthFlowOptions } from '@axis-iam/vertex-react'
import { SessionInvalidatedError } from '@axis-iam/vertex'

/** Render inside IamProvider. Direct Auth is an explicit application choice. */
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
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  // Changing the step remounts the secret input and clears the host-owned value.
  const [revision, setRevision] = useState(0)
  const leave = (action: () => void) => {
    attempt.current++
    setRevision((value) => value + 1)
    setSecret('')
    setConfirm('')
    action()
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
  if (state.step === 'unavailable') return <p role="status">Authentication is unavailable.</p>
  const submit = () => {
    if (state.step === 'identifier') leave(() => actions.continueWithIdentifier(identifier))
    else if (state.step === 'method' && state.method === 'password') consume(actions.submitPassword(secret))
    else if (state.step === 'method' && state.codeSent) consume(actions.verifyCode(secret))
    else if (state.step === 'mfa') consume(actions.verifyMfa(secret))
    else if (state.step === 'sign-up' && secret === confirm)
      consume(actions.signUp({ email: identifier, password: secret }))
  }
  return (
    <section aria-label="Custom authentication">
      <h2>{state.intent === 'sign-up' ? 'Create account' : 'Sign in'}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {(state.step === 'identifier' || state.step === 'sign-up') && (
          <label>
            Email or phone
            <input
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              required
            />
          </label>
        )}
        {needsSecret(state) && (
          <label key={`${state.step}:${revision}`}>
            {state.step === 'mfa'
              ? 'Authenticator code'
              : state.step === 'method' && state.method !== 'password'
                ? 'Verification code'
                : 'Password'}
            <input
              type={
                state.step === 'sign-up' || (state.step === 'method' && state.method === 'password')
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
            disabled={state.pending !== null || state.retryAfterSeconds > 0}
            onClick={() => consume(actions.sendMagicLink())}
          >
            Send sign-in link
          </button>
        )}
        {(state.step === 'identifier' || needsSecret(state)) && (
          <button disabled={state.pending !== null || (state.step === 'sign-up' && secret !== confirm)}>
            {state.pending ? 'Working…' : 'Continue'}
          </button>
        )}
      </form>
      {state.step === 'verification' && (
        <p role="status">
          Account created.{' '}
          {state.result.verificationMode === 'REQUIRED'
            ? 'Verify your email before signing in.'
            : 'You can now sign in.'}
        </p>
      )}
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
