import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAccountSecurity } from './useAccountSecurity'
import type { AuthClient } from '../core/auth-client'
import { securityFixture } from '../core/account-security-fixtures.test-support'
import { recoveryFixture } from '../core/account-security-recovery.test-support'
import type { AccountSecuritySummary } from '../core/types'
let client: AuthClient
const clients: AuthClient[] = []
vi.mock('../provider/IamProvider', () => ({ useIamContext: () => ({ client, isAuthenticated: client.state.isAuthenticated(), isLoaded: true }) }))
afterEach(() => { cleanup(); clients.forEach(c => c.dispose()); clients.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })
const summary: AccountSecuritySummary = { emailVerified: true, passwordCredentialPresent: true, mfaEnrolled: false, totpEnrolled: false, webAuthnEnrolled: false, activeSessionCount: 1 }
async function setup(mode: 'oauth_tokens' | 'server_session' = 'oauth_tokens') { const f = await securityFixture(mode); client = f.client; clients.push(client); return f }
it.each(['oauth_tokens', 'server_session'] as const)('%s exposes only receipt recovery until explicit terminal read and acknowledgement', async mode => {
  const f = await recoveryFixture(mode); client = f.client; clients.push(client)
  const { result } = renderHook(() => useAccountSecurity())
  await waitFor(() => expect(result.current.capabilities?.loginMethodVersion).toBe(4))
  await act(() => f.loseDisable())
  expect(result.current.state.recoveryReceipt?.type).toBe('TOTP_DISABLE')
  expect(result.current.state.operation).toBeNull()
  expect(result.current.capabilities).toBeNull()
  await act(() => f.signIn())
  expect(result.current.capabilities).toBeNull()
  expect(result.current.state.operation).toBeNull()
  await act(() => result.current.actions.query())
  expect(result.current.state.operation?.state).toBe('COMMITTED')
  expect(result.current.capabilities).toBeNull()
  await act(async () => { result.current.actions.acknowledge(); await result.current.refetch() })
  expect(client.state.isAuthenticated()).toBe(true)
  expect(result.current.state.recoveryReceipt).toBeNull()
  expect(result.current.capabilities).not.toBeNull()
})
it('exposes capabilities and the shared operation actions for Headless', async () => {
  await setup()
  const { result } = renderHook(() => useAccountSecurity())
  await waitFor(() => expect(result.current.security).toEqual(summary))
  expect(result.current.capabilities?.totpEnroll.allowed).toBe(true)
  expect(result.current.recoveryCodesRemaining).toBe(0)
  await act(() => result.current.actions.create('TOTP_ENROLL', 4))
  expect(result.current.state.operation?.state).toBe('READY')
})
it.each(['oauth_tokens', 'server_session'] as const)('%s retires a writable snapshot throughout refresh failure and retry', async mode => {
  const f = await securityFixture(mode); client = f.client; clients.push(client)
  const { result } = renderHook(() => useAccountSecurity())
  await waitFor(() => expect(result.current.capabilities?.loginMethodVersion).toBe(4))
  let finish!: (value: ReturnType<typeof f.capabilities>) => void
  const read = vi.spyOn(client, 'getMfaCapabilities').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let refresh!: ReturnType<typeof result.current.refetch>
  act(() => { refresh = result.current.refetch() })
  expect(result.current.isLoading).toBe(true)
  expect(result.current.capabilities).toBeNull()
  expect(result.current.security).toBeNull()
  await act(async () => { finish({ ...f.capabilities(), loginMethodVersion: 5 }); await refresh })
  expect(result.current.capabilities?.loginMethodVersion).toBe(5)
  read.mockRejectedValueOnce(new Error('controlled refresh failure'))
  await act(() => result.current.refetch())
  expect(result.current.capabilities).toBeNull()
  expect(result.current.error).toBeInstanceOf(Error)
  read.mockResolvedValueOnce({ ...f.capabilities(), loginMethodVersion: 6 })
  await act(() => result.current.refetch())
  expect(result.current.capabilities?.loginMethodVersion).toBe(6)
  expect(result.current.error).toBeNull()
})
it.each((['oauth_tokens', 'server_session'] as const).flatMap(mode => (['resolve', 'reject'] as const).map(outcome => ({ mode, outcome }))))('$mode ignores late $outcome after owner change, including error/loading writes', async ({ mode, outcome }) => {
  await setup(mode)
  let resolve!: (value: AccountSecuritySummary) => void, reject!: (error: Error) => void
  const { result, rerender } = renderHook(() => useAccountSecurity())
  await waitFor(() => expect(result.current.capabilities?.loginMethodVersion).toBe(4))
  vi.spyOn(client, 'getAccountSecuritySummary').mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  act(() => { void result.current.refetch() })
  expect(result.current.isLoading).toBe(true)
  const old = client
  const fresh = await securityFixture(mode); clients.push(fresh.client)
  let freshCapabilities!: (value: ReturnType<typeof fresh.capabilities>) => void
  vi.spyOn(fresh.client, 'getMfaCapabilities').mockImplementationOnce(() => new Promise(resolve => { freshCapabilities = resolve }))
  client = fresh.client
  rerender()
  expect(result.current.capabilities).toBeNull()
  expect(result.current.security).toBeNull()
  await act(async () => freshCapabilities({ ...fresh.capabilities(), loginMethodVersion: 6 }))
  await waitFor(() => expect(result.current.security).toEqual(summary))
  await act(async () => { if (outcome === 'resolve') resolve({ ...summary, activeSessionCount: 99 }); else reject(new Error('old owner failed')) })
  expect(result.current.security?.activeSessionCount).toBe(1)
  expect(result.current.error).toBeNull()
  expect(result.current.isLoading).toBe(false)
  expect(result.current.capabilities?.loginMethodVersion).toBe(6)
  old.state.clear()
})
it('invalidates all pending load writes when disabled or unmounted', async () => {
  await setup()
  let finish!: (value: AccountSecuritySummary) => void
  vi.spyOn(client, 'getAccountSecuritySummary').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result, rerender, unmount } = renderHook(({ enabled }) => useAccountSecurity({ enabled }), { initialProps: { enabled: true } })
  rerender({ enabled: false })
  await act(async () => finish(summary))
  expect(result.current.security).toBeNull()
  expect(result.current.error).toBeNull()
  expect(result.current.isLoading).toBe(false)
  unmount()
})
it('logout immediately hides security facts and clears sensitive operation memory', async () => {
  await setup()
  const { result } = renderHook(() => useAccountSecurity())
  await waitFor(() => expect(result.current.security).toEqual(summary))
  await act(() => result.current.actions.create('TOTP_ENROLL', 4))
  await act(() => result.current.actions.begin())
  expect(result.current.state.material).not.toBeNull()
  act(() => client.state.clear())
  expect(result.current.security).toBeNull()
  expect(result.current.state.material).toBeNull()
  expect(result.current.state.operation).toBeNull()
})
