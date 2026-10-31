import { managedIdentifiers } from './identity-management-fixtures.test-support'
import { vi } from 'vitest'
import type { MfaOperation, MfaOperationMode, MfaOperationType, MfaProofOption, MfaProofRequirement } from '@axis-iam/vertex'
import { CookieSessionTransport } from '@axis-iam/vertex'
import { OAuthClient } from './oauth-client'
import { ServerSessionClient } from './server-session-client'
import { makeTestJwt, makeTestUser } from '../test-utils'
import { flowCapabilities, flowPolicy } from './auth-flow-fixtures.test-support'

export const securityRef = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
export const securityId = '019a31b0-0000-7000-8000-000000000001'
export const securityPassword: MfaProofOption = { method: 'PASSWORD', identifierId: null, maskedIdentifier: null, methodId: null, displayName: null, availableMethods: [] }
export const securityEmail: MfaProofOption = { method: 'EMAIL_OTP', identifierId: securityId, maskedIdentifier: 'a***@example.invalid', methodId: null, displayName: null, availableMethods: [] }
export const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
export function securityOperation(ref: string, type: MfaOperationType = 'TOTP_ENROLL'): MfaOperation {
  return { ref, type, state: 'READY', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), expectedLoginMethodVersion: 4, proofRequirement: 'SESSION', proofOptions: [], proofSatisfied: true, nextChallengeAt: null, reasonCode: null, result: null }
}
export async function securityFixture(mode: MfaOperationMode = 'oauth_tokens') {
  let requirement: MfaProofRequirement = 'SESSION', options: MfaProofOption[] = [], enrolled = false, count = 0
  let operation = securityOperation(mode === 'server_session' ? securityRef : securityId)
  const wire = (op = operation) => {
    const { ref, ...rest } = op
    return mode === 'server_session' ? { ref, ...rest } : { id: ref, ...rest }
  }
  const capabilities = () => {
    const action = { allowed: true, reasonCode: null, proofRequirement: requirement, proofOptions: options }
    return { loginMethodVersion: 4, totpEnroll: action, totpDisable: action, recoveryCodesGenerate: action }
  }
  const user = makeTestUser()
  user.authenticationContext.clientId = 'test-app'
  const auth = () => ({ state: 'AUTHENTICATED', owner: securityRef, version: 1, csrfToken: securityRef, expiresAt: new Date(Date.now() + 600_000).toISOString(), profile: user, permissions: { roles: [], permissions: [] } })
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)), path = url.pathname
    const body: Record<string, unknown> = init?.body ? JSON.parse(String(init.body)) : {}
    if (path.endsWith('/session/bootstrap') || path.endsWith('/console/session')) return response(auth())
    if (path.endsWith('/mfa/capabilities')) return response(capabilities())
    if (path.endsWith('/mfa/recovery-codes/remaining')) return response({ remaining: count })
    if (path.endsWith('/security')) return response({ emailVerified: true, passwordCredentialPresent: true, mfaEnrolled: enrolled, totpEnrolled: enrolled, webAuthnEnrolled: false, activeSessionCount: 1 })
    if (path.endsWith('/mfa/operations') && init?.method === 'POST') {
      if (body.type !== 'TOTP_ENROLL' && body.type !== 'TOTP_DISABLE' && body.type !== 'RECOVERY_CODES_GENERATE') throw new Error('Invalid fixture type')
      operation = { ...securityOperation(mode === 'server_session' ? String(body.requestId) : securityId, body.type), state: requirement === 'SESSION' ? 'READY' : 'AWAITING_REAUTH', proofRequirement: requirement, proofOptions: options, proofSatisfied: requirement === 'SESSION' }
      return response(wire())
    }
    if (path.endsWith('/step-up/start')) return response({ [mode === 'server_session' ? 'challengeRef' : 'challengeId']: securityRef, availableMethods: ['TOTP', 'WEBAUTHN'] })
    if (path.endsWith('/step-up/webauthn/start')) return response({ [mode === 'server_session' ? 'requestRef' : 'requestId']: securityRef, publicKey: '{"publicKey":{"challenge":"YWJj"}}' })
    if (path.endsWith('/reauthenticate') || path.endsWith('/step-up/verify') || path.endsWith('/step-up/webauthn/verify')) {
      operation = { ...operation, state: 'READY', proofSatisfied: true }
      return response(wire())
    }
    if (path.endsWith('/challenges')) return response({ operation: wire(), [mode === 'server_session' ? 'challengeRef' : 'challengeId']: mode === 'server_session' ? securityRef : securityId, nextChallengeAt: new Date(Date.now() + 60_000).toISOString() })
    if (path.endsWith('/begin')) {
      operation = { ...operation, state: 'AWAITING_CONFIRMATION' }
      return response({ operation: wire(), delivery: 'AVAILABLE', material: { secret: 'FIXTUREONLYSETUP', qrCodeUri: 'otpauth://totp/fixture?secret=FIXTUREONLYSETUP', issuer: 'Fixture only' } })
    }
    if (path.endsWith('/complete')) {
      if (operation.type === 'TOTP_ENROLL' && body.code !== '123456') return response({ error: 'INVALID_TOTP_CODE' }, 400)
      const type = operation.type
      enrolled = type === 'TOTP_ENROLL' || (type !== 'TOTP_DISABLE' && enrolled)
      if (type === 'RECOVERY_CODES_GENERATE') count = 2
      operation = { ...operation, state: 'COMMITTED', result: { completedAt: new Date().toISOString(), finalLoginMethodVersion: 5, sessionImpact: type === 'TOTP_ENROLL' ? 'CURRENT_SESSION_RETAINED' : type === 'TOTP_DISABLE' ? 'REAUTHENTICATE' : 'UNCHANGED', recoveryBatchId: type === 'RECOVERY_CODES_GENERATE' ? securityId : null, recoveryCount: type === 'RECOVERY_CODES_GENERATE' ? 2 : null } }
      return response({ operation: wire(), delivery: type === 'RECOVERY_CODES_GENERATE' ? 'AVAILABLE' : 'NOT_APPLICABLE', ...(type === 'RECOVERY_CODES_GENERATE' ? { recoveryCodes: { codes: ['FIXTURE-ONE', 'FIXTURE-TWO'], count: 2 } } : {}) })
    }
    if (path.endsWith('/cancel')) { operation = { ...operation, state: operation.state === 'COMMITTED' ? 'COMMITTED' : 'CANCELLED' }; return response(wire()) }
    if (path.includes('/mfa/operations/')) return response(wire())
    if (path.endsWith('/identifiers')) return response(managedIdentifiers())
    if (path.endsWith('/login-methods')) return response({ loginMethodVersion: 4, methods: [] })
    if (path.endsWith('/linkable-identity-providers')) return response([])
    if (path.endsWith('/auth-methods')) return response(flowCapabilities)
    if (path.endsWith('/auth-policy')) return response(flowPolicy)
    if (path.endsWith('/profile')) return response({ userId: user.id, applicationId: 'app-test', globalIdentityId: null, email: user.email, emailVerified: true, username: null, displayName: 'Fixture user', avatarUrl: null, status: 'ACTIVE', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentOrganization: null })
    if (path.endsWith('/sessions')) return response([])
    throw new Error(`Unexpected fixture route: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const config = { issuerUri: 'https://auth.test.com', clientId: 'test-app', redirectUri: `${window.location.origin}/callback` }
  const client = mode === 'server_session' ? new ServerSessionClient({ ...config, sessionMode: 'server_session', sessionTransport: new CookieSessionTransport({ origin: window.location.origin }), sessionProviderReturnUri: '/console/session/callback' }) : new OAuthClient(config)
  if (client.mode === 'server_session') await client.initialize()
  else {
    client.tokenManager.store({ access_token: makeTestJwt(), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
    client.tokenManager.applyViews({ user, roles: [], permissions: [] })
    vi.spyOn(client, 'discover').mockResolvedValue({ issuer: config.issuerUri, authorization_endpoint: `${config.issuerUri}/authorize`, token_endpoint: `${config.issuerUri}/token`, userinfo_endpoint: `${config.issuerUri}/userinfo`, jwks_uri: `${config.issuerUri}/jwks` })
  }
  return { client, fetchMock, wire, setOperation: (op: MfaOperation) => { operation = op }, getOperation: () => operation, setProof: (proof: MfaProofRequirement, methods: MfaProofOption[]) => { requirement = proof; options = methods }, capabilities }
}
