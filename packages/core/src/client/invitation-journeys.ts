import type { LoginIdentifier } from './identity.js'
import type { PrimaryAuthentication, MfaProofMethod, PrimaryProofMethod } from './authentication-transaction.js'

export type InvitationState = 'PREVIEW' | 'AUTHENTICATING' | 'REGISTRATION_REQUIRED' | 'CONFIRM_REQUIRED' | 'COMMITTED' | 'CANCELLED' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE'
export interface InvitationJourney {
  ref: string
  kind: 'APPLICATION_REGISTRATION' | 'ORGANIZATION'
  state: InvitationState
  expiresAt: string
  invitationVersion: number
  configVersion: number
  subject: { applicationId: string; applicationName: string; organizationId: string | null; organizationName: string | null }
  maskedRecipient: string | null
  role: string | null
  nextAction: { type: string; url?: string }
  result: string | null
}
export interface InvitationRegistration {
  registrationRef: string
  state: string
  expiresAt: string
  nextAction: string
  nextChallengeAt: string | null
}
export interface InvitationAuthentication {
  authRef: string
  state: string
  expiresAt: string
  methods: InvitationAuthMethod[]
  providers: InvitationAuthProvider[]
}
export interface InvitationAuthMethod {
  type: 'PASSWORD' | 'EMAIL_OTP' | 'SMS_OTP' | 'EMAIL_MAGIC_LINK' | 'SOCIAL'
  enabled: boolean
  configured: boolean
  availableForLogin: boolean
  availableForSignup: boolean
  unavailableReason: string | null
}
export interface InvitationAuthProvider {
  id: string
  providerType: string
  displayName: string
  enabled: boolean
  configured: boolean
  clickable: boolean
  availableForLogin: boolean
  availableForSignup: boolean
  unavailableReason: string | null
  authorizationUrl: string | null
}
export interface InvitationConfirm {
  expectedInvitationVersion: number
  expectedRole: string | null
}
export type InvitationEnrollmentMethod = 'TOTP' | 'WEBAUTHN'
export interface InvitationEnrollment {
  enrollmentRef: string | null
  method: InvitationEnrollmentMethod | null
  state: 'AVAILABLE' | 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'UNAVAILABLE'
  expiresAt: string | null
  availableMethods: InvitationEnrollmentMethod[]
  reasonCode: string | null
}
/** One-time material belongs to the initiating view, never a cache or ordinary session. */
export interface InvitationEnrollmentBegin {
  enrollment: InvitationEnrollment
  delivery: 'AVAILABLE' | 'ALREADY_DELIVERED' | 'NOT_APPLICABLE'
  totp: { secret: string; qrCodeUri: string; issuer: string } | null
  webauthn: { requestId: string; publicKeyCredentialCreationOptions: string } | null
}
export type InvitationEnrollmentCompletion = { enrollmentRef: string } & (
  { code: string; credential?: never } | { credential: string; code?: never }
)
export type InvitationRegistrationInput = { identifier: LoginIdentifier; password: string; locale?: string }
export type InvitationSessionRequest =
  | { action: 'invitationPrepare'; body: { continuation: string; mode: 'authenticated' | 'registration' } }
  | { action: 'invitationExchange' | 'invitationRegistrationContext'; body: { continuation: string } }
  | { action: 'invitationGet' | 'invitationCancel' | 'invitationRegistrationGet' | 'invitationRegistrationResend' | 'invitationRegistrationCancel' | 'invitationAuthenticationStart' | 'invitationAuthenticatedSession' | 'invitationAuthenticationCancel'; ref: string }
  | { action: 'invitationContinue'; ref: string; body: { expectedVersion: number } }
  | { action: 'invitationConfirm'; ref: string; body: InvitationConfirm; idempotencyKey: string }
  | { action: 'invitationRegister'; ref: string; body: InvitationRegistrationInput; idempotencyKey: string }
  | { action: 'invitationRegistrationVerify'; ref: string; body: { code: string } }
  | { action: 'invitationAuthenticate'; ref: string; body: PrimaryAuthentication }
  | { action: 'invitationChallenge'; ref: string; body: { method: PrimaryProofMethod; identifier: LoginIdentifier } }
  | { action: 'invitationMfa'; ref: string; body: { method: MfaProofMethod; code: string } }
  | { action: 'invitationEnrollmentGet'; ref: string }
  | { action: 'invitationEnrollmentStart'; ref: string; body: { method: InvitationEnrollmentMethod } }
  | { action: 'invitationEnrollmentComplete'; ref: string; body: InvitationEnrollmentCompletion }
  | { action: 'invitationEnrollmentCancel'; ref: string; body: { enrollmentRef: string } }
