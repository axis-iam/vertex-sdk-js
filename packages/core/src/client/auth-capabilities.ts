import type { LoginIdentifier } from './identity.js'

export type LoginMethod = 'PASSWORD' | 'EMAIL_OTP' | 'EMAIL_MAGIC_LINK' | 'SMS_OTP'
export type SignupIdentifierKind = 'EMAIL' | 'USERNAME'
export type PasswordIdentifierKind = LoginIdentifier['kind']
export interface DefaultLogin { identifierKind: LoginIdentifier['kind']; method: LoginMethod }
export interface IdentifierMethods { kind: LoginIdentifier['kind']; methods: LoginMethod[] }
export interface PhoneIdentifierRestriction { restricted: boolean; allowedRegions: string[] | null }
export interface IdentifierPurposeRestrictions { email: { restricted: boolean }; phone: PhoneIdentifierRestriction }
export interface IdentifierRestrictions { signup: IdentifierPurposeRestrictions; login: IdentifierPurposeRestrictions }
export interface AuthCapabilities {
  identifierRestrictions: IdentifierRestrictions
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
    identifierRestrictions: parseIdentifierRestrictions(v.identifierRestrictions),
    identifierMethods,
    defaultLogin,
    defaultIdentifierKind: first?.kind ?? null,
    allowedSignupIdentifierKinds: parseSignupIdentifierKinds(v.allowedSignupIdentifierKinds),
    allowedPasswordIdentifierKinds,
  }
}

// Supported rendering codes from the existing server numbering plan; matching remains server-owned.
const supportedPhoneRegions = new Set('AC AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' '))
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}
function parsePurpose(value: unknown): IdentifierPurposeRestrictions {
  if (!record(value) || !exactKeys(value, ['email', 'phone'])) throw new AuthCapabilitiesError()
  const { email, phone } = value
  if (!record(email) || !exactKeys(email, ['restricted']) || typeof email.restricted !== 'boolean' ||
      !record(phone) || !exactKeys(phone, ['restricted', 'allowedRegions']) || typeof phone.restricted !== 'boolean') throw new AuthCapabilitiesError()
  let allowedRegions: string[] | null = null
  if (phone.restricted) {
    const codes = phone.allowedRegions
    if (!Array.isArray(codes) || codes.length < 1 || codes.length > 100 ||
        codes.some(code => typeof code !== 'string' || !supportedPhoneRegions.has(code)) || new Set(codes).size !== codes.length) throw new AuthCapabilitiesError()
    allowedRegions = codes.map(code => String(code))
  } else if (phone.allowedRegions !== null) throw new AuthCapabilitiesError()
  return { email: { restricted: email.restricted }, phone: { restricted: phone.restricted, allowedRegions } }
}
/** Strict purpose-specific rendering snapshot. Domain allow-lists are never public. */
export function parseIdentifierRestrictions(value: unknown): IdentifierRestrictions {
  if (!record(value) || !exactKeys(value, ['signup', 'login'])) throw new AuthCapabilitiesError()
  return { signup: parsePurpose(value.signup), login: parsePurpose(value.login) }
}
