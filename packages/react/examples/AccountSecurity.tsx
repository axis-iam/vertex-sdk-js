import { useEffect, useState } from 'react'
import {
  AccountCenter, AccountSecurityDialog, AccountSecurityPanel, IamProvider,
  useAccountSecurity, useAuth,
} from '@axis-iam/vertex-react'
import type { IamConfig, IamColorScheme, MfaProofOption, UseAccountSecurityResult } from '@axis-iam/vertex-react'
import { CookieSessionTransport } from '@axis-iam/vertex'

/** Use the application's real public client, issuer and registered callback values. */
export function OAuthAccountSettings({ config }: { config: IamConfig }) {
  return <IamProvider {...config} sessionMode="oauth_tokens"><SecurityEntries /></IamProvider>
}

/** The BFF must implement the finite SessionTransport contract and own its HttpOnly cookie. */
export function BffAccountSettings({ config }: { config: IamConfig }) {
  const [transport] = useState(() => new CookieSessionTransport({ origin: window.location.origin }))
  return <IamProvider {...config} sessionMode="server_session" sessionTransport={transport}>
    <SecurityEntries />
  </IamProvider>
}

function SecurityEntries() {
  const [center, setCenter] = useState(false), [dialog, setDialog] = useState(false)
  return <>
    <button onClick={() => setCenter(true)}>Account settings</button>
    <button onClick={() => setDialog(true)}>Security verification</button>
    <AccountCenter open={center} onOpenChange={setCenter} initialSection="security" />
    <AccountSecurityDialog open={dialog} onOpenChange={setDialog} />
    {/* Mount the panel, dialog, center or Headless editor as appropriate, not duplicate editors. */}
  </>
}

export function EmbeddedSecurity({ config, theme }: { config: IamConfig; theme: IamColorScheme }) {
  return <IamProvider {...config} colorScheme={theme} locale="en"
    appearance={{ primaryColor: '#215b6b' }} darkAppearance={{ primaryColor: '#6fb8c8' }}>
    <AccountSecurityPanel />
  </IamProvider>
}

/** The host owns presentation. All actions/state below are from the public package. */
export function HeadlessSecurity() {
  const { user, isAuthenticated, login } = useAuth()
  const [loginFailed, setLoginFailed] = useState(false)
  if (!isAuthenticated || !user) return <>
    <button onClick={() => { void login().catch(() => setLoginFailed(true)) }}>Sign in</button>
    {loginFailed && <p role="alert">Sign-in could not start. Try again.</p>}
  </>
  return <SecurityEditor key={`${user.id}:${user.authenticationContext.sessionId}`} />
}

