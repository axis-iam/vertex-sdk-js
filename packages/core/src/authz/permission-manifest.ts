export const PERMISSIONS_SYNC_SCOPE = 'permissions:sync' as const

export type PermissionManifestMode = 'validate' | 'upsert'
export type PermissionManifestOperation = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'RESURRECT' | 'CONFLICT'
export type PermissionManifestDriftKind = 'MANUAL_COLLISION' | 'LEGACY_CODE_UNATTRIBUTED' | 'CODE_OWNER_COLLISION' | 'ABSENT_DECLARATION'
export type PermissionManifestSource = 'CODE' | 'MANUAL'

export interface PermissionManifestDeclaration {
  resource: string
  action: string
  name: string
  description: string | null
}

export interface PermissionManifest {
  manifestId: string
  revision: string
  permissions: readonly PermissionManifestDeclaration[]
}

export interface PreparedPermissionManifest extends PermissionManifest {
  mode: PermissionManifestMode
  fingerprint: string
  permissions: readonly PermissionManifestDeclaration[]
}

export interface PermissionManifestItem {
  key: string
  operation: PermissionManifestOperation
  reason: 'DECLARATION_ACCEPTED' | Exclude<PermissionManifestDriftKind, 'ABSENT_DECLARATION'>
}

export interface PermissionManifestDrift {
  key: string
  kind: PermissionManifestDriftKind
  source: PermissionManifestSource
}

export interface PermissionManifestCounts {
  created: number
  updated: number
  unchanged: number
  resurrected: number
  conflict: number
  drift: number
}

export interface PermissionManifestResult {
  mode: PermissionManifestMode
  manifestId: string
  revision: string
  fingerprint: string
  applied: boolean
  results: readonly PermissionManifestItem[]
  drift: readonly PermissionManifestDrift[]
  counts: PermissionManifestCounts
}

export interface PermissionManifestClientConfig {
  issuerEndpoint: string
  portalApiEndpoint: string
  clientId: string
  clientSecret: string
  timeoutMs?: number
  tokenSkewSeconds?: number
  maxRetries?: number
  maxRetryDelayMs?: number
  commandTimeoutMs?: number
  observer?: (event: PermissionManifestObservation) => void
}

export interface PermissionManifestObservation { mode: PermissionManifestMode; outcome: 'SUCCESS' | 'ERROR'; status: number; durationMs: number }

export interface PermissionManifestRequestOptions {
  signal?: AbortSignal
}

export type PermissionManifestStartupMode = 'DISABLED' | 'CI_VALIDATE' | 'DEPLOYMENT_UPSERT' | 'DEVELOPMENT_STARTUP'
export type PermissionManifestFailurePolicy = 'FAIL_FAST' | 'CONTINUE'

export interface PermissionManifestStartupOptions {
  mode?: PermissionManifestStartupMode
  failurePolicy?: PermissionManifestFailurePolicy
  idempotencyKey?: string
  onContinueError?: (event: PermissionManifestContinueEvent) => void
  signal?: AbortSignal
}

export interface PermissionManifestContinueEvent {
  mode: 'DEVELOPMENT_STARTUP'
  outcome: 'CONTINUED'
  status: number
  code: string
}

export interface PermissionManifestStartupResult {
  networkAttempted: boolean
  continued: boolean
  result: PermissionManifestResult | null
}

interface MachineToken {
  accessToken: string
  expiresAtMs: number
}

const MANIFEST_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/
const REVISION = /^[A-Za-z0-9._:@/+~-]{1,128}$/
const SEGMENT = /^[a-z0-9_-]{1,128}$/
const SHA256 = /^[0-9a-f]{64}$/
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,128}$/
const RETRY_STATUSES = new Set([408, 429, 502, 503, 504])
const OPERATIONS = new Set<PermissionManifestOperation>(['CREATE', 'UPDATE', 'UNCHANGED', 'RESURRECT', 'CONFLICT'])
const ITEM_REASONS = new Set<PermissionManifestItem['reason']>(['DECLARATION_ACCEPTED', 'MANUAL_COLLISION', 'LEGACY_CODE_UNATTRIBUTED', 'CODE_OWNER_COLLISION'])
const DRIFT_KINDS = new Set<PermissionManifestDriftKind>(['MANUAL_COLLISION', 'LEGACY_CODE_UNATTRIBUTED', 'CODE_OWNER_COLLISION', 'ABSENT_DECLARATION'])
const SOURCES = new Set<PermissionManifestSource>(['CODE', 'MANUAL'])

