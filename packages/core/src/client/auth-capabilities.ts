import type { LoginIdentifier } from './identity.js'

export type LoginMethod = 'PASSWORD' | 'EMAIL_OTP' | 'EMAIL_MAGIC_LINK' | 'SMS_OTP'
export type SignupIdentifierKind = 'EMAIL' | 'USERNAME'
export type PasswordIdentifierKind = LoginIdentifier['kind']
export interface DefaultLogin { identifierKind: LoginIdentifier['kind']; method: LoginMethod }
export interface IdentifierMethods { kind: LoginIdentifier['kind']; methods: LoginMethod[] }
export interface AuthCapabilities {
  identifierMethods: IdentifierMethods[]
  defaultIdentifierKind: LoginIdentifier['kind'] | null
  defaultLogin: DefaultLogin | null
  allowedSignupIdentifierKinds: SignupIdentifierKind[]
  allowedPasswordIdentifierKinds: PasswordIdentifierKind[]
}
export class AuthCapabilitiesError extends Error {
  readonly code = 'AUTH_CAPABILITIES_INVALID'
  constructor() { super('Authentication capabilities are malformed'); this.name = 'AuthCapabilitiesError' }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export function parseSignupIdentifierKinds(v: unknown): SignupIdentifierKind[] {
  if (!Array.isArray(v) || v.some(k => k !== 'EMAIL' && k !== 'USERNAME') || new Set(v).size !== v.length || (v.length === 2 && v[0] !== 'EMAIL')) throw new AuthCapabilitiesError()
  return v.map(k => k === 'EMAIL' ? 'EMAIL' : 'USERNAME')
}
export function parsePasswordIdentifierKinds(v: unknown): PasswordIdentifierKind[] {
  if (!Array.isArray(v) || v.some(k => k !== 'EMAIL' && k !== 'USERNAME' && k !== 'PHONE') || new Set(v).size !== v.length) throw new AuthCapabilitiesError()
  const order: PasswordIdentifierKind[] = ['EMAIL', 'USERNAME', 'PHONE']
  return order.filter(k => v.includes(k))
}
export function parseDefaultLogin(v: unknown): DefaultLogin {
  if (!record(v) || Object.keys(v).some(k => !['identifierKind', 'method'].includes(k))) throw new AuthCapabilitiesError()
  const kind = v.identifierKind
  const method = v.method
  if (kind !== 'EMAIL' && kind !== 'USERNAME' && kind !== 'PHONE') throw new AuthCapabilitiesError()
  if (method !== 'PASSWORD' && !(kind === 'EMAIL' && (method === 'EMAIL_OTP' || method === 'EMAIL_MAGIC_LINK')) && !(kind === 'PHONE' && method === 'SMS_OTP')) throw new AuthCapabilitiesError()
  return { identifierKind: kind, method }
}
/** Preserve producer order. Preferences from auth-policy must never resolve capabilities here. */
export function parseAuthCapabilities(v: unknown): AuthCapabilities {
  if (!record(v) || !Array.isArray(v.identifierMethods)) throw new AuthCapabilitiesError()
  const allowedPasswordIdentifierKinds = parsePasswordIdentifierKinds(v.allowedPasswordIdentifierKinds)
  if (v.passwordLoginEnabled === true && allowedPasswordIdentifierKinds.length === 0) throw new AuthCapabilitiesError()
  const seen = new Set<string>()
  const identifierMethods: IdentifierMethods[] = v.identifierMethods.map(entry => {
    if (!record(entry) || !Array.isArray(entry.methods) || !entry.methods.length || new Set(entry.methods).size !== entry.methods.length) throw new AuthCapabilitiesError()
    const pairs = entry.methods.map(method => parseDefaultLogin({ identifierKind: entry.kind, method }))
    const kind = pairs[0]!.identifierKind
    if (pairs.some(pair => pair.method === 'PASSWORD') && (v.passwordLoginEnabled === false || !allowedPasswordIdentifierKinds.includes(kind))) throw new AuthCapabilitiesError()
    if (seen.has(kind)) throw new AuthCapabilitiesError()
    seen.add(kind)
    return { kind, methods: pairs.map(p => p.method) }
  })
  const defaultLogin = v.defaultLogin === null ? null : parseDefaultLogin(v.defaultLogin)
  const first = identifierMethods[0]
  if (first ? !defaultLogin || v.defaultIdentifierKind !== first.kind || defaultLogin.identifierKind !== first.kind || defaultLogin.method !== first.methods[0] : defaultLogin !== null || v.defaultIdentifierKind !== null) throw new AuthCapabilitiesError()
  return {
    identifierMethods,
    defaultLogin,
    defaultIdentifierKind: first?.kind ?? null,
    allowedSignupIdentifierKinds: parseSignupIdentifierKinds(v.allowedSignupIdentifierKinds),
    allowedPasswordIdentifierKinds,
  }
}
