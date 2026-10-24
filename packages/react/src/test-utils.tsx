import type { ReactNode } from 'react'
import type { IamProviderProps } from './provider/IamProvider'
import type { IamUser } from './core/types'

// Re-create context access for testing without going through IamProvider's fetch/discovery
// We render IamProvider with a mocked fetch so discovery resolves immediately.

const ISSUER = 'https://auth.test.com'

const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${header}.${body}.fake-sig`
}

export function makeTestUser(overrides: Partial<IamUser> = {}): IamUser {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['admin'],
    permissions: ['orders:read', 'orders:create', 'users:*'],
    orgId: 'org-1',
    orgSlug: 'acme',
    orgRole: 'ADMIN',
    workspaceId: 'ws-1',
    isImpersonating: false,
    status: 'ACTIVE', emailVerified: true, username: null, metadata: {},
    authenticationContext: { subjectType: 'USER', applicationId: 'app-test', clientId: 'test-app', sessionId: 's1', workspaceId: 'ws-1', workspaceSelectionRequired: false, organizationId: null, organizationSlug: null, organizationRole: null, authTime: null, authenticationMethods: [], assuranceLevel: null, impersonation: null },
    ...overrides,
  }
}

export function makeTestJwt(overrides: Record<string, unknown> = {}): string {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return makeJwt({
    sub: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['admin'],
    org_id: 'org-1',
    org_slug: 'acme',
    org_role: 'ADMIN',
    workspace_id: 'ws-1',
    exp,
    ...overrides,
  })
}

/** Default permissions for test user */
const defaultPermissions = ['orders:read', 'orders:create', 'users:*']

const mockPermissionsResponse = {
  applicationId: 'app-test',
  organizationId: null,
  roles: ['admin'],
  permissions: defaultPermissions,
}

/**
 * Setup mock fetch for IamProvider's OIDC discovery + current-user permissions endpoint.
 * Call this in beforeEach.
 */
export function setupMockFetch(permissions?: string[], user: IamUser = makeTestUser()): void {
  const permsResponse = permissions ? { ...mockPermissionsResponse, permissions } : mockPermissionsResponse
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith('/api/v1/auth/me')) {
      return { ok: true, json: async () => user }
    }
    if (url.includes('/api/v1/auth/me/permissions')) {
      return { ok: true, json: async () => permsResponse }
    }
    return { ok: true, json: async () => mockOidcConfig }
  }) as unknown as typeof fetch
}

/**
 * Store tokens for opt-in persistence tests. Required views are always loaded from fetch.
 * Provider props must include tokenStorage: 'sessionStorage' for IamProvider to restore it.
 */
export function storeTestTokens(jwt?: string, _permissions?: string[], _roles: string[] = ['admin']): void {
  const token = jwt ?? makeTestJwt()
  sessionStorage.setItem('axis_iam_session', JSON.stringify({
    version: 6,
    expiresAt: Date.now() + 3600_000,
    tokens: {
      access_token: token,
      refresh_token: 'rt-test',
      token_type: 'Bearer',
      expires_in: 3600,
    },
    owner: null,
    authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
    refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
  }))
}

/**
 * Get default IamProvider props for testing.
 */
export function testProviderProps(): IamProviderProps & { children?: ReactNode } {
  return {
    clientId: 'test-app',
    issuerUri: ISSUER,
    redirectUri: '/callback',
    tokenStorage: 'sessionStorage',
    children: null,
  }
}
