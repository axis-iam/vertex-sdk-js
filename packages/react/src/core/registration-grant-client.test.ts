import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegistrationGrantClient } from './registration-grant-client'
import type { RegistrationGrantInput } from './types'
import { IamApiError } from './types'

const ISSUER = 'https://auth.example.test'
const client = new RegistrationGrantClient({
  clientId: 'spa/client id',
  discover: async () => ({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    jwks_uri: `${ISSUER}/jwks`,
  }),
})

describe('registration grant client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [{ type: 'EMAIL_LINK', registrationGrantToken: 'email-link-proof' }, { registrationGrantToken: 'email-link-proof' }],
    [{ type: 'ACCESS_CODE', registrationAccessCode: '12345678' }, { registrationAccessCode: '12345678' }],
    [{ type: 'ORG_INVITATION', organizationInvitationToken: 'organization-invitation-proof' }, { organizationInvitationToken: 'organization-invitation-proof' }],
  ] as const)('serializes exactly one proof without bearer auth', async (input, body) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ status: 'UNAVAILABLE' }),
    })

    await expect(client.preview(input)).resolves.toEqual({
      status: 'UNAVAILABLE',
      type: null,
      emailHint: null,
      domainHint: null,
      applicationName: null,
      expiresAt: null,
      allowedAuthMethods: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${ISSUER}/api/v1/apps/spa%2Fclient%20id/registration-grants:preview`,
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('returns safe valid previews and preserves valid rate-limit retry metadata', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          status: 'VALID', type: 'EMAIL_LINK', emailHint: 'a***@example.test', domainHint: null,
          applicationName: 'Example', expiresAt: '2026-07-11T10:00:00Z', allowedAuthMethods: ['PASSWORD'],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
        text: async () => JSON.stringify({ error: 'REGISTRATION_GRANT_ATTEMPT_RATE_LIMITED', message: 'Registration grant preview unavailable' }),
      })

    await expect(client.preview({ type: 'EMAIL_LINK', registrationGrantToken: 'token' })).resolves.toMatchObject({
      status: 'VALID', type: 'EMAIL_LINK', allowedAuthMethods: ['PASSWORD'],
    })
    await expect(client.preview({ type: 'ACCESS_CODE', registrationAccessCode: '12345678' })).rejects.toMatchObject({
      status: 429,
      code: 'REGISTRATION_GRANT_ATTEMPT_RATE_LIMITED',
      retryAfterSeconds: 60,
    } satisfies Partial<IamApiError>)
  })

  it.each([
    ['missing', undefined],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['date', 'Wed, 21 Oct 2015 07:28:00 GMT'],
    ['overflow', '9007199254740992'],
  ])('does not invent retry metadata for %s Retry-After header', async (_label, retryAfter) => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: retryAfter === undefined ? new Headers() : new Headers({ 'Retry-After': retryAfter }),
      text: async () => JSON.stringify({ error: 'REGISTRATION_GRANT_ATTEMPT_RATE_LIMITED' }),
    })

    await expect(client.preview({ type: 'ACCESS_CODE', registrationAccessCode: '12345678' })).rejects.toMatchObject({
      status: 429,
      code: 'REGISTRATION_GRANT_ATTEMPT_RATE_LIMITED',
      retryAfterSeconds: undefined,
    } satisfies Partial<IamApiError>)
  })

  it('fails closed for malformed previews and blank proof values', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ status: 'VALID', type: 'UNKNOWN' }) })
    await expect(client.preview({ type: 'EMAIL_LINK', registrationGrantToken: 'token' })).rejects.toThrow('Registration grant preview response is invalid')
    await expect(client.preview({ type: 'ACCESS_CODE', registrationAccessCode: '  ' })).rejects.toThrow('Registration grant proof is required')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown proof types before discovery or preview fetch', async () => {
    const discover = vi.fn(async () => ({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      jwks_uri: `${ISSUER}/jwks`,
    }))
    const untrustedClient = new RegistrationGrantClient({ clientId: 'spa/client id', discover })

    await expect(untrustedClient.preview({ type: 'UNKNOWN', proof: 'untrusted-proof' } as unknown as RegistrationGrantInput))
      .rejects.toMatchObject({ code: 'REGISTRATION_GRANT_INVALID' })

    expect(discover).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
