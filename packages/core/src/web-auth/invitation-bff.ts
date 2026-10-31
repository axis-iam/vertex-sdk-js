import { timingSafeEqual } from 'node:crypto'
import {
  InvitationError, InvitationJourneyClient, invitationRecord, invitationRef,
} from '../client/invitation-journeys.js'
import type { InvitationClientConfig, InvitationRegistrationInput, InvitationEnrollmentCompletion } from '../client/invitation-journeys.js'
import type { PrimaryAuthentication, PrimaryProofMethod, MfaProofMethod } from '../client/authentication-transaction.js'
import type { LoginIdentifier } from '../client/identity.js'

export class ConfidentialInvitationClient extends InvitationJourneyClient {
  private readonly secret: string
  constructor(config: InvitationClientConfig & { clientSecret: string }) {
    super(config)
    if (typeof window !== 'undefined' || !config.clientSecret.trim()) throw new InvitationError('INVITATION_CONFIG_INVALID')
    this.secret = config.clientSecret
  }
  protected override registrationHeaders() {
    return { Authorization: 'Basic ' + Buffer.from(this.config.clientId + ':' + this.secret).toString('base64') }
  }
}

/** Resolved by the host's validated HttpOnly (prelogin or OAuth) session, never from request JSON. */
export interface InvitationBffSession {
  /** Must change on user, Application, Client, or authentication-owner replacement. */
  owner: string
  csrfToken: string
  expiresAt: number
  accessToken: string | null
  /** From a verified token or authenticated /me response, never decoded JWT text. */
  identity: { applicationId: string; clientId: string; userId: string } | null
}
export interface InvitationBffConfig {
  issuer: string
  applicationId: string
  clientId: string
  clientSecret: string
  applicationOrigin: string
  basePath: string
  resolveSession: (request: Request) => Promise<InvitationBffSession | null>
  maxOwners?: number
}
interface Owner {
  client: ConfidentialInvitationClient
  token: { value: string | null }
  expiresAt: number
  refs: Set<string>
  identity: string | null
}

/** Finite single-process BFF adapter. Route it behind the host's secure HttpOnly session store. */
export class InvitationBff {
  private readonly owners = new Map<string, Owner>()
  private readonly origin: string
  constructor(private readonly config: InvitationBffConfig) {
    const url = new URL(config.applicationOrigin)
    if (url.href !== url.origin + '/' || !['http:', 'https:'].includes(url.protocol) ||
        !/^\/[A-Za-z0-9/_-]+$/.test(config.basePath) || config.basePath.endsWith('/') ||
        config.maxOwners !== undefined && (!Number.isSafeInteger(config.maxOwners) || config.maxOwners < 1))
      throw new InvitationError('INVITATION_CONFIG_INVALID')
    this.origin = url.origin
    // Validate upstream configuration without creating an owner or persisting credentials.
    new ConfidentialInvitationClient({ ...config, getAccessToken: () => null })
  }
  releaseOwner(owner: string) { this.owners.get(owner)?.client.clear(); this.owners.delete(owner) }
  dispose() { for (const owner of this.owners.keys()) this.releaseOwner(owner) }

