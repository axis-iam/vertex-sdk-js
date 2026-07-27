import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PortalOpenApiClient, ROLES_READ_SCOPE, ROLES_WRITE_SCOPE, PERMISSIONS_READ_SCOPE,
  PERMISSIONS_WRITE_SCOPE, ROLE_PERMISSIONS_READ_SCOPE, ROLE_PERMISSIONS_WRITE_SCOPE,
  USER_ROLES_READ_SCOPE, USER_ROLES_WRITE_SCOPE,
} from '../server.js'

const roleId = '123e4567-e89b-42d3-a456-426614174000'
const permissionId = '223e4567-e89b-42d3-a456-426614174000'
const userId = '323e4567-e89b-42d3-a456-426614174000'
const assignmentId = '423e4567-e89b-42d3-a456-426614174000'
const timestamp = '2026-07-15T00:00:00Z'
const page = { size: 20, number: 0, totalElements: 1, totalPages: 1 }
const role = { id: roleId, key: 'admin', name: 'Admin', description: null, system: false, version: 1, createdAt: timestamp, updatedAt: timestamp }
const permission = { id: permissionId, resource: 'orders', action: 'read', key: 'orders:read', name: 'Read orders', description: null, source: 'MANUAL', version: 1, createdAt: timestamp, updatedAt: timestamp }
const assignment = { id: assignmentId, userId, roleId, organizationId: null, conditionExpression: null, conditionDescription: null, version: 1, createdAt: timestamp, updatedAt: timestamp }

