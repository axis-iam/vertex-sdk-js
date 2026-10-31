import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import QRCode from 'qrcode'
import type { MfaOperation, MfaOperationType, MfaProofOption } from '@axis-iam/vertex'
import { SessionTransportError } from '@axis-iam/vertex'
import { IamApiError } from '../core/types'
import { useAccountSecurity } from '../hooks/useAccountSecurity'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { useAccountCenterAppearance } from './accountCenterConfig'
import { AccountCenterSurface } from './AccountCenterSurface'
import { AccountIcon } from './AccountIcon'
import { mergeAppearances } from './styles'
import type { Appearance, AppearanceColorScheme } from './styles'
import { securityErrorMessage } from '../security-localization'
import type { SecurityLocalization } from '../security-localization'

export interface AccountSecurityPanelProps {
  appearance?: Appearance
  colorScheme?: AppearanceColorScheme
  darkAppearance?: Appearance
  localization?: Partial<SecurityLocalization>
  className?: string
  style?: CSSProperties
  onReauthenticate?: (receipt: Pick<MfaOperation, 'ref' | 'type'>) => void
  onComplete?: (operation: MfaOperation) => void
}
const proofKey = (p: MfaProofOption) => p.method === 'EMAIL_OTP' ? `${p.method}:${p.identifierId}` : p.method === 'PROVIDER' ? `${p.method}:${p.methodId}` : p.method

function EnrollmentQr({ uri, label }: { uri: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = QRCode.create(uri, { errorCorrectionLevel: 'M' })
    const size = qr.modules.size
    const cells: string[] = []
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.modules.get(y, x)) cells.push(`M${x + 4} ${y + 4}h1v1h-1z`)
    return { size: size + 8, path: cells.join('') }
  }, [uri])
  return <svg role="img" aria-label={label} width="208" height="208" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: '100%', height: 'auto', background: '#fff' }}><path fill="#000" d={path} /></svg>
}

