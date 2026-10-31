import { afterEach, expect, it, vi } from 'vitest'
import { InvitationJourneyClient, SessionInvitationJourneyClient, consumeInvitationContinuation, parseInvitationJourney, parseInvitationEnrollmentBegin } from './invitation-journeys.js'

const app = '10000000-0000-0000-0000-000000000001'
const ref = '20000000-0000-0000-0000-000000000001'
const org = '30000000-0000-0000-0000-000000000001'
const continuation = 'c'.repeat(43)
const expiresAt = () => new Date(Date.now() + 3600000).toISOString()
const view = (state = 'CONFIRM_REQUIRED', result: string | null = null) => ({
  ref, kind: 'ORGANIZATION', state, expiresAt: expiresAt(), invitationVersion: 4, configVersion: 2,
  subject: { applicationId: app, applicationName: 'Example', organizationId: org, organizationName: 'Team' },
  maskedRecipient: 'm***@example.test', role: 'MEMBER', nextAction: { type: 'CONFIRM' }, result,
})
const config = () => ({ issuer: 'https://issuer.example.test', clientId: 'actual-client', applicationId: app, getAccessToken: () => 'user-bearer' })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const enrollment = (state = 'PENDING') => ({ enrollmentRef: ref, method: 'TOTP', state,
  expiresAt: expiresAt(), availableMethods: ['TOTP', 'WEBAUTHN'], reasonCode: null })
