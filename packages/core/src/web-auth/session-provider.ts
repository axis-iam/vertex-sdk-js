import type { CurrentUser } from '../client/current-user.js'
import type { WebAuthTokenSet, WebAuthTransaction } from './web-auth-client.js'

export type BffErrorCode =
  | 'CONFIGURATION_INVALID' | 'VALIDATION_ERROR' | 'SESSION_REQUIRED' | 'SESSION_INVALIDATED'
  | 'SESSION_CSRF_INVALID' | 'SESSION_ACTION_PENDING' | 'SESSION_STORE_UNAVAILABLE'
  | 'SESSION_STORE_CAPACITY' | 'SESSION_STORE_CLOSED' | 'IAM_UNAVAILABLE'
  | 'IAM_RESPONSE_INVALID' | 'AUTH_EXCHANGE_UNCERTAIN' | 'REFRESH_UNCERTAIN'
  | 'AUTH_CALLBACK_INVALID' | 'AUTH_CANCELLED' | 'UNSUPPORTED_OPERATION' | 'RATE_LIMITED'

export class BffError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryAfterSeconds?: number) {
    super(code)
    this.name = 'BffError'
  }
  toJSON() { return { error: this.code, status: this.status, message: this.code } }
}

export interface BffLogin extends WebAuthTransaction {
  kind: 'HOSTED' | 'CUSTOM'
  transactionId?: string
  controlSecret?: string
  stateName: string
  nextAction?: 'authenticate' | 'authorize' | 'mfa' | 'complete' | 'none'
  identifier?: { kind: 'EMAIL' | 'USERNAME' | 'PHONE'; value: string; region?: string | null }
  magicConsumed?: boolean
}
export interface BffRegistration {
  id: string
  controlSecret: string | null
  expiresAt: number
}
/** Server-only record. Never serialize this as an HTTP response. */
export interface BffRecord {
  schemaVersion: 1
  version: number
  kind: 'PRELOGIN' | 'SESSION'
  lifecycle: 'READY' | 'OWNED' | 'SEND_INTENT'
  createdAt: number
  absoluteExpiresAt: number
  idleExpiresAt: number
  owner: string
  csrfToken: string
  clientId: string
  operation?: { fence: string; expiresAt: number }
  login?: BffLogin
  registrations?: Record<string, BffRegistration>
  /** Short-lived, non-authenticating link so a racing logout fences rotation. */
  successorId?: string
  tokens?: WebAuthTokenSet
  profile?: CurrentUser
  permissions?: { roles: string[]; permissions: string[] }
}
export type ProviderResult = 'COMMITTED' | 'CONFLICT'
/**
 * Every mutation is atomic across the provider's declared scope.
 * compareAndSet never inserts an absent/expired record, and binds the complete
 * expected version/owner/fence. invalidate must fence outstanding writers.
 * Storage faults throw BffError; null means only absent/expired.
 */
export interface BffSessionProvider {
  readonly scope: 'process' | 'shared'
  create(id: string, record: BffRecord): Promise<ProviderResult>
  read(id: string): Promise<BffRecord | null>
  compareAndSet(id: string, expected: BffRecord, replacement: BffRecord): Promise<ProviderResult>
  /** Atomically consumes expected prelogin and creates a new session ID. */
  rotate(id: string, expected: BffRecord, nextId: string, session: BffRecord): Promise<ProviderResult>
  invalidate(id: string): Promise<BffRecord | null>
  close(): Promise<void>
}
