export type MfaOperationType =
  | 'TOTP_ENROLL'
  | 'TOTP_DISABLE'
  | 'RECOVERY_CODES_GENERATE'

export type MfaOperationState =
  | 'AWAITING_REAUTH'
  | 'AWAITING_CONFIRMATION'
  | 'READY'
  | 'COMMITTED'
  | 'CANCELLED'
  | 'EXPIRED'

export type MfaProofRequirement =
  | 'SESSION'
  | 'REAUTHENTICATION'
  | 'STEP_UP'

export type MfaOperationProofMethod =
  | 'PASSWORD'
  | 'EMAIL_OTP'
  | 'PROVIDER'
  | 'STEP_UP_PROOF'

export type MfaStepUpMethod = 'TOTP' | 'WEBAUTHN'

export type MfaSessionImpact =
  | 'UNCHANGED'
  | 'CURRENT_SESSION_RETAINED'
  | 'REAUTHENTICATE'

export type MfaProofOption =
  | {
      method: 'PASSWORD'
      identifierId: null
      maskedIdentifier: null
      methodId: null
      displayName: null
      availableMethods: []
    }
  | {
      method: 'EMAIL_OTP'
      identifierId: string
      maskedIdentifier: string
      methodId: null
      displayName: null
      availableMethods: []
    }
  | {
      method: 'PROVIDER'
      identifierId: null
      maskedIdentifier: null
      methodId: string
      displayName: string
      availableMethods: []
    }
  | {
      method: 'STEP_UP_PROOF'
      identifierId: null
      maskedIdentifier: null
      methodId: null
      displayName: null
      availableMethods: MfaStepUpMethod[]
    }

export interface MfaActionCapability {
  allowed: boolean
  reasonCode: string | null
  proofRequirement: MfaProofRequirement
  proofOptions: MfaProofOption[]
}

export interface MfaCapabilities {
  loginMethodVersion: number
  totpEnroll: MfaActionCapability
  totpDisable: MfaActionCapability
  recoveryCodesGenerate: MfaActionCapability
}

export interface MfaOperationResult {
  completedAt: string
  finalLoginMethodVersion: number
  sessionImpact: MfaSessionImpact
  recoveryBatchId: string | null
  recoveryCount: number | null
}

export interface MfaOperation {
  /**
   * BFF consumers receive an opaque ref. OAuth consumers receive the upstream
   * operation identifier through the same field; no verifier or token is exposed.
   */
  ref: string
  type: MfaOperationType
  state: MfaOperationState
  createdAt: string
  expiresAt: string
  expectedLoginMethodVersion: number
  proofRequirement: MfaProofRequirement
  proofOptions: MfaProofOption[]
  proofSatisfied: boolean
  nextChallengeAt: string | null
  reasonCode: string | null
  result: MfaOperationResult | null
}

export type MfaDelivery = 'AVAILABLE' | 'ALREADY_DELIVERED' | 'NOT_APPLICABLE'

export interface MfaTotpMaterial {
  secret: string
  qrCodeUri: string
  issuer: string
}

export interface MfaTotpBeginResult {
  operation: MfaOperation
  delivery: MfaDelivery
  material?: MfaTotpMaterial
}

export interface MfaRecoveryCodes {
  codes: string[]
  count: number
}

export interface MfaCompletionResult {
  operation: MfaOperation
  delivery: MfaDelivery
  recoveryCodes?: MfaRecoveryCodes
}

export interface MfaOperationChallengeResult {
  operation: MfaOperation
  challengeRef: string
  nextChallengeAt: string
}

export interface MfaOperationStepUpResult {
  challengeRef: string
  availableMethods: MfaStepUpMethod[]
}

export interface MfaOperationWebAuthnStartResult {
  requestRef: string
  publicKey: string
}

export type MfaOperationReauthentication =
  | { method: 'PASSWORD'; password: string }
  | { method: 'EMAIL_OTP'; challengeRef: string; code: string }

export interface MfaOperationAuthorizeInput {
  methodId: string
}

export interface MfaOperationProviderAuthorization {
  ref: string
  authorizationUrl: string
  expiresAt: string
}