it('uses the frozen finite enrollment routes without issuing or accepting ordinary session authority', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Response.json(init.method === 'POST' && url.endsWith('/enrollment')
      ? { enrollment: enrollment(), delivery: 'AVAILABLE',
          totp: { secret: 'JBSWY3DPEHPK3PXP', qrCodeUri: 'otpauth://totp/Unit?secret=JBSWY3DPEHPK3PXP', issuer: 'Unit' }, webauthn: null }
      : enrollment(url.endsWith('/complete') ? 'COMPLETED' : 'PENDING'))
  }))
  const client = new InvitationJourneyClient(config())
  await client.enrollment(ref)
  const started = await client.startEnrollment(ref, 'TOTP')
  expect(started.enrollment.enrollmentRef).toBe(ref)
  await client.completeEnrollment(ref, { enrollmentRef: ref, code: '123456' })
  await client.cancelEnrollment(ref, ref)
  expect(calls.map(c => new URL(c.url).pathname.split('/authentication')[1])).toEqual([
    '/mfa/enrollment', '/mfa/enrollment', '/mfa/enrollment/complete', '/mfa/enrollment/cancel',
  ])
  expect(calls.every(c => c.init.credentials === 'omit')).toBe(true)
  expect(JSON.parse(String(calls[2].init.body))).toEqual({ enrollmentRef: ref, code: '123456' })
  expect(calls.some(c => c.url.endsWith('/confirm'))).toBe(false)
  await expect(client.completeEnrollment(ref, { enrollmentRef: ref, code: 'not-a-code' })).rejects.toMatchObject({ code: 'INVITATION_INPUT_INVALID' })
})
it('rejects secret redelivery and exposes typed enrollment to server-session transports', async () => {
  expect(() => parseInvitationEnrollmentBegin({ enrollment: enrollment(), delivery: 'ALREADY_DELIVERED',
    totp: { secret: 'JBSWY3DPEHPK3PXP', qrCodeUri: 'otpauth://totp/Unit', issuer: 'Unit' }, webauthn: null })).toThrow()
  const send = vi.fn(async () => enrollment('COMPLETED'))
  const client = new SessionInvitationJourneyClient(send)
  expect((await client.completeEnrollment(ref, { enrollmentRef: ref, credential: 'attestation' })).state).toBe('COMPLETED')
  expect(send).toHaveBeenCalledWith({ action: 'invitationEnrollmentComplete', ref, body: { enrollmentRef: ref, credential: 'attestation' } })
})
it('exchanges and reads/confirms without Cookie or an authority escape hatch', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Response.json(url.endsWith('/confirm') ? view('COMMITTED', 'JOINED') : view())
  }))
  const client = new InvitationJourneyClient(config())
  await client.exchange(continuation)
  await client.get(ref)
  expect((await client.confirm(ref, { expectedInvitationVersion: 4, expectedRole: 'MEMBER' }, 'one-confirm')).result).toBe('JOINED')
  for (const { init } of calls) {
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer user-bearer')
    expect(new Headers(init.headers).has('Cookie')).toBe(false)
  }
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ continuation })
  expect(JSON.parse(String(calls[2].init.body))).toEqual({ expectedInvitationVersion: 4, expectedRole: 'MEMBER' })
  expect(new Headers(calls[2].init.headers).get('Idempotency-Key')).toBe('one-confirm')
})
it('keeps registration context private, exclusive, finite, and separate from ordinary bearer', async () => {
  const calls: RequestInit[] = []
  let context = ''
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push(init)
    if (url.endsWith('/continuations/registration')) context = JSON.parse(String(init.body)).context
    return Response.json(url.endsWith('/continuations/registration')
      ? { journey: view('REGISTRATION_REQUIRED'), context, expiresAt: new Date(Date.now() + 300000).toISOString(), clientId: 'actual-client' }
      : view())
  }))
  const client = new InvitationJourneyClient(config())
  const result = await client.registrationContext(continuation)
  expect(result).not.toHaveProperty('context')
  await client.get(ref)
  expect(new Headers(calls[0].headers).has('Authorization')).toBe(false)
  expect(context).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(new Headers(calls[2].headers).get('X-Invitation-Context')).toBe(context)
  expect(new Headers(calls[2].headers).has('Authorization')).toBe(false)
  client.useAuthenticatedSession(ref)
  await client.get(ref)
  expect(new Headers(calls[3].headers).has('X-Invitation-Context')).toBe(false)
  expect(new Headers(calls[3].headers).has('Authorization')).toBe(true)
})
it('does not retry unknown confirmation or classify conflict as success; result recovery is GET', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(Response.json(view('COMMITTED', 'JOINED')))
    .mockResolvedValueOnce(Response.json({ error: 'INVITATION_VERSION_CHANGED' }, { status: 409 }))
  vi.stubGlobal('fetch', fetcher)
  const client = new InvitationJourneyClient(config())
  await expect(client.confirm(ref, { expectedInvitationVersion: 4, expectedRole: 'MEMBER' }, 'one')).rejects.toMatchObject({ code: 'INVITATION_RESULT_UNKNOWN' })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await client.get(ref)).state).toBe('COMMITTED')
  await expect(client.confirm(ref, { expectedInvitationVersion: 4, expectedRole: 'MEMBER' }, 'one')).rejects.toMatchObject({ code: 'INVITATION_VERSION_CHANGED', status: 409 })
})
it('fails closed on another App, malformed authority, UUID paths, or secret-bearing response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...view(), subject: { ...view().subject, applicationId: org } })))
  const client = new InvitationJourneyClient(config())
  await expect(client.exchange(continuation)).rejects.toMatchObject({ code: 'INVITATION_ACCOUNT_MISMATCH' })
  await expect(client.get('../other')).rejects.toMatchObject({ code: 'INVITATION_REF_INVALID' })
  await expect(client.exchange('not-a-proof')).rejects.toMatchObject({ code: 'INVITATION_INPUT_INVALID' })
  expect(() => parseInvitationJourney({ ...view(), control: 'private' })).toThrow()
})
it('scrubs continuation synchronously, preserves harmless navigation state and rejects ambiguity', () => {
  const history = { replaceState: vi.fn() }
  expect(consumeInvitationContinuation({ href: 'https://app.example.test/invite?tab=join&continuation=' + continuation }, history)).toBe(continuation)
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/invite?tab=join')
  expect(() => consumeInvitationContinuation({ href: 'https://app.example.test/invite?continuation=a&continuation=b' }, history)).toThrow()
  expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '/invite')
})
it('accepts only the actual HTTPS continuation handoff or query-free success destination', () => {
  const handoff = { ...view('PREVIEW'), nextAction: { type: 'NAVIGATE', url: 'https://app.example.test/invite?continuation=' + continuation } }
  expect(parseInvitationJourney(handoff).nextAction.url).toBe(handoff.nextAction.url)
  expect(parseInvitationJourney({ ...view('COMMITTED'), nextAction: { type: 'NAVIGATE', url: 'https://app.example.test/done' } }).nextAction.url).toBe('https://app.example.test/done')
  for (const url of [
    'http://app.example.test/invite', 'https://user:password@app.example.test/invite',
    'https://app.example.test/invite?context=' + continuation,
    handoff.nextAction.url + '&continuation=' + continuation, handoff.nextAction.url + '&access_token=secret',
    'https://app.example.test/invite#proof',
  ]) expect(() => parseInvitationJourney({ ...handoff, nextAction: { type: 'NAVIGATE', url } })).toThrow()
  expect(() => parseInvitationJourney({ ...handoff, state: 'COMMITTED' })).toThrow()
})
it('bounds request lifetime and aborts rather than retrying a timed-out mutation', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  const client = new InvitationJourneyClient({ ...config(), timeoutMs: 25 })
  const work = client.cancel(ref)
  const rejection = expect(work).rejects.toMatchObject({ code: 'INVITATION_RESULT_UNKNOWN' })
  await vi.advanceTimersByTimeAsync(25); await rejection
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('does not send a stale token if the owner clears while token acquisition is pending', async () => {
  let resolve!: (value: string) => void
  const token = new Promise<string>(complete => { resolve = complete })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const client = new InvitationJourneyClient({ ...config(), getAccessToken: () => token })
  const work = client.get(ref)
  client.clear(); resolve('stale-bearer')
  await expect(work).rejects.toMatchObject({ code: 'INVITATION_INVALIDATED' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('does not fall back to bearer after finite registration authority expires', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async (url: string, init: RequestInit) => Response.json(url.endsWith('/continuations/registration') ? {
    journey: view('PREVIEW'), context: JSON.parse(String(init.body)).context, clientId: 'actual-client',
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  } : view('PREVIEW')))
  vi.stubGlobal('fetch', fetcher)
  const client = new InvitationJourneyClient(config())
  await client.registrationContext(continuation)
  await vi.advanceTimersByTimeAsync(1001)
  await expect(client.get(ref)).rejects.toMatchObject({ code: 'INVITATION_CONTEXT_EXPIRED', status: 410 })
  expect(fetcher).toHaveBeenCalledTimes(2)
})
