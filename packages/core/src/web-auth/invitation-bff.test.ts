import { afterEach, expect, it, vi } from 'vitest'
import { InvitationBff } from './invitation-bff.js'
import type { InvitationBffSession } from './invitation-bff.js'

const app = '10000000-0000-0000-0000-000000000001'
const ref = '20000000-0000-0000-0000-000000000001'
const origin = 'https://application.example.test', issuer = 'https://issuer.example.test'
const csrf = 's'.repeat(43)
const view = (state = 'CONFIRM_REQUIRED') => ({
  ref, kind: 'ORGANIZATION', state, expiresAt: new Date(Date.now() + 1800000).toISOString(),
  invitationVersion: 3, configVersion: 1,
  subject: { applicationId: app, applicationName: 'App', organizationId: ref, organizationName: 'Team' },
  maskedRecipient: 'm***@example.test', role: 'MEMBER', result: state === 'COMMITTED' ? 'JOINED' : 'NONE',
  nextAction: { type: state === 'COMMITTED' ? 'VIEW_RESULT' : 'CONFIRM' },
})
function fixture(prelogin = false) {
  let session: InvitationBffSession = {
    owner: 'host-session-owner', csrfToken: csrf, expiresAt: Date.now() + 3600000,
    accessToken: prelogin ? null : 'server-only-bearer',
    identity: prelogin ? null : { applicationId: app, clientId: 'web-client', userId: 'verified-user' },
  }
  let context = ''
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/continuations/registration')) context = JSON.parse(String(init.body)).context
    return Response.json(url.endsWith('/continuations/registration')
      ? { journey: view('REGISTRATION_REQUIRED'), context, clientId: 'web-client', expiresAt: new Date(Date.now() + 300000).toISOString() }
      : view(url.endsWith('/confirm') ? 'COMMITTED' : undefined))
  })
  vi.stubGlobal('fetch', fetcher)
  const bff = new InvitationBff({ issuer, applicationId: app, clientId: 'web-client', clientSecret: 'server-only-secret',
    applicationOrigin: origin, basePath: '/bff/invitation-journeys', resolveSession: async () => session })
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => bff.handle(new Request(origin + '/bff/invitation-journeys' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', 'Idempotency-Key': 'explicit-once', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { bff, fetcher, request, session, get context() { return context }, replace: (value: InvitationBffSession) => { session = value } }
}
afterEach(() => vi.unstubAllGlobals())
it.each([true, false])('recovers a prepared initial exchange after response loss (prelogin=%s) without a second mutation', async prelogin => {
  const f = fixture(prelogin), continuation = 'c'.repeat(43)
  const prepared = await f.request('/continuations/prepare', { continuation, mode: prelogin ? 'registration' : 'authenticated' })
  expect(prepared.status).toBe(200)
  expect((await prepared.json()).ref).toBe(ref)
  let context = ''
  f.fetcher.mockImplementationOnce(async (_url, init) => {
    if (prelogin) context = JSON.parse(String(init.body)).context
    throw new TypeError('committed response lost')
  })
  const exchanged = await f.request(prelogin ? '/continuations/registration' : '/continuations/exchange', { continuation })
  expect(exchanged.status).toBe(502)
  expect(await exchanged.json()).toEqual({ error: 'INVITATION_RESULT_UNKNOWN' })
  expect((await f.request('/' + ref)).status).toBe(200)
  expect(f.fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
  const headers = new Headers(f.fetcher.mock.calls.at(-1)![1].headers)
  if (prelogin) {
    expect(context).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(headers.get('X-Invitation-Context')).toBe(context)
    expect(headers.get('Authorization')).toMatch(/^Basic /)
    f.replace({ ...f.session, owner: 'other-prelogin-owner' })
    expect((await f.request('/' + ref)).status).toBe(404)
  } else expect(headers.get('Authorization')).toBe('Bearer server-only-bearer')
  expect((await f.request('/continuations/prepare', { continuation, mode: 'registration' }, { 'X-CSRF-Token': 'wrong' })).status).toBe(403)
  f.bff.dispose()
})
it('bridges exact authenticated routes without forwarding browser credentials or returning secrets', async () => {
  const f = fixture()
  const exchange = await f.request('/continuations/exchange', { continuation: 'c'.repeat(43) })
  expect(exchange.status).toBe(200)
  expect(await exchange.json()).toMatchObject({ ref, state: 'CONFIRM_REQUIRED', role: 'MEMBER' })
  expect((await f.request('/' + ref)).status).toBe(200)
  expect((await (await f.request('/' + ref + '/confirm', { expectedInvitationVersion: 3, expectedRole: 'MEMBER' })).json()).state).toBe('COMMITTED')
  for (const [, init] of f.fetcher.mock.calls) {
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer server-only-bearer')
    expect(new Headers(init.headers).has('Cookie')).toBe(false)
  }
  f.bff.dispose()
})
it('denies cross-site, wrong CSRF, injected authority and arbitrary routes before upstream writes', async () => {
  const f = fixture()
  for (const headers of [{ Origin: 'https://wrong.test' }, { 'X-CSRF-Token': 'wrong' }, { Authorization: 'Bearer browser' },
    { 'X-Invitation-Context': 'injected' }, { 'Sec-Fetch-Site': 'same-site' }])
    expect((await f.request('/continuations/exchange', { continuation: 'c'.repeat(43) }, headers)).status).toBe(403)
  expect((await f.request('/proxy', { url: issuer })).status).toBe(404)
  expect((await f.request('/continuations/exchange', { continuation: 'c'.repeat(43), clientId: 'other' })).status).toBe(400)
  expect(f.fetcher).not.toHaveBeenCalled()
  f.bff.dispose()
})
it('holds private finite context through first login, requires explicit authority change and rejects replacement user', async () => {
  const f = fixture(true)
  const result = await f.request('/continuations/registration', { continuation: 'c'.repeat(43) })
  expect(await result.text()).not.toContain(f.context)
  f.replace({ ...f.session, accessToken: 'server-only-bearer', identity: { applicationId: app, clientId: 'web-client', userId: 'first-user' } })
  expect((await f.request('/' + ref)).status).toBe(200)
  const contextHeaders = new Headers(f.fetcher.mock.calls.at(-1)![1].headers)
  expect(contextHeaders.get('X-Invitation-Context')).toBe(f.context)
  expect(contextHeaders.get('Authorization')).toMatch(/^Basic /)
  expect((await f.request('/' + ref + '/authenticated-session', {})).status).toBe(200)
  expect(new Headers(f.fetcher.mock.calls.at(-1)![1].headers).get('Authorization')).toBe('Bearer server-only-bearer')
  f.replace({ ...f.session, accessToken: 'next-bearer', identity: { applicationId: app, clientId: 'web-client', userId: 'replacement-user' } })
  expect((await f.request('/' + ref)).status).toBe(403)
  f.bff.dispose()
})
it('recovers result refs with verified same App/Client identity but rejects wrong session tuple', async () => {
  const f = fixture()
  expect((await f.request('/' + ref)).status).toBe(200)
  f.replace({ ...f.session, identity: { applicationId: ref, clientId: 'web-client', userId: 'verified-user' } })
  expect((await f.request('/' + ref)).status).toBe(403)
  f.bff.dispose()
})
it('limits enrollment to the owned finite ref and strict body under host CSRF', async () => {
  const f = fixture(true)
  await f.request('/continuations/registration', { continuation: 'c'.repeat(43) })
  const path = '/' + ref + '/authentication/mfa/enrollment'
  expect((await f.request(path, { method: 'TOTP', userId: ref })).status).toBe(400)
  expect((await f.request(path, { method: 'TOTP' }, { 'X-CSRF-Token': 'wrong' })).status).toBe(403)
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  f.fetcher.mockResolvedValueOnce(Response.json({
    enrollment: { enrollmentRef: ref, method: 'TOTP', state: 'PENDING', expiresAt: new Date(Date.now() + 120000).toISOString(),
      availableMethods: ['TOTP'], reasonCode: null }, delivery: 'AVAILABLE',
    totp: { secret: 'JBSWY3DPEHPK3PXP', qrCodeUri: 'otpauth://totp/Unit?secret=JBSWY3DPEHPK3PXP', issuer: 'Unit' }, webauthn: null,
  }))
  const result = await f.request(path, { method: 'TOTP' })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ enrollment: { state: 'PENDING' }, delivery: 'AVAILABLE' })
  const headers = new Headers(f.fetcher.mock.calls.at(-1)![1].headers)
  expect(headers.get('X-Invitation-Context')).toBe(f.context)
  expect(headers.get('Authorization')).toMatch(/^Basic /)
  expect(headers.has('Cookie')).toBe(false)
  f.bff.dispose()
})