export interface MfaOperationClient {
  getRecoveryCodesRemaining(): Promise<number>
  getMfaCapabilities(): Promise<MfaCapabilities>
  createMfaOperation(
    type: MfaOperationType,
    expectedLoginMethodVersion: number,
    requestId?: string,
  ): Promise<MfaOperation>
  getMfaOperation(ref: string): Promise<MfaOperation>
  reauthenticateMfaOperation(
    ref: string,
    input: MfaOperationReauthentication,
  ): Promise<MfaOperation>
  challengeMfaOperation(
    ref: string,
    identifierId: string,
  ): Promise<MfaOperationChallengeResult>
  authorizeMfaOperation(
    ref: string,
    input: MfaOperationAuthorizeInput,
  ): Promise<MfaOperationProviderAuthorization>
  completeMfaProviderAuthorization(ref: string): Promise<MfaOperation>
  startMfaOperationStepUp(ref: string): Promise<MfaOperationStepUpResult>
  verifyMfaOperationStepUp(
    ref: string,
    challengeRef: string,
    code: string,
  ): Promise<MfaOperation>
  startMfaOperationWebAuthn(
    ref: string,
    challengeRef: string,
  ): Promise<MfaOperationWebAuthnStartResult>
  verifyMfaOperationWebAuthn(
    ref: string,
    challengeRef: string,
    requestRef: string,
    credential: string,
  ): Promise<MfaOperation>
  beginTotpEnrollmentOperation(ref: string): Promise<MfaTotpBeginResult>
  completeMfaOperation(
    ref: string,
    code?: string,
  ): Promise<MfaCompletionResult>
  cancelMfaOperation(ref: string): Promise<MfaOperation>
}

export class MfaOperationResponseError extends Error {
  constructor(message = 'Invalid MFA operation response') {
    super(message)
    this.name = 'MfaOperationResponseError'
  }
}

function invalid(): never {
  throw new MfaOperationResponseError()
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid()
  }
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : invalid()
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value)
}

function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid()
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid()
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  const matched = values.find((item) => item === value)
  return matched === undefined ? invalid() : matched
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid()
}

export type MfaOperationMode = 'oauth_tokens' | 'server_session'

export function mfaOperationReference(value: unknown, mode: MfaOperationMode): string {
  const result = text(value)
  if (mode === 'server_session' ? !/^[A-Za-z0-9_-]{43}$/.test(result) : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) invalid()
  return result
}

function instant(value: unknown): string {
  const result = text(value)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) invalid()
  return result
}

function noSecrets(v: Record<string, unknown>) {
  for (const key of ['secret', 'qrCodeUri', 'codes', 'recoveryCodes', 'material', 'password', 'code', 'controlSecret', 'codeVerifier', 'access_token', 'authorizationId']) {
    if (key in v) invalid()
  }
}

/** Irrelevant nullable DTO fields may be omitted by the producer's JSON policy. */
export function parseMfaProofOption(value: unknown): MfaProofOption {
  const v = record(value)
  noSecrets(v)
  const method = oneOf(v.method, ['PASSWORD', 'EMAIL_OTP', 'PROVIDER', 'STEP_UP_PROOF'] as const)
  const identifierId = nullableText(v.identifierId)
  const maskedIdentifier = nullableText(v.maskedIdentifier)
  const methodId = nullableText(v.methodId)
  const displayName = nullableText(v.displayName)
  const availableMethods = v.availableMethods == null ? [] : list(v.availableMethods).map((item) => oneOf(item, ['TOTP', 'WEBAUTHN'] as const))
  if (new Set(availableMethods).size !== availableMethods.length) invalid()
  if (method === 'PASSWORD') {
    if (identifierId !== null || maskedIdentifier !== null || methodId !== null || displayName !== null || availableMethods.length) invalid()
    return { method, identifierId: null, maskedIdentifier: null, methodId: null, displayName: null, availableMethods: [] }
  }
  if (method === 'EMAIL_OTP') {
    if (identifierId === null || maskedIdentifier === null || methodId !== null || displayName !== null || availableMethods.length) invalid()
    return { method, identifierId, maskedIdentifier, methodId: null, displayName: null, availableMethods: [] }
  }
  if (method === 'PROVIDER') {
    if (identifierId !== null || maskedIdentifier !== null || methodId === null || displayName === null || availableMethods.length) invalid()
    return { method, identifierId: null, maskedIdentifier: null, methodId, displayName, availableMethods: [] }
  }
  if (identifierId !== null || maskedIdentifier !== null || methodId !== null || displayName !== null || !availableMethods.length) invalid()
  return { method, identifierId: null, maskedIdentifier: null, methodId: null, displayName: null, availableMethods }
}

