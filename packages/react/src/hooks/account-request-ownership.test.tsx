import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../core/oauth-client'
import type { AccountOrganization, AccountProfile, AccountSession } from '../core/types'
import { makeTestJwt } from '../test-utils'
import { useAccountOrganizations } from './useAccountOrganizations'
import { useAccountSessions } from './useAccountSessions'
import { useAccountProfile } from './useAccountProfile'
import { useOrganizationSwitcher } from './useOrganizationSwitcher'

const context = vi.hoisted(() => ({ client: null as OAuthClient | null, authenticated: true }))
vi.mock('../provider/IamProvider', () => ({
  useIamContext: () => ({ client: context.client, isAuthenticated: context.authenticated, isLoaded: true }),
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function login(client: OAuthClient, id: string) {
  client.tokenManager.store({ access_token: makeTestJwt({ sub: id }), refresh_token: 'fixture-refresh', token_type: 'Bearer', expires_in: 3600 }, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
}
function client() {
  const value = new OAuthClient({ clientId: 'test-app', issuerUri: 'https://iam.test', redirectUri: '/callback' }, { startPaused: true })
  login(value, 'A')
  clients.push(value)
  return value
}
const clients: OAuthClient[] = []
const profile = (id: string): AccountProfile => ({ userId: id, applicationId: 'app', globalIdentityId: null, email: null, emailVerified: false, username: null, displayName: id, avatarUrl: null, status: 'ACTIVE', createdAt: '', updatedAt: '', currentOrganization: null })
const organizations = (id: string): AccountOrganization[] => [{ organizationId: id, name: id, slug: null, role: 'MEMBER', joinedAt: null, current: true }]
const sessions = (id: string): AccountSession[] => [{ sessionId: id, ipAddress: null, userAgent: id, deviceId: null, createdAt: '', lastSeenAt: '', current: false }]
const readers = [
  { name: 'organizations', method: 'listAccountOrganizations', data: organizations, hook: (enabled: boolean) => { const v = useAccountOrganizations({ enabled }); return { ...v, data: v.organizations } } },
  { name: 'sessions', method: 'listAccountSessions', data: sessions, hook: (enabled: boolean) => { const v = useAccountSessions({ enabled }); return { ...v, data: v.sessions } } },
  { name: 'profile', method: 'getAccountProfile', data: profile, hook: (enabled: boolean) => { const v = useAccountProfile({ enabled }); return { ...v, data: v.profile } } },
] as const
beforeEach(() => { context.client = client(); context.authenticated = true })
afterEach(() => { cleanup(); for (const c of clients.splice(0)) c.dispose(); vi.restoreAllMocks() })

describe.each(readers)('$name ownership', ({ method, data, hook }) => {
  function pending() {
    const d = deferred<ReturnType<typeof data>>()
    // Each method keeps its real typed return; the union is narrowed at the fixture boundary.
    if (method === 'getAccountProfile') vi.spyOn(context.client!, method).mockImplementation(() => d.promise as Promise<AccountProfile>)
    if (method === 'listAccountOrganizations') vi.spyOn(context.client!, method).mockImplementation(() => d.promise as Promise<AccountOrganization[]>)
    if (method === 'listAccountSessions') vi.spyOn(context.client!, method).mockImplementation(() => d.promise as Promise<AccountSession[]>)
    return d
  }
  it.each((['logout', 'same-client', 'client-replacement', 'unmount'] as const).flatMap(boundary => (['success', 'error'] as const).map(outcome => ({ boundary, outcome }))))('discards old $outcome after $boundary, including returned data', async ({ boundary, outcome }) => {
    const old = pending()
    const { result, rerender, unmount } = renderHook(() => hook(false))
    let request!: Promise<unknown>
    act(() => { request = result.current.refetch() })
    if (boundary === 'logout') { context.client!.state.clear(); context.authenticated = false }
    if (boundary === 'same-client') login(context.client!, 'B')
    if (boundary === 'client-replacement') context.client = client()
    if (boundary === 'unmount') unmount(); else rerender()
    await act(async () => { if (outcome === 'success') old.resolve(data('A')); else old.reject(new Error('old read error')); await request })
    expect(await request).toEqual(method === 'getAccountProfile' ? null : [])
    if (boundary !== 'unmount') {
      expect(result.current.data).toEqual(method === 'getAccountProfile' ? null : [])
      expect(result.current.error).toBeNull()
    }
  })
  it.each(['success', 'error'] as const)('latest refetch wins over an older %s', async outcome => {
    const old = pending()
    const { result } = renderHook(() => hook(false))
    let first!: Promise<unknown>, second!: Promise<unknown>
    act(() => { first = result.current.refetch() })
    const latest = pending()
    act(() => { second = result.current.refetch() })
    await act(async () => { latest.resolve(data('new')); await second })
    await act(async () => { if (outcome === 'success') old.resolve(data('old')); else old.reject(new Error('old failure')); await first })
    expect(result.current.data).toEqual(data('new'))
    expect(result.current.error).toBeNull()
  })
  it('old catch/finally cannot clear data or finish a newer pending request', async () => {
    const old = pending()
    const { result } = renderHook(() => hook(false))
    let first!: Promise<unknown>, second!: Promise<unknown>
    act(() => { first = result.current.refetch() })
    const latest = pending()
    act(() => { second = result.current.refetch() })
    await act(async () => { old.reject(new Error('old failure')); await first })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.error).toBeNull()
    await act(async () => { latest.resolve(data('new')); await second })
    expect(result.current.data).toEqual(data('new'))
    expect(result.current.isLoading).toBe(false)
  })
  it('automatically reloads on same-client generation replacement while still authenticated', async () => {
    const old = pending()
    const { result, rerender } = renderHook(() => hook(true))
    const latest = pending()
    login(context.client!, 'B'); rerender()
    await act(async () => { latest.resolve(data('B')); await latest.promise })
    await act(async () => { old.resolve(data('A')); await old.promise })
    expect(result.current.data).toEqual(data('B'))
  })
})

it.each(['success', 'error'] as const)('profile update rejects stale %s and leaves B update/loading intact', async outcome => {
  const old = deferred<AccountProfile>(), latest = deferred<AccountProfile>()
  vi.spyOn(context.client!, 'updateAccountProfile').mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const { result, rerender } = renderHook(() => useAccountProfile({ enabled: false }))
  let first!: Promise<unknown>, second!: Promise<unknown>
  act(() => { first = result.current.updateProfile({ displayName: 'A' }) })
  const rejected = expect(first).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  login(context.client!, 'B'); rerender()
  act(() => { second = result.current.updateProfile({ displayName: 'B' }) })
  await act(async () => { if (outcome === 'success') old.resolve(profile('A')); else old.reject(new Error('old write error')); await rejected })
  expect(result.current.isUpdating).toBe(true)
  expect(result.current.error).toBeNull()
  await act(async () => { latest.resolve(profile('B')); await second })
  expect(result.current.profile).toEqual(profile('B'))
})

it.each((['revokeSession', 'revokeOtherSessions', 'logoutAccount'] as const).flatMap(operation => (['success', 'error'] as const).map(outcome => ({ operation, outcome }))))('$operation rejects obsolete $outcome without mutating B or its busy flag', async ({ operation, outcome }) => {
  const old = deferred<void>(), latest = deferred<void>()
  const method = operation === 'revokeSession' ? 'revokeAccountSession' : operation === 'revokeOtherSessions' ? 'revokeOtherAccountSessions' : 'logoutAccount'
  vi.spyOn(context.client!, method).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  vi.spyOn(context.client!, 'listAccountSessions').mockResolvedValue(sessions('B'))
  const { result, rerender } = renderHook(() => useAccountSessions({ enabled: false }))
  let first!: Promise<void>, second!: Promise<void>
  act(() => { first = result.current[operation]('B') })
  const rejected = expect(first).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  login(context.client!, 'B'); rerender()
  await act(() => result.current.refetch())
  act(() => { second = result.current[operation]('other') })
  await act(async () => { if (outcome === 'success') old.resolve(); else old.reject(new Error('old write failure')); await rejected })
  expect(result.current.sessions).toEqual(sessions('B'))
  expect(result.current[operation === 'revokeSession' ? 'isRevoking' : operation === 'revokeOtherSessions' ? 'isRevokingOthers' : 'isLoggingOut']).toBe(true)
  await act(async () => { latest.resolve(); await second })
})

it('organization switch cannot return a stale continuation or finish a newer switch', async () => {
  const old = deferred<Awaited<ReturnType<OAuthClient['switchAccountOrganization']>>>(), latest = deferred<Awaited<ReturnType<OAuthClient['switchAccountOrganization']>>>()
  vi.spyOn(context.client!, 'switchAccountOrganization').mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const response = (id: string) => ({ organizationId: id, continuation: 'TOKEN_REFRESH_REQUIRED' as const, tokenRefreshRequired: true, message: 'refresh' })
  const { result, rerender } = renderHook(() => useOrganizationSwitcher({ enabled: false }))
  let first!: Promise<unknown>, second!: Promise<unknown>
  act(() => { first = result.current.switchOrganization('A') })
  const rejected = expect(first).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  login(context.client!, 'B'); rerender()
  act(() => { second = result.current.switchOrganization('B') })
  await act(async () => { old.resolve(response('A')); await rejected })
  expect(result.current.switchResponse).toBeNull()
  expect(result.current.isSwitching).toBe(true)
  await act(async () => { latest.resolve(response('B')); await second })
  expect(result.current.switchResponse).toEqual(response('B'))
})

it('profile update supersedes an older read and preserves the successful public result', async () => {
  const read = deferred<AccountProfile>(), write = deferred<AccountProfile>()
  vi.spyOn(context.client!, 'getAccountProfile').mockReturnValue(read.promise)
  vi.spyOn(context.client!, 'updateAccountProfile').mockReturnValue(write.promise)
  const { result } = renderHook(() => useAccountProfile({ enabled: false }))
  let reading!: Promise<unknown>, writing!: Promise<unknown>
  act(() => { reading = result.current.refetch() })
  act(() => { writing = result.current.updateProfile({ displayName: 'new' }) })
  await act(async () => { write.resolve(profile('new')); await writing })
  await act(async () => { read.resolve(profile('old')); await reading })
  expect(await writing).toEqual(profile('new'))
  expect(result.current.profile).toEqual(profile('new'))
  expect(result.current.isUpdating || result.current.isLoading).toBe(false)
})

it.each(['update', 'revoke', 'revokeOthers', 'logout', 'switch'] as const)('%s cannot report success after component unmount', async operation => {
  const pending = deferred<never>()
  vi.spyOn(context.client!, 'updateAccountProfile').mockReturnValue(pending.promise)
  vi.spyOn(context.client!, 'revokeAccountSession').mockReturnValue(pending.promise)
  vi.spyOn(context.client!, 'revokeOtherAccountSessions').mockReturnValue(pending.promise)
  vi.spyOn(context.client!, 'logoutAccount').mockReturnValue(pending.promise)
  vi.spyOn(context.client!, 'switchAccountOrganization').mockReturnValue(pending.promise)
  const { result, unmount } = renderHook(() => ({ profile: useAccountProfile({ enabled: false }), sessions: useAccountSessions({ enabled: false }), switcher: useOrganizationSwitcher({ enabled: false }) }))
  let promise!: Promise<unknown>
  act(() => {
    promise = operation === 'update' ? result.current.profile.updateProfile({ displayName: 'new' })
      : operation === 'revoke' ? result.current.sessions.revokeSession('A')
      : operation === 'revokeOthers' ? result.current.sessions.revokeOtherSessions()
      : operation === 'logout' ? result.current.sessions.logoutAccount()
      : result.current.switcher.switchOrganization('A')
  })
  const rejected = expect(promise).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  unmount()
  pending.reject(new Error('late error'))
  await rejected
})

it('normal logout resolves after its own intentional generation invalidation', async () => {
  const completed = deferred<void>()
  vi.spyOn(context.client!, 'logoutAccount').mockImplementation(() => { context.client!.state.clear(); return completed.promise })
  const { result, rerender } = renderHook(() => useAccountSessions({ enabled: false }))
  let promise!: Promise<void>
  act(() => { promise = result.current.logoutAccount() })
  context.authenticated = false; rerender()
  await act(async () => { completed.resolve(); await promise })
  await expect(promise).resolves.toBeUndefined()
  expect(result.current.sessions).toEqual([])
  expect(result.current.isLoggingOut).toBe(false)
})

it('read ownership is checked against live generation before a provider rerender', async () => {
  const d = deferred<AccountProfile>()
  vi.spyOn(context.client!, 'getAccountProfile').mockReturnValue(d.promise)
  const { result } = renderHook(() => useAccountProfile({ enabled: false }))
  let promise!: Promise<unknown>
  act(() => { promise = result.current.refetch() })
  login(context.client!, 'B')
  await act(async () => { d.resolve(profile('A')); await promise })
  expect(await promise).toBeNull()
})
