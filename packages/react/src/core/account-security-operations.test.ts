import { afterEach, expect, it, vi } from 'vitest'
import { AccountSecurityStore } from './account-security-store'
import { securityFixture, securityEmail, securityPassword, securityRef, response } from './account-security-fixtures.test-support'
import type { AuthClient } from './auth-client'
import { IdentityOperationStore } from './identity-operation-store'

const clients: AuthClient[] = []
afterEach(() => { clients.forEach(client => client.dispose()); clients.length = 0; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function fixture(mode: 'oauth_tokens' | 'server_session' = 'oauth_tokens') {
  const f = await securityFixture(mode); clients.push(f.client); return f
}
const body = (init?: RequestInit) => JSON.parse(String(init?.body))
it.each(['oauth_tokens', 'server_session'] as const)('%s consumes finite typed MFA operations, current email and scoped factors', async mode => {
  const f = await fixture(mode), c = f.client
  expect((await c.getMfaCapabilities()).loginMethodVersion).toBe(4)
  expect(await c.getRecoveryCodesRemaining()).toBe(0)
  f.setProof('REAUTHENTICATION', [securityPassword, securityEmail])
  const op = await c.createMfaOperation('TOTP_ENROLL', 4, securityRef)
  const create = f.fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/mfa/operations') && init?.method === 'POST')!
  expect(body(create[1])).toEqual(mode === 'server_session' ? { requestId: securityRef, type: 'TOTP_ENROLL', expectedLoginMethodVersion: 4 } : { type: 'TOTP_ENROLL', expectedLoginMethodVersion: 4 })
  expect(new Headers(create[1]?.headers).get('Authorization')).toBe(c.mode === 'server_session' ? null : `Bearer ${c.getAccessToken()}`)
  const challenge = await c.challengeMfaOperation(op.ref, securityEmail.identifierId)
  await c.reauthenticateMfaOperation(op.ref, { method: 'EMAIL_OTP', challengeRef: challenge.challengeRef, code: '123456' })
  const reauth = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/reauthenticate'))!
  expect(body(reauth[1])).toEqual({ method: 'EMAIL_OTP', [mode === 'server_session' ? 'challengeRef' : 'challengeId']: challenge.challengeRef, code: '123456' })
  expect((await c.startMfaOperationStepUp(op.ref)).availableMethods).toEqual(['TOTP', 'WEBAUTHN'])
  const start = await c.startMfaOperationWebAuthn(op.ref, securityRef)
  expect(start.requestRef).toBe(securityRef)
  await c.verifyMfaOperationWebAuthn(op.ref, securityRef, start.requestRef, 'fixture-assertion')
  const verify = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/step-up/webauthn/verify'))!
  expect(body(verify[1])).toEqual(mode === 'server_session' ? { challengeRef: securityRef, requestRef: securityRef, credential: 'fixture-assertion' } : { challengeId: securityRef, requestId: securityRef, credential: 'fixture-assertion' })
  expect((await c.beginTotpEnrollmentOperation(op.ref)).material?.secret).toBe('FIXTUREONLYSETUP')
  expect((await c.getMfaOperation(op.ref))).not.toHaveProperty('material')
  expect((await c.completeMfaOperation(op.ref, '123456')).operation.result?.sessionImpact).toBe('CURRENT_SESSION_RETAINED')
  expect(c.state.isAuthenticated()).toBe(true)
})
it.each(['oauth_tokens', 'server_session'] as const)('%s resolves a lost begin by GET, never a second begin or a summary heuristic', async mode => {
  const f = await fixture(mode), store = new AccountSecurityStore(f.client)
  await store.create('TOTP_ENROLL', 4)
  const actual = f.fetchMock.getMockImplementation()!
  f.fetchMock.mockImplementationOnce(async (...args) => { await actual(...args); throw new TypeError('reply lost') })
  await expect(store.begin()).rejects.toThrow()
  expect(store.getSnapshot().uncertain).toBe(true)
  await expect(store.begin()).rejects.toMatchObject({ code: 'OPERATION_UNCERTAIN' })
  await store.query()
  expect(store.getSnapshot()).toMatchObject({ material: null, materialUnavailable: true, uncertain: false, operation: { state: 'AWAITING_CONFIRMATION' } })
  expect(f.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/begin'))).toHaveLength(1)
  await store.cancel()
  expect(store.getSnapshot().operation?.state).toBe('CANCELLED')
})
it.each(['oauth_tokens', 'server_session'] as const)('%s resolves lost recovery-code delivery without generating another batch', async mode => {
  const f = await fixture(mode), store = new AccountSecurityStore(f.client)
  await store.create('RECOVERY_CODES_GENERATE', 4)
  const actual = f.fetchMock.getMockImplementation()!
  f.fetchMock.mockImplementationOnce(async (...args) => { await actual(...args); throw new TypeError('reply lost') })
  await expect(store.complete()).rejects.toThrow()
  await store.query()
  expect(store.getSnapshot()).toMatchObject({ recoveryCodes: null, recoveryCodesUnavailable: true, operation: { state: 'COMMITTED', result: { recoveryCount: 2, sessionImpact: 'UNCHANGED' } } })
  expect(f.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1)
  expect(f.client.state.isAuthenticated()).toBe(true)
})
it('presents definitive disable success before clearing the local session on acknowledgement', async () => {
  const f = await fixture(), store = new AccountSecurityStore(f.client)
  await store.create('TOTP_DISABLE', 4); await store.complete()
  expect(store.getSnapshot().operation?.result?.sessionImpact).toBe('REAUTHENTICATE')
  expect(f.client.state.isAuthenticated()).toBe(true)
  expect(store.acknowledge()).toBe(true)
  expect(f.client.state.isAuthenticated()).toBe(false)
})
it('clears material on close, expiry and owner change; late generation cannot restore codes', async () => {
  const f = await fixture(), store = new AccountSecurityStore(f.client)
  await store.create('TOTP_ENROLL', 4); await store.begin()
  store.clearSensitive()
  expect(store.getSnapshot().material).toBeNull()
  await store.cancel(); store.acknowledge()
  await store.create('RECOVERY_CODES_GENERATE', 4)
  let finish!: (response: Response) => void
  f.fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = store.complete(), rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.client.state.clear()
  finish(response({}))
  await rejected
  expect(store.getSnapshot()).toMatchObject({ operation: null, recoveryCodes: null, material: null, pending: false })
})
it('expiry clears setup without a network write or fabricated completion', async () => {
  const f = await fixture(), store = new AccountSecurityStore(f.client)
  await store.create('TOTP_ENROLL', 4); await store.begin()
  vi.useFakeTimers()
  // Re-read status under the deterministic clock to arm the expiry timer.
  await store.query()
  const before = f.fetchMock.mock.calls.length
  await vi.advanceTimersByTimeAsync(600_001)
  expect(store.getSnapshot()).toMatchObject({ operation: { state: 'EXPIRED' }, material: null })
  expect(f.fetchMock.mock.calls.length).toBe(before)
  expect(() => store.acknowledge()).toThrow()
  f.setOperation({ ...f.getOperation(), state: 'EXPIRED' })
  await store.query()
  expect(store.acknowledge()).toBe(false)
})
it('keeps the same stable creation identity after an uncertain create', async () => {
  const f = await fixture('server_session'), store = new AccountSecurityStore(f.client)
  f.fetchMock.mockRejectedValueOnce(new TypeError('offline'))
  await expect(store.create('TOTP_ENROLL', 4)).rejects.toThrow()
  const requestId = store.getSnapshot().uncertainCreate?.requestId
  expect(requestId).toMatch(/^[A-Za-z0-9_-]{43}$/)
  await expect(store.create('TOTP_DISABLE', 4)).rejects.toMatchObject({ code: 'OPERATION_PENDING' })
  await store.retryCreate()
  const creates = f.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/mfa/operations'))
  expect(creates.map(([, init]) => body(init).requestId)).toEqual([requestId, requestId])
})
it('validates OAuth provider return binding and keeps verifier out of public results', async () => {
  const f = await fixture(), op = await f.client.createMfaOperation('TOTP_ENROLL', 4)
  const popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  f.fetchMock.mockResolvedValueOnce(response({ authorizationId: 'provider-auth', authorizationUrl: 'https://provider.test/authorize', expiresAt: new Date(Date.now() + 60_000).toISOString() }))
  const result = await f.client.authorizeMfaOperation(op.ref, { methodId: 'idp:connected' })
  expect(result).not.toHaveProperty('codeVerifier')
  expect(result).not.toHaveProperty('authorizationId')
  popup.location.href = `${window.location.origin}/callback?operation_id=other&authorization_id=provider-auth&mfa_operation=proof_pending`
  const before = f.fetchMock.mock.calls.length
  await expect(f.client.completeMfaProviderAuthorization(op.ref)).rejects.toThrow('mismatch')
  expect(f.fetchMock.mock.calls.length).toBe(before)
  popup.location.href = `${window.location.origin}/callback?operation_id=${op.ref}&authorization_id=provider-auth&mfa_operation=proof_pending`
  await f.client.completeMfaProviderAuthorization(op.ref)
  expect(popup.close).toHaveBeenCalled()
})

it.each(['oauth_tokens', 'server_session'] as const)('%s rejects a mismatched response receipt without replacing the active operation', async mode => {
  const f = await fixture(mode), store = new AccountSecurityStore(f.client)
  await store.create('TOTP_ENROLL', 4)
  await expect(store.query(mode === 'server_session' ? 'C'.repeat(43) : '019a31b0-0000-7000-8000-000000000002')).rejects.toMatchObject({ code: 'OPERATION_PENDING' })
  f.fetchMock.mockResolvedValueOnce(response({ ...f.wire(), [mode === 'server_session' ? 'ref' : 'id']: mode === 'server_session' ? 'C'.repeat(43) : '019a31b0-0000-7000-8000-000000000002' }))
  await expect(store.query()).rejects.toThrow('mismatch')
  expect(store.getSnapshot().operation?.ref).toBe(f.getOperation().ref)
})
it('BFF MFA callback posts only an empty body; identity callback only GETs after the server exchange', async () => {
  const f = await fixture('server_session'), op = await f.client.createMfaOperation('TOTP_ENROLL', 4)
  const popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  f.fetchMock.mockResolvedValueOnce(response({ ref: op.ref, authorizationUrl: 'https://provider.invalid/authorize', expiresAt: new Date(Date.now() + 60_000).toISOString() }))
  await f.client.authorizeMfaOperation(op.ref, { methodId: 'idp:fixture' })
  popup.location.href = `${window.location.origin}/console/session/callback?operation_id=upstream-id&authorization_id=upstream-auth&mfa_operation=proof_pending`
  await f.client.completeMfaProviderAuthorization(op.ref)
  const callback = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/provider-callback'))
  expect(callback).toBeDefined()
  expect(body(callback?.[1])).toEqual({})
  expect(new Headers(callback?.[1]?.headers).has('Authorization')).toBe(false)
  const identity = new IdentityOperationStore(f.client)
  const wire = { ref: securityRef, type: 'LINK', state: 'AWAITING_REAUTH', expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredProofs: [], proofOptions: [], completion: null }
  f.fetchMock.mockResolvedValueOnce(response(wire))
  await identity.reopen(securityRef)
  f.fetchMock.mockResolvedValueOnce(response({ ref: securityRef, authorizationUrl: 'https://provider.invalid/authorize', expiresAt: wire.expiresAt }))
  await identity.openProvider('CURRENT_ACCOUNT', undefined, 'idp:fixture')
  popup.location.href = `${window.location.origin}/console/session/callback?operation_id=upstream-id&authorization_id=upstream-auth&identity_operation=proof_pending`
  f.fetchMock.mockResolvedValueOnce(response({ ...wire, state: 'READY' }))
  const before = f.fetchMock.mock.calls.length
  await identity.providerCallback()
  expect(f.fetchMock.mock.calls.slice(before)).toHaveLength(1)
  expect(f.fetchMock.mock.calls[before][1]?.method).toBe('GET')
})
it('cancel loss stays uncertain; a racing completion is shown as success rather than cancellation', async () => {
  const f = await fixture(), store = new AccountSecurityStore(f.client)
  await store.create('TOTP_DISABLE', 4)
  f.fetchMock.mockRejectedValueOnce(new TypeError('cancel reply lost'))
  await expect(store.cancel()).rejects.toThrow()
  expect(store.getSnapshot().uncertain).toBe(true)
  await expect(store.complete()).rejects.toMatchObject({ code: 'OPERATION_UNCERTAIN' })
  await f.client.completeMfaOperation(f.getOperation().ref)
  await store.query()
  expect(store.getSnapshot()).toMatchObject({ uncertain: false, operation: { state: 'COMMITTED', result: { sessionImpact: 'REAUTHENTICATE' } } })
})
it.each([
  ['oauth_tokens', 'TOTP_ENROLL'], ['server_session', 'TOTP_ENROLL'],
  ['oauth_tokens', 'RECOVERY_CODES_GENERATE'], ['server_session', 'RECOVERY_CODES_GENERATE'],
] as const)('%s disposal immediately clears %s memory and notifies Headless subscribers', async (mode, type) => {
  const f = await fixture(mode), store = new AccountSecurityStore(f.client), listener = vi.fn()
  store.subscribe(listener)
  await store.create(type, 4)
  if (type === 'TOTP_ENROLL') await store.begin()
  else await store.complete()
  expect(type === 'TOTP_ENROLL' ? store.getSnapshot().material : store.getSnapshot().recoveryCodes).not.toBeNull()
  const before = listener.mock.calls.length
  f.client.dispose()
  expect(listener.mock.calls.length).toBeGreaterThan(before)
  expect(store.getSnapshot()).toMatchObject({ material: null, recoveryCodes: null, operation: null })
})
it('BFF disposal immediately clears the shared identity operation and notifies subscribers', async () => {
  const f = await fixture('server_session'), store = new IdentityOperationStore(f.client), listener = vi.fn()
  store.subscribe(listener)
  f.fetchMock.mockResolvedValueOnce(response({ ref: securityRef, type: 'LINK', state: 'AWAITING_REAUTH', expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredProofs: [], proofOptions: [], completion: null }))
  await store.reopen(securityRef)
  expect(store.getSnapshot().operation).not.toBeNull()
  const before = listener.mock.calls.length
  f.client.dispose()
  expect(listener.mock.calls.length).toBeGreaterThan(before)
  expect(store.getSnapshot().operation).toBeNull()
})
