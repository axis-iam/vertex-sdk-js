import { useEffect, useId, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import type { InvitationEnrollmentBegin, InvitationEnrollmentMethod } from '@axis-iam/vertex'
import type { useInvitationJourney } from '../hooks/useInvitationJourney'
import { useIamUi } from '../provider/IamUiProvider'
import { createInvitationWebAuthn } from '../core/identity-webauthn'
import { buttonStyle, inputStyle, labelStyle } from './styles'
import type { Appearance } from './styles'

type Flow = ReturnType<typeof useInvitationJourney>
function SetupQr({ uri, label }: { uri: string; label: string }) {
  const qr = useMemo(() => {
    const value = QRCode.create(uri, { errorCorrectionLevel: 'M' }), cells: string[] = []
    for (let y = 0; y < value.modules.size; y++) for (let x = 0; x < value.modules.size; x++)
      if (value.modules.get(y, x)) cells.push(`M${x + 4} ${y + 4}h1v1h-1z`)
    return { size: value.modules.size + 8, path: cells.join('') }
  }, [uri])
  return <svg role="img" aria-label={label} width="208" height="208" viewBox={`0 0 ${qr.size} ${qr.size}`} style={{ maxWidth: '100%', height: 'auto', background: '#fff' }}><path fill="#000" d={qr.path} /></svg>
}
/** Secrets remain local to this bounded view, not the journey store or session cache. */
export function InvitationEnrollmentPanel({ flow, appearance: a }: { flow: Flow; appearance: Required<Appearance> }) {
  const { localization: l } = useIamUi(), id = useId()
  const [delivered, setDelivered] = useState<InvitationEnrollmentBegin | null>(null)
  const [code, setCode] = useState(''), [browserFailed, setBrowserFailed] = useState(false)
  const enrollment = flow.enrollment, busy = flow.phase === 'loading', unknown = flow.phase === 'unknown'
  const material = enrollment?.state === 'PENDING' && delivered?.enrollment.enrollmentRef === enrollment.enrollmentRef
    && enrollment.expiresAt !== null && Date.parse(enrollment.expiresAt) > Date.now() ? delivered : null
  useEffect(() => {
    if (!delivered?.enrollment.expiresAt) return
    const timer = setTimeout(() => { setDelivered(null); setCode('') }, Math.max(0, Date.parse(delivered.enrollment.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [delivered])
  if (!enrollment || enrollment.state === 'COMPLETED') return null
  const clear = () => { setDelivered(null); setCode(''); setBrowserFailed(false) }
  async function start(method: InvitationEnrollmentMethod) {
    clear()
    try { setDelivered(await flow.startEnrollment(method)) } catch { return }
  }
  async function finishWebAuthn() {
    if (!material?.webauthn || !enrollment?.enrollmentRef) return
    setBrowserFailed(false)
    let credential: string
    try { credential = await createInvitationWebAuthn(material.webauthn.publicKeyCredentialCreationOptions) }
    catch { setBrowserFailed(true); return }
    clear()
    try { await flow.completeEnrollment({ enrollmentRef: enrollment.enrollmentRef, credential }) } catch { return }
  }
  const actions = { display: 'flex', flexWrap: 'wrap' as const, gap: 12, marginTop: 16 }
  return <div aria-labelledby={id + '-heading'} style={{ marginTop: 24 }}>
    <h3 id={id + '-heading'} style={{ fontSize: 17, margin: '0 0 8px' }}>{l.security.title}</h3>
    <p>{l.invitation.enrollmentRequired}</p>
    {browserFailed && <p role="alert">{l.security.error}</p>}
    {!unknown && ['AVAILABLE', 'CANCELLED'].includes(enrollment.state) && <div style={actions}>
      {enrollment.availableMethods.map(method => <button type="button" key={method} disabled={busy} style={buttonStyle(a)} onClick={() => { void start(method) }}>
        {method === 'TOTP' ? l.security.enroll : l.security.webauthn}
      </button>)}
    </div>}
    {!unknown && enrollment.state === 'PENDING' && <>
      {material?.totp && <div>
        <p>{l.security.setup}</p><SetupQr uri={material.totp.qrCodeUri} label={l.security.qr} />
        <dl><dt>{l.security.secret}</dt><dd style={{ margin: '8px 0', overflowWrap: 'anywhere' }}><code>{material.totp.secret}</code></dd></dl>
      </div>}
      {!material && <p role="status">{l.security.lostMaterial}</p>}
      {enrollment.method === 'TOTP' && <form onSubmit={event => {
        event.preventDefault()
        if (!enrollment.enrollmentRef) return
        const proof = code; clear()
        void flow.completeEnrollment({ enrollmentRef: enrollment.enrollmentRef, code: proof }).catch(() => {})
      }}>
        <label htmlFor={id + '-code'} style={labelStyle(a)}>{l.auth.authenticatorCode}</label>
        <input id={id + '-code'} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={code} onChange={event => setCode(event.target.value)} style={inputStyle(a)} />
        <button type="submit" disabled={busy || !/^[0-9]{6}$/.test(code)} style={{ ...buttonStyle(a), marginTop: 16 }}>{l.security.complete}</button>
      </form>}
      {material?.webauthn && <button type="button" disabled={busy} style={buttonStyle(a)} onClick={() => { void finishWebAuthn() }}>{l.security.webauthn}</button>}
    </>}
    {enrollment.state === 'EXPIRED' && <p role="status">{l.security.expired}</p>}
    {enrollment.state === 'UNAVAILABLE' && <p role="status">{enrollment.reasonCode === 'INVITATION_ENROLLMENT_MATERIAL_UNAVAILABLE' ? l.security.lostMaterial : l.security.unavailable}</p>}
    <div style={actions}>
      <button type="button" disabled={busy} style={buttonStyle(a, 'ghost')} onClick={() => { clear(); void flow.recoverEnrollment().catch(() => {}) }}>{l.security.query}</button>
      {!unknown && enrollment.enrollmentRef && ['PENDING', 'UNAVAILABLE'].includes(enrollment.state) && <button type="button" disabled={busy} style={buttonStyle(a, 'ghost')} onClick={() => { clear(); void flow.cancelEnrollment().catch(() => {}) }}>{l.security.cancel}</button>}
    </div>
  </div>
}