export class PermissionManifestError extends Error {
  readonly status: number
  readonly code: string
  readonly correlationId?: string
  readonly retryAfterSeconds?: number
  readonly details: unknown

  constructor(message: string, status: number, code: string, details?: unknown, correlationId?: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'PermissionManifestError'
    this.status = status
    this.code = code
    this.details = details
    this.correlationId = correlationId
    this.retryAfterSeconds = retryAfterSeconds
  }

  static fromResponse(status: number, body: unknown, retryAfter: string | null): PermissionManifestError {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return new PermissionManifestError('Invalid permission manifest error response', status, 'INVALID_ERROR_RESPONSE')
    const payload = body as Record<string, unknown>
    if (!exactKeys(payload, ['status', 'error', 'message', 'timestamp'], ['details', 'correlationId']) || payload.status !== status || typeof payload.error !== 'string' || !payload.error
      || typeof payload.message !== 'string' || !payload.message || typeof payload.timestamp !== 'string' || !payload.timestamp
      || (payload.correlationId !== undefined && (typeof payload.correlationId !== 'string' || !payload.correlationId))) {
      return new PermissionManifestError('Invalid permission manifest error response', status, 'INVALID_ERROR_RESPONSE')
    }
    return new PermissionManifestError(payload.message, status, payload.error, body, payload.correlationId, parseRetryAfter(retryAfter))
  }
}

export async function preparePermissionManifest(manifest: PermissionManifest, mode: PermissionManifestMode): Promise<PreparedPermissionManifest> {
  if (mode !== 'validate' && mode !== 'upsert') throw new TypeError('permission manifest mode must be validate or upsert')
  if (!MANIFEST_ID.test(manifest.manifestId)) throw new TypeError('permission manifest manifestId is invalid')
  if (!REVISION.test(manifest.revision)) throw new TypeError('permission manifest revision is invalid')
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length > 1000) throw new TypeError('permission manifest permissions must contain at most 1000 declarations')

  const permissions = manifest.permissions.map(validateDeclaration).sort((left, right) => compareKeys(key(left), key(right)))
  for (let index = 1; index < permissions.length; index += 1) {
    if (key(permissions[index - 1]!) === key(permissions[index]!)) throw new TypeError('permission manifest contains a duplicate permission key')
  }
  const fingerprint = await sha256(canonicalManifest(permissions))
  return { mode, manifestId: manifest.manifestId, revision: manifest.revision, fingerprint, permissions }
}

export async function permissionDeclarationRevision(declaration: PermissionManifestDeclaration): Promise<string> {
  return sha256(canonicalDeclaration(validateDeclaration(declaration)))
}

export class PermissionManifestClient {
  private readonly issuerEndpoint: string
  private readonly portalApiEndpoint: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly timeoutMs: number
  private readonly tokenSkewSeconds: number
  private readonly maxRetries: number
  private readonly maxRetryDelayMs: number
  private readonly commandTimeoutMs: number
  private readonly observer?: (event: PermissionManifestObservation) => void
  private token?: MachineToken

