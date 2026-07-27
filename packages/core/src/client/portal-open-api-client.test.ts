import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PORTAL_OPEN_API_READ_SCOPE,
  PORTAL_OPEN_API_WRITE_SCOPE,
  ORGANIZATIONS_READ_SCOPE,
  ORGANIZATIONS_WRITE_SCOPE,
  ORGANIZATION_INVITATIONS_READ_SCOPE,
  ORGANIZATION_INVITATIONS_WRITE_SCOPE,
  ORGANIZATION_MEMBERS_READ_SCOPE,
  ORGANIZATION_MEMBERS_WRITE_SCOPE,
  REGISTRATION_GRANTS_READ_SCOPE,
  REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE,
  REGISTRATION_GRANTS_WRITE_SCOPE,
  PortalOpenApiClient,
  PortalOpenApiError,
} from '../server.js'

describe('PortalOpenApiClient', () => {
  const config = {
    issuer: 'https://auth.example.com/',
    portalEndpoint: 'https://portal.example.com/',
    clientId: 'm2m-client',
    clientSecret: 'm2m-secret',
    tokenSkewSeconds: 0,
  }

  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requires confidential M2M credentials and explicit supported scope', async () => {
    expect(() => new PortalOpenApiClient({ ...config, clientSecret: '' })).toThrow(/M2M clientId and clientSecret/)
    expect(() => new PortalOpenApiClient({ ...config, timeoutMs: 0 })).toThrow(/timeoutMs must be positive/)
    expect(() => new PortalOpenApiClient({ ...config, tokenSkewSeconds: -1 })).toThrow(/tokenSkewSeconds must be non-negative/)

    const client = new PortalOpenApiClient(config)
    await expect(client.getMachineToken('' as typeof PORTAL_OPEN_API_READ_SCOPE)).rejects.toMatchObject({
      name: 'PortalOpenApiTokenError',
      code: 'invalid_scope',
    })
    await expect(client.getMachineToken('openid' as typeof PORTAL_OPEN_API_READ_SCOPE)).rejects.toMatchObject({
      name: 'PortalOpenApiTokenError',
      code: 'invalid_scope',
    })
  })

  it('is available from the server subpath and absent from the root entry', async () => {
    const server = await import('../server.js')
    const root = await import('../index.js') as Record<string, unknown>
    const react = await import('../../../react/src/index.ts') as Record<string, unknown>

    expect(server.PortalOpenApiClient).toBe(PortalOpenApiClient)
    expect(server.IamClient).toBeDefined()
    expect(root.PortalOpenApiClient).toBeUndefined()
    expect(root.IamClient).toBeUndefined()
    expect(react.PortalOpenApiClient).toBeUndefined()
    for (const publicEntry of [root, react]) {
      expect(publicEntry.REGISTRATION_GRANTS_READ_SCOPE).toBeUndefined()
      expect(publicEntry.REGISTRATION_GRANTS_WRITE_SCOPE).toBeUndefined()
      expect(publicEntry.REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE).toBeUndefined()
      expect(publicEntry.ORGANIZATIONS_READ_SCOPE).toBeUndefined()
      expect(publicEntry.ORGANIZATION_INVITATIONS_READ_SCOPE).toBeUndefined()
      expect(publicEntry.ORGANIZATION_MEMBERS_READ_SCOPE).toBeUndefined()
      expect(publicEntry.createRegistrationGrant).toBeUndefined()
      expect(publicEntry.listRegistrationGrants).toBeUndefined()
      expect(publicEntry.createOrganization).toBeUndefined()
      expect(publicEntry.listOrganizations).toBeUndefined()
      expect(publicEntry.ROLES_READ_SCOPE).toBeUndefined()
      expect(publicEntry.PERMISSIONS_WRITE_SCOPE).toBeUndefined()
      expect(publicEntry.ROLE_PERMISSIONS_WRITE_SCOPE).toBeUndefined()
      expect(publicEntry.USER_ROLES_WRITE_SCOPE).toBeUndefined()
      expect(publicEntry.createRole).toBeUndefined()
      expect(publicEntry.createPermission).toBeUndefined()
      expect(publicEntry.replaceRolePermissions).toBeUndefined()
      expect(publicEntry.createUserRole).toBeUndefined()
    }
  })

  it('requests a read machine token for GET and sends only bearer auth to Portal', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://auth.example.com/oauth2/token') {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic bTJtLWNsaWVudDptMm0tc2VjcmV0',
        })
        expect(init?.body).toBe('grant_type=client_credentials&scope=portal%3Aopenapi%3Aread')
        return jsonResponse({
          access_token: 'read-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: PORTAL_OPEN_API_READ_SCOPE,
        })
      }

      expect(url).toBe('https://portal.example.com/open/v1/roles')
      expect(init?.method).toBe('GET')
      expect(init?.headers).toEqual({ Authorization: 'Bearer read-token' })
      return jsonResponse([{ id: 'role-1', key: 'admin' }])
    })
    globalThis.fetch = fetchMock

    const client = new PortalOpenApiClient(config)
    const roles = await client.requestJson<Array<{ id: string; key: string }>>('GET', '/open/v1/roles')

    expect(roles).toEqual([{ id: 'role-1', key: 'admin' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requests a write machine token for POST and never reuses a read token for write', async () => {
    const tokenScopes: string[] = []
    const portalAuthHeaders: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://auth.example.com/oauth2/token') {
        const body = new URLSearchParams(init?.body as string)
        const scope = body.get('scope')
        tokenScopes.push(scope ?? '')
        return jsonResponse({
          access_token: scope === PORTAL_OPEN_API_READ_SCOPE ? 'read-token' : 'write-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope,
        })
      }

      const headers = init?.headers as Record<string, string>
      portalAuthHeaders.push(headers.Authorization)
      expect(headers.Authorization?.startsWith('Basic ')).toBe(false)
      expect(headers['X-IAM-Client-Id']).toBeUndefined()
      expect(headers['X-Application-Id']).toBeUndefined()
      expect(headers['X-App-Key']).toBeUndefined()
      return jsonResponse({ ok: true })
    })
    globalThis.fetch = fetchMock

    const client = new PortalOpenApiClient(config)
    await client.requestJson('GET', '/open/v1/roles')
    await client.requestJson('GET', '/open/v1/roles')
    await client.requestJson('POST', '/open/v1/roles', { key: 'admin' })
    await client.requestJson('POST', '/open/v1/roles', { key: 'editor' })

    expect(tokenScopes).toEqual([PORTAL_OPEN_API_READ_SCOPE, PORTAL_OPEN_API_WRITE_SCOPE])
    expect(portalAuthHeaders).toEqual([
      'Bearer read-token',
      'Bearer read-token',
      'Bearer write-token',
      'Bearer write-token',
    ])
  })

  it('refreshes tokens when expires_in minus skew is stale', async () => {
    const tokenScopes: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://auth.example.com/oauth2/token') {
        const body = new URLSearchParams(init?.body as string)
        const scope = body.get('scope') ?? ''
        tokenScopes.push(scope)
        return jsonResponse({
          access_token: `read-token-${tokenScopes.length}`,
          token_type: 'Bearer',
          expires_in: 1,
          scope,
        })
      }
      return jsonResponse({ ok: true })
    })

    const client = new PortalOpenApiClient({ ...config, tokenSkewSeconds: 2 })
    await client.requestJson('GET', '/open/v1/roles')
    await client.requestJson('GET', '/open/v1/roles')

    expect(tokenScopes).toEqual([PORTAL_OPEN_API_READ_SCOPE, PORTAL_OPEN_API_READ_SCOPE])
  })

  it('normalizes token endpoint invalid_scope invalid_client and missing bearer responses', async () => {
    const client = new PortalOpenApiClient(config)

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      error: 'invalid_scope',
      error_description: 'scope is required',
    }, 400))
    await expect(client.getMachineToken(PORTAL_OPEN_API_READ_SCOPE)).rejects.toMatchObject({
      name: 'PortalOpenApiTokenError',
      status: 400,
      code: 'invalid_scope',
      message: 'scope is required',
    })

    client.clearTokenCache()
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      error: 'invalid_client',
      error_description: 'bad credentials',
    }, 401))
    await expect(client.getMachineToken(PORTAL_OPEN_API_READ_SCOPE)).rejects.toMatchObject({
      name: 'PortalOpenApiTokenError',
      status: 401,
      code: 'invalid_client',
      message: 'bad credentials',
    })

    client.clearTokenCache()
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: PORTAL_OPEN_API_READ_SCOPE,
    }))
    await expect(client.getMachineToken(PORTAL_OPEN_API_READ_SCOPE)).rejects.toMatchObject({
      name: 'PortalOpenApiTokenError',
      code: 'missing_bearer_token',
    })
  })

  it('normalizes Portal Open API machine-token errors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://auth.example.com/oauth2/token') {
        return jsonResponse({
          access_token: 'read-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: PORTAL_OPEN_API_READ_SCOPE,
        })
      }
      return jsonResponse({
        code: 'OPEN_API_SCOPE_INSUFFICIENT',
        message: 'Portal Open API token rejected',
      }, 403)
    })
    globalThis.fetch = fetchMock

    const client = new PortalOpenApiClient(config)
    await expect(client.requestJson('GET', '/open/v1/roles')).rejects.toMatchObject({
      name: 'PortalOpenApiError',
      status: 403,
      code: 'OPEN_API_SCOPE_INSUFFICIENT',
      message: 'OPEN_API_SCOPE_INSUFFICIENT',
    })
  })

  it('rejects non-Portal Open API paths before sending a request', async () => {
    const client = new PortalOpenApiClient(config)
    globalThis.fetch = vi.fn()

    await expect(client.requestJson('GET', '/api/v1/users')).rejects.toBeInstanceOf(PortalOpenApiError)
    await expect(client.requestJson('HEAD' as never, '/open/v1/roles')).rejects.toMatchObject({
      name: 'PortalOpenApiError',
      code: 'invalid_portal_method',
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uses exact registration-grant scopes and rejects malformed one-time proof responses', async () => {
    const scopes: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        const scope = new URLSearchParams(init?.body as string).get('scope') ?? ''
        scopes.push(scope)
        return jsonResponse({ access_token: scope, token_type: 'Bearer', expires_in: 3600, scope })
      }
      if (url.includes('/redemptions')) return jsonResponse({ content: [], page: { size: 20, number: 0, totalElements: 0, totalPages: 0 } })
      if (init?.method === 'POST') return jsonResponse({ grant: { type: 'EMAIL_LINK' }, registrationGrantToken: 'one', registrationAccessCode: 'two' })
      return jsonResponse({ content: [], page: { size: 20, number: 0, totalElements: 0, totalPages: 0 } })
    })
    const client = new PortalOpenApiClient(config)
    await client.listRegistrationGrants({ search: 'a b', page: 1, size: 10 })
    await expect(client.createRegistrationGrant({ type: 'EMAIL_LINK' })).rejects.toMatchObject({ code: 'invalid_registration_grant_response' })
    await client.listRegistrationGrantRedemptions('123e4567-e89b-12d3-a456-426614174000')
    expect(scopes).toEqual([REGISTRATION_GRANTS_READ_SCOPE, REGISTRATION_GRANTS_WRITE_SCOPE, REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE])
  })

  it('encodes list filters, parses ORG_INVITATION reads, and uses the read scope', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        expect(new URLSearchParams(init?.body as string).get('scope')).toBe(REGISTRATION_GRANTS_READ_SCOPE)
        return tokenResponse(REGISTRATION_GRANTS_READ_SCOPE)
      }
      expect(url).toBe('https://portal.example.com/open/v1/registration-grants?type=ORG_INVITATION&status=ACTIVE&search=a%2Bb+%26+c&page=2&size=25')
      expect(init?.method).toBe('GET')
      return jsonResponse({ content: [grant('ORG_INVITATION')], page: page() })
    })

    const result = await new PortalOpenApiClient(config).listRegistrationGrants({
      type: 'ORG_INVITATION', status: 'ACTIVE', search: 'a+b & c', page: 2, size: 25,
    })

    expect(result.content[0]?.type).toBe('ORG_INVITATION')
  })

  it.each([
    ['EMAIL_LINK', 'registrationGrantToken', 'registrationAccessCode'],
    ['ACCESS_CODE', 'registrationAccessCode', 'registrationGrantToken'],
  ] as const)('accepts %s create response when the other proof is null', async (type, proofField, absentProofField) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/oauth2/token')) {
        expect(new URLSearchParams(init?.body as string).get('scope')).toBe(REGISTRATION_GRANTS_WRITE_SCOPE)
        return tokenResponse(REGISTRATION_GRANTS_WRITE_SCOPE)
      }
      expect(init?.method).toBe('POST')
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(init?.body).toBe(JSON.stringify({ type }))
      return jsonResponse({ grant: grant(type), [proofField]: 'fake-one-time-proof', [absentProofField]: null }, 201)
    })

    const created = await new PortalOpenApiClient(config).createRegistrationGrant({ type })

    expect(created.grant.type).toBe(type)
    expect(created[proofField]).toBe('fake-one-time-proof')
    expect(created[absentProofField]).toBeUndefined()
  })

  it.each([
    ['zero proof', 'EMAIL_LINK', { registrationGrantToken: null, registrationAccessCode: null }],
    ['double proof', 'EMAIL_LINK', { registrationGrantToken: 'fake-token', registrationAccessCode: 'fake-code' }],
    ['blank proof', 'EMAIL_LINK', { registrationGrantToken: '', registrationAccessCode: null }],
    ['type mismatch', 'EMAIL_LINK', { registrationGrantToken: null, registrationAccessCode: 'fake-code' }],
    ['unsupported read type', 'ORG_INVITATION', { registrationGrantToken: 'fake-token', registrationAccessCode: null }],
  ] as const)('fails closed for %s create response without leaking the proof', async (_name, grantType, proofs) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/oauth2/token')
      ? tokenResponse(REGISTRATION_GRANTS_WRITE_SCOPE)
      : jsonResponse({ grant: grant(grantType), ...proofs }, 201))

    await expect(new PortalOpenApiClient(config).createRegistrationGrant({ type: 'EMAIL_LINK' })).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({ code: 'invalid_registration_grant_response' })
      expect(String(error)).not.toContain('fake-token')
      expect(String(error)).not.toContain('fake-code')
      return true
    })
  })

  it('uses exact paths, methods, bodies, and scopes for detail and lifecycle helpers', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        const scope = new URLSearchParams(init?.body as string).get('scope') ?? ''
        return tokenResponse(scope)
      }
      requests.push({ url, init })
      if (url.includes('/redemptions')) return jsonResponse({ content: [], page: page() })
      return jsonResponse(grant('ORG_INVITATION'))
    })
    const client = new PortalOpenApiClient(config)
    const id = '019f4cca-88f8-7e77-a67d-4a6a2a68b803'

    expect((await client.getRegistrationGrant(id)).type).toBe('ORG_INVITATION')
    await client.pauseRegistrationGrant(id)
    await client.resumeRegistrationGrant(id)
    await client.revokeRegistrationGrant(id)
    await client.revokeRegistrationGrant(id, 'expired request')
    await client.listRegistrationGrantRedemptions(id, { page: 1, size: 10 })

    expect(requests.map(({ url, init }) => [new URL(url).pathname + new URL(url).search, init?.method, init?.body])).toEqual([
      [`/open/v1/registration-grants/${id}`, 'GET', undefined],
      [`/open/v1/registration-grants/${id}/pause`, 'POST', undefined],
      [`/open/v1/registration-grants/${id}/resume`, 'POST', undefined],
      [`/open/v1/registration-grants/${id}/revoke`, 'POST', undefined],
      [`/open/v1/registration-grants/${id}/revoke`, 'POST', JSON.stringify({ reason: 'expired request' })],
      [`/open/v1/registration-grants/${id}/redemptions?page=1&size=10`, 'GET', undefined],
    ])
  })

  it('accepts canonical UUIDv7 and rejects malformed IDs locally', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/oauth2/token')
      ? tokenResponse(REGISTRATION_GRANTS_READ_SCOPE)
      : jsonResponse(grant('EMAIL_LINK')))
    globalThis.fetch = fetchMock
    const client = new PortalOpenApiClient(config)

    await expect(client.getRegistrationGrant('019f4cca-88f8-7e77-a67d-4a6a2a68b803')).resolves.toMatchObject({ type: 'EMAIL_LINK' })
    await expect(client.getRegistrationGrant('019f4cca88f87e77a67d4a6a2a68b803')).rejects.toMatchObject({ code: 'invalid_registration_grant_id' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([403, 404, 409])('propagates backend HTTP %i registration-grant errors', async (status) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/oauth2/token')
      ? tokenResponse(REGISTRATION_GRANTS_READ_SCOPE)
      : jsonResponse({ error: 'CONTRACT_ERROR', message: 'safe error' }, status))

    await expect(new PortalOpenApiClient(config).getRegistrationGrant('019f4cca-88f8-7e77-a67d-4a6a2a68b803')).rejects.toMatchObject({ status, code: 'CONTRACT_ERROR' })
  })

  it('keeps all three exact registration-grant scope cache entries isolated', async () => {
    const scopes: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes('/oauth2/token')) throw new Error('unexpected resource request')
      const scope = new URLSearchParams(init?.body as string).get('scope') ?? ''
      scopes.push(scope)
      return tokenResponse(scope)
    })
    const client = new PortalOpenApiClient(config)

    await client.getMachineToken(REGISTRATION_GRANTS_READ_SCOPE)
    await client.getMachineToken(REGISTRATION_GRANTS_WRITE_SCOPE)
    await client.getMachineToken(REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE)
    await client.getMachineToken(REGISTRATION_GRANTS_READ_SCOPE)
    await client.getMachineToken(REGISTRATION_GRANTS_WRITE_SCOPE)
    await client.getMachineToken(REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE)

    expect(scopes).toEqual([
      REGISTRATION_GRANTS_READ_SCOPE,
      REGISTRATION_GRANTS_WRITE_SCOPE,
      REGISTRATION_GRANTS_REDEMPTIONS_READ_SCOPE,
    ])
  })

  it('uses exact organization scopes, query parameters, ETags, and idempotency headers', async () => {
    const scopes: string[] = []
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const invitationId = '223e4567-e89b-42d3-a456-426614174000'
    const membershipId = '323e4567-e89b-42d3-a456-426614174000'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/oauth2/token')) {
        const scope = new URLSearchParams(init?.body as string).get('scope') ?? ''
        scopes.push(scope)
        return tokenResponse(scope)
      }
      requests.push({ url, init })
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      const path = new URL(url).pathname
      if (path.endsWith('/invitations')) {
        if (init?.method === 'GET') return jsonResponse({ content: [invitation(invitationId)], page: page() })
        return jsonResponse(invitation(invitationId), 201)
      }
      if (path.includes('/invitations/')) return jsonResponse(invitation(invitationId))
      if (path.endsWith('/members') && init?.method === 'GET') return jsonResponse({ content: [member(membershipId)], page: page() })
      if (path.includes('/members/')) return jsonResponse(member(membershipId))
      if (path === '/open/v1/organizations' && init?.method === 'GET') return jsonResponse({ content: [organization(id)], page: page() })
      return jsonResponse(organization(id), 200, { ETag: '"7"' })
    })

    const client = new PortalOpenApiClient(config)
    await client.listOrganizations({ search: 'acme & co', page: 1, size: 10, sort: ['name', 'createdAt'], direction: ['ASC', 'DESC'] })
    expect((await client.createOrganization({ name: 'Acme', slug: 'acme' }, { idempotencyKey: 'org-create-1' })).etag).toBe('"7"')
    await client.getOrganization(id)
    await client.updateOrganization(id, { name: 'Acme Inc.' }, { ifMatch: '"7"' })
    await client.deleteOrganization(id, { ifMatch: '"8"' })
    await client.listOrganizationInvitations(id, { status: 'PENDING', page: 1, size: 10 })
    const createdInvitation = await client.createOrganizationInvitation(id, { email: 'member@example.test', role: 'ADMIN', sendEmail: false }, { idempotencyKey: 'invite-create-1' })
    expect(createdInvitation).not.toHaveProperty('invitationToken')
    await client.getOrganizationInvitation(id, invitationId)
    await client.resendOrganizationInvitation(id, invitationId)
    await client.cancelOrganizationInvitation(id, invitationId)
    await client.listOrganizationMembers(id, { search: 'member', page: 1, size: 10 })
    await client.getOrganizationMember(id, membershipId)
    await client.updateOrganizationMemberRole(id, membershipId, 'ADMIN', { ifMatch: '"2"' })
    await client.removeOrganizationMember(id, membershipId)

    expect(scopes).toEqual([
      ORGANIZATIONS_READ_SCOPE,
      ORGANIZATIONS_WRITE_SCOPE,
      ORGANIZATION_INVITATIONS_READ_SCOPE,
      ORGANIZATION_INVITATIONS_WRITE_SCOPE,
      ORGANIZATION_MEMBERS_READ_SCOPE,
      ORGANIZATION_MEMBERS_WRITE_SCOPE,
    ])
    expect(requests.map(({ url, init }) => [new URL(url).pathname + new URL(url).search, init?.method])).toEqual([
      ['/open/v1/organizations?search=acme+%26+co&page=1&size=10&sort=name&sort=createdAt&direction=ASC&direction=DESC', 'GET'],
      ['/open/v1/organizations', 'POST'],
      [`/open/v1/organizations/${id}`, 'GET'],
      [`/open/v1/organizations/${id}`, 'PATCH'],
      [`/open/v1/organizations/${id}`, 'DELETE'],
      [`/open/v1/organizations/${id}/invitations?status=PENDING&page=1&size=10`, 'GET'],
      [`/open/v1/organizations/${id}/invitations`, 'POST'],
      [`/open/v1/organizations/${id}/invitations/${invitationId}`, 'GET'],
      [`/open/v1/organizations/${id}/invitations/${invitationId}/resend`, 'POST'],
      [`/open/v1/organizations/${id}/invitations/${invitationId}`, 'DELETE'],
      [`/open/v1/organizations/${id}/members?search=member&page=1&size=10`, 'GET'],
      [`/open/v1/organizations/${id}/members/${membershipId}`, 'GET'],
      [`/open/v1/organizations/${id}/members/${membershipId}`, 'PATCH'],
      [`/open/v1/organizations/${id}/members/${membershipId}`, 'DELETE'],
    ])
    expect(requests[1]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'org-create-1' })
    expect(requests[3]?.init?.headers).toMatchObject({ 'If-Match': '"7"' })
    expect(requests[4]?.init?.headers).toMatchObject({ 'If-Match': '"8"' })
    expect(requests[6]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'invite-create-1' })
    expect(requests[12]?.init?.headers).toMatchObject({ 'If-Match': '"2"' })
  })

  it('preserves invitation retry and terminal/member conflict semantics', async () => {
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const invitationId = '223e4567-e89b-42d3-a456-426614174000'
    const membershipId = '323e4567-e89b-42d3-a456-426614174000'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/oauth2/token')) return tokenResponse(ORGANIZATION_INVITATIONS_WRITE_SCOPE)
      return jsonResponse({ error: 'CONFLICT', message: 'terminal invitation' }, 409, { 'Retry-After': '30' })
    })
    const client = new PortalOpenApiClient(config)
    await expect(client.resendOrganizationInvitation(id, invitationId)).rejects.toMatchObject({ status: 409, code: 'CONFLICT', retryAfter: '30' })

    client.clearTokenCache()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/oauth2/token')) return tokenResponse(ORGANIZATION_MEMBERS_WRITE_SCOPE)
      return jsonResponse({ error: 'BAD_REQUEST', message: 'Cannot remove the last OWNER' }, 400)
    })
    await expect(client.removeOrganizationMember(id, membershipId)).rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' })
  })
})

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function tokenResponse(scope: string): Response {
  return jsonResponse({ access_token: `${scope}-token`, token_type: 'Bearer', expires_in: 3600, scope })
}