describe('authorization management helpers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses all eight exact scopes, methods, paths, and concurrency headers', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init })
      if (url.endsWith('/oauth2/token')) {
        const scope = new URLSearchParams(String(init?.body)).get('scope')!
        return json({ access_token: `${scope}-token`, token_type: 'Bearer', expires_in: 3600, scope })
      }
      const path = new URL(url).pathname; const method = init?.method
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (path.endsWith('/permissions') && path.includes(`/roles/${roleId}`)) {
        return method === 'GET' ? json({ content: [{ roleId, permissionId, createdAt: timestamp }], page }, 200, { ETag: '"1"' }) : json({ roleId, permissionIds: [permissionId], version: 2 }, 200, { ETag: '"2"' })
      }
      if (path.includes(`/users/${userId}/roles`)) return path.endsWith('/roles') && method === 'GET' ? json({ content: [assignment], page }) : json(assignment, method === 'POST' ? 201 : 200, { ETag: '"1"' })
      if (path.startsWith('/open/v1/permissions')) return path === '/open/v1/permissions' && method === 'GET' ? json({ content: [permission], page }) : json(permission, method === 'POST' ? 201 : 200, { ETag: '"1"' })
      return path === '/open/v1/roles' && method === 'GET' ? json({ content: [role], page }) : json(role, method === 'POST' ? 201 : 200, { ETag: '"1"' })
    })
    const client = new PortalOpenApiClient({ issuer: 'https://auth.test', portalEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret', tokenSkewSeconds: 0 })
    await client.listRoles(); await client.getRole(roleId); await client.createRole({ key: 'admin', name: 'Admin' }, { idempotencyKey: 'role-key' }); await client.updateRole(roleId, { name: 'Admin 2' }, '"1"'); await client.deleteRole(roleId, '"2"')
    await client.listPermissions(); await client.getPermission(permissionId); await client.createPermission({ resource: 'orders', action: 'read', name: 'Read' }, { idempotencyKey: 'permission-key' }); await client.updatePermission(permissionId, { name: 'Read 2' }, '"1"'); await client.deletePermission(permissionId, '"2"')
    await client.listRolePermissions(roleId); await client.replaceRolePermissions(roleId, [permissionId], '"1"')
    await client.listUserRoles(userId); await client.createUserRole(userId, { roleId, condition: null }, { idempotencyKey: 'assignment-key' }); await client.updateUserRole(userId, assignmentId, { condition: { expression: "department == 'sales'", description: null } }, '"1"'); await client.deleteUserRole(userId, assignmentId, '"2"')
    const tokenScopes = calls.filter((call) => call.url.endsWith('/oauth2/token')).map((call) => new URLSearchParams(String(call.init?.body)).get('scope'))
    expect(new Set(tokenScopes)).toEqual(new Set([ROLES_READ_SCOPE, ROLES_WRITE_SCOPE, PERMISSIONS_READ_SCOPE, PERMISSIONS_WRITE_SCOPE, ROLE_PERMISSIONS_READ_SCOPE, ROLE_PERMISSIONS_WRITE_SCOPE, USER_ROLES_READ_SCOPE, USER_ROLES_WRITE_SCOPE]))
    expect(calls.some((call) => (call.init?.headers as Record<string,string>)?.['Idempotency-Key'] === 'role-key')).toBe(true)
    expect(calls.filter((call) => ['PATCH','PUT','DELETE'].includes(call.init?.method ?? '')).every((call) => (call.init?.headers as Record<string,string>)?.['If-Match']?.startsWith('"'))).toBe(true)
  })

  it('rejects invalid grants, page bounds, ETags, and malformed pages', async () => {
    const client = new PortalOpenApiClient({ issuer: 'https://auth.test', portalEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    await expect(client.createPermission({ resource: '*', action: 'read', name: 'bad' })).rejects.toMatchObject({ code: 'invalid_permission_key' })
    await expect(client.listRoles({ size: 101 })).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    await expect(client.updateRole(roleId, { name: 'x' }, 'W/"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/oauth2/token') ? json({ access_token: 't', token_type: 'Bearer', expires_in: 3600, scope: new URLSearchParams(String(init?.body)).get('scope') }) : json({ content: [] }))
    await expect(client.listRoles()).rejects.toMatchObject({ code: 'invalid_authorization_response' })
  })

  it('binds object responses to the requested path identity', async () => {
    let responseBody: unknown = role
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/oauth2/token')
      ? json({ access_token: 't', token_type: 'Bearer', expires_in: 3600, scope: new URLSearchParams(String(init?.body)).get('scope') })
      : json(responseBody, 200, { ETag: '"1"' }))
    const client = new PortalOpenApiClient({ issuer: 'https://auth.test', portalEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    const wrongId = '523e4567-e89b-42d3-a456-426614174000'
    responseBody = { ...role, id: wrongId }
    await expect(client.getRole(roleId)).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    await expect(client.updateRole(roleId, { name: 'x' }, '"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { ...permission, id: wrongId }
    await expect(client.getPermission(permissionId)).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    await expect(client.updatePermission(permissionId, { name: 'x' }, '"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { roleId: wrongId, permissionIds: [permissionId], version: 0 }
    await expect(client.replaceRolePermissions(roleId, [permissionId], '"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { ...assignment, userId: wrongId }
    await expect(client.createUserRole(userId, { roleId })).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { ...assignment, roleId: wrongId }
    await expect(client.createUserRole(userId, { roleId })).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { ...assignment, userId: wrongId }
    await expect(client.updateUserRole(userId, assignmentId, { condition: null }, '"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { ...assignment, id: wrongId }
    await expect(client.updateUserRole(userId, assignmentId, { condition: null }, '"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { roleId, permissionIds: [permissionId] }
    await expect(client.replaceRolePermissions(roleId, [permissionId], '"1"')).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { id: assignmentId, userId, roleId, organizationId: null, conditionExpression: null, conditionDescription: null, createdAt: timestamp, updatedAt: timestamp }
    await expect(client.createUserRole(userId, { roleId })).rejects.toMatchObject({ code: 'invalid_authorization_response' })
    responseBody = { ...role, version: 0, system: false }
    await expect(client.getRole(roleId)).resolves.toMatchObject({ id: roleId, system: false, version: 0 })
    responseBody = { ...permission, version: 0 }
    await expect(client.getPermission(permissionId)).resolves.toMatchObject({ id: permissionId, version: 0 })
    responseBody = { roleId, permissionIds: [permissionId], version: 0 }
    await expect(client.replaceRolePermissions(roleId, [permissionId], '"0"')).resolves.toMatchObject({ roleId, version: 0 })
    responseBody = { ...assignment, version: 0 }
    await expect(client.createUserRole(userId, { roleId })).resolves.toMatchObject({ id: assignmentId, version: 0 })
    await expect(client.updateUserRole(userId, assignmentId, { condition: null }, '"0"')).resolves.toMatchObject({ id: assignmentId, version: 0 })
    responseBody = { content: [], page: { size: 20, number: 0, totalElements: 0, totalPages: 0 } }
    await expect(client.listRoles()).resolves.toMatchObject({ content: [], page: { number: 0, totalElements: 0, totalPages: 0 } })
  })

  it.each([
    ['role UUID', '/open/v1/roles?page=0&size=20', { content: [{ ...role, id: 'not-a-uuid' }], page }],
    ['role timestamp', '/open/v1/roles?page=0&size=20', { content: [{ ...role, createdAt: 'yesterday' }], page }],
    ['role calendar timestamp', '/open/v1/roles?page=0&size=20', { content: [{ ...role, createdAt: '2026-02-30T00:00:00Z' }], page }],
    ['page size', '/open/v1/roles?page=0&size=20', { content: [role], page: { ...page, size: 1000 } }],
    ['page content consistency', '/open/v1/roles?page=0&size=20', { content: [role], page: { ...page, size: 1, totalElements: 0, totalPages: 0 } }],
    ['page number bounds', '/open/v1/roles?page=0&size=20', { content: [role], page: { size: 1, number: 1, totalElements: 1, totalPages: 1 } }],
    ['underfilled page', '/open/v1/roles?page=0&size=20', { content: [role], page: { size: 2, number: 0, totalElements: 2, totalPages: 1 } }],
    ['missing page number', '/open/v1/roles?page=0&size=20', { content: [], page: { size: 20, totalElements: 0, totalPages: 0 } }],
    ['missing page totalElements', '/open/v1/roles?page=0&size=20', { content: [], page: { size: 20, number: 0, totalPages: 0 } }],
    ['missing page totalPages', '/open/v1/roles?page=0&size=20', { content: [], page: { size: 20, number: 0, totalElements: 0 } }],
    ['missing role system', '/open/v1/roles?page=0&size=20', { content: [{ ...role, system: undefined }], page }],
    ['missing role version', '/open/v1/roles?page=0&size=20', { content: [{ ...role, version: undefined }], page }],
    ['permission source', '/open/v1/permissions?page=0&size=20', { content: [{ ...permission, source: 'CUSTOM' }], page }],
    ['permission grant', '/open/v1/permissions?page=0&size=20', { content: [{ ...permission, resource: 'Orders', key: 'Orders:read' }], page }],
    ['missing permission version', '/open/v1/permissions?page=0&size=20', { content: [{ ...permission, version: undefined }], page }],
    ['binding relationship UUID', `/open/v1/roles/${roleId}/permissions?page=0&size=20`, { content: [{ roleId: 'not-a-uuid', permissionId, createdAt: timestamp }], page }],
    ['binding path relationship', `/open/v1/roles/${roleId}/permissions?page=0&size=20`, { content: [{ roleId: '523e4567-e89b-42d3-a456-426614174000', permissionId, createdAt: timestamp }], page }],
    ['binding timestamp', `/open/v1/roles/${roleId}/permissions?page=0&size=20`, { content: [{ roleId, permissionId, createdAt: 'invalid' }], page }],
    ['assignment reference UUID', `/open/v1/users/${userId}/roles?page=0&size=20`, { content: [{ ...assignment, roleId: 'not-a-uuid' }], page }],
    ['assignment path relationship', `/open/v1/users/${userId}/roles?page=0&size=20`, { content: [{ ...assignment, userId: '523e4567-e89b-42d3-a456-426614174000' }], page }],
    ['assignment timestamp', `/open/v1/users/${userId}/roles?page=0&size=20`, { content: [{ ...assignment, updatedAt: 'invalid' }], page }],
  ])('fails closed for malformed %s responses', async (_name, expectedPath, responseBody) => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/oauth2/token')) {
        const scope = new URLSearchParams(String(init?.body)).get('scope')!
        return json({ access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope })
      }
      expect(new URL(String(input)).pathname + new URL(String(input)).search).toBe(expectedPath)
      return json(responseBody, 200, expectedPath.includes(`roles/${roleId}/permissions`) ? { ETag: '"1"' } : {})
    })
    const client = new PortalOpenApiClient({ issuer: 'https://auth.test', portalEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    const call = expectedPath.includes(`/roles/${roleId}/permissions`)
      ? client.listRolePermissions(roleId)
      : expectedPath.startsWith(`/open/v1/users/${userId}`)
        ? client.listUserRoles(userId)
        : expectedPath.startsWith('/open/v1/permissions')
          ? client.listPermissions()
          : client.listRoles()
    await expect(call).rejects.toMatchObject({ code: 'invalid_authorization_response' })
  })
})

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }) }
