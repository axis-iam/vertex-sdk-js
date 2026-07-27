import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useDevices } from './useDevices'
import type { Device } from './useDevices'
import { storeTestTokens, testProviderProps } from '../test-utils'

const mockDevices: Device[] = [
  { id: 'dev-1', name: 'Chrome on MacOS', lastIp: '192.168.1.1', lastSeen: '2026-04-12T10:00:00Z', trusted: true },
  { id: 'dev-2', name: 'Firefox on Windows', lastIp: '10.0.0.1', lastSeen: '2026-04-11T08:00:00Z', trusted: false },
]

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

describe('useDevices', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()

    fetchMock = vi.fn()
      // First call: OIDC discovery (from IamProvider mount)
      .mockResolvedValueOnce({ ok: true, json: async () => mockOidcConfig })
      // Second call: fetch devices (from useDevices useEffect)
      .mockResolvedValueOnce({ ok: true, json: async () => mockDevices })
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads devices on mount', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useDevices(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.devices).toHaveLength(2)
    expect(result.current.devices[0].name).toBe('Chrome on MacOS')
  })

  it('revokeDevice calls DELETE and refreshes list', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useDevices(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    // Mock for DELETE + re-fetch
    fetchMock
      .mockResolvedValueOnce({ ok: true }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => [mockDevices[1]] }) // refresh

    await act(async () => {
      await result.current.revokeDevice('dev-1')
    })

    // Find the DELETE call
    const deleteCall = fetchMock.mock.calls.find(
      (call: [string, ...unknown[]]) => call[1] && (call[1] as RequestInit).method === 'DELETE',
    )
    expect(deleteCall).toBeTruthy()
    expect(deleteCall![0]).toContain('/devices/dev-1')
  })

  it('trustDevice calls POST and refreshes list', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useDevices(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fetchMock
      .mockResolvedValueOnce({ ok: true }) // POST trust
      .mockResolvedValueOnce({ ok: true, json: async () => mockDevices }) // refresh

    await act(async () => {
      await result.current.trustDevice('dev-2')
    })

    const trustCall = fetchMock.mock.calls.find(
      (call: [string, ...unknown[]]) => typeof call[0] === 'string' && call[0].includes('/trust'),
    )
    expect(trustCall).toBeTruthy()
    expect(trustCall![0]).toContain('/devices/dev-2/trust')
  })

  it('returns empty devices when unauthenticated', async () => {
    // No tokens stored, so getAccessToken returns null → fetchDevices returns early
    const { result } = renderHook(() => useDevices(), { wrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(result.current.devices).toEqual([])
  })
})
