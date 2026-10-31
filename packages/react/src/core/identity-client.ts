import { SessionInvalidatedError, parseMfaProofOption, parseMfaStepUpResult, parseMfaWebAuthnStartResult, parseIdentifierManagement, parseIdentifierActions, parseIdentityProviderTarget } from '@axis-iam/vertex'
import type {
  AccountIdentifiers, AccountLoginMethods, AuthorizeIdentityOperation,
  CompleteIdentityOperation, CompleteRecovery, CreateIdentityOperation,
  IdentityOperation, IdentityProviderAuthorization, OperationReauthentication,
  RecoveryOperation, RegistrationOperation, StartRegistration, TargetProofMethod,
} from '@axis-iam/vertex'
import { requestJson } from './http-client'
import type { BrowserRequestOptions } from './http-client'
import { IamApiError, IamConfigurationError } from './types'
import type { OAuthClient } from './oauth-client'

/** Memory owns flow control; the email proof never substitutes for it. */
export class IdentityClient {
  private registration: { id: string; secret: string; generation: number } | null = null
  private recovery: { id: string; secret: string; generation: number } | null = null
  constructor(private readonly client: OAuthClient) {}

  private async call(path: string, options: BrowserRequestOptions, authenticated: boolean): Promise<unknown> {
    const generation = this.client.tokenManager.generation
    const token = authenticated ? this.client.tokenManager.getAccessToken() : null
    if (authenticated && (!token || !this.client.tokenManager.hasUsableToken()))
      throw new IamApiError('Authentication required', { status: 401, code: 'UNAUTHENTICATED' })
    const config = await this.client.discover()
    this.client.tokenManager.assertCurrent(generation)
    const result = await requestJson<unknown>(new URL(`/api/v1/auth/${path}`, config.issuer).toString(), {
      ...options, bearerToken: token,
    })
    this.client.tokenManager.assertCurrent(generation)
    return result
  }
  async startStepUp(trigger: 'LOGIN_METHOD_CHANGE' | 'ACCOUNT_DELETE' = 'LOGIN_METHOD_CHANGE'): Promise<{ challengeId: string; availableMethods: ('totp' | 'webauthn')[] }> {
    const data = record(await this.call('step-up/start', { json: { trigger } }, true))
    return { challengeId: string(data.challengeId), availableMethods: array(data.availableMethods).map(m => oneOf(m, ['totp', 'webauthn'])) }
  }
  async verifyStepUp(challengeId: string, code: string): Promise<void> {
    const data = record(await this.call('step-up/verify', { json: { challengeId, code } }, true))
    if (data.verified !== true) throw new IamApiError('Step-up failed', { status: 403, code: 'REAUTH_REQUIRED' })
  }
  async startStepUpWebAuthn(challengeId: string): Promise<{ requestId: string; publicKey: string }> {
    const data = record(await this.call('step-up/webauthn/start', { json: { challengeId } }, true))
    return { requestId: string(data.requestId), publicKey: string(data.publicKey) }
  }
  async verifyStepUpWebAuthn(challengeId: string, requestId: string, credential: string): Promise<void> {
    const data = record(await this.call('step-up/webauthn/verify', { json: { challengeId, requestId, credential } }, true))
    if (data.verified !== true) throw new IamApiError('Step-up failed', { status: 403, code: 'REAUTH_REQUIRED' })
  }
  async startAccountDeletion(expectedLoginMethodVersion: number, idempotencyKey: string, proof?: OperationReauthentication): Promise<IdentityOperation> {
    return parseOperation(await this.call('me/account-deletion/reauthenticate', {
      headers: { 'Idempotency-Key': idempotencyKey }, json: { expectedLoginMethodVersion, ...(proof ? { proof } : {}) },
    }, true))
  }
  async completeAccountDeletion(deletionId: string): Promise<IdentityOperation> {
    return parseOperation(await this.call('me/account-deletion/complete', { json: { deletionId } }, true))
  }
  async authorizeAccountDeletion(id: string, input: AuthorizeIdentityOperation): Promise<IdentityProviderAuthorization> {
    return parseAuthorization(await this.call(`me/account-deletion/${encodeURIComponent(id)}/authorize`, { json: input }, true))
  }
  async accountDeletionProviderCallback(id: string, authorizationId: string, codeVerifier: string): Promise<IdentityOperation> {
    return parseOperation(await this.call(`me/account-deletion/${encodeURIComponent(id)}/provider-callback`, { json: { authorizationId, codeVerifier } }, true))
  }
  async identifiers(): Promise<AccountIdentifiers> {
    return parseIdentifiers(await this.call('me/identifiers', {}, true))
  }
  async loginMethods(): Promise<AccountLoginMethods> {
    return parseMethods(await this.call('me/login-methods', {}, true))
  }
  async create(input: CreateIdentityOperation, idempotencyKey: string): Promise<IdentityOperation> {
    if (!idempotencyKey.trim()) throw new IamConfigurationError('An idempotency key is required')
    return parseOperation(await this.call('me/identity-operations', {
      json: input, headers: { 'Idempotency-Key': idempotencyKey },
    }, true))
  }
  async get(id: string): Promise<IdentityOperation> {
    return parseOperation(await this.call(this.operationPath(id), {}, true))
  }
  private operationPath(id: string) { return `me/identity-operations/${encodeURIComponent(id)}` }
  private async action(id: string, action: string, json: unknown): Promise<IdentityOperation> {
    return parseOperation(await this.call(`${this.operationPath(id)}/${action}`, { json }, true))
  }
  reauthenticate(id: string, input: OperationReauthentication) { return this.action(id, 'reauthenticate', input) }
  async currentAccountChallenge(id: string, identifierId: string) {
    const v = record(await this.call(`${this.operationPath(id)}/current-account/challenges`, { json: { identifierId } }, true))
    return { operation: parseOperation(v.operation), challengeId: string(v.challengeId), nextChallengeAt: string(v.nextChallengeAt) }
  }
  async startOperationStepUp(id: string) {
    const v = parseMfaStepUpResult(await this.call(`${this.operationPath(id)}/step-up/start`, { json: {} }, true), 'oauth_tokens')
    return { challengeId: v.challengeRef, availableMethods: v.availableMethods }
  }
  verifyOperationStepUp(id: string, challengeId: string, code: string) { return this.action(id, 'step-up/verify', { challengeId, code }) }
  async startOperationWebAuthn(id: string, challengeId: string) {
    const v = parseMfaWebAuthnStartResult(await this.call(`${this.operationPath(id)}/step-up/webauthn/start`, { json: { challengeId } }, true), 'oauth_tokens')
    return { requestId: v.requestRef, publicKey: v.publicKey }
  }
  verifyOperationWebAuthn(id: string, challengeId: string, requestId: string, credential: string) { return this.action(id, 'step-up/webauthn/verify', { challengeId, requestId, credential }) }
  challenge(id: string, targetProofMethod: TargetProofMethod) { return this.action(id, 'challenges', { targetProofMethod }) }
  complete(id: string, input: CompleteIdentityOperation) { return this.action(id, 'complete', input) }
  cancel(id: string) { return this.action(id, 'cancel', {}) }
  confirmTransfer(id: string, decision: 'ACCEPT' | 'REJECT') { return this.action(id, 'confirm-transfer', { decision }) }
  async authorize(id: string, input: AuthorizeIdentityOperation): Promise<IdentityProviderAuthorization> {
    return parseAuthorization(await this.call(`${this.operationPath(id)}/authorize`, { json: input }, true))
  }
  providerCallback(id: string, authorizationId: string, codeVerifier: string) {
    return this.action(id, 'provider-callback', { authorizationId, codeVerifier })
  }
  async startRegistration(input: StartRegistration, idempotencyKey: string): Promise<RegistrationOperation> {
    if (!['EMAIL', 'USERNAME'].includes(input.identifier.kind) || 'region' in input.identifier) throw new IamConfigurationError('Registration requires an allowed EMAIL or USERNAME identifier')
    const generation = this.client.tokenManager.generation
    const raw = record(await this.call('signup', {
      json: { ...input, client_id: this.client.clientId }, headers: { 'Idempotency-Key': idempotencyKey },
    }, false))
    const result = parseRegistration(raw)
    if (typeof raw.controlSecret === 'string' && raw.controlSecret)
      this.registration = { id: result.registrationId, secret: raw.controlSecret, generation }
    // A lost first response cannot be recovered from an email link or an idempotent replay.
    if (result.status === 'PENDING_VERIFICATION') this.requireRegistration(result.registrationId)
    return result
  }
  private requireRegistration(id: string) {
    if (!this.registration || this.registration.id !== id ||
      this.registration.generation !== this.client.tokenManager.generation) {
      this.registration = null
      throw new IamApiError('Restart registration and choose your own password', {
        status: 401, code: 'REGISTRATION_RESTART_REQUIRED',
      })
    }
    return this.registration
  }
  async getRegistration(id: string): Promise<RegistrationOperation> {
    const control = this.requireRegistration(id)
    return parseRegistration(await this.call(`signup/operations/${encodeURIComponent(id)}`, { headers: {
      'Registration-Control': control.secret, 'Registration-Client': this.client.clientId,
    } }, false))
  }
  async registrationAction(id: string, action: 'complete' | 'challenges' | 'cancel', code?: string): Promise<RegistrationOperation> {
    const control = this.requireRegistration(id)
    const result = parseRegistration(await this.call(`signup/operations/${encodeURIComponent(id)}/${action}`, {
      headers: { 'Registration-Client': this.client.clientId },
      json: { controlSecret: control.secret, ...(code !== undefined ? { code } : {}) },
    }, false))
    return result
  }
  async authorizeRecoveryProvider(id: string, input: { redirectUri: string; codeChallenge: string; codeChallengeMethod: 'S256' }): Promise<IdentityProviderAuthorization> {
    const context = this.requireRecovery(id)
    return parseAuthorization(await this.call(`recovery/${encodeURIComponent(id)}/authorize`, {
      headers: { 'X-Recovery-Context': context.secret }, json: input,
    }, false))
  }
  async startRecoveryWebAuthn(id: string): Promise<{ requestId: string; publicKeyCredentialCreationOptions: string }> {
    const context = this.requireRecovery(id)
    const data = record(await this.call(`recovery/${encodeURIComponent(id)}/webauthn/registration`, {
      headers: { 'X-Recovery-Context': context.secret }, json: {},
    }, false))
    return { requestId: string(data.requestId), publicKeyCredentialCreationOptions: string(data.publicKeyCredentialCreationOptions) }
  }
  private requireRecovery(id: string) {
    const context = this.recovery
    if (!context || context.id !== id || context.generation !== this.client.tokenManager.generation) {
      this.recovery = null
      throw new SessionInvalidatedError()
    }
    return context
  }
  async authorizeRecovery(recoveryId: string, proof: string): Promise<RecoveryOperation> {
    const generation = this.client.tokenManager.generation
    const data = record(await this.call('recovery/authorize', { json: { recoveryId, proof } }, false))
    const result = parseRecovery(data.recovery)
    this.recovery = { id: result.id, secret: string(data.recoveryContext), generation }
    return result
  }
  async recoveryAction(id: string, action?: 'challenges' | 'complete' | 'cancel', input?: CompleteRecovery): Promise<RecoveryOperation> {
    const context = this.requireRecovery(id)
    return parseRecovery(await this.call(`recovery/${encodeURIComponent(id)}${action ? `/${action}` : ''}`, {
      headers: { 'X-Recovery-Context': context.secret }, ...(action ? { json: input ?? {} } : {}),
    }, false))
  }
}

