import { afterEach, expect, it, vi } from 'vitest'
import {
  MfaOperationResponseError,
  parseMfaCapabilities,
  parseMfaCompletionResult,
  parseMfaOperation,
  parseMfaTotpBeginResult,
} from './account-security-operations.js'
import { CookieSessionTransport } from './session-transport.js'
import type { SessionRequest } from './session-transport.js'

const ref = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
const csrf = () => ({ state: 'AUTHENTICATED', csrfToken: ref, expiresAt: new Date(Date.now() + 600_000).toISOString() })
const operation = (overrides: Record<string, unknown> = {}) => ({
  ref,
  type: 'TOTP_ENROLL',
  state: 'AWAITING_REAUTH',
  createdAt: '2026-10-30T00:00:00Z',
  expiresAt: '2026-10-30T00:10:00Z',
  expectedLoginMethodVersion: 4,
  proofRequirement: 'REAUTHENTICATION',
  proofOptions: [{
    method: 'PASSWORD',
    identifierId: null,
    maskedIdentifier: null,
    methodId: null,
    displayName: null,
    availableMethods: [],
  }],
  proofSatisfied: false,
  nextChallengeAt: null,
  reasonCode: null,
  result: null,
  ...overrides,
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('parses the strict MFA operation contract and preserves typed session impact', () => {
  expect(parseMfaOperation(operation())).toMatchObject({
    ref,
    type: 'TOTP_ENROLL',
    state: 'AWAITING_REAUTH',
    proofRequirement: 'REAUTHENTICATION',
  })
  expect(parseMfaOperation(operation({
    state: 'COMMITTED',
    result: {
      completedAt: '2026-10-30T00:01:00Z',
      finalLoginMethodVersion: 5,
      sessionImpact: 'CURRENT_SESSION_RETAINED',
      recoveryBatchId: null,
      recoveryCount: null,
    },
  })).result).toEqual({
    completedAt: '2026-10-30T00:01:00Z',
    finalLoginMethodVersion: 5,
    sessionImpact: 'CURRENT_SESSION_RETAINED',
    recoveryBatchId: null,
    recoveryCount: null,
  })
})

it('rejects missing required capability fields instead of defaulting to unavailable', () => {
  expect(() => parseMfaCapabilities({
    loginMethodVersion: 4,
    totpEnroll: { allowed: true, reasonCode: null, proofRequirement: 'SESSION', proofOptions: [] },
    totpDisable: { allowed: false, reasonCode: 'MFA_NOT_ENROLLED', proofRequirement: 'SESSION', proofOptions: [] },
  })).toThrow(MfaOperationResponseError)
})

it('returns one-time TOTP and recovery material only from the explicit action response', () => {
  const begin = parseMfaTotpBeginResult({
    operation: operation({ state: 'AWAITING_CONFIRMATION' }),
    delivery: 'AVAILABLE',
    material: { secret: 'secret', qrCodeUri: 'otpauth://totp/example', issuer: 'Axis Vertex' },
  })
  expect(begin.material).toEqual({ secret: 'secret', qrCodeUri: 'otpauth://totp/example', issuer: 'Axis Vertex' })
  expect(() => parseMfaTotpBeginResult({
    operation: operation({ state: 'AWAITING_CONFIRMATION' }),
    delivery: 'ALREADY_DELIVERED',
  })).not.toThrow()
  expect(parseMfaCompletionResult({
    operation: operation({ type: 'RECOVERY_CODES_GENERATE', state: 'COMMITTED', result: {
      completedAt: '2026-10-30T00:01:00Z',
      finalLoginMethodVersion: 4,
      sessionImpact: 'UNCHANGED',
      recoveryBatchId: 'batch-1',
      recoveryCount: 2,
    } }),
    delivery: 'AVAILABLE',
    recoveryCodes: { codes: ['one', 'two'], count: 2 },
  }).recoveryCodes).toEqual({ codes: ['one', 'two'], count: 2 })
})

it('maps BFF opaque refs to finite same-origin routes without exposing bearer or server ids', async () => {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith('/bootstrap')) return new Response(JSON.stringify(csrf()))
    if (path.endsWith('/mfa/capabilities')) return new Response(JSON.stringify({
      loginMethodVersion: 4,
      totpEnroll: { allowed: true, reasonCode: null, proofRequirement: 'SESSION', proofOptions: [] },
      totpDisable: { allowed: true, reasonCode: null, proofRequirement: 'STEP_UP', proofOptions: [{
        method: 'STEP_UP_PROOF', identifierId: null, maskedIdentifier: null, methodId: null, displayName: null, availableMethods: ['TOTP'],
      }] },
      recoveryCodesGenerate: { allowed: true, reasonCode: null, proofRequirement: 'SESSION', proofOptions: [] },
    }))
    if (path.endsWith('/mfa/operations')) return new Response(JSON.stringify(operation()))
    if (path.endsWith(`/mfa/operations/${ref}/begin`)) return new Response(JSON.stringify({
      operation: operation({ state: 'AWAITING_CONFIRMATION' }),
      delivery: 'AVAILABLE',
      material: { secret: 'secret', qrCodeUri: 'otpauth://totp/example', issuer: 'Axis Vertex' },
    }))
    return new Response(JSON.stringify(operation()))
  })
  vi.stubGlobal('fetch', fetchMock)
  const transport = new CookieSessionTransport({ origin: 'https://app.test' })
  await transport.request({ action: 'bootstrap' })
  await transport.request({ action: 'mfaCapabilities' })
  await transport.request({
    action: 'mfaOperationCreate',
    body: { requestId: ref, type: 'TOTP_ENROLL', expectedLoginMethodVersion: 4 },
  })
  await transport.request({ action: 'mfaOperationBegin', ref })
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
  expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
    '/console/session/bootstrap',
    '/console/mfa/capabilities',
    '/console/mfa/operations',
    `/console/mfa/operations/${ref}/begin`,
  ])
  const [, init] = calls[2]
  expect(JSON.parse(String(init.body))).toEqual({
    requestId: ref,
    type: 'TOTP_ENROLL',
    expectedLoginMethodVersion: 4,
  })
  expect(new Headers(init.headers).get('X-CSRF-Token')).toBe(ref)
  expect(new Headers(init.headers).has('Authorization')).toBe(false)
})

