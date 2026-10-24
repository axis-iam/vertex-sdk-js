import { operationReference } from './server-session-client'
import type { OperationView } from './server-session-client'
import type {
  CreateIdentityOperation,
  IdentityProofPurpose,
  OperationReauthentication,
  TargetProofMethod,
} from '@axis-iam/vertex'
import { SessionInvalidatedError, SessionTransportError } from '@axis-iam/vertex'
import { IamApiError } from './types'
import type { AuthClient } from './auth-client'
import { ProviderOperationWindow } from './provider-operation-window'
import { generatePKCEPair } from './pkce'

export interface IdentityOperationSnapshot {
  operation: OperationView | null
  pending: boolean
  error: Error | null
  cancelUnconfirmed: boolean
  uncertainCreate: UncertainIdentityCreate | null
}
export interface UncertainIdentityCreate {
  request: CreateIdentityOperation
  idempotencyKey: string
}
const empty: IdentityOperationSnapshot = {
  operation: null,
  pending: false,
  error: null,
  cancelUnconfirmed: false,
  uncertainCreate: null,
}
function uncertainCreateError() {
  return new IamApiError(
    'Recover the original creation before starting another operation',
    { status: 409, code: 'CREATE_UNCONFIRMED' },
  )
}
function creationRejected(error: unknown) {
  if (!(error instanceof IamApiError) && !(error instanceof SessionTransportError)) return false
  // These producer errors occur before insertion, after idempotent replay lookup where applicable.
  return (
    (error.status === 400 &&
      [
        'INVALID_IDENTIFIER',
        'INVALID_IDENTIFIER_KIND',
        'INVALID_OPERATION_PAYLOAD',
      ].includes(error.code ?? '')) ||
    (error.status === 409 &&
      [
        'STALE_LOGIN_METHOD_VERSION',
        'IDENTITY_CONFLICT',
        'LAST_LOGIN_METHOD',
        'IDENTIFIER_UNVERIFIED',
      ].includes(error.code ?? ''))
  )
}
const stores = new WeakMap<AuthClient, IdentityOperationStore>()
export function identityOperationStore(
  client: AuthClient,
): IdentityOperationStore {
  let store = stores.get(client)
  if (!store) {
    store = new IdentityOperationStore(client)
    stores.set(client, store)
  }
  return store
}
/** Shared by prebuilt and Custom; retains an uncertain operation until GET resolves it. */
export class IdentityOperationStore {
  private generation: number
  private value = empty
  private listeners = new Set<() => void>()
  private authorization: {
    id: string
    verifier: string
    operationId: string
  } | null = null
  private providerWindow: ProviderOperationWindow | null = null
  private providerRevision = 0
  private savedKey: string | null = null
  private creation: { body: string; key: string } | null = null
  constructor(private readonly client: AuthClient) {
    this.generation = client.state.generation
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = (): IdentityOperationSnapshot => {
    if (this.generation !== this.client.state.generation) {
      if (this.savedKey && typeof sessionStorage !== 'undefined')
        sessionStorage.removeItem(this.savedKey)
      this.cancelProviderWindow()
      this.savedKey = null
      this.value = empty
      this.authorization = null
      this.creation = null
      this.generation = this.client.state.generation
    }
    return this.value
  }
  private update(value: IdentityOperationSnapshot) {
    this.value = value
    for (const listener of this.listeners) listener()
  }
  private async run(
    work: () => Promise<OperationView>,
    options: { cancelling?: boolean; creating?: boolean } = {},
  ) {
    const current = this.getSnapshot()
    if (current.pending)
      throw new IamApiError('An operation is pending', {
        status: 409,
        code: 'OPERATION_PENDING',
      })
    if (current.uncertainCreate && !options.creating)
      throw uncertainCreateError()
    const generation = this.generation
    this.update({ ...current, pending: true, error: null })
    try {
      const operation = await work()
      this.client.state.assertCurrent(generation)
      this.update({
        operation,
        pending: false,
        error: null,
        cancelUnconfirmed: false,
        uncertainCreate: null,
      })
      this.saveOperation(operation)
      if (
        ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(
          operation.state,
        )
      )
        this.cancelProviderWindow()
      if (operation.result?.sessionImpact === 'REAUTHENTICATE')
        this.client.state.clear()
      return operation
    } catch (error) {
      if (generation !== this.client.state.generation)
        throw new SessionInvalidatedError()
      this.update({
        ...this.value,
        pending: false,
        error:
          error instanceof Error
            ? error
            : new Error('Identity operation failed'),
        cancelUnconfirmed:
          Boolean(options.cancelling) || this.value.cancelUnconfirmed,
      })
      throw error
    }
  }
  private storageKey(): string | null {
    if (
      this.client.mode === 'server_session' ||
      this.client.config.tokenStorage !== 'sessionStorage' ||
      typeof sessionStorage === 'undefined'
    )
      return null
    const user = this.client.state.getUser()
    if (
      !user ||
      !user.authenticationContext.sessionId ||
      !user.authenticationContext.applicationId
    )
      return null
    return `axis_identity_operation:${this.client.config.issuerUri}:${this.client.clientId}:${user.authenticationContext.applicationId}:${user.id}:${user.authenticationContext.sessionId}`
  }
  private saveOperation(operation: OperationView) {
    this.savedKey = this.storageKey()
    if (!this.savedKey) return
    if (
      ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(
        operation.state,
      )
    )
      sessionStorage.removeItem(this.savedKey)
    else sessionStorage.setItem(this.savedKey, operationReference(operation))
  }
  resumeSaved = async () => {
    const existing = this.getSnapshot().operation
    const key = this.storageKey()
    const id = (existing ? operationReference(existing) : undefined) ?? (key ? sessionStorage.getItem(key) : null)
    if (id) return this.reopen(id)
    return null
  }
  private id() {
    const op = this.getSnapshot().operation
    if (!op)
      throw new IamApiError('Open an operation first', {
        status: 400,
        code: 'OPERATION_REQUIRED',
      })
    return operationReference(op)
  }
  create = (input: CreateIdentityOperation, idempotencyKey?: string) =>
    this.run(
      async () => {
        const body = JSON.stringify(input)
        if (
          this.creation &&
          (this.creation.body !== body ||
            (idempotencyKey !== undefined &&
              this.creation.key !== idempotencyKey))
        )
          throw uncertainCreateError()
        const op = this.value.operation
        if (
          op &&
          !['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(op.state)
        )
          throw new IamApiError('Resume or cancel the existing operation', {
            status: 409,
            code: 'OPERATION_PENDING',
          })
        const attempt = this.creation ?? {
          body,
          key: idempotencyKey ?? crypto.randomUUID(),
        }
        const generation = this.generation
        this.creation = attempt
        try {
          const result = await this.client.identity.create(
            JSON.parse(attempt.body) as CreateIdentityOperation,
            attempt.key,
          )
          this.client.state.assertCurrent(generation)
          this.creation = null
          return result
        } catch (error) {
          this.client.state.assertCurrent(generation)
          if (creationRejected(error)) {
            this.creation = null
            this.update({ ...this.value, uncertainCreate: null })
          } else {
            this.update({
              ...this.value,
              uncertainCreate: {
                request: JSON.parse(attempt.body) as CreateIdentityOperation,
                idempotencyKey: attempt.key,
              },
            })
          }
          throw error
        }
      },
      { creating: true },
    )
  retryCreate = async () => {
    this.getSnapshot()
    const attempt = this.creation
    if (!attempt)
      throw new IamApiError('No uncertain creation to recover', {
        status: 400,
        code: 'CREATE_NOT_PENDING',
      })
    return this.create(
      JSON.parse(attempt.body) as CreateIdentityOperation,
      attempt.key,
    )
  }
  reopen = (id?: string) =>
    this.run(() => {
      id = id ?? this.id()
      const op = this.value.operation
      if (
        op &&
        operationReference(op) !== id &&
        !['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(op.state)
      )
        throw new IamApiError('Resume or cancel the existing operation', {
          status: 409,
          code: 'OPERATION_PENDING',
        })
      return this.client.identity.get(id)
    })
  reauthenticate = (input: OperationReauthentication) =>
    this.run(() => this.client.identity.reauthenticate(this.id(), input))
  challenge = (method: TargetProofMethod) =>
    this.run(() => this.client.identity.challenge(this.id(), method))
  complete = (method?: TargetProofMethod, code?: string) =>
    this.run(() =>
      this.client.identity.complete(this.id(), {
        proofs:
          method && code ? [{ purpose: 'TARGET_OWNERSHIP', method, code }] : [],
      }),
    )
  cancel = () => {
    this.cancelProviderWindow()
    return this.run(() => this.client.identity.cancel(this.id()), {
      cancelling: true,
    })
  }
  confirmTransfer = (decision: 'ACCEPT' | 'REJECT') =>
    this.run(() => this.client.identity.confirmTransfer(this.id(), decision))
  cancelProviderWindow = () => {
    ++this.providerRevision
    this.providerWindow?.close()
    this.providerWindow = null
    this.authorization = null
  }
  async openProvider(
    purpose: IdentityProofPurpose,
    redirectUri: string,
    methodId?: string,
  ) {
    const generation = this.client.state.generation
    const operationId = this.id()
    this.cancelProviderWindow()
    const revision = this.providerRevision
    const assertOwner = () => {
      this.client.state.assertCurrent(generation)
      if (
        revision !== this.providerRevision ||
        (!this.value.operation || operationReference(this.value.operation) !== operationId)
      )
        throw new SessionInvalidatedError()
      if (
        Date.parse(this.value.operation.expiresAt) <= Date.now() ||
        ['CANCELLED', 'EXPIRED', 'REJECTED', 'COMMITTED'].includes(
          this.value.operation.state,
        )
      )
        throw new SessionInvalidatedError()
    }
    const popup = new ProviderOperationWindow(assertOwner)
    this.providerWindow = popup
    try {
      if (this.client.mode === 'server_session') {
        const result = await this.client.identity.openProvider(operationId, purpose, methodId)
        assertOwner()
        popup.navigateServer(result.authorizationUrl, this.client.config.sessionProviderReturnUri ?? '/settings/security', result.expiresAt)
        return result
      }
      const result = await this.authorize(purpose, redirectUri, methodId)
      assertOwner()
      popup.navigate({ ...result, redirectUri, operationId })
      return result
    } catch (error) {
      popup.close()
      this.authorization = null
      throw error
    }
  }
  async authorize(
    purpose: IdentityProofPurpose,
    redirectUri: string,
    methodId?: string,
  ) {
    if (this.client.mode === 'server_session') throw new IamApiError('Use server-owned provider authorization', { code: 'UNSUPPORTED_OPERATION' })
    const snapshot = this.getSnapshot()
    if (snapshot.pending)
      throw new IamApiError('An operation is pending', {
        status: 409,
        code: 'OPERATION_PENDING',
      })
    if (snapshot.uncertainCreate) throw uncertainCreateError()
    const generation = this.client.state.generation
    const operationId = this.id()
    this.update({ ...snapshot, pending: true, error: null })
    try {
      const pair = await generatePKCEPair()
      this.client.state.assertCurrent(generation)
      const result = await this.client.identity.authorize(operationId, {
        purpose,
        redirectUri,
        ...(methodId ? { methodId } : {}),
        codeChallenge: pair.codeChallenge,
        codeChallengeMethod: 'S256',
      })
      this.client.state.assertCurrent(generation)
      this.authorization = {
        id: result.authorizationId,
        verifier: pair.codeVerifier,
        operationId,
      }
      this.update({ ...this.value, pending: false })
      return result
    } catch (error) {
      this.client.state.assertCurrent(generation)
      this.update({
        ...this.value,
        pending: false,
        error:
          error instanceof Error
            ? error
            : new Error('Provider authorization failed'),
      })
      throw error
    }
  }
  providerCallback = () =>
    this.run(async () => {
      if (this.client.mode === 'server_session') {
        if (!this.providerWindow) throw new SessionInvalidatedError()
        const revision = this.providerRevision
        this.providerWindow.callbackUrl()
        const view = await this.client.identity.get(this.id())
        if (revision !== this.providerRevision) throw new SessionInvalidatedError()
        this.providerWindow?.callbackUrl()
        this.cancelProviderWindow()
        return view
      }
      const auth = this.authorization
      if (!auth || auth.operationId !== this.id())
        throw new IamApiError('Restart provider confirmation', {
          status: 400,
          code: 'PROOF_REVOKED',
        })
      if (!this.providerWindow)
        throw new IamApiError('Open the original provider window', {
          status: 400,
          code: 'PROOF_REVOKED',
        })
      this.providerWindow.callbackUrl()
      const revision = this.providerRevision
      const operation = await this.client.identity.get(this.id())
      if (revision !== this.providerRevision)
        throw new SessionInvalidatedError()
      this.providerWindow?.callbackUrl()
      if (
        ['CANCELLED', 'EXPIRED', 'REJECTED', 'COMMITTED'].includes(
          operation.state,
        ) ||
        Date.parse(operation.expiresAt) <= Date.now()
      ) {
        this.cancelProviderWindow()
        throw new SessionInvalidatedError()
      }
      const result = await this.client.identity.providerCallback(
        this.id(),
        auth.id,
        auth.verifier,
      )
      if (revision !== this.providerRevision)
        throw new SessionInvalidatedError()
      this.cancelProviderWindow()
      return result
    })
}