  constructor(config: PermissionManifestClientConfig) {
    this.issuerEndpoint = endpoint(config.issuerEndpoint, 'issuerEndpoint')
    this.portalApiEndpoint = endpoint(config.portalApiEndpoint, 'portalApiEndpoint')
    this.clientId = required(config.clientId, 'clientId')
    this.clientSecret = required(config.clientSecret, 'clientSecret')
    this.timeoutMs = positive(config.timeoutMs ?? 5000, 'timeoutMs')
    this.tokenSkewSeconds = nonNegative(config.tokenSkewSeconds ?? 30, 'tokenSkewSeconds')
    this.maxRetries = nonNegativeInteger(config.maxRetries ?? 2, 'maxRetries')
    this.maxRetryDelayMs = positive(config.maxRetryDelayMs ?? 5000, 'maxRetryDelayMs')
    this.commandTimeoutMs = positive(config.commandTimeoutMs ?? 15000, 'commandTimeoutMs')
    this.observer = config.observer
    if (this.timeoutMs > 5000 || this.commandTimeoutMs > 15000) throw new TypeError('permission manifest timeout exceeds the frozen contract')
  }

  clearTokenCache(): void { this.token = undefined }

  async validate(manifest: PermissionManifest, options: PermissionManifestRequestOptions = {}): Promise<PermissionManifestResult> {
    const prepared = await preparePermissionManifest(manifest, 'validate')
    return this.observed('validate', () => this.send(prepared, '/open/v1/permission-manifests:sync', undefined, options))
  }

  async upsert(manifest: PermissionManifest, idempotencyKey: string, options: PermissionManifestRequestOptions = {}): Promise<PermissionManifestResult> {
    requireIdempotencyKey(idempotencyKey)
    const prepared = await preparePermissionManifest(manifest, 'upsert')
    return this.observed('upsert', () => this.send(prepared, '/open/v1/permission-manifests:sync', idempotencyKey, options))
  }

  private async observed(mode: PermissionManifestMode, command: () => Promise<PermissionManifestResult>): Promise<PermissionManifestResult> {
    const started = Date.now()
    try { const result = await command(); this.observer?.({ mode, outcome: 'SUCCESS', status: 200, durationMs: Date.now() - started }); return result }
    catch (error) { this.observer?.({ mode, outcome: 'ERROR', status: error instanceof PermissionManifestError ? error.status : 0, durationMs: Date.now() - started }); throw error }
  }

