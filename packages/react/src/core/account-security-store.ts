import { createMfaOperationRequestId, MfaOperationResponseError, SessionInvalidatedError, SessionTransportError } from '@axis-iam/vertex'
import type { MfaOperation, MfaOperationType, MfaTotpMaterial, MfaRecoveryCodes, MfaOperationReauthentication, MfaStepUpMethod } from '@axis-iam/vertex'
import type { AuthClient } from './auth-client'
import { IamApiError } from './types'
import { assertIdentityWebAuthn } from './identity-webauthn'
import { readSecurityReceipt, receiptKey, receiptStorage, sameSecurityOwner, securityOwner } from './account-security-receipt'
import type { AccountSecurityReceipt, SecurityOwner } from './account-security-receipt'

export interface AccountSecurityOperationState {
  recoveryReceipt: AccountSecurityReceipt | null
  operation: MfaOperation | null
  pending: boolean
  error: Error | null
  uncertain: boolean
  uncertainCreate: { type: MfaOperationType; version: number; requestId: string } | null
  material: MfaTotpMaterial | null
  recoveryCodes: MfaRecoveryCodes | null
  challengeRef: string | null
  availableMethods: MfaStepUpMethod[]
  materialUnavailable: boolean
  recoveryCodesUnavailable: boolean
}
const initial = (): AccountSecurityOperationState => ({ recoveryReceipt: null, operation: null, pending: false, error: null, uncertain: false, uncertainCreate: null, material: null, recoveryCodes: null, challengeRef: null, availableMethods: [], materialUnavailable: false, recoveryCodesUnavailable: false })
const terminal = (op: MfaOperation) => ['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(op.state)
const failure = (code: string) => new IamApiError('Account security operation cannot continue', { code, status: 409 })
const definite = (e: unknown) => (e instanceof IamApiError || e instanceof SessionTransportError) && e.status !== undefined && e.status >= 400 && e.status < 500 && ![401, 408].includes(e.status)
const stores = new WeakMap<AuthClient, AccountSecurityStore>()
export function accountSecurityStore(client: AuthClient) {
  let store = stores.get(client)
  if (!store) { store = new AccountSecurityStore(client); stores.set(client, store) }
  return store
}

/** One owner-scoped state machine for Embedded, Dialog, AccountCenter and Headless. */
export class AccountSecurityStore {
  private value = initial()
  private generation: number
  private owner: SecurityOwner | null
  private revision = 0
  private listeners = new Set<() => void>()
  private expiry: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly client: AuthClient) {
    this.generation = client.state.generation
    this.owner = securityOwner(client)
    const recoveryReceipt = readSecurityReceipt(client)
    this.update({ ...initial(), recoveryReceipt, uncertain: recoveryReceipt !== null })
    client.state.subscribe(() => this.syncOwner())
  }
  private syncOwner() {
    const owner = securityOwner(this.client)
    let receipt = this.value.recoveryReceipt
    const changed = this.generation !== this.client.state.generation
    if (changed) {
      const reason = this.client.state.invalidationReason
      const op = this.value.operation
      if (reason === 'unauthorized' && op && !terminal(op) && this.owner && (this.value.pending || this.value.uncertain))
        receipt = { ...this.owner, ref: op.ref, type: op.type, expiresAt: op.expiresAt, expectedLoginMethodVersion: op.expectedLoginMethodVersion }
      else if (reason !== 'replaced' && reason !== 'unauthorized') receipt = null
    }
    if (receipt && (receipt.issuer !== this.client.config.issuerUri || receipt.clientId !== this.client.clientId || receipt.mode !== this.client.mode ||
      Date.parse(receipt.expiresAt) <= Date.now() || (owner && !sameSecurityOwner(receipt, owner)))) receipt = null
    this.owner = owner
    if (!changed && receipt === this.value.recoveryReceipt) return
    this.generation = this.client.state.generation
    ++this.revision
    this.client.accountSecurity.cancelProviderWindow()
    if (!receipt) this.removeSavedReceipt()
    this.update({ ...initial(), recoveryReceipt: receipt, uncertain: receipt !== null })
  }
  private removeSavedReceipt() { receiptStorage()?.removeItem(receiptKey(this.client)) }
  /** Explicit sign-in handoff stores only the bound, expiring read receipt. */
  prepareReauthentication = () => {
    const receipt = this.getSnapshot().recoveryReceipt
    if (!receipt) throw failure('RECEIPT_REQUIRED')
    const storage = receiptStorage()
    if (!storage) throw failure('RECEIPT_STORAGE_UNAVAILABLE')
    storage.setItem(receiptKey(this.client), JSON.stringify(receipt))
    return { ref: receipt.ref, type: receipt.type }
  }
  /** This forgets local status tracking, not a server cancellation. */
  discardReceipt = () => {
    const current = this.getSnapshot()
    if (current.pending) throw failure('OPERATION_PENDING')
    if (!current.recoveryReceipt) throw failure('RECEIPT_REQUIRED')
    ++this.revision
    this.removeSavedReceipt()
    this.update(initial())
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => { this.syncOwner(); return this.value }
  private update(next: AccountSecurityOperationState) {
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = null
    this.value = next
    const op = next.operation
    if (!op && next.recoveryReceipt) {
      const remaining = Date.parse(next.recoveryReceipt.expiresAt) - Date.now()
      this.expiry = setTimeout(() => this.syncOwner(), Math.min(Math.max(remaining, 0), 2147483647))
    } else if (op && !terminal(op)) {
      const remaining = Date.parse(op.expiresAt) - Date.now()
      if (remaining <= 0) {
        this.value = { ...next, operation: { ...op, state: 'EXPIRED' }, pending: false, uncertain: true, material: null, recoveryCodes: null, challengeRef: null, availableMethods: [] }
        this.client.accountSecurity.cancelProviderWindow()
      } else this.expiry = setTimeout(() => {
        ++this.revision
        this.client.accountSecurity.cancelProviderWindow()
        this.update({ ...this.value, operation: { ...op, state: 'EXPIRED' }, pending: false, uncertain: true, material: null, recoveryCodes: null, challengeRef: null, availableMethods: [] })
      }, remaining)
    }
    for (const listener of this.listeners) listener()
  }
  private ref() {
    const snapshot = this.getSnapshot()
    const op = snapshot.operation ?? snapshot.recoveryReceipt
    if (!op) throw failure('OPERATION_REQUIRED')
    return op.ref
  }
  private async run(work: () => Promise<Partial<AccountSecurityOperationState> & { operation?: MfaOperation }>, kind: 'mutation' | 'query' | 'create' | 'cancel' = 'mutation') {
    const current = this.getSnapshot()
    if (current.pending) throw failure('OPERATION_PENDING')
    if (current.recoveryReceipt && kind !== 'query') throw failure('RECEIPT_READ_ONLY')
    if (current.recoveryReceipt) {
      const owner = securityOwner(this.client)
      if (!owner || !sameSecurityOwner(owner, current.recoveryReceipt)) throw failure('REAUTHENTICATION_REQUIRED')
    }
    if (kind === 'mutation' && (current.uncertain || current.uncertainCreate)) throw failure('OPERATION_UNCERTAIN')
    if (kind === 'mutation' && (!current.operation || terminal(current.operation))) throw failure('OPERATION_NOT_ACTIVE')
    const generation = this.generation, revision = this.revision
    this.update({ ...current, pending: true, error: null })
    try {
      const patch = await work()
      this.client.state.assertCurrent(generation)
      if (revision !== this.revision) throw new SessionInvalidatedError()
      if (current.recoveryReceipt && (!patch.operation || !terminal(patch.operation) ||
        patch.operation.ref !== current.recoveryReceipt.ref || patch.operation.type !== current.recoveryReceipt.type ||
        patch.operation.expectedLoginMethodVersion !== current.recoveryReceipt.expectedLoginMethodVersion)) throw failure('RECEIPT_NOT_TERMINAL')
      if (kind !== 'create' && patch.operation && current.operation && patch.operation.ref === current.operation.ref &&
        (patch.operation.type !== current.operation.type || patch.operation.expectedLoginMethodVersion !== current.operation.expectedLoginMethodVersion)) throw new MfaOperationResponseError()
      const next = { ...this.value, ...patch, pending: false, error: null, uncertain: false }
      const op = next.operation
      if (op && terminal(op)) {
        next.material = null
        next.challengeRef = null
        next.availableMethods = []
        this.client.accountSecurity.cancelProviderWindow()
      }
      if (op && op.state !== 'AWAITING_CONFIRMATION') next.material = null
      next.materialUnavailable = op?.state === 'AWAITING_CONFIRMATION' && next.material === null
      next.recoveryCodesUnavailable = op?.state === 'COMMITTED' && op.type === 'RECOVERY_CODES_GENERATE' && next.recoveryCodes === null
      this.update(next)
      return op
    } catch (e) {
      if (generation !== this.client.state.generation || revision !== this.revision) throw new SessionInvalidatedError()
      this.update({ ...this.value, pending: false, uncertain: kind === 'query' ? this.value.uncertain : !definite(e), error: e instanceof Error ? e : failure('SECURITY_OPERATION_FAILED') })
      throw e
    }
  }
  create = (type: MfaOperationType, version: number) => {
    const current = this.getSnapshot()
    if (current.recoveryReceipt) return Promise.reject(failure('RECEIPT_READ_ONLY'))
    if (current.uncertain || current.uncertainCreate || (current.operation && !terminal(current.operation))) return Promise.reject(failure('OPERATION_PENDING'))
    const attempt = { type, version, requestId: createMfaOperationRequestId() }
    return this.createAttempt(attempt)
  }
  private createAttempt(attempt: NonNullable<AccountSecurityOperationState['uncertainCreate']>) {
    return this.run(async () => {
      this.update({ ...this.value, uncertainCreate: attempt, material: null, recoveryCodes: null })
      const generation = this.generation, revision = this.revision
      try {
        const operation = await this.client.createMfaOperation(attempt.type, attempt.version, attempt.requestId)
        return { operation, uncertainCreate: null, material: null, recoveryCodes: null }
      } catch (e) {
        this.client.state.assertCurrent(generation)
        if (revision !== this.revision) throw new SessionInvalidatedError()
        if (definite(e)) this.update({ ...this.value, uncertainCreate: null })
        throw e
      }
    }, 'create')
  }
  retryCreate = () => {
    const attempt = this.getSnapshot().uncertainCreate
    return attempt ? this.createAttempt(attempt) : Promise.reject(failure('CREATE_NOT_PENDING'))
  }
  query = (ref = this.ref()) => {
    const current = this.getSnapshot()
    if (current.recoveryReceipt && current.recoveryReceipt.ref !== ref) return Promise.reject(failure('RECEIPT_REFERENCE_MISMATCH'))
    if (current.uncertainCreate || (current.operation && current.operation.ref !== ref && (!terminal(current.operation) || current.uncertain))) return Promise.reject(failure('OPERATION_PENDING'))
    return this.run(async () => ({ operation: await this.client.getMfaOperation(ref) }), 'query')
  }
  reauthenticate = (proof: MfaOperationReauthentication) => this.run(async () => ({ operation: await this.client.reauthenticateMfaOperation(this.ref(), proof) }))
  challenge = (identifierId: string) => this.run(async () => {
    const result = await this.client.challengeMfaOperation(this.ref(), identifierId)
    return { operation: result.operation, challengeRef: result.challengeRef }
  })
  startStepUp = () => this.run(async () => {
    const result = await this.client.startMfaOperationStepUp(this.ref())
    return { challengeRef: result.challengeRef, availableMethods: result.availableMethods }
  })
  verifyTotp = (code: string) => this.run(async () => {
    const ref = this.value.challengeRef
    if (!ref) throw failure('CHALLENGE_REQUIRED')
    return { operation: await this.client.verifyMfaOperationStepUp(this.ref(), ref, code) }
  })
  verifyWebAuthn = () => this.run(async () => {
    const challenge = this.value.challengeRef
    if (!challenge) throw failure('CHALLENGE_REQUIRED')
    const ref = this.ref(), generation = this.generation, revision = this.revision
    const start = await this.client.startMfaOperationWebAuthn(ref, challenge)
    this.client.state.assertCurrent(generation)
    const credential = await assertIdentityWebAuthn(start.publicKey)
    this.client.state.assertCurrent(generation)
    if (revision !== this.revision) throw new SessionInvalidatedError()
    return { operation: await this.client.verifyMfaOperationWebAuthn(ref, challenge, start.requestRef, credential) }
  })
  authorizeProvider = (methodId: string) => this.run(async () => {
    await this.client.authorizeMfaOperation(this.ref(), { methodId })
    return {}
  })
  providerCallback = () => this.run(async () => ({ operation: await this.client.completeMfaProviderAuthorization(this.ref()) }))
  resetProof = () => {
    const current = this.getSnapshot()
    if (current.recoveryReceipt) throw failure('RECEIPT_READ_ONLY')
    if (current.pending || current.uncertain) throw failure('OPERATION_PENDING')
    this.client.accountSecurity.cancelProviderWindow()
    this.update({ ...current, challengeRef: null, availableMethods: [], error: null })
  }
  begin = () => this.run(async () => {
    const result = await this.client.beginTotpEnrollmentOperation(this.ref())
    return { operation: result.operation, material: result.material ?? null }
  })
  complete = (code?: string) => this.run(async () => {
    const result = await this.client.completeMfaOperation(this.ref(), code)
    return { operation: result.operation, material: null, recoveryCodes: result.recoveryCodes ?? null }
  })
  cancel = () => {
    this.clearSensitive()
    return this.run(async () => ({ operation: await this.client.cancelMfaOperation(this.ref()), recoveryCodes: null }), 'cancel')
  }
  /** Closing never claims server cancellation; the receipt stays available for status/cancel. */
  clearSensitive = () => {
    this.syncOwner()
    ++this.revision
    this.client.accountSecurity.cancelProviderWindow()
    this.update({ ...this.value, pending: false, uncertain: this.value.uncertain || this.value.pending, material: null, recoveryCodes: null, challengeRef: null, availableMethods: [] })
  }
  /** Call only after presenting the definitive result; no implicit logout hides success. */
  acknowledge = () => {
    const current = this.getSnapshot(), op = current.operation
    if (current.pending || current.uncertain || current.uncertainCreate) throw failure('OPERATION_UNCERTAIN')
    if (!op || !terminal(op)) throw failure('OPERATION_NOT_TERMINAL')
    const reauthenticate = !current.recoveryReceipt && op.result?.sessionImpact === 'REAUTHENTICATE'
    this.clearSensitive()
    this.removeSavedReceipt()
    this.update(initial())
    if (reauthenticate) this.client.state.clear()
    return reauthenticate
  }
}
