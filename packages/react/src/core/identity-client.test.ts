import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import { makeTestJwt, makeTestUser } from '../test-utils'
import * as pkce from './pkce'
import { IdentityOperationStore } from './identity-operation-store'
import { parseIdentifiers, parseMethods } from './identity-client'

const issuer = 'https://auth.test.com'
const operation = (state = 'AWAITING_REAUTH', type = 'ADD') => ({ id: 'op-1', type, state, expiresAt: new Date(Date.now()+600000).toISOString(),
  requiredProofs: [{ purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD'], strength: 'POLICY', satisfied: false }], result: null })
const registration = (status = 'PENDING_VERIFICATION') => ({ registrationId: 'registration-1', status,
  expiresAt: new Date(Date.now()+600000).toISOString(), nextAction: status === 'COMPLETED' ? 'LOGIN' : 'VERIFY_EMAIL', controlSecret: null })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const fetchMock = vi.fn<typeof fetch>()
let client: OAuthClient
beforeEach(() => {
  client = new OAuthClient({ issuerUri: issuer, clientId: 'client', redirectUri: '/callback' })
  vi.spyOn(client, 'discover').mockResolvedValue({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks` })
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { client.dispose(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function login() { client.tokenManager.store({ access_token: makeTestJwt(), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null) }
function body(index = 0) { return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) }
function headers(index = 0) { return new Headers(fetchMock.mock.calls[index][1]?.headers) }

describe('identity public wire and registration control', () => {
  it('sends typed signup, separates memory-only control from email proof, exposes no User/session', async () => {
    fetchMock.mockResolvedValueOnce(response({ ...registration(), controlSecret: 'private-control' }))
    const result = await client.identity.startRegistration({ identifier: { kind: 'EMAIL', value: 'test@example.invalid' }, password: 'test-password' }, 'creation-key')
    expect(result).not.toHaveProperty('controlSecret')
    expect(result).not.toHaveProperty('user')
    expect(body()).toEqual({ identifier: { kind: 'EMAIL', value: 'test@example.invalid' }, password: 'test-password', client_id: 'client' })
    expect(headers().get('Idempotency-Key')).toBe('creation-key')
    expect(client.tokenManager.isAuthenticated()).toBeFalsy()
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
    fetchMock.mockResolvedValueOnce(response(registration('COMPLETED')))
    expect((await client.identity.registrationAction(result.registrationId, 'complete', '123456')).status).toBe('COMPLETED')
    expect(body(1)).toEqual({ controlSecret: 'private-control', code: '123456' })
    expect(headers(1).get('Registration-Client')).toBe('client')
    expect(headers(1).get('Authorization')).toBeNull()
    expect(client.tokenManager.isAuthenticated()).toBeFalsy()
  })
  it('requires restart after lost control, idempotent replay or changed session', async () => {
    await expect(client.identity.getRegistration('registration-1')).rejects.toMatchObject({ code: 'REGISTRATION_RESTART_REQUIRED' })
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(response(registration()))
    await expect(client.identity.startRegistration({ identifier: { kind: 'EMAIL', value: 'x@y.invalid' }, password: 'password' }, 'same-key')).rejects.toMatchObject({ code: 'REGISTRATION_RESTART_REQUIRED' })
    fetchMock.mockResolvedValueOnce(response({ ...registration(), controlSecret: 'private-control' }))
    await client.identity.startRegistration({ identifier: { kind: 'EMAIL', value: 'x@y.invalid' }, password: 'password' }, 'new-key')
    login()
    await expect(client.identity.registrationAction('registration-1', 'complete', '123456')).rejects.toMatchObject({ code: 'REGISTRATION_RESTART_REQUIRED' })
  })
  it('preserves version envelope/capabilities and rejects malformed remote facts', () => {
    expect(parseIdentifiers({ loginMethodVersion: 4, items: [] })).toEqual({ loginMethodVersion: 4, items: [] })
    expect(parseMethods({ loginMethodVersion: 4, methods: [{ methodId: 'opaque-id', kind: 'PROVIDER', roles: ['FIRST_FACTOR'], status: 'UNAVAILABLE', capabilities: { unlink: false }, unavailableReasons: ['MANAGED_AUTHENTICATION_REQUIRED'] }] }).methods[0].capabilities.unlink).toBe(false)
    expect(() => parseMethods([])).toThrow()
    expect(() => parseIdentifiers({ loginMethodVersion: -1, items: [] })).toThrow()
    expect(() => parseMethods({ loginMethodVersion: 4, methods: [{ methodId: 'x', capabilities: {} }] })).toThrow()
  })
  it('runs create/reauth/challenge/complete with exact strict bodies and no retired route', async () => {
    login()
    fetchMock.mockImplementation(async () => response(operation()))
    await client.identity.create({ type: 'REPLACE', expectedLoginMethodVersion: 4, payload: { identifierId: 'old', replacement: { kind: 'PHONE', value: '13800138000', region: 'CN' }, removeOld: false } }, 'idempotency-key')
    await client.identity.reauthenticate('op-1', { method: 'PASSWORD', password: 'private-password' })
    await client.identity.challenge('op-1', 'PHONE_OTP')
    await client.identity.complete('op-1', { proofs: [{ purpose: 'TARGET_OWNERSHIP', method: 'PHONE_OTP', code: '123456' }] })
    expect(headers().get('Idempotency-Key')).toBe('idempotency-key')
    expect(body(1)).toEqual({ method: 'PASSWORD', password: 'private-password' })
    expect(body(2)).toEqual({ targetProofMethod: 'PHONE_OTP' })
    expect(body(3)).toEqual({ proofs: [{ purpose: 'TARGET_OWNERSHIP', method: 'PHONE_OTP', code: '123456' }] })
    expect(fetchMock.mock.calls.every(([url, init]) => !String(url).includes('link-ticket') && init?.method !== 'DELETE')).toBe(true)
  })
  it('preserves stable errors and retry metadata', async () => {
    login()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 409, error: 'STALE_LOGIN_METHOD_VERSION', message: 'safe' }), { status: 409, headers: { 'Retry-After': '3' } }))
    await expect(client.identity.get('op-1')).rejects.toMatchObject({ status: 409, code: 'STALE_LOGIN_METHOD_VERSION', retryAfterSeconds: 3 })
  })
  it('binds provider reauthentication and LINK target proof to PKCE and the operation', async () => {
    login()
    vi.spyOn(pkce, 'generatePKCEPair').mockResolvedValue({ codeVerifier: 'v'.repeat(43), codeChallenge: 'c'.repeat(43) })
    const store = new IdentityOperationStore(client)
    fetchMock.mockResolvedValueOnce(response(operation('AWAITING_REAUTH', 'LINK')))
    await store.reopen('op-1')
    fetchMock.mockResolvedValueOnce(response({ authorizationId: 'authz', authorizationUrl: 'https://provider.invalid/authorize', expiresAt: new Date(Date.now()+600000).toISOString() }))
    const popup={closed:false,location:{href:'about:blank'},close:vi.fn()}
    vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window)
    await store.openProvider('CURRENT_ACCOUNT', 'https://app.invalid/callback', 'opaque-method')
    expect(body(1)).toEqual({ purpose: 'CURRENT_ACCOUNT', methodId: 'opaque-method', redirectUri: 'https://app.invalid/callback', codeChallenge: 'c'.repeat(43), codeChallengeMethod: 'S256' })
    fetchMock.mockResolvedValueOnce(response(operation('READY', 'LINK')))
    popup.location.href='https://app.invalid/callback?operation_id=op-1&authorization_id=authz&identity_operation=proof_pending'
    fetchMock.mockResolvedValueOnce(response(operation('READY','LINK')))
    await store.providerCallback()
    expect(body(3)).toEqual({ authorizationId: 'authz', codeVerifier: 'v'.repeat(43) })
    expect(sessionStorage.length).toBe(0)
  })
  it('uses the actual lowercase step-up methods and independent WebAuthn recovery options', async () => {
    login()
    fetchMock.mockResolvedValueOnce(response({ challengeId: 'challenge', availableMethods: ['totp', 'webauthn'] }))
    expect((await client.identity.startStepUp()).availableMethods).toEqual(['totp', 'webauthn'])
    expect(body()).toEqual({ trigger: 'LOGIN_METHOD_CHANGE' })
    fetchMock.mockResolvedValueOnce(response({ requestId: 'assertion', publicKey: '{"publicKey":{"challenge":"AQID"}}' }))
    expect((await client.identity.startStepUpWebAuthn('challenge')).requestId).toBe('assertion')
    fetchMock.mockResolvedValueOnce(response({ verified: true, acr: 'mfa' }))
    await client.identity.verifyStepUpWebAuthn('challenge', 'assertion', 'serialized-credential')
    expect(body(2)).toEqual({ challengeId: 'challenge', requestId: 'assertion', credential: 'serialized-credential' })
    const recovery = { id: 'recovery-1', method: 'WEBAUTHN', state: 'AUTHORIZED', expiresAt: new Date(Date.now()+600000).toISOString(), verificationEvidenceRef: 'e', verifiedDeliveryChannelRef: 'd' }
    fetchMock.mockResolvedValueOnce(response({ recovery, recoveryContext: 'context' }))
    await client.identity.authorizeRecovery('recovery-1', 'delivery-proof')
    fetchMock.mockResolvedValueOnce(response({ requestId: 'registration', publicKeyCredentialCreationOptions: '{"publicKey":{}}' }))
    expect(await client.identity.startRecoveryWebAuthn('recovery-1')).toEqual({ requestId: 'registration', publicKeyCredentialCreationOptions: '{"publicKey":{}}' })
    expect(headers(4).has('Authorization')).toBe(false)
  })
  it('recovery uses its independent context and never a normal bearer', async () => {
    login()
    const recovery = { id: 'recovery-1', method: 'LOCAL_PASSWORD', state: 'AUTHORIZED', expiresAt: new Date(Date.now()+600000).toISOString(), verificationEvidenceRef: 'evidence', verifiedDeliveryChannelRef: 'delivery' }
    fetchMock.mockResolvedValueOnce(response({ recovery, recoveryContext: 'recovery-private' })).mockResolvedValueOnce(response(recovery))
    await client.identity.authorizeRecovery('recovery-1', 'delivery-proof')
    await client.identity.recoveryAction('recovery-1', 'complete', { password: 'new-password', code: '123456' })
    expect(headers().has('Authorization')).toBe(false)
    expect(headers(1).get('X-Recovery-Context')).toBe('recovery-private')
    expect(headers(1).has('Authorization')).toBe(false)
    expect(body(1)).toEqual({ password: 'new-password', code: '123456' })
    expect(sessionStorage.length).toBe(0)
  })
})

describe('durable public operation state shared by React and Custom', () => {
  const createInput = () => ({ type: 'ADD' as const, expectedLoginMethodVersion: 3,
    payload: { identifier: { kind: 'EMAIL' as const, value: 'original@example.invalid' } } })
  it('retains the original request/version/key and blocks changed input and other actions until recovery', async () => {
    login()
    const store = new IdentityOperationStore(client)
    const input = createInput()
    fetchMock.mockRejectedValueOnce(new TypeError('response lost'))
    await expect(store.create(input, 'original-key')).rejects.toThrow()
    expect(store.getSnapshot()).toMatchObject({ operation: null, pending: false,
      uncertainCreate: { request: createInput(), idempotencyKey: 'original-key' } })
    input.payload.identifier.value = 'changed@example.invalid'
    await expect(store.create(input)).rejects.toMatchObject({ code: 'CREATE_UNCONFIRMED' })
    await expect(store.create(createInput(), 'different-key')).rejects.toMatchObject({ code: 'CREATE_UNCONFIRMED' })
    for (const action of [
      () => store.reopen('another-operation'), () => store.cancel(), () => store.complete(),
      () => store.challenge('EMAIL_OTP'), () => store.confirmTransfer('ACCEPT'),
      () => store.authorize('CURRENT_ACCOUNT', '/callback'),
    ]) await expect(action()).rejects.toMatchObject({ code: 'CREATE_UNCONFIRMED' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const exposed = store.getSnapshot().uncertainCreate!
    if (exposed.request.type === 'ADD') exposed.request.payload.identifier.value = 'mutated-snapshot@example.invalid'
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.retryCreate()
    expect(body(1)).toEqual(createInput())
    expect(headers(1).get('Idempotency-Key')).toBe('original-key')
    expect(store.getSnapshot()).toMatchObject({ operation: { id: 'op-1' }, uncertainCreate: null, error: null, pending: false })
  })
  it.each([
    [400, 'INVALID_IDENTIFIER'], [409, 'STALE_LOGIN_METHOD_VERSION'],
  ])('clears a definitive creation rejection %s/%s so corrected input uses a fresh key', async (status, code) => {
    login()
    const store = new IdentityOperationStore(client)
    fetchMock.mockRejectedValueOnce(new TypeError('lost'))
    await expect(store.create(createInput())).rejects.toThrow()
    fetchMock.mockResolvedValueOnce(response({ error: code }, status))
    await expect(store.retryCreate()).rejects.toMatchObject({ code })
    expect(store.getSnapshot()).toMatchObject({ pending: false, uncertainCreate: null })
    const corrected = createInput()
    corrected.expectedLoginMethodVersion = 4
    corrected.payload.identifier.value = 'corrected@example.invalid'
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.create(corrected)
    expect(body(2)).toEqual(corrected)
    expect(headers(1).get('Idempotency-Key')).toBe(headers(0).get('Idempotency-Key'))
    expect(headers(2).get('Idempotency-Key')).not.toBe(headers(0).get('Idempotency-Key'))
  })
  it.each([[500, 'INTERNAL_ERROR'], [409, 'IDEMPOTENCY_CONFLICT'], [400, 'UNKNOWN_ERROR'], [200, 'MALFORMED_SUCCESS']])(
    'keeps an unknown outcome %s/%s recoverable through repeated failure', async (status, code) => {
      login()
      const store = new IdentityOperationStore(client)
      fetchMock.mockResolvedValueOnce(response({ error: code }, status))
      await expect(store.create(createInput(), 'retained-key')).rejects.toThrow()
      fetchMock.mockRejectedValueOnce(new TypeError('still offline'))
      await expect(store.retryCreate()).rejects.toThrow()
      expect(store.getSnapshot()).toMatchObject({ pending: false, uncertainCreate: { request: createInput(), idempotencyKey: 'retained-key' } })
      fetchMock.mockResolvedValueOnce(response(operation()))
      await store.retryCreate()
      expect(body(2)).toEqual(body(0))
      expect(headers(2).get('Idempotency-Key')).toBe('retained-key')
    })
  it.each(['success', 'failure'])('isolates a late old-create %s from the next session uncertainty', async outcome => {
    login()
    const store = new IdentityOperationStore(client)
    let finish!: (value: Response) => void
    let fail!: (reason: Error) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
    const old = store.create(createInput(), 'old-key')
    const invalidated = expect(old).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    client.tokenManager.clear()
    login()
    expect(store.getSnapshot().uncertainCreate).toBeNull()
    fetchMock.mockRejectedValueOnce(new TypeError('new session response lost'))
    const next = { ...createInput(), expectedLoginMethodVersion: 9 }
    await expect(store.create(next, 'new-key')).rejects.toThrow()
    if (outcome === 'success') finish(response(operation()))
    else fail(new TypeError('old response lost'))
    await invalidated
    expect(store.getSnapshot()).toMatchObject({ operation: null, pending: false,
      uncertainCreate: { request: next, idempotencyKey: 'new-key' } })
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.retryCreate()
    expect(body(2)).toEqual(next)
    expect(headers(2).get('Idempotency-Key')).toBe('new-key')
  })
  it('resumes only the opted-in session operation ID and clears it on account switch', async () => {
    client.dispose()
    client = new OAuthClient({ issuerUri: issuer, clientId: 'client', redirectUri: '/callback', tokenStorage: 'sessionStorage' })
    vi.spyOn(client, 'discover').mockResolvedValue({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks` })
    client.tokenManager.store({ access_token: makeTestJwt({ sid: 's1', app_id: 'app1' }), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
    const user=makeTestUser();user.authenticationContext.applicationId='app1';user.authenticationContext.clientId='client'
    client.tokenManager.applyViews({user,roles:[],permissions:[]})
    const key = `axis_identity_operation:${issuer}:client:app1:user-1:s1`
    const store = new IdentityOperationStore(client)
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.reopen('op-1')
    expect(sessionStorage.getItem(key)).toBe('op-1')
    const recreated = new IdentityOperationStore(client)
    fetchMock.mockResolvedValueOnce(response(operation()))
    await recreated.resumeSaved()
    expect(recreated.getSnapshot().operation?.id).toBe('op-1')
    client.tokenManager.clear()
    expect(store.getSnapshot().operation).toBeNull()
    expect(sessionStorage.getItem(key)).toBeNull()
    client.tokenManager.store({ access_token: makeTestJwt({ sub: 'other', sid: 's2', app_id: 'app1' }), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
    user.id='other';user.authenticationContext.sessionId='s2'
    client.tokenManager.applyViews({user,roles:[],permissions:[]})
    const switched = new IdentityOperationStore(client)
    expect(await switched.resumeSaved()).toBeNull()
  })
  it('starts a new idempotency scope after cancellation and prevents abandoning an active operation', async () => {
    login()
    const store = new IdentityOperationStore(client)
    const input = { type: 'ADD' as const, expectedLoginMethodVersion: 1, payload: { identifier: { kind: 'EMAIL' as const, value: 'x@y.invalid' } } }
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.create(input)
    await expect(store.reopen('another-id')).rejects.toMatchObject({ code: 'OPERATION_PENDING' })
    expect(fetchMock).toHaveBeenCalledOnce()
    fetchMock.mockResolvedValueOnce(response(operation('CANCELLED')))
    await store.cancel()
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.create(input)
    expect(headers(0).get('Idempotency-Key')).not.toBe(headers(2).get('Idempotency-Key'))
  })
  it('keeps cancellation uncertainty, reopens the same ID, then accepts terminal cancellation', async () => {
    login()
    const store = new IdentityOperationStore(client)
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.create({ type: 'ADD', expectedLoginMethodVersion: 1, payload: { identifier: { kind: 'EMAIL', value: 'x@y.invalid' } } }, 'key')
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    await expect(store.cancel()).rejects.toThrow()
    expect(store.getSnapshot()).toMatchObject({ cancelUnconfirmed: true, operation: { id: 'op-1', state: 'AWAITING_REAUTH' } })
    fetchMock.mockResolvedValueOnce(response(operation()))
    await store.reopen()
    expect(fetchMock.mock.lastCall?.[0]).toBe(`${issuer}/api/v1/auth/me/identity-operations/op-1`)
    fetchMock.mockResolvedValueOnce(response(operation('CANCELLED')))
    await store.cancel()
    expect(store.getSnapshot()).toMatchObject({ cancelUnconfirmed: false, operation: { state: 'CANCELLED' } })
  })
  it('isolates late results after logout/account switch and rejects conflicting writes', async () => {
    login()
    const store = new IdentityOperationStore(client)
    let finish!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const promise = store.reopen('op-1')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await expect(store.reopen('other')).rejects.toMatchObject({ code: 'OPERATION_PENDING' })
    client.tokenManager.clear()
    finish(response(operation()))
    await expect(promise).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    expect(store.getSnapshot().operation).toBeNull()
  })
  it('reuses idempotency key after an uncertain create and exposes transfer recipient actions', async () => {
    login()
    const store = new IdentityOperationStore(client)
    const input = { type: 'TRANSFER' as const, expectedLoginMethodVersion: 1, payload: { identifierId: 'id', targetUserId: 'receiver' } }
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(response(operation('AWAITING_REAUTH', 'TRANSFER')))
    await expect(store.create(input)).rejects.toThrow()
    await store.create(input)
    expect(headers(0).get('Idempotency-Key')).toBe(headers(1).get('Idempotency-Key'))
    fetchMock.mockResolvedValueOnce(response(operation('READY', 'TRANSFER')))
    await store.confirmTransfer('ACCEPT')
    expect(body(2)).toEqual({ decision: 'ACCEPT' })
    fetchMock.mockResolvedValueOnce(response(operation('REJECTED', 'TRANSFER')))
    await store.confirmTransfer('REJECT')
    expect(body(3)).toEqual({ decision: 'REJECT' })
    fetchMock.mockResolvedValueOnce(response(operation('EXPIRED', 'TRANSFER')))
    await store.reopen()
    expect(store.getSnapshot().operation?.state).toBe('EXPIRED')
  })
})

describe('provider window public operation protection',()=>{
 it.each(['LINK','TRANSFER'] as const)('keeps %s owner tokens in original window and checks protected GET before PKCE consumption',async type=>{
  login();const token=client.getAccessToken()
  const popup={closed:false,location:{href:'about:blank'},close:vi.fn()}
  vi.spyOn(window,'open').mockReturnValue(popup as unknown as Window)
  vi.spyOn(pkce,'generatePKCEPair').mockResolvedValue({codeVerifier:'v'.repeat(43),codeChallenge:'c'.repeat(43)})
  const store=new IdentityOperationStore(client)
  fetchMock.mockResolvedValueOnce(response(operation('AWAITING_REAUTH',type)));await store.reopen('op-1')
  fetchMock.mockResolvedValueOnce(response({authorizationId:'authz',authorizationUrl:'https://provider.test/authorize',expiresAt:new Date(Date.now()+300000).toISOString()}))
  await store.openProvider(type==='TRANSFER'?'TRANSFER_COUNTERPART':'TARGET_OWNERSHIP','https://app.test/callback')
  await expect(store.providerCallback()).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  popup.location.href='https://app.test/callback?operation_id=op-1&authorization_id=authz&identity_operation=proof_pending'
  fetchMock.mockResolvedValueOnce(response(operation('AWAITING_PROOF',type))).mockResolvedValueOnce(response(operation('READY',type)))
  await store.providerCallback()
  expect(fetchMock.mock.calls[2][1]?.method).toBe('GET')
  expect(headers(2).get('Authorization')).toBe('Bearer '+token)
  expect(body(3)).toEqual({authorizationId:'authz',codeVerifier:'v'.repeat(43)})
  expect(client.getAccessToken()).toBe(token)
  expect(sessionStorage.length).toBe(0)
  expect(popup.close).toHaveBeenCalled()
 })
 it('blocked popup sends no authorize request and cancellation prevents a late callback commit',async()=>{
  login();const store=new IdentityOperationStore(client)
  fetchMock.mockResolvedValueOnce(response(operation()));await store.reopen('op-1')
  vi.spyOn(window,'open').mockReturnValue(null)
  await expect(store.openProvider('CURRENT_ACCOUNT','https://app.test/callback')).rejects.toThrow('blocked')
  expect(fetchMock).toHaveBeenCalledOnce()
  const popup={closed:false,location:{href:'about:blank'},close:vi.fn()}
  vi.mocked(window.open).mockReturnValue(popup as unknown as Window)
  vi.spyOn(pkce,'generatePKCEPair').mockResolvedValue({codeVerifier:'v'.repeat(43),codeChallenge:'c'.repeat(43)})
  fetchMock.mockResolvedValueOnce(response({authorizationId:'authz',authorizationUrl:'https://provider.test/authorize',expiresAt:new Date(Date.now()+300000).toISOString()}))
  await store.openProvider('CURRENT_ACCOUNT','https://app.test/callback')
  popup.location.href='https://app.test/callback?operation_id=op-1&authorization_id=authz&identity_operation=proof_pending'
  let finish!:(value:Response)=>void
  fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>finish=resolve))
  const pending=store.providerCallback(),rejected=expect(pending).rejects.toMatchObject({code:'SESSION_INVALIDATED'})
  await vi.waitFor(()=>expect(finish).toBeDefined());store.cancelProviderWindow()
  finish(response(operation('READY')));await rejected
  expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith('/provider-callback'))).toBe(false)
 })
})