  async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.origin !== this.origin || url.search || url.hash ||
          !url.pathname.startsWith(this.config.basePath + '/')) throw new InvitationError('NOT_FOUND', 404)
      const origin = request.headers.get('Origin')
      if (origin !== null && origin !== this.origin ||
          ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site') ?? ''))
        throw new InvitationError('INVITATION_ORIGIN_DENIED', 403)
      if (request.headers.has('Authorization') || request.headers.has('X-Invitation-Context') ||
          request.headers.has('X-Invitation-Client')) throw new InvitationError('INVITATION_AUTHORITY_DENIED', 403)
      const session = await this.config.resolveSession(request)
      if (!session || !session.owner || session.expiresAt <= Date.now() ||
          !/^[A-Za-z0-9_-]{43}$/.test(session.csrfToken)) throw new InvitationError('SESSION_REQUIRED', 401)
      if (!Number.isFinite(session.expiresAt) || (session.accessToken === null) !== (session.identity === null) ||
          session.identity && (session.identity.applicationId !== this.config.applicationId ||
            session.identity.clientId !== this.config.clientId || !session.identity.userId))
        throw new InvitationError('INVITATION_ACCOUNT_MISMATCH', 403)
      const identity = session.identity ? JSON.stringify([session.identity.applicationId, session.identity.clientId, session.identity.userId]) : null
      const write = request.method === 'POST'
      if (!['GET', 'POST'].includes(request.method)) throw new InvitationError('METHOD_NOT_ALLOWED', 405)
      if (write && (origin !== this.origin || !equal(request.headers.get('X-CSRF-Token'), session.csrfToken)))
        throw new InvitationError('SESSION_CSRF_REQUIRED', 403)
      for (const [key, value] of this.owners) if (value.expiresAt <= Date.now()) this.releaseOwner(key)
      let owner = this.owners.get(session.owner)
      if (!owner) {
        if (this.owners.size >= (this.config.maxOwners ?? 1000)) throw new InvitationError('INVITATION_CAPACITY_EXCEEDED', 503)
        const token = { value: session.accessToken }
        const created: Owner = { client: new ConfidentialInvitationClient({ ...this.config, getAccessToken: () => token.value }),
          token, expiresAt: session.expiresAt, refs: new Set(), identity }
        owner = created; this.owners.set(session.owner, owner)
      }
      if (owner.identity !== null && owner.identity !== identity) {
        this.releaseOwner(session.owner)
        throw new InvitationError('INVITATION_ACCOUNT_MISMATCH', 403)
      }
      owner.identity = identity
      owner.token.value = session.accessToken; owner.expiresAt = session.expiresAt
      const path = url.pathname.slice(this.config.basePath.length)
      const body: unknown = write ? await request.json() : undefined
      if (path === '/continuations/prepare') {
        if (!write) throw new InvitationError('METHOD_NOT_ALLOWED', 405)
        const b = exact(body, ['continuation', 'mode'])
        if (typeof b.continuation !== 'string' || (b.mode !== 'authenticated' && b.mode !== 'registration'))
          throw new InvitationError('INVITATION_INPUT_INVALID', 400)
        const result = await owner.client.prepareEntry(b.continuation, b.mode)
        owner.refs.add(result.ref)
        return response(result)
      }
      if (path === '/continuations/exchange' || path === '/continuations/registration') {
        if (!write) throw new InvitationError('METHOD_NOT_ALLOWED', 405)
        const b = exact(body, ['continuation'])
        if (typeof b.continuation !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
        const result = path.endsWith('/exchange') ? await owner.client.exchange(b.continuation) : await owner.client.registrationContext(b.continuation)
        owner.refs.add(result.ref)
        return response(result)
      }
      const match = /^\/([0-9a-f-]{36})(\/.*)?$/i.exec(path)
      if (!match) throw new InvitationError('NOT_FOUND', 404)
      const ref = invitationRef(match[1]), suffix = match[2] ?? ''
      if (!owner.refs.has(ref)) {
        if (!write && suffix === '' && session.identity) {
          const result = await owner.client.get(ref)
          owner.refs.add(ref)
          return response(result)
        }
        throw new InvitationError('NOT_FOUND', 404)
      }
      if (!write) {
        if (suffix === '') return response(await owner.client.get(ref))
        if (suffix === '/authentication/registration') return response(await owner.client.registration(ref))
        if (suffix === '/authentication/mfa/enrollment') return response(await owner.client.enrollment(ref))
        throw new InvitationError('NOT_FOUND', 404)
      }
      const key = () => {
        const value = request.headers.get('Idempotency-Key')
        if (!value || value.length > 128) throw new InvitationError('INVITATION_INPUT_INVALID', 400)
        return value
      }
      const client = owner.client
      switch (suffix) {
        case '/authentication/mfa/enrollment': {
          const b = exact(body, ['method'])
          if (b.method !== 'TOTP' && b.method !== 'WEBAUTHN') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.startEnrollment(ref, b.method))
        }
        case '/authentication/mfa/enrollment/complete': {
          const b = exact(body, ['enrollmentRef', 'code', 'credential'], ['enrollmentRef'])
          if (typeof b.enrollmentRef !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          let completion: InvitationEnrollmentCompletion
          if (typeof b.code === 'string' && b.credential === undefined)
            completion = { enrollmentRef: b.enrollmentRef, code: b.code }
          else if (typeof b.credential === 'string' && b.code === undefined)
            completion = { enrollmentRef: b.enrollmentRef, credential: b.credential }
          else throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.completeEnrollment(ref, completion))
        }
        case '/authentication/mfa/enrollment/cancel': {
          const b = exact(body, ['enrollmentRef'])
          if (typeof b.enrollmentRef !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.cancelEnrollment(ref, b.enrollmentRef))
        }
        case '/continue': {
          const b = exact(body, ['expectedVersion'])
          return response(await client.continue(ref, nonnegative(b.expectedVersion)))
        }
        case '/confirm': {
          const b = exact(body, ['expectedInvitationVersion', 'expectedRole'])
          if (b.expectedRole !== null && typeof b.expectedRole !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.confirm(ref, { expectedInvitationVersion: nonnegative(b.expectedInvitationVersion), expectedRole: b.expectedRole }, key()))
        }
        case '/cancel': exact(body, []); return response(await client.cancel(ref))
        case '/authenticated-session':
          exact(body, [])
          if (!session.identity) throw new InvitationError('SESSION_REQUIRED', 401)
          return response(await client.authenticatedSession(ref))
        case '/authentication/registration': {
          const b = exact(body, ['identifier', 'password', 'locale'], ['identifier', 'password'])
          identifier(b.identifier)
          if (typeof b.password !== 'string' || !b.password || b.password.length > 1024 ||
              b.locale !== undefined && (typeof b.locale !== 'string' || b.locale.length > 64))
            throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.register(ref, b as unknown as InvitationRegistrationInput, key()))
        }
        case '/authentication/registration/verify': {
          const b = exact(body, ['code'])
          if (typeof b.code !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.verifyRegistration(ref, b.code))
        }
        case '/authentication/registration/resend': exact(body, []); return response(await client.resendRegistration(ref))
        case '/authentication/registration/cancel': exact(body, []); return response(await client.cancelRegistration(ref))
        case '/authentication/start': exact(body, []); return response(await client.startAuthentication(ref))
        case '/authentication/cancel': exact(body, []); return response(await client.cancelAuthentication(ref))
        case '/authentication/authenticate': {
          const b = invitationRecord(body), password = b.method === 'PASSWORD'
          exact(body, ['method', 'identifier', password ? 'password' : 'proof'])
          identifier(b.identifier)
          if (!['PASSWORD', 'EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'].includes(String(b.method)) ||
              typeof b[password ? 'password' : 'proof'] !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.authenticate(ref, b as unknown as PrimaryAuthentication))
        }
        case '/authentication/challenges': {
          const b = exact(body, ['method', 'identifier']); identifier(b.identifier)
          if (!['EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'].includes(String(b.method))) throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.challenge(ref, b.method as PrimaryProofMethod, b.identifier as LoginIdentifier))
        }
        case '/authentication/mfa': {
          const b = exact(body, ['method', 'code'])
          if (!['TOTP', 'RECOVERY_CODE'].includes(String(b.method)) || typeof b.code !== 'string') throw new InvitationError('INVITATION_INPUT_INVALID', 400)
          return response(await client.mfa(ref, b.method as MfaProofMethod, b.code))
        }
        default: throw new InvitationError('NOT_FOUND', 404)
      }
    } catch (error) {
      if (error instanceof InvitationError) return response({ error: error.code },
        error.status || (error.code === 'INVITATION_RESULT_UNKNOWN' ? 502 : 400))
      if (error instanceof SyntaxError) return response({ error: 'INVITATION_INPUT_INVALID' }, 400)
      return response({ error: 'INVITATION_BFF_FAILED' }, 503)
    }
  }
}
function equal(input: string | null, expected: string) {
  if (input === null) return false
  const a = Buffer.from(input), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
function exact(value: unknown, keys: string[], required = keys) {
  const body = invitationRecord(value)
  if (Object.keys(body).some(key => !keys.includes(key)) || required.some(key => !(key in body)))
    throw new InvitationError('INVITATION_INPUT_INVALID', 400)
  return body
}
function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InvitationError('INVITATION_INPUT_INVALID', 400)
  return value
}
function identifier(value: unknown): asserts value is LoginIdentifier {
  const b = exact(value, ['kind', 'value', 'region'], ['kind', 'value'])
  if (!['EMAIL', 'USERNAME', 'PHONE'].includes(String(b.kind)) || typeof b.value !== 'string' || !b.value ||
      b.region !== undefined && (b.kind !== 'PHONE' || typeof b.region !== 'string'))
    throw new InvitationError('INVITATION_INPUT_INVALID', 400)
}
function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
