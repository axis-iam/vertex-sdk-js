import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { consumeInvitationContinuation } from '@axis-iam/vertex'
import type { InvitationJourney } from '@axis-iam/vertex'
import { useInvitationJourney } from '../hooks/useInvitationJourney'
import type { Appearance } from './styles'
import { buttonStyle, containerStyle, errorStyle, inputStyle, labelStyle } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'
import { SignIn } from './SignIn'
import { InvitationEnrollmentPanel } from './InvitationEnrollmentPanel'

export interface OrganizationInvitationAcceptProps {
  /** Application one-use continuation, never raw invitation token or issuer owner control. */
  continuation?: string
  journeyRef?: string
  appearance?: Appearance
  onAccepted?: (journey: InvitationJourney) => void | Promise<void>
  /** Dialog/Custom/Headless hosts retain the entry in memory while their login completes. */
  renderLogin?: () => ReactNode
  /** Hosted runs in a bounded popup so this page retains the invitation in memory. */
  loginMode?: 'embedded' | 'hosted'
}
export function OrganizationInvitationAccept(props: OrganizationInvitationAcceptProps) {
  const { localization: l } = useIamUi()
  const [entry, setEntry] = useState<{ continuation?: string; ref?: string } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const captured = useRef<{ continuation?: string; ref?: string; propContinuation?: string; propRef?: string } | null>(null)
  useLayoutEffect(() => {
    try {
      if (captured.current && captured.current.propContinuation === props.continuation && captured.current.propRef === props.journeyRef) return
      const proof = consumeInvitationContinuation(window.location, window.history)
      if (proof && props.continuation && proof !== props.continuation) throw new Error('Ambiguous invitation entry')
      const refs = new URL(window.location.href).searchParams.getAll('journeyRef')
      if (refs.length > 1) throw new Error('Ambiguous invitation reference')
      const ref = props.journeyRef ?? refs[0], continuation = proof ?? props.continuation
      if ((!ref && !continuation) || ref && continuation) throw new Error('Invalid invitation entry')
      const value = { continuation, ref }
      captured.current = { ...value, propContinuation: props.continuation, propRef: props.journeyRef }
      setInvalid(false); setEntry(value)
    } catch { setInvalid(true) }
  }, [props.continuation, props.journeyRef])
  if (invalid) return <div role="alert">{l.invitation.invalidEntry}</div>
  if (!entry) return <p role="status">{l.invitation.loading}</p>
  return <InvitationContent {...props} entry={entry} />
}
function InvitationContent({ appearance, onAccepted, renderLogin, loginMode = 'embedded', entry }: OrganizationInvitationAcceptProps & { entry: { continuation?: string; ref?: string } }) {
  const { localization: l, locale } = useIamUi()
  const [a] = useIamAppearance(appearance)
  const flow = useInvitationJourney(entry)
  const [mode, setMode] = useState<'choice' | 'login' | 'registration' | 'finiteLogin'>('choice')
  const [finiteMethod, setFiniteMethod] = useState<'PASSWORD' | 'EMAIL_OTP' | null>(null)
  const [finiteChallenge, setFiniteChallenge] = useState(false)
  const [password, setPassword] = useState(''), [email, setEmail] = useState(''), [code, setCode] = useState('')
  const [navigationError, setNavigationError] = useState(false)
  const [hostedStarted, setHostedStarted] = useState(false)
  const [mfaCode, setMfaCode] = useState(''), [mfaMethod, setMfaMethod] = useState<'TOTP' | 'RECOVERY_CODE'>('TOTP')
  const id = useId(), view = flow.journey, registration = flow.registration
  const busy = flow.phase === 'loading' || !flow.isLoaded
  const terminal = view && ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REVOKED', 'UNAVAILABLE'].includes(view.state)
  const committed = view?.state === 'COMMITTED', unknown = flow.phase === 'unknown'
  const canConfirm = !flow.entryPending && view?.state === 'CONFIRM_REQUIRED' && flow.phase === 'ready'
  useEffect(() => {
    if (!view || !entry.continuation || flow.entryPending) return
    const url = new URL(window.location.href)
    url.searchParams.delete('continuation'); url.searchParams.set('journeyRef', view.ref)
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [view?.ref, entry.continuation, flow.entryPending])
  // All API rejections remain observable in the store. Callback/navigation failure is separate.
  async function accepted(work: Promise<InvitationJourney>) {
    try {
      const result = await work
      if (result.state === 'COMMITTED') { try { await onAccepted?.(result) } catch { setNavigationError(true) } }
    } catch { return }
  }
  async function register(event: FormEvent) {
    event.preventDefault()
    const input = { identifier: { kind: 'EMAIL' as const, value: email }, password, locale }
    setPassword('')
    try { await flow.register(input) } catch { return }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); const proof = code; setCode('')
    try { await flow.verifyRegistration(proof) } catch { return }
  }
  const title = view?.subject.organizationName ? l.invitation.join(view.subject.organizationName) : view?.subject.applicationName ?? l.invitation.title
  const actions = { display: 'flex', flexWrap: 'wrap' as const, gap: 12, marginTop: 24 }
  return <section className="axis-iam-invitation" style={{ ...containerStyle(a), maxWidth: 520, overflowWrap: 'anywhere', '--axis-invitation-focus': a.focusColor } as React.CSSProperties} aria-labelledby={id + '-title'} aria-busy={busy}>
    <style>{`.axis-iam-invitation button{min-height:44px}.axis-iam-invitation input,.axis-iam-invitation select,.axis-iam-invitation button{font-family:inherit}.axis-iam-invitation :is(button,input,select,a):focus-visible{outline:2px solid var(--axis-invitation-focus);outline-offset:3px}.axis-iam-invitation button:disabled{cursor:not-allowed;opacity:.65}.axis-iam-invitation button:not(:disabled):hover{filter:brightness(.95)}@media(prefers-reduced-motion:reduce){.axis-iam-invitation *{transition:none!important}}`}</style>
    <h2 id={id + '-title'} style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
    {view && <dl style={{ margin: '20px 0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: '8px 16px' }}>
      <dt style={{ color: a.mutedTextColor }}>{l.invitation.applicationLabel}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{view.subject.applicationName}</dd>
      {view.role && <><dt style={{ color: a.mutedTextColor }}>{l.invitation.roleLabel}</dt><dd style={{ margin: 0 }}>{l.organization.role(view.role)}</dd></>}
      {view.maskedRecipient && <><dt style={{ color: a.mutedTextColor }}>{l.invitation.recipientLabel}</dt><dd style={{ margin: 0 }}>{view.maskedRecipient}</dd></>}
    </dl>}
    {view && <p>{l.invitation.expires(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(view.expiresAt)))}</p>}
    {flow.error && <div role="alert" style={{ ...errorStyle(a), marginTop: 16 }}>{unknown ? l.invitation.unknownResult : localizeError(flow.error, l, 'invitationFailed')}</div>}
    {navigationError && <p role="alert">{l.invitation.navigationFailed}</p>}
    {busy && <p role="status">{l.invitation.loading}</p>}
    {flow.canRetryPreparation && <div style={actions}>
      <p>{l.invitation.preparationNotSubmitted}</p>
      <button type="button" disabled={busy} style={buttonStyle(a)}
        onClick={() => { void flow.retryPreparation().catch(() => {}) }}>{l.invitation.retryPreparation}</button>
    </div>}
    {flow.canSwitchAccount && <button type="button" disabled={busy} style={{ ...buttonStyle(a), marginTop: 16 }}
      onClick={() => { void flow.switchAccount().then(() => setMode('login')).catch(() => {}) }}>{l.invitation.switchAccount}</button>}
    {terminal && <p role="status">{committed ? l.invitation.accepted : view.result === 'ACCOUNT_CREATED_BUT_NOT_JOINED' ? l.invitation.accountKept : l.invitation.terminal(view.state)}</p>}
    {!view && !busy && mode === 'choice' && flow.phase !== 'error' && !unknown && <div style={actions}>
      <button type="button" style={buttonStyle(a)} onClick={() => setMode('login')}>{l.auth.signIn}</button>
      <button type="button" style={buttonStyle(a)} onClick={() => { setMode('registration'); void flow.beginRegistration().catch(() => {}) }}>{l.signUp.createAccount}</button>
    </div>}
    {!view && mode === 'login' && !flow.isAuthenticated && (renderLogin ? renderLogin() : loginMode === 'embedded' ? <SignIn mode="embedded" allowSignUp={false} providerNavigation="popup" appearance={appearance} /> : <div style={actions}>
      <button type="button" disabled={busy || hostedStarted} style={buttonStyle(a)} onClick={() => { void flow.startHostedLogin(locale).then(() => setHostedStarted(true)).catch(() => {}) }}>{l.auth.signIn}</button>
      {hostedStarted && <button type="button" disabled={busy} style={buttonStyle(a)} onClick={() => { void flow.completeHostedLogin().catch(() => {}) }}>{l.invitation.loginCompleted}</button>}
    </div>)}
    {!terminal && mode === 'registration' && view && ['PREVIEW', 'REGISTRATION_REQUIRED'].includes(view.state) && !registration && !unknown && <form onSubmit={event => { void register(event) }} style={{ marginTop: 24 }}>
      <label style={labelStyle(a)} htmlFor={id + '-email'}>{l.signUp.email}</label>
      <input id={id + '-email'} type="email" autoComplete="email" required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} style={inputStyle(a)} />
      <label style={labelStyle(a)} htmlFor={id + '-password'}>{l.signUp.password}</label>
      <input id={id + '-password'} type="password" autoComplete="new-password" required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} style={inputStyle(a)} />
      <button type="submit" disabled={busy} style={{ ...buttonStyle(a), marginTop: 16 }}>{l.signUp.createAccount}</button>
      <p>{l.invitation.explicitConfirmation}</p>
      <button type="button" disabled={busy} style={buttonStyle(a)} onClick={() => {
        void flow.startAuthentication().then(() => setMode('finiteLogin')).catch(() => {})
      }}>{l.auth.signIn}</button>
    </form>}
    {!terminal && mode === 'finiteLogin' && flow.authentication?.state === 'AUTHENTICATING' && !unknown && <div style={{ marginTop: 24 }}>
      <div style={actions}>{(['PASSWORD', 'EMAIL_OTP'] as const).filter(type => flow.authentication!.methods.some(method => method.type === type && method.enabled && method.configured && method.availableForLogin)).map(method => <button type="button" key={method} disabled={busy} style={buttonStyle(a)}
        onClick={() => { setFiniteMethod(method); setFiniteChallenge(false); setPassword(''); setCode('') }}>{method === 'PASSWORD' ? l.auth.password : l.auth.verificationCode}</button>)}</div>
      {finiteMethod && <form onSubmit={event => {
        event.preventDefault()
        if (finiteMethod === 'EMAIL_OTP' && !finiteChallenge) {
          void flow.challenge('EMAIL_OTP', { kind: 'EMAIL', value: email }).then(() => setFiniteChallenge(true)).catch(() => {})
          return
        }
        const input = finiteMethod === 'PASSWORD' ? { method: 'PASSWORD' as const, identifier: { kind: 'EMAIL' as const, value: email }, password }
          : { method: 'EMAIL_OTP' as const, identifier: { kind: 'EMAIL' as const, value: email }, proof: code }
        setPassword(''); setCode(''); void flow.authenticate(input).catch(() => {})
      }}>
        <label htmlFor={id + '-login-email'} style={labelStyle(a)}>{l.auth.email}</label>
        <input id={id + '-login-email'} type="email" required disabled={busy || finiteChallenge} value={email} autoComplete="username" onChange={event => setEmail(event.target.value)} style={inputStyle(a)} />
        {finiteMethod === 'PASSWORD' && <><label htmlFor={id + '-login-password'} style={labelStyle(a)}>{l.auth.password}</label>
          <input id={id + '-login-password'} type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} style={inputStyle(a)} /></>}
        {finiteChallenge && <><label htmlFor={id + '-login-code'} style={labelStyle(a)}>{l.auth.verificationCode}</label>
          <input id={id + '-login-code'} autoComplete="one-time-code" inputMode="numeric" required disabled={busy} value={code} onChange={event => setCode(event.target.value)} style={inputStyle(a)} /></>}
        <button type="submit" disabled={busy} style={{ ...buttonStyle(a), marginTop: 16 }}>{finiteMethod === 'EMAIL_OTP' && !finiteChallenge ? l.auth.sendCode : l.auth.signIn}</button>
      </form>}
    </div>}
    {!terminal && registration && !['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(registration.state) && !unknown && <form onSubmit={event => { void verify(event) }} style={{ marginTop: 24 }}>
      <label style={labelStyle(a)} htmlFor={id + '-code'}>{l.auth.verificationCode}</label>
      <input id={id + '-code'} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} disabled={busy} onChange={event => setCode(event.target.value)} style={inputStyle(a)} />
      <button type="submit" disabled={busy} style={{ ...buttonStyle(a), marginTop: 16 }}>{l.auth.verify}</button>
      <button type="button" disabled={busy || registration.nextChallengeAt !== null && Date.parse(registration.nextChallengeAt) > Date.now()}
        onClick={() => { void flow.resendRegistration().catch(() => {}) }} style={{ ...buttonStyle(a), marginTop: 12 }}>{l.auth.resend}</button>
    </form>}
    {registration?.state === 'COMPLETED' && !terminal && <p role="status">{l.invitation.explicitConfirmation}</p>}
    {!terminal && flow.enrollment && flow.enrollment.reasonCode !== 'INVITATION_AUTH_REQUIRED' && <InvitationEnrollmentPanel flow={flow} appearance={a} />}
    {!terminal && (!flow.enrollment || flow.enrollment.reasonCode === 'INVITATION_AUTH_REQUIRED') && (flow.authentication?.state === 'MFA_REQUIRED' || view?.state === 'AUTHENTICATING' && registration?.state === 'COMPLETED') && !unknown && <form onSubmit={event => {
      event.preventDefault(); const proof = mfaCode; setMfaCode('')
      void flow.verifyMfa(mfaMethod, proof).catch(() => {})
    }} style={{ marginTop: 24 }}>
      <label htmlFor={id + '-mfa-method'} style={labelStyle(a)}>{l.invitation.mfaMethod}</label>
      <select id={id + '-mfa-method'} value={mfaMethod} disabled={busy} style={inputStyle(a)} onChange={event => { setMfaMethod(event.target.value === 'TOTP' ? 'TOTP' : 'RECOVERY_CODE'); setMfaCode('') }}>
        <option value="TOTP">{l.auth.authenticatorCode}</option><option value="RECOVERY_CODE">{l.invitation.recoveryCode}</option>
      </select>
      <label htmlFor={id + '-mfa-code'} style={labelStyle(a)}>{mfaMethod === 'TOTP' ? l.auth.authenticatorCode : l.invitation.recoveryCode}</label>
      <input id={id + '-mfa-code'} type="text" autoComplete="one-time-code" required disabled={busy} value={mfaCode} onChange={event => setMfaCode(event.target.value)} style={inputStyle(a)} />
      <button type="submit" disabled={busy} style={{ ...buttonStyle(a), marginTop: 16 }}>{l.auth.verify}</button>
    </form>}
    {!terminal && view && !unknown && <div style={actions}>
      {view.result === 'ROLE_CHANGED' && flow.phase === 'ready' && <button type="button" disabled={busy} onClick={() => { void flow.continueJourney().catch(() => {}) }} style={buttonStyle(a)}>{l.invitation.reviewChanges}</button>}
      {canConfirm && <button type="button" disabled={busy} onClick={() => { void accepted(flow.confirm()) }} style={buttonStyle(a)}>{l.invitation.accept}</button>}
      <button type="button" disabled={busy} onClick={() => { void flow.cancel().catch(() => {}) }} style={buttonStyle(a, 'ghost')}>{l.invitation.cancel}</button>
    </div>}
    {view && (unknown || flow.phase === 'error') && <div style={actions}>
      <button type="button" disabled={busy} onClick={() => { void accepted(flow.recover()) }} style={buttonStyle(a)}>{l.invitation.checkResult}</button>
      {(registration || flow.unknownAction === 'registration') && <button type="button" disabled={busy} onClick={() => { void flow.recoverRegistration().catch(() => {}) }} style={buttonStyle(a)}>{l.invitation.checkRegistration}</button>}
      {flow.isAuthenticated && <button type="button" disabled={busy} onClick={() => { void accepted(flow.useAuthenticatedSession()) }} style={buttonStyle(a)}>{l.invitation.useSession}</button>}
    </div>}
    {committed && view.nextAction.url && <button type="button" style={{ ...buttonStyle(a), marginTop: 20 }}
      onClick={() => { try { window.location.assign(view.nextAction.url!) } catch { setNavigationError(true) } }}>{l.invitation.navigate}</button>}
  </section>
}
