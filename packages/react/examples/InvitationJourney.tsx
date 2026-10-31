import { useState } from 'react'
import { AuthDialog, OrganizationInvitationAccept, useInvitationJourney } from '@axis-iam/vertex-react'
import { CustomAuth } from './CustomAuth'
import { InvitationError } from '@axis-iam/vertex'
import type { InvitationJourneyApi, InvitationEnrollmentMethod, InvitationEnrollmentBegin, InvitationEnrollmentCompletion } from '@axis-iam/vertex'

/** Host-owned setup UI receives material once. Errors require status lookup, never an automatic retry. */
export async function enrollNewInvitationAccount(
  api: InvitationJourneyApi, ref: string, method: InvitationEnrollmentMethod,
  collectProof: (material: InvitationEnrollmentBegin) => Promise<InvitationEnrollmentCompletion>,
) {
  const material = await api.startEnrollment(ref, method)
  if (material.delivery !== 'AVAILABLE') throw new InvitationError('INVITATION_ENROLLMENT_MATERIAL_UNAVAILABLE')
  const proof = await collectProof(material)
  if (proof.enrollmentRef !== material.enrollment.enrollmentRef) throw new InvitationError('INVITATION_REF_INVALID')
  // This establishes finite MFA only. A later user action must read and confirm the invitation.
  return api.completeEnrollment(ref, proof)
}

/** Mount these inside the same IamProvider; do not remount the invitation during login. */
export function EmbeddedInvitation() {
  return <OrganizationInvitationAccept />
}
export function HostedInvitation() {
  // Registered /callback must be passive: the opener consumes the normal OAuth callback.
  // BFF hosts complete their callback server-side and return to config.redirectUri with no query.
  return <OrganizationInvitationAccept loginMode="hosted" />
}
export function DialogInvitation() {
  const [open, setOpen] = useState(true)
  return <OrganizationInvitationAccept renderLogin={() => <AuthDialog open={open} onOpenChange={setOpen}
    allowSignUp={false} signInProps={{ providerNavigation: 'popup', onSuccess: () => setOpen(false) }} />} />
}
export function CustomInvitation() {
  // Authentication stays ordinary Client OAuth. Invitation registration uses the dedicated form.
  return <OrganizationInvitationAccept renderLogin={() => <CustomAuth initialIntent="sign-in" providerPopupRedirectUri="/callback" />} />
}
/** The host captures/scrubs continuation before mounting this Headless example. */
export function HeadlessInvitation({ continuation, journeyRef }: { continuation?: string; journeyRef?: string }) {
  const flow = useInvitationJourney({ continuation, ref: journeyRef })
  const [failure, setFailure] = useState(false)
  const run = (work: Promise<unknown>) => { setFailure(false); void work.catch(() => setFailure(true)) }
  const busy = !flow.isLoaded || flow.phase === 'loading'
  return <section aria-label="Invitation">
    <h2>{flow.journey?.subject.organizationName ?? 'Invitation'}</h2>
    {flow.journey && <p>{flow.journey.role} · {flow.journey.state}</p>}
    {!flow.isAuthenticated && !flow.journey && <button disabled={busy} onClick={() => run(flow.startHostedLogin())}>Open sign in</button>}
    {!flow.isAuthenticated && <button disabled={busy} onClick={() => run(flow.completeHostedLogin())}>Check sign in</button>}
    {flow.journey?.state === 'CONFIRM_REQUIRED' && flow.phase === 'ready' &&
      <button disabled={busy} onClick={() => run(flow.confirm())}>Confirm displayed role</button>}
    {flow.journey && flow.journey.state !== 'COMMITTED' && <button disabled={busy || flow.phase === 'unknown'} onClick={() => run(flow.cancel())}>Cancel invitation</button>}
    {(flow.phase === 'unknown' || flow.phase === 'error') && <button disabled={busy} onClick={() => run(flow.recover())}>Read authoritative result</button>}
    {flow.unknownAction === 'registration' && <button disabled={busy} onClick={() => run(flow.recoverRegistration())}>Read registration status</button>}
    {flow.enrollment && <button disabled={busy} onClick={() => run(flow.recoverEnrollment())}>Read enrollment status</button>}
    {(failure || flow.error) && <p role="alert">Invitation could not continue. Read its current status before retrying.</p>}
  </section>
}