function invalid(): never { throw new IamConfigurationError('Invalid identity response') }
export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function string(value: unknown): string { return typeof value === 'string' ? value : invalid() }
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid() }
function optional(value: unknown): string | null | undefined {
  return value == null ? value : string(value)
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalid() }
function strings(value: unknown): string[] { return array(value).map(string) }
function version(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid()
}
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  for (const choice of choices) if (value === choice) return choice
  return invalid()
}
export function parseIdentifiers(value: unknown): AccountIdentifiers {
  const v = record(value)
  const management = parseIdentifierManagement(v.management)
  const items = array(v.items).map(x => {
    const i = record(x)
    return { id: string(i.id), kind: oneOf(i.kind, ['EMAIL', 'PHONE', 'USERNAME']), displayValue: string(i.displayValue),
      status: oneOf(i.status, ['ACTIVE', 'INACTIVE']), verificationState: string(i.verificationState),
      verifiedAt: optional(i.verifiedAt), verificationSource: optional(i.verificationSource),
      isPrimary: boolean(i.isPrimary), managedBy: optional(i.managedBy), capabilities: parseIdentifierActions(i.capabilities) }
  })
  if (new Set(items.map(item => item.id)).size !== items.length) return invalid()
  for (const item of items) for (const capability of Object.values(item.capabilities)) {
    if (capability.allowed && !management.proofOptions.length) return invalid()
    if (capability.replacementPrimaryIds.some(id => !items.some(other => other.id === id && other.id !== item.id && other.kind === item.kind))) return invalid()
  }
  return { loginMethodVersion: version(v.loginMethodVersion), items, management }
}
export function parseMethods(value: unknown): AccountLoginMethods {
  const v = record(value)
  return { loginMethodVersion: version(v.loginMethodVersion), methods: array(v.methods).map(x => {
    const m = record(x)
    return { methodId: string(m.methodId), kind: string(m.kind),
      roles: array(m.roles).map(r => oneOf(r, ['FIRST_FACTOR', 'SECOND_FACTOR', 'RECOVERY'])),
      status: oneOf(m.status, ['AVAILABLE', 'UNAVAILABLE']), identifierId: optional(m.identifierId),
      credentialId: optional(m.credentialId), identityId: optional(m.identityId), providerId: optional(m.providerId),
      capabilities: Object.fromEntries(Object.entries(record(m.capabilities)).map(([k, v]) => [k, boolean(v)])),
      unavailableReasons: strings(m.unavailableReasons) }
  }) }
}
export function parseOperation(value: unknown): IdentityOperation {
  const v = record(value)
  const providerTarget = parseIdentityProviderTarget(v.providerTarget)
  if (providerTarget && (v.type !== 'LINK' || ['CANCELLED', 'EXPIRED', 'REJECTED'].includes(String(v.state)))) return invalid()
  return { id: string(v.id), type: oneOf(v.type, ['ADD', 'VERIFY', 'SET_PRIMARY', 'REMOVE', 'REPLACE', 'LINK', 'UNLINK', 'TRANSFER', 'ACCOUNT_DELETE']),
    state: oneOf(v.state, ['AWAITING_REAUTH', 'AWAITING_PROOF', 'READY', 'COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED']),
    expiresAt: string(v.expiresAt), requiredProofs: array(v.requiredProofs).map(x => {
      const p = record(x)
      return { purpose: oneOf(p.purpose, ['CURRENT_ACCOUNT', 'TARGET_OWNERSHIP', 'TRANSFER_COUNTERPART']), methods: strings(p.methods),
        strength: string(p.strength), satisfied: boolean(p.satisfied) }
    }), result: v.result == null ? v.result : Object.fromEntries(Object.entries(record(v.result)).map(([k,v]) => [k,string(v)])),
    completion: v.completion == null ? null : parseIdentityCompletion(v.completion),
    proofOptions: array(v.proofOptions).map(parseMfaProofOption),
    providerTarget,
    maskedIdentifier: optional(v.maskedIdentifier), nextChallengeAt: optional(v.nextChallengeAt) }
}
function parseIdentityCompletion(value: unknown) {
  const v = record(value)
  return { completedAt: string(v.completedAt), finalLoginMethodVersion: version(v.finalLoginMethodVersion), sessionImpact: oneOf(v.sessionImpact, ['UNCHANGED', 'CURRENT_SESSION_RETAINED', 'REAUTHENTICATE'] as const) }
}
export function parseRegistration(value: unknown): RegistrationOperation {
  const v = record(value)
  return { registrationId: string(v.registrationId), status: oneOf(v.status, ['PENDING_VERIFICATION', 'COMPLETED', 'CANCELLED', 'EXPIRED']),
    expiresAt: string(v.expiresAt), nextAction: oneOf(v.nextAction, ['VERIFY_EMAIL', 'LOGIN', 'RESTART']), nextChallengeAt: optional(v.nextChallengeAt) }
}
function parseAuthorization(value: unknown): IdentityProviderAuthorization {
  const v = record(value)
  return { authorizationId: string(v.authorizationId), authorizationUrl: string(v.authorizationUrl), expiresAt: string(v.expiresAt) }
}
function parseRecovery(value: unknown): RecoveryOperation {
  const v = record(value)
  return { id: string(v.id), method: oneOf(v.method, ['LOCAL_PASSWORD', 'PROVIDER', 'WEBAUTHN']), state: string(v.state),
    expiresAt: string(v.expiresAt), verificationEvidenceRef: string(v.verificationEvidenceRef),
    verifiedDeliveryChannelRef: string(v.verifiedDeliveryChannelRef), nextChallengeAt: optional(v.nextChallengeAt) }
}