function SecurityEditor() {
  const model = useAccountSecurity()
  const { state, actions, capabilities, isLoading, error, refetch } = model
  const { login } = useAuth()
  const [failed, setFailed] = useState(false)
  useEffect(() => () => actions.clearSensitive(), [actions])
  const run = (work: () => Promise<unknown>) => {
    setFailed(false)
    // Typed store errors remain available; do not display raw backend/provider text.
    void work().catch(() => setFailed(true))
  }
  const op = state.operation, blocked = state.pending || state.uncertain || Boolean(state.uncertainCreate)
  if (isLoading) return <p role="status">Loading security</p>
  return <section aria-label="Custom account security" aria-busy={state.pending}>
    {(failed || error || state.error) && <p role="alert">The step did not complete. Check this operation before trying again.</p>}
    {error && <button onClick={() => void refetch()}>Reload security</button>}
    {state.uncertainCreate && <button disabled={state.pending} onClick={() => run(actions.retryCreate)}>Recover original request</button>}
    {state.uncertain && op && <button disabled={state.pending} onClick={() => run(() => actions.query())}>Check this operation</button>}
    {!op && !state.uncertainCreate && capabilities && <>
      <button disabled={blocked || !capabilities.totpEnroll.allowed} onClick={() => run(() => actions.create('TOTP_ENROLL', capabilities.loginMethodVersion))}>Set up authenticator</button>
      <button disabled={blocked || !capabilities.totpDisable.allowed} onClick={() => { if (window.confirm('Turn off the authenticator and sign out?')) run(() => actions.create('TOTP_DISABLE', capabilities.loginMethodVersion)) }}>Turn off authenticator</button>
      <button disabled={blocked || !capabilities.recoveryCodesGenerate.allowed} onClick={() => { if (window.confirm('Replace every previous recovery code?')) run(() => actions.create('RECOVERY_CODES_GENERATE', capabilities.loginMethodVersion)) }}>Generate recovery codes</button>
    </>}
    {op && <>
      <p role="status">{op.state}</p>
      {op.state === 'AWAITING_REAUTH' && <ProofEditor key={`${op.ref}:${op.state}`} model={model} />}
      {op.state === 'READY' && <button disabled={blocked} onClick={() => run(() => op.type === 'TOTP_ENROLL' ? actions.begin() : actions.complete())}>Continue</button>}
      {op.state === 'AWAITING_CONFIRMATION' && <ProofEditor key={`${op.ref}:${op.state}`} model={model} />}
      {state.materialUnavailable && <p>Setup material is no longer available. Cancel this operation before creating another setup.</p>}
      {state.recoveryCodesUnavailable && <p>This set was generated but cannot be shown again. A new set needs a new deliberate confirmation.</p>}
      {state.recoveryCodes && <><p>Save these codes now. They will not be shown again.</p><pre>{state.recoveryCodes.codes.join('\n')}</pre></>}
      {['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(op.state) ? <>
        {op.result?.sessionImpact === 'REAUTHENTICATE' && <p>Your change succeeded. Sign in again.</p>}
        <button disabled={blocked} onClick={() => {
          const needsLogin = actions.acknowledge()
          if (needsLogin) run(() => login())
          else void refetch()
        }}>{op.result?.sessionImpact === 'REAUTHENTICATE' ? 'Sign in again' : 'Done'}</button>
      </> : <button disabled={state.pending} onClick={() => {
        if (window.confirm('Cancel this operation and discard setup material?')) run(actions.cancel)
      }}>Cancel operation</button>}
    </>}
  </section>
}

function ProofEditor({ model }: { model: UseAccountSecurityResult }) {
  const { state, actions } = model
  const [choice, setChoice] = useState<MfaProofOption | null>(null)
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [failed, setFailed] = useState(false)
  const run = (work: () => Promise<unknown>) => { setFailed(false); void work().catch(() => setFailed(true)) }
  const blocked = state.pending || state.uncertain
  const material = state.material, challengeRef = state.challengeRef
  return <div>
    {failed && <p role="alert">Verification did not complete. Check the operation or try another offered method.</p>}
    {state.operation?.proofOptions.map((option, index) => <button key={index} disabled={blocked} onClick={() => {
      actions.resetProof(); setChoice(option); setPassword(''); setCode('')
    }}>{option.method === 'PROVIDER' ? option.displayName : option.method === 'EMAIL_OTP' ? option.maskedIdentifier : option.method}</button>)}
    {choice?.method === 'PASSWORD' && <><label>Current password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button disabled={blocked || !password} onClick={() => { run(() => actions.reauthenticate({ method: 'PASSWORD', password })); setPassword('') }}>Verify password</button></>}
    {choice?.method === 'EMAIL_OTP' && <button disabled={blocked} onClick={() => run(() => actions.challenge(choice.identifierId))}>Send account code</button>}
    {choice?.method === 'PROVIDER' && <><button disabled={blocked} onClick={() => run(() => actions.authorizeProvider(choice.methodId))}>Confirm with provider</button><button disabled={blocked} onClick={() => run(actions.providerCallback)}>I have returned from the provider</button></>}
    {choice?.method === 'STEP_UP_PROOF' && <><button disabled={blocked} onClick={() => run(actions.startStepUp)}>Choose an enrolled factor</button>{state.availableMethods.includes('WEBAUTHN') && <button disabled={blocked} onClick={() => run(actions.verifyWebAuthn)}>Use security key</button>}</>}
    {material && <><p>Enter this key in your authenticator, then verify its six-digit code.</p><code>{material.secret}</code><p>{material.issuer}</p></>}
    {(material || (choice?.method === 'EMAIL_OTP' && challengeRef) || state.availableMethods.includes('TOTP')) && <>
      <label>Verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} /></label>
      <button disabled={blocked || !/^\d{6}$/.test(code)} onClick={() => {
        if (material) run(() => actions.complete(code))
        else if (choice?.method === 'EMAIL_OTP' && challengeRef) run(() => actions.reauthenticate({ method: 'EMAIL_OTP', challengeRef, code }))
        else run(() => actions.verifyTotp(code))
        setCode('')
      }}>Verify code</button>
    </>}
  </div>
}
