import { AuthenticationTransactionError } from './authentication-transaction.js'

export interface PendingAuthorization {
  version: 1
  issuer: string
  clientId: string
  redirectUri: string
  entryMode: 'CUSTOM' | 'HOSTED'
  flowOwner: string
  verifier: string
  state: string
  expiresAt: string
  /** Hosted OpenID correlation; absent only for non-OpenID authorization. */
  nonce?: string
  transactionId?: string
  controlSecret?: string
}
const KEY = 'axis_iam_pending_authorization'
const secret = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const fail = (code: string): never => {
  throw new AuthenticationTransactionError(code)
}

/** One tab-local, bounded navigation capability; never an ordinary token store. */
export class PendingAuthorizationStore {
  static save(pending: PendingAuthorization): void {
    this.validate(pending)
    try {
      sessionStorage.setItem(KEY, JSON.stringify(pending))
    } catch {
      fail('AUTH_PENDING_STORAGE_UNAVAILABLE')
    }
  }
  static read(
    binding: Pick<
      PendingAuthorization,
      'issuer' | 'clientId' | 'redirectUri'
    > & { entryMode?: PendingAuthorization['entryMode'] },
  ): PendingAuthorization {
    let raw: string | null
    try {
      raw = sessionStorage.getItem(KEY)
    } catch {
      return fail('AUTH_PENDING_STORAGE_UNAVAILABLE')
    }
    if (!raw) return fail('AUTH_CONTROL_LOST')
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return fail('AUTH_CONTROL_LOST')
    }
    const pending = this.validate(value)
    if (
      pending.issuer !== binding.issuer ||
      pending.clientId !== binding.clientId ||
      pending.redirectUri !== binding.redirectUri ||
      (binding.entryMode !== undefined &&
        pending.entryMode !== binding.entryMode)
    )
      fail('AUTH_CONTROL_LOST')
    return { ...pending }
  }
  static remove(flowOwner: string): void {
    try {
      const raw = sessionStorage.getItem(KEY)
      if (!raw) return
      const value: unknown = JSON.parse(raw)
      if (
        value &&
        typeof value === 'object' &&
        'flowOwner' in value &&
        value.flowOwner === flowOwner
      )
        sessionStorage.removeItem(KEY)
    } catch {
      fail('AUTH_PENDING_STORAGE_UNAVAILABLE')
    }
  }
  /** A consumed callback cannot commit over a newer navigation owner. */
  static assertNoReplacement(): void {
    try {
      if (sessionStorage.getItem(KEY) !== null) fail('AUTH_CONTROL_LOST')
    } catch (error) {
      if (error instanceof AuthenticationTransactionError) throw error
      fail('AUTH_PENDING_STORAGE_UNAVAILABLE')
    }
  }
  static discard(
    binding: Pick<PendingAuthorization, 'issuer' | 'clientId'>,
  ): void {
    if (typeof sessionStorage === 'undefined') return
    try {
      const raw = sessionStorage.getItem(KEY)
      if (!raw) return
      const value: unknown = JSON.parse(raw)
      if (
        value &&
        typeof value === 'object' &&
        'clientId' in value &&
        'issuer' in value &&
        value.clientId === binding.clientId &&
        typeof value.issuer === 'string' &&
        new URL(value.issuer).href === new URL(binding.issuer).href
      )
        sessionStorage.removeItem(KEY)
    } catch {
      fail('AUTH_PENDING_STORAGE_UNAVAILABLE')
    }
  }
  private static validate(value: unknown): PendingAuthorization {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return fail('AUTH_CONTROL_LOST')
    const p = value as Record<string, unknown>
    if (
      Object.keys(p).some(
        (key) =>
          ![
            'version',
            'issuer',
            'clientId',
            'redirectUri',
            'entryMode',
            'flowOwner',
            'verifier',
            'state',
            'expiresAt',
            'nonce',
            'transactionId',
            'controlSecret',
          ].includes(key),
      ) ||
      p.version !== 1 ||
      !['CUSTOM', 'HOSTED'].includes(String(p.entryMode)) ||
      !['issuer', 'clientId', 'redirectUri', 'expiresAt'].every(
        (key) => typeof p[key] === 'string' && Boolean(p[key]),
      ) ||
      !['flowOwner', 'verifier', 'state'].every(
        (key) => typeof p[key] === 'string' && secret.test(p[key]),
      ) ||
      !Number.isFinite(Date.parse(String(p.expiresAt))) ||
      (p.nonce !== undefined &&
        (p.entryMode !== 'HOSTED' ||
          typeof p.nonce !== 'string' ||
          !secret.test(p.nonce)))
    )
      return fail('AUTH_CONTROL_LOST')
    if (Date.parse(String(p.expiresAt)) <= Date.now())
      return fail('AUTH_TRANSACTION_EXPIRED')
    if (
      p.entryMode === 'CUSTOM' &&
      (typeof p.transactionId !== 'string' ||
        !p.transactionId ||
        typeof p.controlSecret !== 'string' ||
        !secret.test(p.controlSecret))
    )
      return fail('AUTH_CONTROL_LOST')
    if (
      p.entryMode === 'HOSTED' &&
      (p.transactionId !== undefined || p.controlSecret !== undefined)
    )
      return fail('AUTH_CONTROL_LOST')
    return p as unknown as PendingAuthorization
  }
}

export function authorizationRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
export function authorizationCallback(
  url: string,
  redirectUri: string,
  keys: readonly string[],
): URLSearchParams {
  const callback = new URL(url),
    expected = new URL(redirectUri)
  if (
    callback.hash ||
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname
  )
    return fail('AUTH_CALLBACK_MISMATCH')
  const params = new URLSearchParams(callback.search)
  for (const [key, value] of expected.searchParams) {
    if (
      params.getAll(key).length !== 1 ||
      params.get(key) !== value ||
      keys.includes(key)
    )
      return fail('AUTH_CALLBACK_MISMATCH')
    params.delete(key)
  }
  if (
    [...params.keys()].length !== keys.length ||
    !keys.every(
      (key) => params.getAll(key).length === 1 && Boolean(params.get(key)),
    )
  )
    return fail('AUTH_CALLBACK_MISMATCH')
  return params
}
