import type { MfaOperation, MfaOperationMode } from '@axis-iam/vertex'
import type { AuthClient } from './auth-client'

/** Read-only continuation, never a proof, token, sid or pending mutation. */
export interface AccountSecurityReceipt {
  ref: string
  type: MfaOperation['type']
  expectedLoginMethodVersion: number
  expiresAt: string
  issuer: string
  clientId: string
  applicationId: string
  userId: string
  mode: MfaOperationMode
}
export type SecurityOwner = Pick<AccountSecurityReceipt, 'issuer' | 'clientId' | 'applicationId' | 'userId' | 'mode'>
export function securityOwner(client: AuthClient): SecurityOwner | null {
  const user = client.state.getUser()
  if (!user) return null
  const context = user.authenticationContext
  return { issuer: client.config.issuerUri, clientId: context.clientId, applicationId: context.applicationId, userId: user.id, mode: client.mode }
}
export const sameSecurityOwner = (a: SecurityOwner, b: SecurityOwner) =>
  a.issuer === b.issuer && a.clientId === b.clientId && a.applicationId === b.applicationId && a.userId === b.userId && a.mode === b.mode
export const receiptKey = (client: AuthClient) =>
  `axis_iam_mfa_receipt:${encodeURIComponent(JSON.stringify([client.config.issuerUri, client.clientId, client.mode]))}`
/** Optional navigation storage must not break memory-only clients or logout. */
export function receiptStorage(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'SecurityError') throw error
    return null
  }
}
export function readSecurityReceipt(client: AuthClient): AccountSecurityReceipt | null {
  const storage = receiptStorage()
  if (!storage) return null
  const key = receiptKey(client)
  if (client.state.invalidationReason === 'cleared' || client.state.invalidationReason === 'disposed') {
    storage.removeItem(key)
    return null
  }
  const raw = storage.getItem(key)
  if (raw === null) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    storage.removeItem(key); return null
  }
  const keys = ['ref', 'type', 'expectedLoginMethodVersion', 'expiresAt', 'issuer', 'clientId', 'applicationId', 'userId', 'mode']
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>
    if (Object.keys(v).length === keys.length && keys.every(k => k in v) &&
      typeof v.ref === 'string' && (client.mode === 'server_session' ? /^[A-Za-z0-9_-]{43}$/.test(v.ref) : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.ref)) &&
      typeof v.expiresAt === 'string' && Date.parse(v.expiresAt) > Date.now() &&
      typeof v.applicationId === 'string' && v.applicationId.length > 0 &&
      typeof v.userId === 'string' && v.userId.length > 0 &&
      (v.type === 'TOTP_ENROLL' || v.type === 'TOTP_DISABLE' || v.type === 'RECOVERY_CODES_GENERATE') &&
      typeof v.expectedLoginMethodVersion === 'number' && Number.isSafeInteger(v.expectedLoginMethodVersion) && v.expectedLoginMethodVersion >= 0 &&
      v.issuer === client.config.issuerUri && v.clientId === client.clientId && v.mode === client.mode) {
      return { ref: v.ref, type: v.type, expiresAt: v.expiresAt, expectedLoginMethodVersion: v.expectedLoginMethodVersion,
        applicationId: v.applicationId, userId: v.userId, issuer: v.issuer, clientId: v.clientId, mode: client.mode }
    }
  }
  storage.removeItem(key)
  return null
}
