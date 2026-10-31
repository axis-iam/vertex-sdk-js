import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortalOpenApiClient, PortalOpenApiError } from '../server.js'

const config = { issuer: 'https://auth.example.test', portalEndpoint: 'https://portal.example.test', clientId: 'machine', clientSecret: 'fixture-only' }
const id = '019f4cca-88f8-7e77-a67d-4a6a2a68b803'
const deliveryId = '019f4cca-88f8-7e77-a67d-4a6a2a68b804'
const otherId = '019f4cca-88f8-7e77-a67d-4a6a2a68b805'
const originalFetch = globalThis.fetch
const grant = {
  id, version: 2, type: 'EMAIL_LINK', status: 'ACTIVE', displayName: null, allowedEmail: null,
  allowedDomain: null, expiresAt: null, maxUses: null, usedCount: 0, sourceType: 'API',
  createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z', revokedAt: null, revokeReason: null,
}
const created = {
  grant, secretAlreadyIssued: false, registrationGrantToken: 'fixture-proof',
  registrationInvitationUrl: 'https://auth.example.test/invitation?token=fixture-proof',
}
const delivery = {
  id: deliveryId, grantId: id, recipient: 'r@example.test', variant: 'LINK', status: 'QUEUED',
  failureCode: null, attemptCount: 0, maxAttempts: 3, nextAttemptAt: null, retryable: true,
  expiresAt: '2026-11-01T00:00:00Z', createdAt: '2026-10-30T00:00:00Z',
}

function mockResource(body: unknown, status = 200) {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/oauth2/token') {
      const scope = new URLSearchParams(init?.body as string).get('scope')
      return Response.json({ access_token: scope, token_type: 'Bearer', expires_in: 3600, scope })
    }
    calls.push({ path: url.pathname, init })
    return Response.json(body, { status })
  })
  return calls
}

afterEach(() => { globalThis.fetch = originalFetch })