/** The same operation store powers AccountCenter, this panel, Dialog and Custom. */
export function AccountSecurityPanel(props: AccountSecurityPanelProps) {
  const ui = useIamUi()
  const l = { ...ui.localization.security, ...props.localization }
  const { client, login, isAuthenticated } = useIamContext()
  const generation = client.state.generation
  const { security, capabilities, recoveryCodesRemaining, isLoading, error, refetch, state, actions } = useAccountSecurity()
  const [a, scheme] = useAccountCenterAppearance(props.colorScheme ?? ui.colorScheme, mergeAppearances(ui.appearance, props.appearance), mergeAppearances(ui.darkAppearance, props.darkAppearance))
  const op = state.operation
  const recoveryCodes = state.recoveryCodes
  const owner = `${generation}:${op?.ref ?? ''}:${op?.state ?? ''}`
  const empty = () => ({ owner, choice: '', password: '', code: '', provider: false, confirm: null as MfaOperationType | null, cancel: false, copied: false, failed: false })
  const [fields, setFields] = useState(empty)
  const f = fields.owner === owner ? fields : empty()
  if (f !== fields) setFields(f)
  const update = (patch: Partial<typeof fields>) => setFields(previous => previous.owner === owner && generation === client.state.generation ? { ...previous, ...patch } : previous)
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [op?.state])
  useEffect(() => () => actions.clearSensitive(), [actions])
  const run = (work: () => Promise<unknown>) => {
    update({ failed: false, copied: false })
    void work().catch(() => update({ failed: true })) // The store retains typed failure/uncertainty; never render raw server text.
  }
  const busy = state.pending
  const terminal = op !== null && ['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(op.state)
  const canWrite = isAuthenticated && !busy && !state.uncertain && !state.uncertainCreate && !state.recoveryReceipt
  const canStart = canWrite && !isLoading && !error && capabilities !== null
  const choice = op?.proofOptions.find(p => proofKey(p) === f.choice) ?? (op?.proofOptions.length === 1 ? op.proofOptions[0] : undefined)
  const proofLabel = (p: MfaProofOption) => p.method === 'PASSWORD' ? l.password : p.method === 'EMAIL_OTP' ? `${l.email} — ${p.maskedIdentifier}` : p.method === 'PROVIDER' ? `${l.provider} — ${p.displayName}` : l.stepUp
  const action = (type: MfaOperationType) => type === 'TOTP_ENROLL' ? capabilities?.totpEnroll : type === 'TOTP_DISABLE' ? capabilities?.totpDisable : capabilities?.recoveryCodesGenerate
  const start = (type: MfaOperationType) => {
    if (!canStart || !capabilities || !action(type)?.allowed) return
    update({ confirm: null })
    run(() => actions.create(type, capabilities.loginMethodVersion))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canWrite || !op) return
    if (op.state === 'AWAITING_CONFIRMATION') run(() => actions.complete(f.code))
    else if (choice?.method === 'PASSWORD') run(() => actions.reauthenticate({ method: 'PASSWORD', password: f.password }))
    else if (choice?.method === 'EMAIL_OTP' && state.challengeRef) {
      const challengeRef = state.challengeRef
      run(() => actions.reauthenticate({ method: 'EMAIL_OTP', challengeRef, code: f.code }))
    }
    else if (choice?.method === 'STEP_UP_PROOF') run(() => actions.verifyTotp(f.code))
    update({ password: '', code: '' })
  }
  const finish = () => {
    if (!op) return
    const receipt = { ref: op.ref, type: op.type }
    const needsLogin = !state.recoveryReceipt && op.result?.sessionImpact === 'REAUTHENTICATE'
    props.onComplete?.(op)
    // Retire capabilities before acknowledgement exposes the next-action controls.
    if (!needsLogin) void refetch()
    actions.acknowledge()
    if (needsLogin) {
      if (props.onReauthenticate) props.onReauthenticate(receipt)
      else run(() => login())
    }
  }
  const signInToQuery = () => run(async () => {
    const receipt = actions.prepareReauthentication()
    if (props.onReauthenticate) props.onReauthenticate(receipt)
    else await login()
  })
  const stateError = state.error ?? error
  const code = stateError instanceof IamApiError || stateError instanceof SessionTransportError ? stateError.code : undefined
  const remaining = op?.nextChallengeAt ? Math.max(0, Math.ceil((Date.parse(op.nextChallengeAt) - Date.now()) / 1000)) : 0
  useEffect(() => {
    if (!remaining) return
    const timer = setTimeout(() => update({ copied: false }), Math.min(remaining * 1000, 2147483647))
    return () => clearTimeout(timer)
  }, [remaining, owner])
  const input = (name: 'password' | 'code', label: string) => <div className="axis-iam-account-field"><label htmlFor={`${id}-${name}`}>{label}</label><input className="axis-iam-account-input" id={`${id}-${name}`} type={name === 'password' ? 'password' : 'text'} autoComplete={name === 'password' ? 'current-password' : 'one-time-code'} inputMode={name === 'code' ? 'numeric' : undefined} maxLength={name === 'code' ? 6 : 128} value={f[name]} onChange={e => update({ [name]: e.target.value })} /></div>
  return <AccountCenterSurface appearance={a} colorScheme={scheme} ariaLabel={l.title} title={l.title} description={l.description} className={props.className} style={props.style} componentCss={css}>
    <div className="axis-security-content" aria-busy={busy}>
      {(stateError || f.failed) && <p role="alert" className="axis-iam-account-notice-error">{securityErrorMessage(code, l)}</p>}
      {isLoading && !op && <p role="status">{l.loading}</p>}
      {error && !op && <button type="button" onClick={() => void refetch()}>{l.retry}</button>}
      {state.recoveryReceipt && !op && <section className="axis-security-result" aria-labelledby={`${id}-receipt`}>
        <div className="axis-security-symbol" data-tone="info"><AccountIcon name="info" size={24} /></div>
        <h3 tabIndex={-1} ref={heading} id={`${id}-receipt`}>{l.recoveryTitle}</h3>
        <p role="status">{isAuthenticated ? l.recoveryReady : l.recoverySignIn}</p>
        <div className="axis-security-actions">
          {isAuthenticated ? <button type="button" disabled={busy} onClick={() => run(() => actions.query())}>{l.query}</button> : <button className="axis-iam-account-primary-button" type="button" disabled={busy} onClick={signInToQuery}>{l.signIn}</button>}
          <button type="button" disabled={busy} onClick={actions.discardReceipt}>{l.forgetReceipt}</button>
        </div>
        <p className="axis-iam-account-muted">{l.forgetHint}</p>
      </section>}
      {state.uncertainCreate && <div role="alert"><p>{l.uncertain}</p><button type="button" disabled={busy} onClick={() => run(() => actions.retryCreate())}>{l.recoverCreate}</button></div>}
      {op && <section className={terminal ? 'axis-security-operation axis-security-result' : 'axis-security-operation'} aria-labelledby={`${id}-operation`}>
        <div className="axis-security-symbol" data-tone={op.state === 'COMMITTED' ? 'success' : 'info'}><AccountIcon name={op.state === 'COMMITTED' ? 'check' : terminal ? 'info' : op.type === 'TOTP_ENROLL' ? 'authenticator' : op.type === 'TOTP_DISABLE' ? 'security' : 'recovery'} size={24} /></div>
        <h3 tabIndex={-1} ref={heading} id={`${id}-operation`}>{op.state === 'COMMITTED' ? l.committed : op.state === 'CANCELLED' ? l.cancelled : op.state === 'EXPIRED' ? l.expired : op.type === 'TOTP_ENROLL' ? l.enroll : op.type === 'TOTP_DISABLE' ? l.disable : l.generate}</h3>
        {state.uncertain && <p className="axis-security-notice" role="alert">{l.uncertain}</p>}
        {(state.uncertain || state.materialUnavailable || state.recoveryCodesUnavailable || op.state === 'EXPIRED') && <button type="button" disabled={busy} onClick={() => run(() => actions.query())}>{l.query}</button>}
        {state.materialUnavailable && <p role="status">{l.lostMaterial}</p>}
        {state.recoveryCodesUnavailable && <p role="status">{l.lostCodes}</p>}
        {op.state === 'AWAITING_REAUTH' && !state.uncertain && <>
          {op.proofOptions.length > 1 && <div className="axis-iam-account-field"><label htmlFor={`${id}-proof`}>{l.choose}</label><select id={`${id}-proof`} className="axis-iam-account-input" value={choice ? proofKey(choice) : ''} disabled={!canWrite} onChange={e => { actions.resetProof(); update({ choice: e.target.value, password: '', code: '', provider: false }) }}><option value="">{l.choose}</option>{op.proofOptions.map(p => <option value={proofKey(p)} key={proofKey(p)}>{proofLabel(p)}</option>)}</select></div>}
          {op.proofOptions.length === 0 && <p>{l.unavailable}</p>}
          <form onSubmit={submit}>
            {choice?.method === 'PASSWORD' && <>{input('password', l.password)}<button disabled={!canWrite || !f.password} type="submit">{l.verify}</button></>}
            {choice?.method === 'EMAIL_OTP' && <><p>{choice.maskedIdentifier}</p><button type="button" disabled={!canWrite || remaining > 0} onClick={() => run(() => actions.challenge(choice.identifierId))}>{remaining ? l.cooldown(remaining) : l.send}</button>{state.challengeRef && <>{input('code', l.code)}<button type="submit" disabled={!canWrite || !/^\d{6}$/.test(f.code)}>{l.verify}</button></>}</>}
            {choice?.method === 'PROVIDER' && <><button type="button" disabled={!canWrite} onClick={() => run(async () => { await actions.authorizeProvider(choice.methodId); update({ provider: true }) })}>{proofLabel(choice)}</button>{f.provider && <button type="button" disabled={!canWrite} onClick={() => run(() => actions.providerCallback())}>{l.providerDone}</button>}</>}
            {choice?.method === 'STEP_UP_PROOF' && <>{!state.challengeRef ? <button type="button" disabled={!canWrite} onClick={() => run(() => actions.startStepUp())}>{l.stepUp}</button> : <>{state.availableMethods.includes('TOTP') && <>{input('code', l.code)}<button type="submit" disabled={!canWrite || !/^\d{6}$/.test(f.code)}>{l.verify}</button></>}{state.availableMethods.includes('WEBAUTHN') && <button type="button" disabled={!canWrite} onClick={() => run(() => actions.verifyWebAuthn())}>{l.webauthn}</button>}</>}</>}
          </form>
        </>}
        {op.state === 'READY' && <button className="axis-iam-account-primary-button" type="button" disabled={!canWrite} onClick={() => run(() => op.type === 'TOTP_ENROLL' ? actions.begin() : actions.complete())}>{op.type === 'TOTP_ENROLL' ? l.begin : l.confirm}</button>}
        {state.material && op.state === 'AWAITING_CONFIRMATION' && <><p>{l.setup}</p><div className="axis-security-setup"><EnrollmentQr uri={state.material.qrCodeUri} label={l.qr} /><dl><dt>{l.secret}</dt><dd><code>{state.material.secret}</code></dd><dt>{l.issuer}</dt><dd>{state.material.issuer}</dd></dl></div><form onSubmit={submit}>{input('code', l.code)}<button className="axis-iam-account-primary-button" type="submit" disabled={!canWrite || !/^\d{6}$/.test(f.code)}>{l.complete}</button></form></>}
        {op.state === 'COMMITTED' && op.type === 'TOTP_ENROLL' && <p className="axis-security-notice" data-tone="success" role="status">{l.enrolled}</p>}
        {recoveryCodes && <section aria-label={l.recovery}><p>{l.saveCodes}</p><ul className="axis-security-codes">{recoveryCodes.codes.map((value, index) => <li key={index}><code>{value}</code></li>)}</ul><div className="axis-security-actions"><button type="button" onClick={() => run(async () => { await navigator.clipboard.writeText(recoveryCodes.codes.join('\n')); update({ copied: true }) })}>{f.copied ? l.copied : l.copy}</button><button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([recoveryCodes.codes.join('\n')], { type: 'text/plain' }))
          const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'recovery-codes.txt'; anchor.click(); URL.revokeObjectURL(url)
        }}>{l.download}</button></div></section>}
        {op.result?.sessionImpact === 'REAUTHENTICATE' && !state.recoveryReceipt && <p className="axis-security-notice" data-tone="success" role="status">{l.relogin}</p>}
        {terminal ? <div className="axis-security-footer"><button className={op.state === 'COMMITTED' ? 'axis-iam-account-primary-button' : undefined} type="button" disabled={busy || state.uncertain} onClick={finish}>{op.result?.sessionImpact === 'REAUTHENTICATE' && !state.recoveryReceipt ? l.signIn : l.done}</button></div> : <div className="axis-security-actions axis-security-footer">{f.cancel ? <div role="alert"><p>{l.cancelConfirm}</p><button type="button" disabled={busy} onClick={() => run(async () => { await actions.cancel(); update({ cancel: false }) })}>{l.cancelNow}</button><button type="button" disabled={busy} onClick={() => update({ cancel: false })}>{l.keep}</button></div> : <button type="button" disabled={busy} onClick={() => update({ cancel: true })}>{l.cancel}</button>}</div>}
      </section>}
      {!op && !state.recoveryReceipt && !state.uncertainCreate && security && capabilities && <>
        <div className="axis-security-group">
          <section className="axis-security-row"><span className="axis-security-row-icon"><AccountIcon name="authenticator" /></span><div className="axis-security-row-copy"><h3>{l.totp}<span className="axis-security-status" data-enabled={security.totpEnrolled}>{security.totpEnrolled ? l.enabled : l.disabled}</span></h3><p>{l.authenticatorDetail}</p>{!action(security.totpEnrolled ? 'TOTP_DISABLE' : 'TOTP_ENROLL')?.allowed && <p>{l.unavailable}</p>}</div><button className={security.totpEnrolled ? undefined : 'axis-iam-account-primary-button'} type="button" disabled={!canStart || !action(security.totpEnrolled ? 'TOTP_DISABLE' : 'TOTP_ENROLL')?.allowed} onClick={() => security.totpEnrolled ? update({ confirm: 'TOTP_DISABLE' }) : start('TOTP_ENROLL')}>{security.totpEnrolled ? l.disable : l.enroll}</button></section>
          <section className="axis-security-row"><span className="axis-security-row-icon"><AccountIcon name="recovery" /></span><div className="axis-security-row-copy"><h3>{l.recovery}</h3><p>{l.recoveryDetail}</p>{recoveryCodesRemaining !== null && <p className="axis-security-count">{l.remaining(recoveryCodesRemaining)}</p>}{!capabilities.recoveryCodesGenerate.allowed && <p>{l.unavailable}</p>}</div><button type="button" disabled={!canStart || !capabilities.recoveryCodesGenerate.allowed} onClick={() => update({ confirm: 'RECOVERY_CODES_GENERATE' })}>{recoveryCodesRemaining ? l.regenerate : l.generate}</button></section>
        </div>
        {f.confirm && <section className="axis-security-confirm" role="alert"><p>{f.confirm === 'TOTP_DISABLE' ? l.confirmDisable : l.confirmGenerate}</p><div className="axis-security-actions"><button className={f.confirm === 'TOTP_DISABLE' ? 'axis-iam-account-danger-button' : 'axis-iam-account-primary-button'} type="button" disabled={!canStart} onClick={() => f.confirm && start(f.confirm)}>{l.confirm}</button><button type="button" onClick={() => update({ confirm: null })}>{l.back}</button></div></section>}
      </>}
    </div>
  </AccountCenterSurface>
}
const css = `
.axis-security-content{min-width:0}.axis-security-content p{max-width:65ch;line-height:1.65;overflow-wrap:anywhere;margin:10px 0}.axis-security-content h3{margin:0;font-size:16px;font-weight:600;line-height:1.5}.axis-security-content h3[tabindex]{width:fit-content;border-radius:3px}.axis-security-content h3:focus{outline:2px solid var(--a-focus);outline-offset:5px}
.axis-security-group{border-top:1px solid var(--a-border)}.axis-security-row{display:flex;align-items:center;gap:14px;padding:22px 0;border-bottom:1px solid var(--a-border)}.axis-security-row-icon{display:grid;place-items:center;flex:none;width:38px;height:42px;border:1px solid var(--a-border);border-radius:var(--a-radius);color:var(--a-muted);background:var(--a-subtle)}.axis-security-row-copy{flex:1;min-width:0}.axis-security-row h3{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:14px}.axis-security-row p{margin:5px 0 0;font-size:13px;color:var(--a-muted)}.axis-security-count{font-variant-numeric:tabular-nums}.axis-security-row>button{flex:none;max-width:42%}.axis-security-status{font-size:11px;font-weight:500;color:var(--a-muted)}.axis-security-status[data-enabled=true]{color:var(--a-success)}
.axis-security-operation,.axis-security-result{max-width:480px;margin:0 auto;padding:6px 0}.axis-security-symbol{display:grid;place-items:center;width:48px;height:48px;margin:0 0 16px;border-radius:50%;background:var(--a-subtle);color:var(--a-primary)}.axis-security-symbol[data-tone=success]{color:var(--a-success);background:color-mix(in srgb,var(--a-success) 10%,var(--a-surface))}.axis-security-result{text-align:center;padding:14px 0 4px}.axis-security-result>.axis-security-symbol,.axis-security-result>h3{margin-left:auto;margin-right:auto}.axis-security-result>p{margin:14px auto}.axis-security-result .axis-security-actions{justify-content:center}.axis-security-result .axis-security-footer{justify-content:flex-end}
.axis-security-content .axis-security-notice{padding:12px 14px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle);font-size:13px;text-align:left}.axis-security-notice[data-tone=success]{color:var(--a-success);border-color:color-mix(in srgb,var(--a-success) 35%,var(--a-surface));background:color-mix(in srgb,var(--a-success) 6%,var(--a-surface))}
.axis-security-content form{display:grid;gap:16px;margin:20px 0;justify-items:start;text-align:left}.axis-security-content form>button{justify-self:end}.axis-security-content .axis-iam-account-field{width:100%}.axis-security-content select{height:auto;min-height:44px}.axis-security-setup{display:grid;justify-items:center;gap:16px;margin:24px 0;text-align:left}.axis-security-setup>svg{width:184px;height:184px}.axis-security-setup dl{width:100%;min-width:0;margin:0;font-size:13px}.axis-security-setup dt{color:var(--a-muted)}.axis-security-setup dd{margin:5px 0 12px;overflow-wrap:anywhere}.axis-security-setup code{display:block;padding:10px 12px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle)}
.axis-security-actions,.axis-security-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:20px}.axis-security-footer{justify-content:flex-end}.axis-security-confirm{margin-top:20px;padding:16px;border:1px solid var(--a-border);border-radius:var(--a-radius)}.axis-security-confirm p{margin-top:0}.axis-security-codes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;padding:16px;list-style:none;text-align:left;background:var(--a-subtle);border:1px solid var(--a-border);border-radius:var(--a-radius);font-size:13px;font-variant-numeric:tabular-nums}.axis-security-codes li{overflow-wrap:anywhere}
@media(max-width:480px){.axis-security-row{align-items:flex-start;flex-wrap:wrap;gap:12px;padding:20px 0}.axis-security-row-copy{flex-basis:calc(100% - 54px)}.axis-security-row>button{margin-left:52px;max-width:calc(100% - 52px)}.axis-security-status{font-size:12px}.axis-security-result{padding-top:8px}.axis-security-codes{grid-template-columns:1fr}.axis-security-result .axis-security-actions{flex-direction:column;align-items:center}.axis-security-content .axis-security-actions>button,.axis-security-footer>button{width:auto}}
`
