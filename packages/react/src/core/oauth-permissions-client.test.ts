import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOAuthPermissionSummary, normalizePermissionResponse } from './oauth-permissions-client'

const ISSUER = 'https://auth.example.com'

describe('oauth permissions client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches resolved permissions with the current bearer token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ applicationId: 'app-1', organizationId: null, roles: ['admin'], permissions: ['orders:read'] }),
    })

    const summary = await fetchOAuthPermissionSummary({
      issuer: ISSUER,
      accessToken: 'access-token',
    })

    expect(summary).toEqual({ applicationId: 'app-1', organizationId: null, roles: ['admin'], permissions: ['orders:read'] })
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/api/v1/auth/me/permissions`, expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer access-token' },
    }))
  })

  it('rejects malformed canonical responses', () => {
    expect(() => normalizePermissionResponse({} as never)).toThrow('IAM permissions response was malformed')
    expect(() => normalizePermissionResponse({ applicationId: 123, organizationId: null, roles: ['admin'], permissions: [] } as never)).toThrow('IAM permissions response was malformed')
    expect(() => normalizePermissionResponse({ applicationId: 'app-1', organizationId: 123, roles: ['admin'], permissions: [] } as never)).toThrow('IAM permissions response was malformed')
    expect(() => normalizePermissionResponse({ applicationId: 'app-1', organizationId: null, roles: 'admin', permissions: [] } as never)).toThrow('IAM permissions response was malformed')
    expect(() => normalizePermissionResponse({ applicationId: 'app-1', organizationId: null, roles: ['admin'], permissions: ['orders:read', 7] } as never)).toThrow('IAM permissions response was malformed')
  })
})