describe('current registration management contract through public server entry', () => {
  it('requires caller keys and does not create implicit keys or send network calls for invalid inputs', async () => {
    globalThis.fetch = vi.fn()
    const c = new PortalOpenApiClient(config)
    for (const key of [undefined, '', ' ', 'x\nbad', 'x'.repeat(201)]) {
      await expect(c.createRegistrationGrant({ type: 'EMAIL_LINK' }, key as string)).rejects.toMatchObject({ code: 'invalid_idempotency_key' })
      await expect(c.rotateRegistrationGrant(id, 2, key as string)).rejects.toMatchObject({ code: 'invalid_idempotency_key' })
      await expect(c.deliverRegistrationGrant(id, { recipient: 'r@example.test', variant: 'LINK' }, key as string)).rejects.toMatchObject({ code: 'invalid_idempotency_key' })
    }
    await expect(c.rotateRegistrationGrant(id, -1, 'key')).rejects.toBeInstanceOf(PortalOpenApiError)
    await expect(c.rotateRegistrationGrant(id, 0.5, 'key')).rejects.toBeInstanceOf(PortalOpenApiError)
    await expect(c.deliverRegistrationGrant(id, { recipient: ' ', variant: 'LINK' }, 'key')).rejects.toBeInstanceOf(PortalOpenApiError)
    await expect(c.getRegistrationGrantDelivery(id, 'bad')).rejects.toBeInstanceOf(PortalOpenApiError)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('exposes full URL once and supports explicitly secretless same-key replay', async () => {
    const calls = mockResource(created)
    const c = new PortalOpenApiClient(config)
    expect(await c.createRegistrationGrant({ type: 'EMAIL_LINK' }, 'create-1')).toEqual(created)
    expect(calls[0]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'create-1', Authorization: 'Bearer registration_grants:write' })
    mockResource({ grant, secretAlreadyIssued: true })
    expect(await c.createRegistrationGrant({ type: 'EMAIL_LINK' }, 'create-1')).toEqual({ grant, secretAlreadyIssued: true })
  })

  it('sends versioned rotation, addressed delivery and exact scoped status with no automatic retry', async () => {
    const c = new PortalOpenApiClient(config)
    let calls = mockResource(created)
    await c.rotateRegistrationGrant(id, 2, 'rotate-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe(`/open/v1/registration-grants/${id}/rotate`)
    expect(calls[0]?.init?.body).toBe('{"expectedVersion":2}')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'rotate-1', Authorization: 'Bearer registration_grants:write' })
    calls = mockResource(delivery, 202)
    expect(await c.deliverRegistrationGrant(id, { recipient: 'r@example.test', locale: 'en', variant: 'LINK' }, 'send-1')).toEqual(delivery)
    expect(calls[0]?.path).toBe(`/open/v1/registration-grants/${id}/deliveries`)
    expect(calls[0]?.init?.body).toBe('{"recipient":"r@example.test","locale":"en","variant":"LINK"}')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Idempotency-Key': 'send-1' })
    calls = mockResource({ ...delivery, status: 'DELIVERED', attemptCount: 1, retryable: false })
    expect((await c.getRegistrationGrantDelivery(id, deliveryId)).status).toBe('DELIVERED')
    expect(calls[0]?.init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer registration_grants:read' } })
    expect(calls[0]?.path).toBe(`/open/v1/registration-grants/${id}/deliveries/${deliveryId}`)
    for (const status of [403, 404, 409, 429, 500]) {
      calls = mockResource({ error: 'CONTRACT_ERROR', message: 'safe' }, status)
      await expect(c.rotateRegistrationGrant(id, 2, 'rotate-1')).rejects.toMatchObject({ status, code: 'CONTRACT_ERROR' })
      expect(calls).toHaveLength(1)
    }
  })

  it.each([
    { ...created, secretAlreadyIssued: undefined },
    { ...created, secretAlreadyIssued: null },
    { ...created, secretAlreadyIssued: true },
    { grant, secretAlreadyIssued: false },
    { ...created, registrationAccessCode: 'other-secret' },
    { ...created, registrationInvitationUrl: '/relative' },
    { ...created, registrationInvitationUrl: 'javascript:fixture-proof' },
    { ...created, registrationInvitationUrl: 'https://user:fixture-proof@auth.example.test/invitation' },
    { ...created, registrationInvitationUrl: '' },
    { ...created, grant: { ...grant, version: undefined } },
    { ...created, grant: { ...grant, version: null } },
    { ...created, grant: { ...grant, version: -1 } },
  ])('fails closed on malformed create response %# without including credentials', async (body) => {
    mockResource(body)
    await expect(new PortalOpenApiClient(config).createRegistrationGrant({ type: 'EMAIL_LINK' }, 'key')).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(PortalOpenApiError)
      expect(e).toMatchObject({ code: 'invalid_registration_grant_response' })
      expect(String(e)).not.toContain('fixture-proof')
      return true
    })
  })

  it.each([
    { ...delivery, attemptCount: undefined },
    { ...delivery, attemptCount: null },
    { ...delivery, retryable: undefined },
    { ...delivery, retryable: null },
    { ...delivery, status: 'invented' },
    { ...delivery, variant: 'invented' },
    { ...delivery, grantId: otherId },
    { ...delivery, id: otherId },
  ])('rejects malformed or identity-mismatched delivery response %#', async (body) => {
    mockResource(body)
    await expect(new PortalOpenApiClient(config).getRegistrationGrantDelivery(id, deliveryId)).rejects.toMatchObject({ code: 'invalid_registration_grant_response' })
  })

  it('rejects crossed rotation and delivery identities', async () => {
    const c = new PortalOpenApiClient(config)
    mockResource({ ...created, grant: { ...grant, id: otherId } })
    await expect(c.rotateRegistrationGrant(id, 2, 'key')).rejects.toMatchObject({ code: 'invalid_registration_grant_response' })
    mockResource({ ...delivery, variant: 'CODE' })
    await expect(c.deliverRegistrationGrant(id, { recipient: 'r@example.test', variant: 'LINK' }, 'key')).rejects.toMatchObject({ code: 'invalid_registration_grant_response' })
  })
})