function parseResult(value: unknown): MfaOperationResult {
  const v = record(value)
  noSecrets(v)
  return {
    completedAt: instant(v.completedAt),
    finalLoginMethodVersion: integer(v.finalLoginMethodVersion),
    sessionImpact: oneOf(v.sessionImpact, ['UNCHANGED', 'CURRENT_SESSION_RETAINED', 'REAUTHENTICATE'] as const),
    recoveryBatchId: nullableText(v.recoveryBatchId),
    recoveryCount: v.recoveryCount === null || v.recoveryCount === undefined ? null : integer(v.recoveryCount),
  }
}

export function parseMfaOperation(value: unknown, mode: MfaOperationMode = 'server_session'): MfaOperation {
  const v = record(value)
  noSecrets(v)
  if (mode === 'server_session' ? 'id' in v : 'ref' in v) invalid()
  const ref = mode === 'server_session' ? v.ref : v.id
  const operation: MfaOperation = {
    ref: mfaOperationReference(ref, mode),
    type: oneOf(v.type, ['TOTP_ENROLL', 'TOTP_DISABLE', 'RECOVERY_CODES_GENERATE'] as const),
    state: oneOf(v.state, ['AWAITING_REAUTH', 'AWAITING_CONFIRMATION', 'READY', 'COMMITTED', 'CANCELLED', 'EXPIRED'] as const),
    createdAt: instant(v.createdAt),
    expiresAt: instant(v.expiresAt),
    expectedLoginMethodVersion: integer(v.expectedLoginMethodVersion),
    proofRequirement: oneOf(v.proofRequirement, ['SESSION', 'REAUTHENTICATION', 'STEP_UP'] as const),
    proofOptions: list(v.proofOptions).map(parseMfaProofOption),
    proofSatisfied: boolean(v.proofSatisfied),
    nextChallengeAt: v.nextChallengeAt == null ? null : instant(v.nextChallengeAt),
    reasonCode: nullableText(v.reasonCode),
    result: v.result === null || v.result === undefined ? null : parseResult(v.result),
  }
  if (Date.parse(operation.expiresAt) <= Date.parse(operation.createdAt)) invalid()
  if ((operation.state === 'COMMITTED') !== (operation.result !== null)) invalid()
  if (operation.result) {
    const expected: MfaSessionImpact = operation.type === 'TOTP_ENROLL' ? 'CURRENT_SESSION_RETAINED' : operation.type === 'TOTP_DISABLE' ? 'REAUTHENTICATE' : 'UNCHANGED'
    if (operation.result.sessionImpact !== expected) invalid()
    if (operation.type === 'RECOVERY_CODES_GENERATE' ? operation.result.recoveryBatchId === null || operation.result.recoveryCount === null : operation.result.recoveryBatchId !== null || operation.result.recoveryCount !== null) invalid()
  }
  return operation
}

export function parseMfaCapabilities(value: unknown): MfaCapabilities {
  const v = record(value)
  return {
    loginMethodVersion: integer(v.loginMethodVersion),
    totpEnroll: parseActionCapability(v.totpEnroll),
    totpDisable: parseActionCapability(v.totpDisable),
    recoveryCodesGenerate: parseActionCapability(v.recoveryCodesGenerate),
  }
}

function parseActionCapability(value: unknown): MfaActionCapability {
  const v = record(value)
  return {
    allowed: boolean(v.allowed),
    reasonCode: nullableText(v.reasonCode),
    proofRequirement: oneOf(v.proofRequirement, ['SESSION', 'REAUTHENTICATION', 'STEP_UP'] as const),
    proofOptions: list(v.proofOptions).map(parseMfaProofOption),
  }
}

