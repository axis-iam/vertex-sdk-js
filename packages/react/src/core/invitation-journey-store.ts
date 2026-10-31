import { InvitationError } from '@axis-iam/vertex'
import type { InvitationJourney, InvitationJourneyApi, InvitationRegistration, InvitationRegistrationInput, InvitationAuthentication, InvitationEnrollment } from '@axis-iam/vertex'

export interface InvitationJourneySnapshot {
  journey: InvitationJourney | null
  registration: InvitationRegistration | null
  authentication: InvitationAuthentication | null
  enrollment: InvitationEnrollment | null
  phase: 'idle' | 'loading' | 'ready' | 'unknown' | 'error'
  error: Error | null
  unknownAction: 'registration' | 'enrollment' | 'mutation' | null
  entryPending: boolean
}
/** Memory-only entry proof and one mutation at a time. Result recovery is always an authoritative read. */
export class InvitationJourneyStore {
  private snapshot: InvitationJourneySnapshot = { journey: null, registration: null, authentication: null, enrollment: null, phase: 'idle', error: null, unknownAction: null, entryPending: false }
  private listeners = new Set<() => void>()
  private busy = false
  private active = true
  private ref: string | null
  private continuation: string | null
  private opening: Promise<InvitationJourney> | null = null
  private preparationMode: 'authenticated' | 'registration' | null = null
  private owner: string | null = null
  private switchingAccount = false
  constructor(readonly api: InvitationJourneyApi, entry: { ref?: string; continuation?: string }) {
    this.ref = entry.ref ?? null; this.continuation = entry.continuation ?? null
    this.snapshot.entryPending = this.continuation !== null
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      queueMicrotask(() => { if (this.listeners.size === 0) this.invalidate() })
    }
  }
  getSnapshot = () => this.snapshot
  private apply(patch: Partial<InvitationJourneySnapshot>) {
    if (!this.active) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  invalidate() {
    this.continuation = null
    this.preparationMode = null
    this.apply({ journey: null, registration: null, authentication: null, enrollment: null, phase: 'error', error: new InvitationError('INVITATION_INVALIDATED') })
    this.active = false
  }
  bindOwner(owner: string | null) {
    if (this.owner !== null && this.owner !== owner && !this.switchingAccount) {
      if (this.canSwitchAccount() && !this.busy) {
        this.ref = null
        this.apply({ journey: null, registration: null, authentication: null, enrollment: null, phase: 'idle', error: null, unknownAction: null })
      } else this.invalidate()
    }
    this.owner = owner
  }
  canSwitchAccount() {
    const error = this.snapshot.error
    return this.snapshot.entryPending && this.continuation !== null && this.snapshot.phase === 'error' && this.snapshot.unknownAction === null &&
      error !== null && 'code' in error && ['INVITATION_ACCOUNT_MISMATCH', 'EMAIL_VERIFICATION_REQUIRED', 'INVITATION_VERIFICATION_REQUIRED'].includes(String(error.code))
  }
  async switchAccount(action: () => Promise<void>) {
    if (!this.canSwitchAccount() || this.busy) throw new InvitationError('INVITATION_REFRESH_REQUIRED')
    this.switchingAccount = true
    try {
      await this.run(action, 'read')
      this.ref = null; this.owner = null
      this.apply({ journey: null, registration: null, authentication: null, enrollment: null, phase: 'idle', error: null, unknownAction: null })
    } finally { this.switchingAccount = false }
  }
  hasContinuation() { return this.continuation !== null }
  hasRef() { return this.ref !== null }
  canRetryPreparation() {
    return this.active && this.preparationMode !== null && this.ref === null && this.continuation !== null &&
      this.snapshot.entryPending && this.snapshot.phase === 'error' && this.snapshot.unknownAction === null
  }
  async retryPreparation() {
    if (this.opening) return this.opening
    const mode = this.preparationMode
    if (mode === null || !this.canRetryPreparation()) throw new InvitationError('INVITATION_REFRESH_REQUIRED')
    return this.open(mode)
  }
  login(action: () => Promise<void>) { return this.run(action) }
  async open(mode: 'authenticated' | 'registration'): Promise<InvitationJourney> {
    if (this.opening) return this.opening
    if (this.busy) throw new InvitationError('INVITATION_ACTION_PENDING')
    if (this.ref && !this.snapshot.entryPending) return this.recover()
    if (this.snapshot.phase === 'unknown' || this.snapshot.unknownAction !== null) throw new InvitationError('INVITATION_RESULT_UNKNOWN')
    if (!this.continuation) return this.run(async () => { throw new InvitationError('INVITATION_ENTRY_REQUIRED') })
    const proof = this.continuation
    this.preparationMode = mode
    const work = this.run(async () => {
      const prepared = await this.api.prepareEntry(proof, mode)
      if (!this.active) throw new InvitationError('INVITATION_INVALIDATED')
      this.ref = prepared.ref; this.apply({ journey: prepared })
      return prepared
    }, 'preparation').then(prepared => this.run(async () => {
      this.preparationMode = null
      const journey = await (mode === 'authenticated' ? this.api.exchange(proof) : this.api.registrationContext(proof))
      if (journey.ref !== prepared.ref) throw new InvitationError('INVITATION_RESPONSE_INVALID')
      this.continuation = null
      this.apply({ journey, entryPending: false }); return journey
    }, 'mutation'))
    this.opening = work
    try { return await work } finally { this.opening = null }
  }
  private requireRef(): string {
    if (!this.ref) throw new InvitationError('INVITATION_ENTRY_REQUIRED')
    return this.ref
  }
  private async run<T>(action: () => Promise<T>, kind: 'preparation' | 'read' | 'registrationRead' | 'enrollmentRead' | 'mutation' | 'registration' | 'enrollment' = 'mutation'): Promise<T> {
    if (!this.active) throw new InvitationError('INVITATION_INVALIDATED')
    if (this.busy) throw new InvitationError('INVITATION_ACTION_PENDING')
    if (this.snapshot.unknownAction && (kind === 'mutation' || kind === 'registration' || kind === 'enrollment'))
      throw new InvitationError('INVITATION_RESULT_UNKNOWN')
    this.busy = true; this.apply({ phase: 'loading', error: null })
    try {
      const result = await action()
      if (!this.active) throw new InvitationError('INVITATION_INVALIDATED')
      const registrationUnknown = this.snapshot.unknownAction === 'registration' && kind === 'read' &&
        this.snapshot.journey?.state !== 'COMMITTED'
      const enrollmentUnknown = this.snapshot.unknownAction === 'enrollment' && kind === 'read' &&
        this.snapshot.enrollment?.state !== 'COMPLETED'
      const unknown = registrationUnknown || enrollmentUnknown
      this.apply({ phase: unknown ? 'unknown' : 'ready', ...(unknown ? {} : { unknownAction: null }) }); return result
    } catch (failure) {
      const error = failure instanceof Error ? failure : new InvitationError('INVITATION_REQUEST_FAILED')
      const code = 'code' in error ? error.code : null
      const unknown = kind !== 'preparation' && (code === 'INVITATION_RESULT_UNKNOWN' || error instanceof TypeError ||
        code === 'INVITATION_RESPONSE_INVALID' && kind !== 'read' && kind !== 'registrationRead' && kind !== 'enrollmentRead' ||
        'status' in error && typeof error.status === 'number' && error.status >= 500)
      this.apply({ phase: unknown ? 'unknown' : 'error', error,
        ...(unknown ? { unknownAction: kind === 'registration' ? 'registration' : kind === 'enrollment' ? 'enrollment' : this.snapshot.unknownAction ?? 'mutation' } : {}) }); throw error
    } finally { this.busy = false }
  }
  async recover() {
    return this.run(async () => {
      const journey = await this.api.get(this.requireRef())
      this.continuation = null
      this.apply({ journey, entryPending: false })
      if (journey.state === 'AUTHENTICATING') this.apply({ enrollment: await this.api.enrollment(this.requireRef()) })
      return journey
    }, 'read')
  }
  async authenticatedSession() {
    return this.run(async () => { const journey = await this.api.authenticatedSession(this.requireRef()); this.apply({ journey }); return journey }, 'read')
  }
  async continue() {
    return this.run(async () => {
      const view = this.snapshot.journey
      if (!view) throw new InvitationError('INVITATION_ENTRY_REQUIRED')
      const journey = await this.api.continue(this.requireRef(), view.invitationVersion)
      this.apply({ journey }); return journey
    })
  }
  async confirm() {
    if (!this.active) throw new InvitationError('INVITATION_INVALIDATED')
    if (this.snapshot.phase === 'unknown') throw new InvitationError('INVITATION_RESULT_UNKNOWN')
    if (this.snapshot.phase === 'error') throw new InvitationError('INVITATION_REFRESH_REQUIRED')
    return this.run(async () => {
      const view = this.snapshot.journey
      if (this.snapshot.entryPending || !view || view.state !== 'CONFIRM_REQUIRED') throw new InvitationError('INVITATION_CONFIRMATION_REQUIRED')
      const journey = await this.api.confirm(this.requireRef(),
        { expectedInvitationVersion: view.invitationVersion, expectedRole: view.role }, crypto.randomUUID())
      this.apply({ journey }); return journey
    })
  }
  async cancel() {
    if (this.snapshot.phase === 'unknown') throw new InvitationError('INVITATION_RESULT_UNKNOWN')
    return this.run(async () => { const journey = await this.api.cancel(this.requireRef()); this.apply({ journey }); return journey })
  }
  async register(input: InvitationRegistrationInput) {
    if (this.snapshot.phase === 'unknown') throw new InvitationError('INVITATION_RESULT_UNKNOWN')
    return this.run(async () => {
      const registration = await this.api.register(this.requireRef(), input, crypto.randomUUID())
      this.apply({ registration }); return registration
    }, 'registration')
  }
  async recoverRegistration() {
    return this.run(async () => { const registration = await this.api.registration(this.requireRef()); this.apply({ registration }); return registration }, 'registrationRead')
  }
  async verifyRegistration(code: string) {
    return this.run(async () => {
      const registration = await this.api.verifyRegistration(this.requireRef(), code)
      this.apply({ registration })
      const journey = await this.api.get(this.requireRef()); this.apply({ journey })
      if (registration.state === 'COMPLETED' && journey.state === 'AUTHENTICATING')
        this.apply({ enrollment: await this.api.enrollment(this.requireRef()) })
      return registration
    }, 'registration')
  }
  async recoverEnrollment() {
    return this.run(async () => {
      const enrollment = await this.api.enrollment(this.requireRef()); this.apply({ enrollment })
      if (enrollment.state === 'COMPLETED') this.apply({ journey: await this.api.get(this.requireRef()) })
      return enrollment
    }, 'enrollmentRead')
  }
  async startEnrollment(method: Parameters<InvitationJourneyApi['startEnrollment']>[1]) {
    return this.run(async () => {
      const result = await this.api.startEnrollment(this.requireRef(), method)
      this.apply({ enrollment: result.enrollment })
      return result
    }, 'enrollment')
  }
  async completeEnrollment(input: Parameters<InvitationJourneyApi['completeEnrollment']>[1]) {
    return this.run(async () => {
      const enrollment = await this.api.completeEnrollment(this.requireRef(), input); this.apply({ enrollment })
      this.apply({ journey: await this.api.get(this.requireRef()) })
      return enrollment
    }, 'enrollment')
  }
  async cancelEnrollment() {
    return this.run(async () => {
      const ref = this.snapshot.enrollment?.enrollmentRef
      if (!ref) throw new InvitationError('INVITATION_ENROLLMENT_REQUIRED')
      const enrollment = await this.api.cancelEnrollment(this.requireRef(), ref); this.apply({ enrollment })
      return enrollment
    }, 'enrollment')
  }
  async resendRegistration() {
    return this.run(async () => { const registration = await this.api.resendRegistration(this.requireRef()); this.apply({ registration }); return registration })
  }
  async startAuthentication() {
    return this.run(async () => { const authentication = await this.api.startAuthentication(this.requireRef()); this.apply({ authentication }); return authentication })
  }
  async challenge(method: Parameters<InvitationJourneyApi['challenge']>[1], identifier: Parameters<InvitationJourneyApi['challenge']>[2]) {
    return this.run(() => this.api.challenge(this.requireRef(), method, identifier))
  }
  async cancelRegistration() {
    return this.run(async () => { const registration = await this.api.cancelRegistration(this.requireRef()); this.apply({ registration }); return registration })
  }
  async cancelAuthentication() {
    return this.run(async () => { const authentication = await this.api.cancelAuthentication(this.requireRef()); this.apply({ authentication }); return authentication })
  }
  async authenticate(input: Parameters<InvitationJourneyApi['authenticate']>[1]) {
    return this.run(async () => {
      const authentication = await this.api.authenticate(this.requireRef(), input); this.apply({ authentication })
      if (authentication.state === 'AUTHENTICATED') this.apply({ journey: await this.api.get(this.requireRef()) })
      return authentication
    })
  }
  async mfa(method: Parameters<InvitationJourneyApi['mfa']>[1], code: string) {
    return this.run(async () => {
      const authentication = await this.api.mfa(this.requireRef(), method, code); this.apply({ authentication })
      this.apply({ journey: await this.api.get(this.requireRef()) }); return authentication
    })
  }
}
