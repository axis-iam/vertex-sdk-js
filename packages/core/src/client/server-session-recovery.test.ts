import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { ServerSession } from './server-session'
import { SessionTransportError } from './session-transport'

const view = () => ({
  state: 'AUTHENTICATED', expiresAt: new Date(Date.now() + 600_000).toISOString(),
  owner: 'A'.repeat(43), version: 1, csrfToken: 'B'.repeat(43),
  profile: JSON.parse(readFileSync('../../testdata/current-user.json', 'utf8')),
  permissions: { roles: [], permissions: [] },
})
const sessions: ServerSession[] = []
afterEach(() => { sessions.forEach(s => s.dispose()); sessions.length = 0 })
it.each(['bootstrap', 'action'] as const)('%s 401 clears authentication and identifies unauthorized invalidation', async path => {
  const transport = { request: vi.fn().mockResolvedValue(view()) }
  const session = new ServerSession(transport); sessions.push(session)
  await session.restore()
  expect(session.invalidationReason).toBe('replaced')
  transport.request.mockRejectedValueOnce(new SessionTransportError('SESSION_REVOKED', 401))
  await expect(path === 'bootstrap' ? session.restore() : session.action({ action: 'mfaCapabilities' })).rejects.toMatchObject({ status: 401 })
  expect(session.isAuthenticated()).toBe(false)
  expect(session.getSnapshot()).toBeNull()
  expect(session.invalidationReason).toBe('unauthorized')
})
it('does not relabel explicit clear, logout or dispose as recoverable unauthorized', async () => {
  const session = new ServerSession({ request: async () => view() }); sessions.push(session)
  await session.restore(); session.clear()
  expect(session.invalidationReason).toBe('cleared')
  await session.restore(); await session.logout()
  expect(session.invalidationReason).toBe('cleared')
  session.dispose()
  expect(session.invalidationReason).toBe('disposed')
})
it('a late old-session 401 cannot clear a freshly restored session', async () => {
  let reject!: (error: Error) => void
  const transport = { request: vi.fn().mockResolvedValue(view()) }
  const session = new ServerSession(transport); sessions.push(session)
  await session.restore()
  transport.request.mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
  const old = session.action({ action: 'mfaCapabilities' })
  const failed = expect(old).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  session.clear(); await session.restore()
  reject(new SessionTransportError('SESSION_REVOKED', 401)); await failed
  expect(session.isAuthenticated()).toBe(true)
  expect(session.invalidationReason).toBe('replaced')
})
