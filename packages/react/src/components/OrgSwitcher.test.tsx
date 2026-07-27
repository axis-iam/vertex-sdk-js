import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { OrgSwitcher, OrganizationSwitcher } from './OrgSwitcher'
import { storeTestTokens, testProviderProps } from '../test-utils'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

const mockOrgs = [
  { organizationId: 'org-1', name: 'Acme Corp', slug: 'acme', role: 'ADMIN', joinedAt: '2026-07-06T00:00:00Z', current: true },
  { organizationId: 'org-2', name: 'Beta Inc', slug: 'beta', role: 'MEMBER', joinedAt: '2026-07-06T00:00:00Z', current: false },
]

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

describe('OrganizationSwitcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    storeTestTokens(undefined, ['orders:read'])
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/.well-known/openid-configuration')) {
        return { ok: true, json: async () => mockOidcConfig }
      }
      if (url.endsWith('/api/v1/auth/me/organizations') && init?.method !== 'POST') {
        return { ok: true, text: async () => JSON.stringify(mockOrgs) }
      }
      if (url.endsWith('/api/v1/auth/me/organizations/current') && init?.method === 'POST') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            organizationId: 'org-2',
            continuation: 'TOKEN_REFRESH_REQUIRED',
            tokenRefreshRequired: true,
            message: 'Refresh token to receive the new organization context.',
          }),
        }
      }
      const summary = { applicationId: 'app-test', organizationId: 'org-2', roles: ['admin'], permissions: ['orders:read'] }
      return { ok: true, json: async () => summary, text: async () => JSON.stringify(summary) }
    })
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows current org name and dropdown organizations', async () => {
    renderWithProvider(createElement(OrganizationSwitcher))

    await waitFor(() => expect(screen.getByText(/Acme Corp/)).toBeTruthy())
    fireEvent.click(screen.getByText(/Acme Corp/))

    expect(screen.getByText('Beta Inc')).toBeTruthy()
    expect(screen.getByText('Member')).toBeTruthy()
  })

  it('calls switch endpoint and returns continuation response', async () => {
    const onSwitch = vi.fn()
    renderWithProvider(createElement(OrganizationSwitcher, { onSwitch }))

    await waitFor(() => expect(screen.getByText(/Acme Corp/)).toBeTruthy())
    fireEvent.click(screen.getByText(/Acme Corp/))
    fireEvent.click(screen.getByText('Beta Inc'))

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-2',
      tokenRefreshRequired: true,
    })))

    const switchRequest = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/me/organizations/current'))
    expect(switchRequest?.[1]?.method).toBe('POST')
    expect(JSON.parse(switchRequest?.[1]?.body as string)).toEqual({ organizationId: 'org-2' })
  })

  it('keeps legacy OrgSwitcher callback shape', async () => {
    const onSwitch = vi.fn()
    renderWithProvider(createElement(OrgSwitcher, { onSwitch }))

    await waitFor(() => expect(screen.getByText(/Acme Corp/)).toBeTruthy())
    fireEvent.click(screen.getByText(/Acme Corp/))
    fireEvent.click(screen.getByText('Beta Inc'))

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('org-2', expect.objectContaining({
      organizationId: 'org-2',
    })))
  })
})
