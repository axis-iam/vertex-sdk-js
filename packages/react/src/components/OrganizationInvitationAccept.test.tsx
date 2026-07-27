import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { OrganizationInvitationAccept } from './OrganizationInvitationAccept'
import { testProviderProps } from '../test-utils'

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

describe('OrganizationInvitationAccept', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/.well-known/openid-configuration')) {
        return { ok: true, json: async () => mockOidcConfig }
      }
      if (url.endsWith('/api/v1/auth/organization-invitations/public-token') && init?.method !== 'POST') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            applicationId: 'app-1',
            applicationName: 'Example App',
            organizationId: 'org-1',
            organizationName: 'Acme',
            inviteeEmail: 'u***@example.com',
            role: 'MEMBER',
            status: 'PENDING',
            expiresAt: '2026-07-07T00:00:00Z',
          }),
        }
      }
      if (url.endsWith('/api/v1/auth/organization-invitations/public-token/accept')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            status: 'LOGIN_REQUIRED',
            continuation: 'LOGIN_OR_REGISTER_THEN_RETRY_ACCEPT',
            applicationId: 'app-1',
            organizationId: 'org-1',
            organizationName: 'Acme',
            role: 'MEMBER',
            acceptedAt: null,
          }),
        }
      }
      const summary = { applicationId: 'app-1', organizationId: 'org-1', roles: [], permissions: [] }
      return { ok: true, json: async () => summary, text: async () => JSON.stringify(summary) }
    })
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('previews invitation without bearer and surfaces login-required continuation', async () => {
    const onLoginRequired = vi.fn()
    renderWithProvider(createElement(OrganizationInvitationAccept, {
      token: 'public-token',
      onLoginRequired,
    }))

    await waitFor(() => expect(screen.getByText('Join Acme')).toBeTruthy())
    const previewRequest = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/organization-invitations/public-token'))
    expect(previewRequest?.[1]?.headers).toEqual({})

    fireEvent.click(screen.getByText('Accept invitation'))

    await waitFor(() => expect(onLoginRequired).toHaveBeenCalledWith(expect.objectContaining({
      status: 'LOGIN_REQUIRED',
      continuation: 'LOGIN_OR_REGISTER_THEN_RETRY_ACCEPT',
    })))
    const acceptRequest = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/organization-invitations/public-token/accept'))
    expect(acceptRequest?.[1]?.headers).toEqual({})
  })
})
