import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { UserProfile } from './UserProfile'
import { storeTestTokens, testProviderProps } from '../test-utils'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

describe('UserProfile', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/.well-known/openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
      if (url.includes('/api/v1/auth/me/permissions')) {
        return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: [] }) }
      }
      return { ok: true, json: async () => [] }
    })
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders nothing when not authenticated', async () => {
    const { container } = renderWithProvider(createElement(UserProfile))
    await vi.advanceTimersByTimeAsync(10)

    expect(container.querySelector('h2')).toBeNull()
  })

  it('displays profile fields when authenticated', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserProfile))
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Profile')).toBeTruthy()
    expect(screen.getByText('test@example.com')).toBeTruthy()
    expect(screen.getByText('Test User')).toBeTruthy()
  })

  it('displays organization info', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserProfile))
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Organization')).toBeTruthy()
    expect(screen.getByText('acme (Administrator)')).toBeTruthy()
  })

  it('displays roles', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserProfile))
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Roles')).toBeTruthy()
    expect(screen.getByText('admin')).toBeTruthy()
  })

  it('displays devices when available', async () => {
    storeTestTokens()
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/.well-known/openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
      if (url.includes('/api/v1/auth/me/permissions')) {
        return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: [] }) }
      }
      return {
        ok: true,
        json: async () => [
          { id: 'd1', name: 'Chrome on MacOS', lastIp: '1.2.3.4', lastSeen: '2026-04-12', trusted: true },
        ],
      }
    })
    globalThis.fetch = fetchMock

    renderWithProvider(createElement(UserProfile))
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Devices')).toBeTruthy()
    expect(screen.getByText('Chrome on MacOS')).toBeTruthy()
    expect(screen.getByText('Revoke')).toBeTruthy()
  })
})