it.each(['REJECTED', 'MISSING', null])('rejects non-producer operation state %s', state => {
  expect(() => parseMfaOperation(operation({ state }))).toThrow(MfaOperationResponseError)
})
it('separates Server UUIDs and BFF references without guessing or exposing secrets', () => {
  const { ref: _ref, ...server } = operation()
  const id = '019a31b0-0000-7000-8000-000000000001'
  expect(parseMfaOperation({ ...server, id }, 'oauth_tokens').ref).toBe(id)
  expect(() => parseMfaOperation({ ...server, id })).toThrow(MfaOperationResponseError)
  expect(() => parseMfaOperation(operation(), 'oauth_tokens')).toThrow(MfaOperationResponseError)
  expect(() => parseMfaOperation(operation({ secret: 'must-not-return' }))).toThrow(MfaOperationResponseError)
  expect(() => parseMfaOperation(operation({ state: 'COMMITTED' }))).toThrow(MfaOperationResponseError)
})
it('rejects sensitive replay and missing once-only delivery material', () => {
  const material = { secret: 'x', qrCodeUri: 'otpauth://totp/x', issuer: 'fixture' }
  expect(() => parseMfaTotpBeginResult({ operation: operation(), delivery: 'ALREADY_DELIVERED', material })).toThrow(MfaOperationResponseError)
  expect(() => parseMfaTotpBeginResult({ operation: operation(), delivery: 'AVAILABLE' })).toThrow(MfaOperationResponseError)
  expect(() => parseMfaCompletionResult({ operation: operation(), delivery: 'ALREADY_DELIVERED', recoveryCodes: { codes: ['x'], count: 1 } })).toThrow(MfaOperationResponseError)
})

it('rejects extra, legacy, null and malformed BFF proof fields before any transport', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const transport = new CookieSessionTransport({ origin: 'https://app.test' })
  const requests: unknown[] = [
    { action: 'mfaOperationReauthenticate', ref, body: { method: 'STEP_UP_PROOF', proof: 'x' } },
    { action: 'mfaOperationReauthenticate', ref, body: { method: 'PASSWORD', password: 'fixture', codeVerifier: 'x' } },
    { action: 'mfaOperationReauthenticate', ref, body: { method: 'EMAIL_OTP', challengeId: ref, code: '123456' } },
    { action: 'mfaOperationComplete', ref, body: { code: null } },
    { action: 'mfaOperationComplete', ref, body: { code: 123456 } },
    { action: 'mfaOperationProviderCallback', ref, body: { codeVerifier: 'x' } },
    { action: 'mfaOperationCreate', body: { requestId: ref, type: 'TOTP_ENROLL', expectedLoginMethodVersion: -1 } },
    { action: 'identityStepUpVerify', ref, body: { challengeRef: ref, code: 'bad' } },
  ]
  for (const request of requests) await expect(transport.request(request as SessionRequest)).rejects.toMatchObject({ code: 'INVALID_OPERATION_PAYLOAD' })
  expect(fetchMock).not.toHaveBeenCalled()
})
