/**
 * Mock IAM server fetch handler for testing without MSW.
 * Intercepts permission-management endpoints and, when configured, Portal Open
 * API M2M token/role requests.
 *
 * @example
 * ```ts
 * const handler = createMockIamFetch({
 *   endpoint: 'https://auth.test.com',
 *   rolesToPerms: { admin: ['posts:read', 'posts:write'] },
 * })
 * globalThis.fetch = handler
 * ```
 */
export interface MockIamServerConfig {
  endpoint: string
  rolesToPerms: Record<string, string[]>
  rolePermissions?: Array<{ key: string; name: string; permissions: string[] }>
  portalEndpoint?: string
  portalRoles?: Array<Record<string, unknown>>
  portalReadToken?: string
  portalWriteToken?: string
}

export function createMockIamFetch(config: MockIamServerConfig) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method?.toUpperCase() ?? 'GET'

    // POST /oauth2/token for Portal Open API client_credentials.
    if (method === 'POST' && url === `${config.endpoint.replace(/\/$/, '')}/oauth2/token`) {
      const body = new URLSearchParams(init?.body as string)
      const scope = body.get('scope')
      if (body.get('grant_type') !== 'client_credentials' || !scope) {
        return new Response(JSON.stringify({ error: 'invalid_scope' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (scope !== 'portal:openapi:read' && scope !== 'portal:openapi:write') {
        return new Response(JSON.stringify({ error: 'invalid_scope' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          access_token: scope === 'portal:openapi:write'
            ? config.portalWriteToken ?? 'mock-portal-write-token'
            : config.portalReadToken ?? 'mock-portal-read-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // GET /open/v1/roles on iam-portal with a machine bearer token.
    if (
      config.portalEndpoint
      && method === 'GET'
      && url === `${config.portalEndpoint.replace(/\/$/, '')}/open/v1/roles`
    ) {
      const authorization = readHeader(init?.headers, 'Authorization')
      if (authorization !== `Bearer ${config.portalReadToken ?? 'mock-portal-read-token'}`
        && authorization !== `Bearer ${config.portalWriteToken ?? 'mock-portal-write-token'}`) {
        return new Response(JSON.stringify({ code: 'OPEN_API_MACHINE_TOKEN_REQUIRED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(config.portalRoles ?? []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /open/v1/permissions:resolve
    if (method === 'POST' && url.includes('/open/v1/permissions:resolve')) {
      const body = JSON.parse(init?.body as string) as { roles: string[] }
      const permissions = body.roles.flatMap((r) => config.rolesToPerms[r] ?? [])
      return new Response(JSON.stringify({ permissions }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // GET /open/v1/apps/{clientId}/permissions
    if (method === 'GET' && /\/open\/v1\/apps\/[^/]+\/permissions$/.test(new URL(url).pathname)) {
      return new Response(
        JSON.stringify({
          applicationId: 'mock-app-id',
          clientId: 'mock-client-id',
          roles: config.rolePermissions ?? [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // JWKS endpoint
    if (url.includes('/oauth2/jwks')) {
      return new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) {
    return null
  }
  if (headers instanceof Headers) {
    return headers.get(name)
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return match?.[1] ?? null
  }
  return headers[name] ?? headers[name.toLowerCase()] ?? null
}