function page(): { size: number; number: number; totalElements: number; totalPages: number } {
  return { size: 20, number: 0, totalElements: 0, totalPages: 0 }
}

function grant(type: 'EMAIL_LINK' | 'ACCESS_CODE' | 'ORG_INVITATION'): Record<string, unknown> {
  return {
    id: '019f4cca-88f8-7e77-a67d-4a6a2a68b803', type, status: 'ACTIVE', displayName: null,
    allowedEmail: null, allowedDomain: null, expiresAt: null, maxUses: null, usedCount: 0,
    sourceType: 'API', createdAt: '2026-07-11T00:00:00Z', updatedAt: '2026-07-11T00:00:00Z',
    revokedAt: null, revokeReason: null,
  }
}

function organization(id: string): Record<string, unknown> {
  return { id, name: 'Acme', slug: 'acme', version: 7, createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z' }
}

function invitation(id: string): Record<string, unknown> {
  return { id, email: 'member@example.test', role: 'ADMIN', status: 'PENDING', deliveryStatus: 'SENT', expiresAt: '2026-07-19T00:00:00Z', createdAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z', invitationToken: 'must-not-leak' }
}

function member(membershipId: string): Record<string, unknown> {
  return { membershipId, userId: '423e4567-e89b-42d3-a456-426614174000', email: 'member@example.test', displayName: 'Member', role: 'ADMIN', joinedAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z', version: 2 }
}