export function parseMfaTotpBeginResult(value: unknown, mode: MfaOperationMode = 'server_session'): MfaTotpBeginResult {
  const v = record(value)
  const material = v.material === null || v.material === undefined
    ? undefined
    : parseTotpMaterial(v.material)
  const operation = parseMfaOperation(v.operation, mode)
  const delivery = oneOf(v.delivery, ['AVAILABLE', 'ALREADY_DELIVERED', 'NOT_APPLICABLE'] as const)
  if (operation.type !== 'TOTP_ENROLL' || (delivery === 'AVAILABLE') !== Boolean(material) || (material && operation.state !== 'AWAITING_CONFIRMATION')) invalid()
  return { operation, delivery, ...(material ? { material } : {}) }
}

export function parseMfaCompletionResult(value: unknown, mode: MfaOperationMode = 'server_session'): MfaCompletionResult {
  const v = record(value)
  const codes = v.recoveryCodes === null || v.recoveryCodes === undefined
    ? undefined
    : parseRecoveryCodes(v.recoveryCodes)
  const operation = parseMfaOperation(v.operation, mode)
  const delivery = oneOf(v.delivery, ['AVAILABLE', 'ALREADY_DELIVERED', 'NOT_APPLICABLE'] as const)
  if ((delivery === 'AVAILABLE') !== Boolean(codes) || (codes && (operation.type !== 'RECOVERY_CODES_GENERATE' || operation.state !== 'COMMITTED' || operation.result?.recoveryCount !== codes.count))) invalid()
  return { operation, delivery, ...(codes ? { recoveryCodes: codes } : {}) }
}

function parseTotpMaterial(value: unknown): MfaTotpMaterial {
  const v = record(value)
  return { secret: text(v.secret), qrCodeUri: text(v.qrCodeUri), issuer: text(v.issuer) }
}

function parseRecoveryCodes(value: unknown): MfaRecoveryCodes {
  const v = record(value)
  const codes = list(v.codes).map(text)
  const count = integer(v.count)
  if (codes.length !== count) return invalid()
  return { codes, count }
}

export function parseMfaChallengeResult(value: unknown, mode: MfaOperationMode = 'server_session'): MfaOperationChallengeResult {
  const v = record(value)
  return {
    operation: parseMfaOperation(v.operation, mode),
    challengeRef: mode === 'server_session' ? mfaOperationReference(v.challengeRef, mode) : text(v.challengeId),
    nextChallengeAt: instant(v.nextChallengeAt),
  }
}

export function parseMfaStepUpResult(value: unknown, mode: MfaOperationMode = 'server_session'): MfaOperationStepUpResult {
  const v = record(value)
  noSecrets(v)
  const availableMethods = list(v.availableMethods).map((item) => oneOf(item, ['TOTP', 'WEBAUTHN'] as const))
  if (!availableMethods.length || new Set(availableMethods).size !== availableMethods.length) invalid()
  return {
    challengeRef: mode === 'server_session' ? mfaOperationReference(v.challengeRef, mode) : text(v.challengeId),
    availableMethods,
  }
}

export function parseMfaWebAuthnStartResult(value: unknown, mode: MfaOperationMode = 'server_session'): MfaOperationWebAuthnStartResult {
  const v = record(value)
  return { requestRef: mode === 'server_session' ? mfaOperationReference(v.requestRef, mode) : text(v.requestId), publicKey: text(v.publicKey) }
}

export function parseMfaProviderAuthorization(value: unknown): MfaOperationProviderAuthorization {
  const v = record(value)
  return { ref: text(v.ref), authorizationUrl: text(v.authorizationUrl), expiresAt: instant(v.expiresAt) }
}

export function parseMfaRecoveryCodes(value: unknown): MfaRecoveryCodes {
  return parseRecoveryCodes(value)
}

/** Creates a non-secret 43-character browser request reference for BFF idempotency. */
export function createMfaOperationRequestId(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new MfaOperationResponseError('Secure random values are unavailable')
  }
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  if (typeof btoa !== 'function') {
    throw new MfaOperationResponseError('Base64 encoding is unavailable')
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