  private async send(prepared: PreparedPermissionManifest, path: string, idempotencyKey: string | undefined, options: PermissionManifestRequestOptions): Promise<PermissionManifestResult> {
    const budget = { attempts: 3, deadline: Date.now() + this.commandTimeoutMs }
    const token = await this.machineToken(budget, options.signal)
    const headers: Record<string, string> = { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey
    const response = await this.requestWithRetry(`${this.portalApiEndpoint}${path}`, { method: 'POST', headers, body: JSON.stringify(prepared) }, budget, options.signal)
    const body = await parseJson(response)
    if (!response.ok) throw PermissionManifestError.fromResponse(response.status, body, response.headers.get('Retry-After'))
    return parseResult(body, prepared)
  }

  private async machineToken(budget: CommandBudget, signal?: AbortSignal): Promise<MachineToken> {
    if (this.token && this.token.expiresAtMs > Date.now()) return this.token
    const body = new URLSearchParams({ grant_type: 'client_credentials', scope: PERMISSIONS_SYNC_SCOPE })
    const response = await this.requestWithRetry(`${this.issuerEndpoint}/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth(this.clientId, this.clientSecret)}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    }, budget, signal)
    const payload = await parseTokenJson(response)
    if (!response.ok) throw tokenProtocolError(response.status, payload)
    if (!isRecord(payload)) throw tokenError(response.status)
    const value = payload
    if (typeof value.access_token !== 'string' || !value.access_token || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer'
      || typeof value.expires_in !== 'number' || !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0) throw tokenError(response.status)
    if (typeof value.scope !== 'string' || value.scope.split(/\s+/).filter(Boolean).join(' ') !== PERMISSIONS_SYNC_SCOPE) throw tokenError(response.status, 'INVALID_TOKEN_SCOPE')
    this.token = { accessToken: value.access_token, expiresAtMs: Date.now() + Math.max(0, value.expires_in - this.tokenSkewSeconds) * 1000 }
    return this.token
  }

  private async requestWithRetry(url: string, init: RequestInit, budget: CommandBudget, externalSignal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      if (externalSignal?.aborted) throw externalSignal.reason
      if (budget.attempts <= 0 || Date.now() >= budget.deadline) throw new PermissionManifestError('Permission manifest command budget exhausted', 0, 'COMMAND_TIMEOUT')
      budget.attempts -= 1
      const controller = new AbortController()
      const abort = () => controller.abort(externalSignal?.reason)
      externalSignal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => controller.abort(new Error('permission manifest request timed out')), Math.min(this.timeoutMs, budget.deadline - Date.now()))
      try {
        const response = await fetch(url, { ...init, signal: controller.signal })
        if (!RETRY_STATUSES.has(response.status) || attempt >= this.maxRetries || budget.attempts === 0) return response
        const delay = Math.min(parseRetryAfter(response.headers.get('Retry-After')) === undefined ? 250 * (2 ** attempt) : parseRetryAfter(response.headers.get('Retry-After'))! * 1000, this.maxRetryDelayMs)
        await waitWithinBudget(delay, budget, externalSignal)
      } catch (error) {
        if (error instanceof PermissionManifestError && error.code === 'COMMAND_TIMEOUT') throw error
        if (externalSignal?.aborted || attempt >= this.maxRetries || budget.attempts === 0) throw error
        await waitWithinBudget(Math.min(250 * (2 ** attempt), this.maxRetryDelayMs), budget, externalSignal)
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', abort)
      }
    }
  }
}

interface CommandBudget { attempts: number; deadline: number }

export async function runPermissionManifestStartup(client: PermissionManifestClient, manifest: PermissionManifest, options: PermissionManifestStartupOptions = {}): Promise<PermissionManifestStartupResult> {
  const mode = options.mode ?? 'DISABLED'
  if (mode === 'DISABLED') return { networkAttempted: false, continued: false, result: null }
  if (mode === 'CI_VALIDATE') return { networkAttempted: true, continued: false, result: await client.validate(manifest, { signal: options.signal }) }
  if (mode === 'DEPLOYMENT_UPSERT') return { networkAttempted: true, continued: false, result: await client.upsert(manifest, requireStartupIdempotencyKey(options.idempotencyKey), { signal: options.signal }) }
  if (mode !== 'DEVELOPMENT_STARTUP') throw new TypeError('unknown permission manifest startup mode')
  if (options.failurePolicy !== 'FAIL_FAST' && options.failurePolicy !== 'CONTINUE') throw new TypeError('DEVELOPMENT_STARTUP requires explicit failurePolicy')
  if (options.failurePolicy === 'CONTINUE' && options.onContinueError === undefined) throw new TypeError('DEVELOPMENT_STARTUP with CONTINUE requires onContinueError')
  try {
    return { networkAttempted: true, continued: false, result: await client.upsert(manifest, requireStartupIdempotencyKey(options.idempotencyKey), { signal: options.signal }) }
  } catch (error) {
    if (options.failurePolicy === 'FAIL_FAST') throw error
    options.onContinueError!({ mode: 'DEVELOPMENT_STARTUP', outcome: 'CONTINUED', status: error instanceof PermissionManifestError ? error.status : 0, code: error instanceof PermissionManifestError ? error.code : 'UNEXPECTED_ERROR' })
    return { networkAttempted: true, continued: true, result: null }
  }
}

function validateDeclaration(value: PermissionManifestDeclaration): PermissionManifestDeclaration {
  if (!value || !SEGMENT.test(value.resource) || !SEGMENT.test(value.action)) throw new TypeError('permission manifest contains an invalid concrete permission key')
  validateText(value.name, 128, 'name')
  if (value.description !== null) validateText(value.description, 512, 'description')
  for (const [field, text] of Object.entries(value)) {
    if (typeof text === 'string') requireNfc(text, field)
  }
  return { resource: value.resource, action: value.action, name: value.name, description: value.description }
}

function validateText(value: string, max: number, field: string): void {
  if (typeof value !== 'string' || !value || value.length > max || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new TypeError(`permission manifest ${field} is invalid`)
}

function requireNfc(value: string, field: string): void {
  if (value.normalize('NFC') !== value || /[\ud800-\udfff]/u.test(value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) throw new TypeError(`permission manifest ${field} must already be NFC and valid Unicode`)
}

function canonicalManifest(permissions: readonly PermissionManifestDeclaration[]): string {
  return `{"permissions":[${permissions.map(canonicalDeclaration).join(',')}]}`
}

function canonicalDeclaration(value: PermissionManifestDeclaration): string {
  return `{"action":${JSON.stringify(value.action)},"description":${value.description === null ? 'null' : JSON.stringify(value.description)},"name":${JSON.stringify(value.name)},"resource":${JSON.stringify(value.resource)}}`
}

function parseResult(value: unknown, request: PreparedPermissionManifest): PermissionManifestResult {
  if (!isRecord(value)) throw invalidResult(value)
  const payload = value
  if (!exactKeys(payload, ['mode', 'manifestId', 'revision', 'fingerprint', 'applied', 'results', 'drift', 'counts']) || (payload.mode !== 'validate' && payload.mode !== 'upsert') || payload.mode !== request.mode || payload.manifestId !== request.manifestId
    || payload.revision !== request.revision || payload.fingerprint !== request.fingerprint || !SHA256.test(payload.fingerprint as string)
    || typeof payload.applied !== 'boolean' || payload.applied !== (request.mode === 'upsert') || !Array.isArray(payload.results) || !Array.isArray(payload.drift)) {
    throw new PermissionManifestError('Invalid permission manifest result', 0, 'INVALID_MANIFEST_RESPONSE', value)
  }
  const results = payload.results.map(parseItem)
  const drift = payload.drift.map(parseDrift)
  if (!isStrictlySorted(results.map((item) => item.key)) || !isStrictlySorted(drift.map((item) => item.key))) throw invalidResult(value)
  if (!isRecord(payload.counts)) throw invalidResult(value)
  const countsPayload = payload.counts
  if (!exactKeys(countsPayload, ['created', 'updated', 'unchanged', 'resurrected', 'conflict', 'drift'])) throw invalidResult(value)
  const counts: PermissionManifestCounts = {
    created: count(countsPayload.created), updated: count(countsPayload.updated), unchanged: count(countsPayload.unchanged),
    resurrected: count(countsPayload.resurrected), conflict: count(countsPayload.conflict), drift: count(countsPayload.drift),
  }
  const actual = { created: 0, updated: 0, unchanged: 0, resurrected: 0, conflict: 0, drift: drift.length }
  for (const item of results) actual[operationCount(item.operation)] += 1
  if (Object.keys(actual).some((field) => actual[field as keyof typeof actual] !== counts[field as keyof PermissionManifestCounts])) throw invalidResult(value)
  return { mode: payload.mode, manifestId: request.manifestId, revision: request.revision, fingerprint: request.fingerprint, applied: payload.applied, results, drift, counts }
}

function parseItem(value: unknown): PermissionManifestItem {
  if (!isRecord(value)) throw invalidResult(value)
  const payload = value
  if (!exactKeys(payload, ['key', 'operation', 'reason']) || typeof payload.key !== 'string' || !validKey(payload.key) || !OPERATIONS.has(payload.operation as PermissionManifestOperation) || !ITEM_REASONS.has(payload.reason as PermissionManifestItem['reason'])) throw invalidResult(value)
  return { key: payload.key, operation: payload.operation as PermissionManifestOperation, reason: payload.reason as PermissionManifestItem['reason'] }
}

function parseDrift(value: unknown): PermissionManifestDrift {
  if (!isRecord(value)) throw invalidResult(value)
  const payload = value
  if (!exactKeys(payload, ['key', 'kind', 'source']) || typeof payload.key !== 'string' || !validKey(payload.key) || !DRIFT_KINDS.has(payload.kind as PermissionManifestDriftKind) || !SOURCES.has(payload.source as PermissionManifestSource)) throw invalidResult(value)
  return { key: payload.key, kind: payload.kind as PermissionManifestDriftKind, source: payload.source as PermissionManifestSource }
}

function operationCount(operation: PermissionManifestOperation): Exclude<keyof PermissionManifestCounts, 'drift'> {
  const mapping: Record<PermissionManifestOperation, Exclude<keyof PermissionManifestCounts, 'drift'>> = {
    CREATE: 'created', UPDATE: 'updated', UNCHANGED: 'unchanged', RESURRECT: 'resurrected', CONFLICT: 'conflict',
  }
  return mapping[operation]
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidResult(value)
  return value
}

function validKey(value: string): boolean { const parts = value.split(':'); return parts.length === 2 && SEGMENT.test(parts[0]!) && SEGMENT.test(parts[1]!) }
function isStrictlySorted(values: readonly string[]): boolean { return values.every((value, index) => index === 0 || values[index - 1]! < value) }
function invalidResult(value: unknown): PermissionManifestError { return new PermissionManifestError('Invalid permission manifest result', 0, 'INVALID_MANIFEST_RESPONSE', value) }
function key(value: PermissionManifestDeclaration): string { return `${value.resource}:${value.action}` }
function compareKeys(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean { const allowed = new Set([...required, ...optional]); return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => allowed.has(key)) }
function endpoint(value: string, field: string): string { return required(value, field).replace(/\/+$/, '') }
function required(value: string, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`permission manifest ${field} is required`); return value.trim() }
function positive(value: number, field: string): number { if (!Number.isFinite(value) || value <= 0) throw new TypeError(`permission manifest ${field} must be positive`); return value }
function nonNegative(value: number, field: string): number { if (!Number.isFinite(value) || value < 0) throw new TypeError(`permission manifest ${field} must be non-negative`); return value }
function nonNegativeInteger(value: number, field: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`permission manifest ${field} must be a non-negative integer`); return value }
function requireIdempotencyKey(value: string): void { if (!IDEMPOTENCY_KEY.test(value)) throw new TypeError('Idempotency-Key must be 8-128 visible ASCII characters') }
function requireStartupIdempotencyKey(value: string | undefined): string { if (value === undefined) throw new TypeError('permission manifest upsert requires idempotencyKey'); requireIdempotencyKey(value); return value }
function parseRetryAfter(value: string | null): number | undefined { if (value === null || !/^[1-9][0-9]{0,4}$/.test(value)) return undefined; const seconds = Number(value); return seconds <= 86400 ? seconds : undefined }
function basicAuth(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
async function parseJson(response: Response): Promise<unknown> { const text = await response.text(); try { return JSON.parse(text) as unknown } catch { throw new PermissionManifestError('IAM returned malformed JSON', response.status, 'INVALID_JSON_RESPONSE', text) } }
async function parseTokenJson(response: Response): Promise<unknown> { const text = await response.text(); try { return JSON.parse(text) as unknown } catch { throw new PermissionManifestError('IAM token endpoint returned malformed JSON', response.status, 'INVALID_JSON_RESPONSE') } }
function tokenError(status: number, code = 'INVALID_TOKEN_RESPONSE'): PermissionManifestError { return new PermissionManifestError('Permission manifest machine token request failed', status, code) }
function tokenProtocolError(status: number, body: unknown): PermissionManifestError {
  if (body && typeof body === 'object' && !Array.isArray(body)) { const payload = body as Record<string, unknown>; if (typeof payload.error === 'string' && payload.error) return new PermissionManifestError('Permission manifest machine token request failed', status, payload.error) }
  return new PermissionManifestError('Invalid machine token error response', status, 'INVALID_ERROR_RESPONSE')
}
async function wait(ms: number, signal?: AbortSignal): Promise<void> { await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true }) }) }
async function waitWithinBudget(ms: number, budget: CommandBudget, signal?: AbortSignal): Promise<void> {
  const remaining = budget.deadline - Date.now()
  if (remaining <= 0 || ms >= remaining) throw new PermissionManifestError('Permission manifest command budget exhausted', 0, 'COMMAND_TIMEOUT')
  await wait(ms, signal)
}
