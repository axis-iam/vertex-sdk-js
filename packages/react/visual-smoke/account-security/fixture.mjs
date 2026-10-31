import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/** Deterministic protocol boundary, not a replacement for real-backend integration. */
export function securityFixture(bundle) {
  let origin, enrolled = false, count = 0, version = 4, operation = null, lostBegin = false, lostComplete = false, identity = null, providerReturned = false, lostIdentityComplete = false
  const requests = [], issued = new Map()
  const ref = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
  const providerId = '019a31b0-0000-7000-8000-000000000001'
  const providerTarget = { providerId, maskedDisplayName: 'V*** A***', maskedEmail: 'v***@verified.invalid', reference: 'a'.repeat(64) }
  const identifierIds = Array.from({ length: 11 }, () => randomUUID())
  const capability = (unavailableReasons = [], requirements = ['CURRENT_ACCOUNT_PROOF'], replacementPrimaryIds = []) => ({ allowed: !unavailableReasons.length, unavailableReasons, requirements, replacementPrimaryIds })
  const identifiers = () => ({ loginMethodVersion: version, management: { add: {
    USERNAME: capability([], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER']), EMAIL: capability([], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'TARGET_EMAIL_OTP']), PHONE: capability(['TARGET_PROOF_UNAVAILABLE'], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'TARGET_PHONE_OTP']),
  }, proofOptions: [{ method: 'PASSWORD', availableMethods: [] }] }, items: identifierIds.map((id, index) => ({ id, kind: 'EMAIL', displayValue: index === 0 ? 'member@example.invalid' : `member.${index + 1}.with-a-long-address@example.invalid`, status: 'ACTIVE', verificationState: index === 1 ? 'UNVERIFIED' : 'VERIFIED', isPrimary: index === 0, managedBy: null, capabilities: {
    VERIFY: capability(index === 1 ? [] : ['ALREADY_VERIFIED'], ['CURRENT_ACCOUNT_PROOF', 'TARGET_EMAIL_OTP']), SET_PRIMARY: capability(index === 0 ? ['ALREADY_PRIMARY'] : index === 1 ? ['IDENTIFIER_UNVERIFIED'] : []),
    REMOVE: capability([], ['CURRENT_ACCOUNT_PROOF', 'REMAINING_LOGIN_PATH', ...(index === 0 ? ['REPLACEMENT_PRIMARY'] : [])], index === 0 ? [identifierIds[10]] : []),
    REPLACE: capability([], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'REMAINING_LOGIN_PATH', 'TARGET_EMAIL_OTP']),
    TRANSFER: capability([], ['CURRENT_ACCOUNT_PROOF', 'REMAINING_LOGIN_PATH', 'COUNTERPART_CONFIRMATION', 'TARGET_EMAIL_OTP', ...(index === 0 ? ['REPLACEMENT_PRIMARY'] : [])], index === 0 ? [identifierIds[10]] : []),
  } })) })
  const identityWire = bff => {
    const { ref: operationRef, ...rest } = identity
    return { [bff ? 'ref' : 'id']: operationRef, ...rest }
  }
  const providerReady = () => {
    identity.state = 'READY'; identity.providerTarget = providerTarget
    identity.requiredProofs = identity.requiredProofs.map(proof => ({ ...proof, satisfied: true }))
  }
  const now = () => new Date().toISOString(), future = () => new Date(Date.now() + 600_000).toISOString()
  const user = { id: 'fixture-user', email: 'member@example.invalid', username: 'fixture-member', status: 'ACTIVE', emailVerified: true, metadata: { displayName: 'Fixture member' }, authenticationContext: { subjectType: 'USER', applicationId: 'fixture-app', clientId: 'security-fixture-client', sessionId: 'fixture-session', workspaceId: null, workspaceSelectionRequired: false, organizationId: null, organizationSlug: null, organizationRole: null, authTime: null, authenticationMethods: [], assuranceLevel: null, impersonation: null } }
  const profile = { userId: user.id, applicationId: 'fixture-app', globalIdentityId: null, email: user.email, username: user.username, displayName: 'Fixture member', avatarUrl: null, emailVerified: true, status: 'ACTIVE', createdAt: now(), updatedAt: now(), currentOrganization: null }
  const restrictions = { signup: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } }, login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } } }
  const capabilities = { clientId: 'security-fixture-client', passwordLoginEnabled: true, emailMagicLinkEnabled: true, emailOtpEnabled: true, smsOtpEnabled: true, socialLoginEnabled: false, signupEnabled: true, selfRegistrationEnabled: true, idpAutoProvisioningEnabled: false, loginInitiationUri: null, postVerificationRedirectUri: null, identifierRestrictions: restrictions, identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_OTP', 'EMAIL_MAGIC_LINK'] }, { kind: 'PHONE', methods: ['PASSWORD', 'SMS_OTP'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }], defaultIdentifierKind: 'EMAIL', defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' }, allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'], allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'], methods: ['PASSWORD', 'EMAIL_OTP', 'EMAIL_MAGIC_LINK', 'SMS_OTP'].map(type => ({ type, enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null })), idpProviders: [], resend: { emailVerificationCooldownSeconds: 30 } }
  const send = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
  const loseReply = res => {
    // Send part of a response before disconnecting: browsers may transparently retry an untouched socket.
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' })
    res.flushHeaders(); res.write('{"operation":')
    setTimeout(() => res.destroy(), 10)
  }
  const wire = bff => {
    const { ref: operationRef, ...rest } = operation
    return { [bff ? 'ref' : 'id']: operationRef, ...rest }
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin), path = url.pathname, bff = path.startsWith('/console/')
      if (path === '/protocol-provider') {
        providerReturned = true
        if (url.searchParams.get('mode') === 'bff') providerReady()
        res.writeHead(302, { Location: `${origin}${url.searchParams.get('mode') === 'bff' ? '/console/session/callback' : '/callback'}?operation_id=${identity.ref}&authorization_id=protocol-authorization&identity_operation=proof_pending` }); res.end(); return
      }
      if (path === '/console/session/callback') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Isolated provider return</title><p>Return to the original account confirmation.</p>'); return }
      if (path === '/' || path === '/callback') {
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html lang="en" data-host-theme="unchanged"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account security isolated consumer</title><style>body{margin:0;background:#edf0f3;font-family:Georgia,serif}.consumer-controls{margin:16px 0;color:#344352}.consumer-controls button{min-height:44px}#app{margin:0 auto;padding:24px;max-width:1000px;box-sizing:border-box}@media(max-width:480px){#app{padding:12px}}</style><script type="module" src="/browser.js"></script></html>'); return
      }
      if (path === '/browser.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(bundle)); return }
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const text = Buffer.concat(chunks).toString()
      const body = !text ? undefined : req.headers['content-type']?.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text)
      requests.push({ path, method: req.method, bff, bodyKeys: body ? Object.keys(body) : [], bearer: Boolean(req.headers.authorization), csrf: Boolean(req.headers['x-csrf-token']) })
      if (bff && req.method !== 'GET' && req.headers['x-csrf-token'] !== ref) return send(res, { error: 'SESSION_CSRF_REQUIRED' }, 403)
      if (path.endsWith('/openid-configuration')) return send(res, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, userinfo_endpoint: `${origin}/userinfo`, jwks_uri: `${origin}/jwks` })
      if (path === '/token') return send(res, { access_token: 'fixture-access-token', token_type: 'Bearer', expires_in: 3600 })
      if (path.endsWith('/session/bootstrap') || path === '/console/session') return send(res, { state: 'AUTHENTICATED', owner: ref, version: 1, csrfToken: ref, expiresAt: future(), profile: user, permissions: { roles: ['member'], permissions: ['documents:read'] } })
      if (path.endsWith('/auth/me')) return send(res, user)
      if (path.endsWith('/permissions')) return send(res, { applicationId: 'fixture-app', organizationId: null, roles: ['member'], permissions: ['documents:read'] })
      if (path.endsWith('/auth-methods')) return send(res, capabilities)
      if (path.endsWith('/auth-policy')) return send(res, { identifierRestrictions: restrictions, defaultLogin: capabilities.defaultLogin, allowedSignupIdentifierKinds: capabilities.allowedSignupIdentifierKinds, allowedPasswordIdentifierKinds: capabilities.allowedPasswordIdentifierKinds, passwordLoginEnabled: true, emailMagicLinkEnabled: true, emailOtpEnabled: true, smsOtpEnabled: true, socialLoginEnabled: false, smsAutoProvisioningEnabled: false, minPasswordLength: 10, requireUppercase: true, requireLowercase: true, requireDigit: true, requireSpecialChar: true, breachedPasswordCheck: false, totpEnabled: true, webauthnEnabled: false, mfaEnforcement: 'OPTIONAL', stepUpEnabled: false, stepUpTriggers: [], deviceTrustDays: 0, maxTrustedDevices: 0, maxLoginAttempts: 5, lockoutDurationMinutes: 15, progressiveLockout: false, idpAutoProvisioningEnabled: false, signupMode: 'OPEN', allowedRegistrationGrantTypes: ['EMAIL_LINK', 'ACCESS_CODE', 'ORG_INVITATION'] })
      if (path.endsWith('/profile')) {
        if (body?.displayName) profile.displayName = body.displayName
        return send(res, profile)
      }
      if (path.endsWith('/security')) return send(res, { emailVerified: true, passwordCredentialPresent: true, mfaEnrolled: enrolled, totpEnrolled: enrolled, webAuthnEnrolled: false, activeSessionCount: 1 })
      if (path.endsWith('/identifiers')) return send(res, identifiers())
      if (path.endsWith('/login-methods')) return send(res, { loginMethodVersion: version, methods: [] })
      if (path.endsWith('/linkable-identity-providers')) return send(res, [{ id: providerId, displayName: 'Catalog directory label', providerType: 'OIDC', protocol: 'OIDC', enabled: true, linked: false, linkedAt: null, supportsAccountLinking: true, canLink: true, canReauthenticate: false, unavailableReasons: [] }])
      if (path.endsWith('/identity-operations') && req.method === 'POST') {
        if (body.type !== 'LINK' || body.payload.providerId !== providerId) return send(res, { error: 'INVALID_OPERATION_PAYLOAD' }, 400)
        identity = { ref: bff ? ref : randomUUID(), type: 'LINK', state: 'AWAITING_REAUTH', expiresAt: future(), providerTarget: null, completion: null, proofOptions: [{ method: 'PASSWORD' }], requiredProofs: [{ purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD'], strength: 'POLICY', satisfied: false }, { purpose: 'TARGET_OWNERSHIP', methods: ['PROVIDER'], strength: 'OWNERSHIP', satisfied: false }] }
        return send(res, identityWire(bff), 201)
      }
      if (path.includes('/identity-operations/')) {
        if (!identity || !path.includes(identity.ref)) return send(res, { error: 'OPERATION_NOT_FOUND' }, 404)
        if (path.endsWith('/reauthenticate')) { identity.state = 'AWAITING_PROOF'; identity.requiredProofs[0].satisfied = true }
        if (path.endsWith('/authorize')) return send(res, { [bff ? 'ref' : 'authorizationId']: bff ? ref : 'protocol-authorization', authorizationUrl: `${origin}/protocol-provider?mode=${bff ? 'bff' : 'oauth'}`, expiresAt: future() })
        if (path.endsWith('/provider-callback')) { if (!providerReturned) return send(res, { error: 'PROOF_REQUIRED' }, 409); providerReady() }
        if (path.endsWith('/cancel')) { identity.state = 'CANCELLED'; identity.providerTarget = null }
        if (path.endsWith('/complete')) {
          if (identity.state !== 'READY' || !identity.providerTarget || body.proofs.length) return send(res, { error: 'PROOF_REQUIRED' }, 409)
          identity.state = 'COMMITTED'; version++
          identity.completion = { completedAt: now(), finalLoginMethodVersion: version, sessionImpact: 'UNCHANGED' }
          if (lostIdentityComplete) { lostIdentityComplete = false; loseReply(res); return }
        }
        return send(res, identityWire(bff))
      }
      if (path.endsWith('/sessions')) return send(res, [])
      if (path.endsWith('/mfa/capabilities')) {
        const action = allowed => ({ allowed, reasonCode: allowed ? null : 'METHOD_UNAVAILABLE', proofRequirement: 'SESSION', proofOptions: [] })
        return send(res, { loginMethodVersion: version, totpEnroll: action(!enrolled), totpDisable: action(enrolled), recoveryCodesGenerate: action(true) })
      }
      if (path.endsWith('/recovery-codes/remaining')) return send(res, { remaining: count })
      if (path.endsWith('/mfa/operations') && req.method === 'POST') {
        const key = bff ? body.requestId : req.headers['idempotency-key']
        if (issued.has(key)) { operation = issued.get(key); return send(res, wire(bff)) }
        operation = { ref: bff ? key : randomUUID(), type: body.type, state: 'READY', createdAt: now(), expiresAt: future(), expectedLoginMethodVersion: body.expectedLoginMethodVersion, proofRequirement: 'SESSION', proofOptions: [], proofSatisfied: true, nextChallengeAt: null, reasonCode: null, result: null }
        issued.set(key, operation); return send(res, wire(bff))
      }
      if (path.includes('/mfa/operations/')) {
        if (!operation || !path.includes(operation.ref)) return send(res, { error: 'OPERATION_NOT_FOUND' }, 404)
        if (path.endsWith('/begin')) {
          if (operation.state === 'AWAITING_CONFIRMATION') return send(res, { operation: wire(bff), delivery: 'ALREADY_DELIVERED' })
          operation.state = 'AWAITING_CONFIRMATION'
          if (lostBegin) { lostBegin = false; loseReply(res); return }
          return send(res, { operation: wire(bff), delivery: 'AVAILABLE', material: { secret: 'FIXTUREONLYSETUP', qrCodeUri: 'otpauth://totp/fixture?secret=FIXTUREONLYSETUP', issuer: 'Isolated fixture' } })
        }
        if (path.endsWith('/complete')) {
          if (operation.state === 'COMMITTED') return send(res, { operation: wire(bff), delivery: operation.type === 'RECOVERY_CODES_GENERATE' ? 'ALREADY_DELIVERED' : 'NOT_APPLICABLE' })
          if (operation.type === 'TOTP_ENROLL' && body.code !== '123456') return send(res, { error: 'INVALID_TOTP_CODE' }, 400)
          enrolled = operation.type === 'TOTP_ENROLL' || (operation.type !== 'TOTP_DISABLE' && enrolled)
          if (operation.type === 'RECOVERY_CODES_GENERATE') count = 2
          operation.state = 'COMMITTED'; version++
          operation.result = { completedAt: now(), finalLoginMethodVersion: version, sessionImpact: operation.type === 'TOTP_ENROLL' ? 'CURRENT_SESSION_RETAINED' : operation.type === 'TOTP_DISABLE' ? 'REAUTHENTICATE' : 'UNCHANGED', recoveryBatchId: operation.type === 'RECOVERY_CODES_GENERATE' ? randomUUID() : null, recoveryCount: operation.type === 'RECOVERY_CODES_GENERATE' ? 2 : null }
          if (lostComplete) { lostComplete = false; loseReply(res); return }
          return send(res, { operation: wire(bff), delivery: operation.type === 'RECOVERY_CODES_GENERATE' ? 'AVAILABLE' : 'NOT_APPLICABLE', ...(operation.type === 'RECOVERY_CODES_GENERATE' ? { recoveryCodes: { codes: ['FIXTURE-CODE-ONE', 'FIXTURE-CODE-TWO'], count: 2 } } : {}) })
        }
        if (path.endsWith('/cancel') && operation.state !== 'COMMITTED') operation.state = 'CANCELLED'
        return send(res, wire(bff))
      }
      return send(res, { error: 'FIXTURE_ROUTE_NOT_FOUND' }, 404)
    } catch { send(res, { error: 'FIXTURE_INVALID_REQUEST' }, 400) }
  })
  return {
    server, requests,
    async listen() { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`; return origin },
    reset(options = {}) { enrolled = false; count = 0; version = 4; operation = null; identity = null; providerReturned = false; lostBegin = Boolean(options.lostBegin); lostComplete = Boolean(options.lostComplete); lostIdentityComplete = Boolean(options.lostIdentityComplete); issued.clear(); requests.length = 0 },
  }
}