export class InvitationError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(code); this.name = 'InvitationError' }
}
export interface InvitationClientConfig {
  issuer: string
  clientId: string
  applicationId?: string
  getAccessToken: () => string | null | Promise<string | null>
  timeoutMs?: number
  signal?: AbortSignal
}
export function invitationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return value
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value) }
function instant(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return result
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return value
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return value
}
function authorityFree(value: Record<string, unknown>) {
  if (['control', 'controlSecret', 'context', 'access_token', 'refresh_token'].some(key => key in value))
    throw new InvitationError('INVITATION_RESPONSE_INVALID')
}
export function parseInvitationEnrollment(value: unknown): InvitationEnrollment {
  const v = invitationRecord(value)
  authorityFree(v)
  if (!['AVAILABLE', 'PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'UNAVAILABLE'].includes(String(v.state)) ||
      v.method !== null && v.method !== 'TOTP' && v.method !== 'WEBAUTHN' ||
      !Array.isArray(v.availableMethods) || !v.availableMethods.every(m => m === 'TOTP' || m === 'WEBAUTHN') ||
      ['secret', 'totp', 'webauthn', 'credential'].some(key => key in v))
    throw new InvitationError('INVITATION_RESPONSE_INVALID')
  const result: InvitationEnrollment = {
    enrollmentRef: v.enrollmentRef === null ? null : invitationRef(text(v.enrollmentRef)),
    method: v.method, state: v.state as InvitationEnrollment['state'],
    expiresAt: v.expiresAt === null ? null : instant(v.expiresAt),
    availableMethods: [...v.availableMethods], reasonCode: nullableText(v.reasonCode),
  }
  if (['PENDING', 'COMPLETED'].includes(result.state) && (!result.enrollmentRef || !result.method || !result.expiresAt))
    throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return result
}
export function parseInvitationEnrollmentBegin(value: unknown): InvitationEnrollmentBegin {
  const v = invitationRecord(value), enrollment = parseInvitationEnrollment(v.enrollment)
  authorityFree(v)
  if (!['AVAILABLE', 'ALREADY_DELIVERED', 'NOT_APPLICABLE'].includes(String(v.delivery)))
    throw new InvitationError('INVITATION_RESPONSE_INVALID')
  let totp: InvitationEnrollmentBegin['totp'] = null, webauthn: InvitationEnrollmentBegin['webauthn'] = null
  if (v.totp !== null) {
    const t = invitationRecord(v.totp)
    totp = { secret: text(t.secret), qrCodeUri: text(t.qrCodeUri), issuer: text(t.issuer) }
    if (!/^[A-Z2-7]+=*$/.test(totp.secret) || !totp.qrCodeUri.startsWith('otpauth://totp/'))
      throw new InvitationError('INVITATION_RESPONSE_INVALID')
  }
  if (v.webauthn !== null) {
    const w = invitationRecord(v.webauthn)
    webauthn = { requestId: text(w.requestId), publicKeyCredentialCreationOptions: text(w.publicKeyCredentialCreationOptions) }
  }
  if (v.delivery === 'AVAILABLE'
    ? enrollment.state !== 'PENDING' || (enrollment.method === 'TOTP' ? !totp || webauthn !== null : !webauthn || totp !== null)
    : totp !== null || webauthn !== null) throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return { enrollment, delivery: v.delivery as InvitationEnrollmentBegin['delivery'], totp, webauthn }
}
function enrollmentCompletion(input: InvitationEnrollmentCompletion): InvitationEnrollmentCompletion {
  const enrollmentRef = invitationRef(input.enrollmentRef)
  if (input.code !== undefined && input.credential === undefined && /^[0-9]{6}$/.test(input.code))
    return { enrollmentRef, code: input.code }
  if (input.code === undefined && typeof input.credential === 'string' && input.credential.length > 0 && input.credential.length <= 65536)
    return { enrollmentRef, credential: input.credential }
  throw new InvitationError('INVITATION_INPUT_INVALID')
}
export function invitationRef(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new InvitationError('INVITATION_REF_INVALID')
  return value
}
function opaque(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new InvitationError('INVITATION_INPUT_INVALID')
  return value
}
function identifierInput(value: LoginIdentifier): LoginIdentifier {
  const v = invitationRecord(value)
  if (!['EMAIL', 'USERNAME', 'PHONE'].includes(String(v.kind)) || typeof v.value !== 'string' ||
      !v.value.trim() || v.value.length > 320 || Object.keys(v).some(k => !['kind', 'value', 'region'].includes(k)) ||
      v.region !== undefined && (v.kind !== 'PHONE' || typeof v.region !== 'string'))
    throw new InvitationError('INVITATION_INPUT_INVALID')
  return value
}
export function parseInvitationJourney(value: unknown): InvitationJourney {
  const v = invitationRecord(value), s = invitationRecord(v.subject), n = invitationRecord(v.nextAction)
  if (!['APPLICATION_REGISTRATION', 'ORGANIZATION'].includes(String(v.kind)) ||
      !['PREVIEW', 'AUTHENTICATING', 'REGISTRATION_REQUIRED', 'CONFIRM_REQUIRED', 'COMMITTED', 'CANCELLED', 'EXPIRED', 'REVOKED', 'UNAVAILABLE'].includes(String(v.state)) ||
      ['control', 'context', 'access_token', 'refresh_token'].some(key => key in v))
    throw new InvitationError('INVITATION_RESPONSE_INVALID')
  let url: string | undefined
  if (n.url !== undefined) {
    let parsed: URL
    try { parsed = new URL(text(n.url)) } catch { throw new InvitationError('INVITATION_RESPONSE_INVALID') }
    const keys = [...parsed.searchParams.keys()]
    // Only the producer's one-use application handoff may carry a query.
    const continuation = keys.length === 1 && keys[0] === 'continuation' &&
      /^[A-Za-z0-9_-]{43}$/.test(parsed.searchParams.get('continuation') ?? '')
    if (n.type !== 'NAVIGATE' || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash ||
        parsed.search && (!continuation || v.state === 'COMMITTED'))
      throw new InvitationError('INVITATION_RESPONSE_INVALID')
    url = parsed.href
  }
  return {
    ref: invitationRef(text(v.ref)), kind: v.kind as InvitationJourney['kind'], state: v.state as InvitationState,
    expiresAt: instant(v.expiresAt), invitationVersion: version(v.invitationVersion), configVersion: version(v.configVersion),
    subject: { applicationId: invitationRef(text(s.applicationId)), applicationName: text(s.applicationName),
      organizationId: s.organizationId === null ? null : invitationRef(text(s.organizationId)), organizationName: nullableText(s.organizationName) },
    maskedRecipient: nullableText(v.maskedRecipient), role: nullableText(v.role), result: nullableText(v.result),
    nextAction: { type: text(n.type), ...(url ? { url } : {}) },
  }
}
export function parseInvitationRegistration(value: unknown): InvitationRegistration {
  const v = invitationRecord(value)
  authorityFree(v)
  return { registrationRef: invitationRef(text(v.registrationRef)), state: text(v.state), expiresAt: instant(v.expiresAt),
    nextAction: text(v.nextAction), nextChallengeAt: v.nextChallengeAt === null ? null : instant(v.nextChallengeAt) }
}
export function parseInvitationAuthentication(value: unknown): InvitationAuthentication {
  const v = invitationRecord(value)
  authorityFree(v)
  if (!Array.isArray(v.methods) || !Array.isArray(v.providers)) throw new InvitationError('INVITATION_RESPONSE_INVALID')
  return { authRef: invitationRef(text(v.authRef)), state: text(v.state), expiresAt: instant(v.expiresAt),
    methods: v.methods.map(value => {
      const m = invitationRecord(value)
      if (!['PASSWORD', 'EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK', 'SOCIAL'].includes(String(m.type)))
        throw new InvitationError('INVITATION_RESPONSE_INVALID')
      return { type: m.type as InvitationAuthMethod['type'], enabled: flag(m.enabled), configured: flag(m.configured),
        availableForLogin: flag(m.availableForLogin), availableForSignup: flag(m.availableForSignup),
        unavailableReason: nullableText(m.unavailableReason) }
    }),
    providers: v.providers.map(value => {
      const p = invitationRecord(value)
      return { id: invitationRef(text(p.id)), providerType: text(p.providerType), displayName: text(p.displayName),
        enabled: flag(p.enabled), configured: flag(p.configured), clickable: flag(p.clickable),
        availableForLogin: flag(p.availableForLogin), availableForSignup: flag(p.availableForSignup),
        unavailableReason: nullableText(p.unavailableReason), authorizationUrl: nullableText(p.authorizationUrl) }
    }) }
}

/** Application authority only: never issuer cookies, raw owner control, or automatic mutation retries. */
export class InvitationJourneyClient {
  private readonly base: string
  private contexts = new Map<string, { proof: string; expiresAt: number }>()
  private entries = new Map<string, { ref: string; context: string }>()
  private lifetime = new AbortController()
  constructor(protected readonly config: InvitationClientConfig) {
    const issuer = new URL(config.issuer)
    if (!['http:', 'https:'].includes(issuer.protocol) || issuer.username || issuer.password || issuer.search || issuer.hash ||
        issuer.pathname !== '/' || !config.clientId.trim() ||
        config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1))
      throw new InvitationError('INVITATION_CONFIG_INVALID')
    if (config.applicationId !== undefined) invitationRef(config.applicationId)
    this.base = issuer.origin + '/api/v1/auth/invitation-journeys'
  }
  protected registrationHeaders(): Record<string, string> { return {} }
  clear() { this.contexts.clear(); this.entries.clear(); this.lifetime.abort(); this.lifetime = new AbortController() }
  /** Explicit authority change after normal OAuth login; never a silent fallback. */
  useAuthenticatedSession(ref: string) { this.contexts.delete(invitationRef(ref)) }
  async authenticatedSession(ref: string) {
    this.useAuthenticatedSession(ref)
    return this.get(ref)
  }
  private scoped(value: unknown): InvitationJourney {
    const view = parseInvitationJourney(value)
    if (this.config.applicationId !== undefined && view.subject.applicationId !== this.config.applicationId) throw new InvitationError('INVITATION_ACCOUNT_MISMATCH')
    return view
  }
  private async request(method: 'GET' | 'POST', path: string, body?: unknown, key?: string, ref?: string, registration = false, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const lifetime = this.lifetime.signal
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (key !== undefined) {
      if (!key.trim() || key.length > 128) throw new InvitationError('INVITATION_INPUT_INVALID')
      headers['Idempotency-Key'] = key
    }
    const context = ref === undefined ? undefined : this.contexts.get(ref)
    if (context) {
      if (context.expiresAt <= Date.now()) throw new InvitationError('INVITATION_CONTEXT_EXPIRED', 410)
      headers['X-Invitation-Context'] = context.proof; headers['X-Invitation-Client'] = this.config.clientId
      Object.assign(headers, this.registrationHeaders())
    } else if (registration) Object.assign(headers, this.registrationHeaders())
    else {
      const token = await this.config.getAccessToken()
      if (!token) throw new InvitationError('INVITATION_AUTH_REQUIRED', 401)
      headers.Authorization = `Bearer ${token}`
    }
    const controller = new AbortController(), external = this.config.signal
    const abort = () => controller.abort()
    lifetime.addEventListener('abort', abort, { once: true })
    external?.addEventListener('abort', abort, { once: true })
    if (lifetime.aborted || external?.aborted) abort()
    const timeout = setTimeout(abort, this.config.timeoutMs ?? 10000)
    let response: Response, data: unknown
    try {
      if (lifetime.aborted || external?.aborted) throw new InvitationError('INVITATION_INVALIDATED')
      response = await fetch(this.base + path, { method, headers, credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      data = await response.json()
      if (lifetime.aborted || external?.aborted) throw new InvitationError('INVITATION_INVALIDATED')
    } catch (error) {
      if (error instanceof InvitationError) throw error
      throw new InvitationError('INVITATION_RESULT_UNKNOWN')
    } finally {
      clearTimeout(timeout)
      lifetime.removeEventListener('abort', abort)
      external?.removeEventListener('abort', abort)
    }
    if (!response.ok) {
      const error = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' && /^[A-Z0-9_]+$/.test(data.error)
        ? data.error : 'INVITATION_REQUEST_FAILED'
      throw new InvitationError(error, response.status)
    }
    return data
  }
  /** Read the safe ref before exchanging. A registration proof is retained in memory before POST. */
  async prepareEntry(continuation: string, mode: 'authenticated' | 'registration'): Promise<InvitationJourney> {
    const proof = opaque(continuation)
    if (mode !== 'authenticated' && mode !== 'registration') throw new InvitationError('INVITATION_INPUT_INVALID')
    const view = this.scoped(await this.request('GET', '/continuations', undefined, undefined, undefined, mode === 'registration',
      { 'X-Invitation-Continuation': proof, 'X-Invitation-Client': this.config.clientId }))
    if (mode === 'registration') {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const context = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      this.entries.set(proof, { ref: view.ref, context })
      this.contexts.set(view.ref, { proof: context, expiresAt: Math.min(Date.parse(view.expiresAt), Date.now() + 600_000) })
    }
    return view
  }
  async exchange(continuation: string): Promise<InvitationJourney> {
    return this.scoped(await this.request('POST', '/continuations/exchange', { continuation: opaque(continuation) }))
  }
  async registrationContext(continuation: string): Promise<InvitationJourney> {
    const continuationProof = opaque(continuation)
    if (!this.entries.has(continuationProof)) await this.prepareEntry(continuationProof, 'registration')
    const prepared = this.entries.get(continuationProof)
    if (!prepared) throw new InvitationError('INVITATION_ENTRY_REQUIRED')
    const raw = invitationRecord(await this.request('POST', '/continuations/registration',
      { continuation: continuationProof, clientId: this.config.clientId, context: prepared.context }, undefined, undefined, true))
    const view = this.scoped(raw.journey), proof = opaque(raw.context), expiresAt = Date.parse(instant(raw.expiresAt))
    if (view.ref !== prepared.ref || proof !== prepared.context || raw.clientId !== this.config.clientId || expiresAt <= Date.now() || expiresAt > Date.now() + 600_000 || expiresAt > Date.parse(view.expiresAt))
      throw new InvitationError('INVITATION_RESPONSE_INVALID')
    this.contexts.set(view.ref, { proof, expiresAt })
    this.entries.delete(continuationProof)
    return view
  }
  async get(ref: string) {
    const view = this.scoped(await this.request('GET', '/' + invitationRef(ref), undefined, undefined, ref))
    for (const [proof, entry] of this.entries) if (entry.ref === view.ref) this.entries.delete(proof)
    return view
  }
  async continue(ref: string, expectedVersion: number) {
    return this.scoped(await this.request('POST', '/' + invitationRef(ref) + '/continue', { expectedVersion: version(expectedVersion) }, undefined, ref))
  }
  async confirm(ref: string, input: InvitationConfirm, idempotencyKey: string) {
    const body = { expectedInvitationVersion: version(input.expectedInvitationVersion), expectedRole: nullableText(input.expectedRole) }
    return this.scoped(await this.request('POST', '/' + invitationRef(ref) + '/confirm', body, idempotencyKey, ref))
  }
  async cancel(ref: string) { return this.scoped(await this.request('POST', '/' + invitationRef(ref) + '/cancel', {}, undefined, ref)) }
  async register(ref: string, input: InvitationRegistrationInput, idempotencyKey: string) {
    const identifier = identifierInput(input.identifier)
    if (identifier.kind === 'PHONE' || typeof input.password !== 'string' || !input.password.trim() ||
        input.password.length > 1024 || input.locale !== undefined && (typeof input.locale !== 'string' || input.locale.length > 64))
      throw new InvitationError('INVITATION_INPUT_INVALID')
    const body = { identifier, password: input.password, ...(input.locale === undefined ? {} : { locale: input.locale }) }
    return parseInvitationRegistration(await this.request('POST', '/' + invitationRef(ref) + '/authentication/registration', body, idempotencyKey, ref))
  }
  async registration(ref: string) {
    return parseInvitationRegistration(await this.request('GET', '/' + invitationRef(ref) + '/authentication/registration', undefined, undefined, ref))
  }
  async verifyRegistration(ref: string, code: string) {
    if (!/^\d{6}$/.test(code)) throw new InvitationError('INVITATION_INPUT_INVALID')
    return parseInvitationRegistration(await this.request('POST', '/' + invitationRef(ref) + '/authentication/registration/verify', { code }, undefined, ref))
  }
  async resendRegistration(ref: string) {
    return parseInvitationRegistration(await this.request('POST', '/' + invitationRef(ref) + '/authentication/registration/resend', {}, undefined, ref))
  }
  async cancelRegistration(ref: string) {
    return parseInvitationRegistration(await this.request('POST', '/' + invitationRef(ref) + '/authentication/registration/cancel', {}, undefined, ref))
  }
  async startAuthentication(ref: string) {
    return parseInvitationAuthentication(await this.request('POST', '/' + invitationRef(ref) + '/authentication/start', {}, undefined, ref))
  }
  async cancelAuthentication(ref: string) {
    return parseInvitationAuthentication(await this.request('POST', '/' + invitationRef(ref) + '/authentication/cancel', {}, undefined, ref))
  }
  async authenticate(ref: string, input: PrimaryAuthentication) {
    const identifier = identifierInput(input.identifier)
    if (!['PASSWORD', 'EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'].includes(input.method)) throw new InvitationError('INVITATION_INPUT_INVALID')
    const proof = input.method === 'PASSWORD' ? input.password : input.proof
    if (typeof proof !== 'string' || !proof.trim() || proof.length > 1024) throw new InvitationError('INVITATION_INPUT_INVALID')
    const body = input.method === 'PASSWORD' ? { method: input.method, identifier, password: proof } : { method: input.method, identifier, proof }
    return parseInvitationAuthentication(await this.request('POST', '/' + invitationRef(ref) + '/authentication/authenticate', body, undefined, ref))
  }
  async challenge(ref: string, method: PrimaryProofMethod, identifier: LoginIdentifier) {
    if (!['EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'].includes(method)) throw new InvitationError('INVITATION_INPUT_INVALID')
    const data = invitationRecord(await this.request('POST', '/' + invitationRef(ref) + '/authentication/challenges', { method, identifier: identifierInput(identifier) }, undefined, ref))
    return { authRef: invitationRef(text(data.authRef)), expiresAt: instant(data.expiresAt), nextAction: text(data.nextAction) }
  }
  async mfa(ref: string, method: MfaProofMethod, code: string) {
    if (!['TOTP', 'RECOVERY_CODE'].includes(method) || typeof code !== 'string' || !code.trim() || code.length > 256)
      throw new InvitationError('INVITATION_INPUT_INVALID')
    return parseInvitationAuthentication(await this.request('POST', '/' + invitationRef(ref) + '/authentication/mfa', { method, code }, undefined, ref))
  }
  async enrollment(ref: string) {
    return parseInvitationEnrollment(await this.request('GET', '/' + invitationRef(ref) + '/authentication/mfa/enrollment', undefined, undefined, ref))
  }
  async startEnrollment(ref: string, method: InvitationEnrollmentMethod) {
    if (method !== 'TOTP' && method !== 'WEBAUTHN') throw new InvitationError('INVITATION_INPUT_INVALID')
    return parseInvitationEnrollmentBegin(await this.request('POST', '/' + invitationRef(ref) + '/authentication/mfa/enrollment', { method }, undefined, ref))
  }
  async completeEnrollment(ref: string, input: InvitationEnrollmentCompletion) {
    return parseInvitationEnrollment(await this.request('POST', '/' + invitationRef(ref) + '/authentication/mfa/enrollment/complete', enrollmentCompletion(input), undefined, ref))
  }
  async cancelEnrollment(ref: string, enrollmentRef: string) {
    return parseInvitationEnrollment(await this.request('POST', '/' + invitationRef(ref) + '/authentication/mfa/enrollment/cancel', { enrollmentRef: invitationRef(enrollmentRef) }, undefined, ref))
  }
}
export type InvitationJourneyApi = Pick<InvitationJourneyClient, 'prepareEntry' | 'exchange' | 'registrationContext' | 'get' | 'continue' |
  'confirm' | 'cancel' | 'register' | 'registration' | 'verifyRegistration' | 'resendRegistration' | 'cancelRegistration' |
  'startAuthentication' | 'cancelAuthentication' | 'authenticate' | 'challenge' | 'mfa' | 'authenticatedSession' |
  'enrollment' | 'startEnrollment' | 'completeEnrollment' | 'cancelEnrollment'>

/** Safe-view consumer of a finite customer BFF. The browser never sees its upstream context. */
export class SessionInvitationJourneyClient implements InvitationJourneyApi {
  constructor(private readonly send: (request: InvitationSessionRequest) => Promise<unknown>) {}
  async prepareEntry(continuation: string, mode: 'authenticated' | 'registration') {
    return parseInvitationJourney(await this.send({ action: 'invitationPrepare', body: { continuation: opaque(continuation), mode } }))
  }
  async exchange(continuation: string) { return parseInvitationJourney(await this.send({ action: 'invitationExchange', body: { continuation: opaque(continuation) } })) }
  async registrationContext(continuation: string) { return parseInvitationJourney(await this.send({ action: 'invitationRegistrationContext', body: { continuation: opaque(continuation) } })) }
  async get(ref: string) { return parseInvitationJourney(await this.send({ action: 'invitationGet', ref: invitationRef(ref) })) }
  async authenticatedSession(ref: string) { return parseInvitationJourney(await this.send({ action: 'invitationAuthenticatedSession', ref: invitationRef(ref) })) }
  async continue(ref: string, expectedVersion: number) { return parseInvitationJourney(await this.send({ action: 'invitationContinue', ref: invitationRef(ref), body: { expectedVersion: version(expectedVersion) } })) }
  async confirm(ref: string, body: InvitationConfirm, idempotencyKey: string) { return parseInvitationJourney(await this.send({ action: 'invitationConfirm', ref: invitationRef(ref), body, idempotencyKey })) }
  async cancel(ref: string) { return parseInvitationJourney(await this.send({ action: 'invitationCancel', ref: invitationRef(ref) })) }
  async register(ref: string, body: InvitationRegistrationInput, idempotencyKey: string) { return parseInvitationRegistration(await this.send({ action: 'invitationRegister', ref: invitationRef(ref), body, idempotencyKey })) }
  async registration(ref: string) { return parseInvitationRegistration(await this.send({ action: 'invitationRegistrationGet', ref: invitationRef(ref) })) }
  async verifyRegistration(ref: string, code: string) { return parseInvitationRegistration(await this.send({ action: 'invitationRegistrationVerify', ref: invitationRef(ref), body: { code } })) }
  async resendRegistration(ref: string) { return parseInvitationRegistration(await this.send({ action: 'invitationRegistrationResend', ref: invitationRef(ref) })) }
  async cancelRegistration(ref: string) { return parseInvitationRegistration(await this.send({ action: 'invitationRegistrationCancel', ref: invitationRef(ref) })) }
  async startAuthentication(ref: string) { return parseInvitationAuthentication(await this.send({ action: 'invitationAuthenticationStart', ref: invitationRef(ref) })) }
  async cancelAuthentication(ref: string) { return parseInvitationAuthentication(await this.send({ action: 'invitationAuthenticationCancel', ref: invitationRef(ref) })) }
  async authenticate(ref: string, body: PrimaryAuthentication) { return parseInvitationAuthentication(await this.send({ action: 'invitationAuthenticate', ref: invitationRef(ref), body })) }
  async challenge(ref: string, method: PrimaryProofMethod, identifier: LoginIdentifier) {
    const v = invitationRecord(await this.send({ action: 'invitationChallenge', ref: invitationRef(ref), body: { method, identifier } }))
    return { authRef: invitationRef(text(v.authRef)), expiresAt: instant(v.expiresAt), nextAction: text(v.nextAction) }
  }
  async mfa(ref: string, method: MfaProofMethod, code: string) { return parseInvitationAuthentication(await this.send({ action: 'invitationMfa', ref: invitationRef(ref), body: { method, code } })) }
  async enrollment(ref: string) { return parseInvitationEnrollment(await this.send({ action: 'invitationEnrollmentGet', ref: invitationRef(ref) })) }
  async startEnrollment(ref: string, method: InvitationEnrollmentMethod) {
    if (method !== 'TOTP' && method !== 'WEBAUTHN') throw new InvitationError('INVITATION_INPUT_INVALID')
    return parseInvitationEnrollmentBegin(await this.send({ action: 'invitationEnrollmentStart', ref: invitationRef(ref), body: { method } }))
  }
  async completeEnrollment(ref: string, input: InvitationEnrollmentCompletion) {
    return parseInvitationEnrollment(await this.send({ action: 'invitationEnrollmentComplete', ref: invitationRef(ref), body: enrollmentCompletion(input) }))
  }
  async cancelEnrollment(ref: string, enrollmentRef: string) {
    return parseInvitationEnrollment(await this.send({ action: 'invitationEnrollmentCancel', ref: invitationRef(ref), body: { enrollmentRef: invitationRef(enrollmentRef) } }))
  }
}

export function invitationSessionRoute(input: InvitationSessionRequest): readonly ['GET' | 'POST', string] {
  const suffixes = {
    invitationGet: '', invitationContinue: '/continue', invitationConfirm: '/confirm', invitationCancel: '/cancel',
    invitationRegister: '/authentication/registration', invitationRegistrationGet: '/authentication/registration',
    invitationRegistrationVerify: '/authentication/registration/verify', invitationRegistrationResend: '/authentication/registration/resend',
    invitationRegistrationCancel: '/authentication/registration/cancel', invitationAuthenticationStart: '/authentication/start',
    invitationAuthenticate: '/authentication/authenticate', invitationChallenge: '/authentication/challenges', invitationMfa: '/authentication/mfa',
    invitationAuthenticatedSession: '/authenticated-session', invitationAuthenticationCancel: '/authentication/cancel',
    invitationEnrollmentGet: '/authentication/mfa/enrollment', invitationEnrollmentStart: '/authentication/mfa/enrollment',
    invitationEnrollmentComplete: '/authentication/mfa/enrollment/complete', invitationEnrollmentCancel: '/authentication/mfa/enrollment/cancel',
  } as const
  if (input.action === 'invitationPrepare') return ['POST', '/invitation-journeys/continuations/prepare']
  if (input.action === 'invitationExchange' || input.action === 'invitationRegistrationContext')
    return ['POST', '/invitation-journeys/continuations/' + (input.action === 'invitationExchange' ? 'exchange' : 'registration')]
  if (!('ref' in input) || !(input.action in suffixes)) throw new InvitationError('INVITATION_INPUT_INVALID')
  return [input.action === 'invitationGet' || input.action === 'invitationRegistrationGet' || input.action === 'invitationEnrollmentGet' ? 'GET' : 'POST',
    '/invitation-journeys/' + invitationRef(input.ref) + suffixes[input.action]]
}

/** Read and scrub before any asynchronous exchange, navigation, analytics, or provider work. */
export function consumeInvitationContinuation(location: Pick<Location, 'href'>, history: Pick<History, 'replaceState'>): string | null {
  const url = new URL(location.href), values = url.searchParams.getAll('continuation')
  if (!values.length) return null
  url.searchParams.delete('continuation')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
  if (values.length !== 1) throw new InvitationError('INVITATION_INPUT_INVALID')
  return opaque(values[0])
}
