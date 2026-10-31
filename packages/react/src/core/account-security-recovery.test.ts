import { afterEach, expect, it, vi } from 'vitest'
import { AccountSecurityStore } from './account-security-store'
import { receiptKey } from './account-security-receipt'
import { response } from './account-security-fixtures.test-support'
import { recoveryFixture } from './account-security-recovery.test-support'
import type { AuthClient } from './auth-client'

const clients: AuthClient[] = []
afterEach(() => {
  clients.forEach(c => c.dispose()); clients.length = 0
  sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
async function setup(mode: 'oauth_tokens' | 'server_session') {
  const f = await recoveryFixture(mode); clients.push(f.client); return f
}
for (const mode of ['oauth_tokens', 'server_session'] as const) {
  it(`${mode}: loss + 401 keeps only a bounded read receipt; explicit fresh-sid GET resolves without replay/logout`, async () => {
    const f = await setup(mode)
    await f.loseDisable()
    expect(f.getOperation().state).toBe('COMMITTED')
    expect(f.client.state.isAuthenticated()).toBe(false)
    expect(f.store.getSnapshot()).toMatchObject({
      operation: null, uncertain: true, recoveryReceipt: { ref: f.getOperation().ref, type: 'TOTP_DISABLE', expectedLoginMethodVersion: 4 },
      material: null, recoveryCodes: null, challengeRef: null, availableMethods: [], uncertainCreate: null,
    })
    expect(sessionStorage.length).toBe(0)
    const wireCount = f.fetchMock.mock.calls.length
    await expect(f.store.query()).rejects.toMatchObject({ code: 'REAUTHENTICATION_REQUIRED' })
    expect(f.fetchMock.mock.calls).toHaveLength(wireCount)
    const receipt = f.store.prepareReauthentication()
    expect(receipt).toEqual({ ref: f.getOperation().ref, type: 'TOTP_DISABLE' })
    expect(Object.keys(JSON.parse(sessionStorage.getItem(receiptKey(f.client))!)).sort()).toEqual(
      ['ref', 'type', 'expectedLoginMethodVersion', 'expiresAt', 'issuer', 'clientId', 'applicationId', 'userId', 'mode'].sort())
    await f.signIn()
    expect(f.store.getSnapshot().operation).toBeNull()
    const beforeQuery = f.fetchMock.mock.calls.length
    await expect(f.store.query('another-ref')).rejects.toMatchObject({ code: 'RECEIPT_REFERENCE_MISMATCH' })
    for (const mutation of [() => f.store.create('TOTP_ENROLL', 5), () => f.store.complete(), () => f.store.begin(), () => f.store.cancel(),
      () => f.store.reauthenticate({ method: 'PASSWORD', password: 'not-sent' }), () => f.store.startStepUp()]) {
      await expect(mutation()).rejects.toMatchObject({ code: 'RECEIPT_READ_ONLY' })
    }
    await expect(f.store.retryCreate()).rejects.toMatchObject({ code: 'CREATE_NOT_PENDING' })
    expect(f.fetchMock.mock.calls).toHaveLength(beforeQuery)
    await f.store.query()
    expect(f.store.getSnapshot().operation?.state).toBe('COMMITTED')
    expect(f.store.acknowledge()).toBe(false)
    expect(f.client.state.isAuthenticated()).toBe(true)
    expect(f.store.getSnapshot().recoveryReceipt).toBeNull()
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0)
    expect(f.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/complete'))).toHaveLength(1)
  })
  it.each(['user', 'app', 'client'] as const)(`${mode}: wrong %s cannot inherit or query the receipt`, async field => {
    const f = await setup(mode); await f.loseDisable(); f.store.prepareReauthentication()
    if (field === 'client' && mode === 'server_session') {
      await expect(f.signIn(user => { user.authenticationContext.clientId = 'other-client' })).rejects.toBeInstanceOf(Error)
      // A rejected profile has no authority; explicit clear also discards the handoff.
      f.client.state.clear()
    } else await f.signIn(user => {
      if (field === 'user') user.id = 'other-user'
      else if (field === 'app') user.authenticationContext.applicationId = 'other-app'
      else user.authenticationContext.clientId = 'other-client'
    })
    expect(f.store.getSnapshot().recoveryReceipt).toBeNull()
    expect(f.store.getSnapshot().operation).toBeNull()
    const n = f.fetchMock.mock.calls.length
    expect(() => f.store.query()).toThrow()
    expect(f.fetchMock.mock.calls).toHaveLength(n)
    expect(sessionStorage.length).toBe(0)
  })
  it.each(['clear', 'logout', 'dispose', 'forget'] as const)(`${mode}: explicit %s discards the safe handoff`, async kind => {
    const f = await setup(mode); await f.loseDisable(); f.store.prepareReauthentication()
    if (kind === 'clear') f.client.state.clear()
    else if (kind === 'logout') {
      if (mode === 'oauth_tokens') await expect(f.client.logout()).rejects.toBeInstanceOf(Error)
      else {
        f.fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
        await f.client.logout()
      }
    } else if (kind === 'dispose') f.client.dispose()
    else f.store.discardReceipt()
    expect(f.store.getSnapshot().recoveryReceipt).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
  it(`${mode}: navigation restores no authority, rejects nonterminal/changed receipts and drops late results`, async () => {
    const f = await setup(mode); await f.loseDisable(); f.store.prepareReauthentication()
    const resumed = new AccountSecurityStore(f.client)
    expect(resumed.getSnapshot().recoveryReceipt?.ref).toBe(f.getOperation().ref)
    expect(resumed.getSnapshot().operation).toBeNull()
    await f.signIn()
    const actual = f.fetchMock.getMockImplementation()!
    f.fetchMock.mockImplementationOnce(async () => response(f.wire({ ...f.getOperation(), state: 'READY', result: null })))
    await expect(resumed.query()).rejects.toMatchObject({ code: 'RECEIPT_NOT_TERMINAL' })
    expect(resumed.getSnapshot().operation).toBeNull()
    f.fetchMock.mockImplementationOnce(async () => response(f.wire({ ...f.getOperation(), expectedLoginMethodVersion: 99 })))
    await expect(resumed.query()).rejects.toMatchObject({ code: 'RECEIPT_NOT_TERMINAL' })
    let finish!: (r: Response) => void
    f.fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const query = resumed.query(), rejected = expect(query).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    f.client.state.clear()
    finish(response(f.wire())); await rejected
    expect(resumed.getSnapshot().recoveryReceipt).toBeNull()
    expect(resumed.getSnapshot().operation).toBeNull()
    f.fetchMock.mockImplementation(actual)
  })
  it(`${mode}: a late unauthorized response never clears a newly signed-in session`, async () => {
    const f = await setup(mode)
    await f.store.create('TOTP_DISABLE', 4)
    let finish!: (r: Response) => void
    f.fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const query = f.store.query(), rejected = expect(query).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await f.signIn()
    finish(response({ error: 'SESSION_REVOKED' }, 401)); await rejected
    expect(f.client.state.isAuthenticated()).toBe(true)
    expect(f.store.getSnapshot().operation).toBeNull()
    expect(f.store.getSnapshot().recoveryReceipt).toBeNull()
  })
  it(`${mode}: unauthorized clears delivered setup material, and a later explicit clear cannot rehydrate a saved receipt`, async () => {
    const f = await setup(mode)
    await f.store.create('TOTP_ENROLL', 4); await f.store.begin()
    expect(f.store.getSnapshot().material).not.toBeNull()
    f.fetchMock.mockResolvedValueOnce(response({ error: 'SESSION_REVOKED' }, 401))
    await expect(f.store.query()).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    expect(f.store.getSnapshot()).toMatchObject({ material: null, recoveryCodes: null, challengeRef: null, operation: null })
    f.store.prepareReauthentication()
    const key = receiptKey(f.client), saved = sessionStorage.getItem(key)!
    f.client.state.clear()
    sessionStorage.setItem(key, saved)
    expect(new AccountSecurityStore(f.client).getSnapshot().recoveryReceipt).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
  it(`${mode}: unavailable optional storage cannot break memory-only recovery or explicit cleanup`, async () => {
    const f = await setup(mode); await f.loseDisable()
    const storage = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError') })
    expect(() => new AccountSecurityStore(f.client)).not.toThrow()
    expect(() => f.store.prepareReauthentication()).toThrow()
    expect(f.store.getSnapshot().recoveryReceipt).not.toBeNull()
    expect(() => f.client.state.clear()).not.toThrow()
    expect(f.store.getSnapshot().recoveryReceipt).toBeNull()
    storage.mockRestore()
  })
  it(`${mode}: expired, malformed and configuration-mismatched stored receipts cannot become authority`, async () => {
    const f = await setup(mode); await f.loseDisable(); f.store.prepareReauthentication()
    const key = receiptKey(f.client), receipt = f.store.getSnapshot().recoveryReceipt!
    for (const patch of [{ ref: '../unsafe' }, { issuer: 'https://other.test' }, { clientId: 'other' }, { mode: 'other' }, { expiresAt: '2020-01-01T00:00:00Z' }, { sid: 'forbidden' }]) {
      sessionStorage.setItem(key, JSON.stringify({ ...receipt, ...patch }))
      expect(new AccountSecurityStore(f.client).getSnapshot().recoveryReceipt).toBeNull()
      expect(sessionStorage.getItem(key)).toBeNull()
    }
    sessionStorage.setItem(key, '{')
    expect(new AccountSecurityStore(f.client).getSnapshot().recoveryReceipt).toBeNull()
    f.store.prepareReauthentication()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(Date.parse(receipt.expiresAt) - Date.now() + 1)
    expect(f.store.getSnapshot().recoveryReceipt).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
}
