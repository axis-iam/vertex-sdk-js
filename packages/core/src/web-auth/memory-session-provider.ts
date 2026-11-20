import { BffError, type BffRecord, type BffSessionProvider, type ProviderResult } from './session-provider.js'

export interface MemorySessionProviderConfig {
  maxSessions?: number
  maxPrelogins?: number
  maxRecordBytes?: number
  cleanupIntervalMs?: number
  sessionAbsoluteMs?: number
  sessionIdleMs?: number
  preloginTtlMs?: number
  /** Deployment declaration. RAM is never shared between workers/replicas. */
  replicas?: number
  workers?: number
  now?: () => number
}
const positive = (n: number) => Number.isSafeInteger(n) && n > 0

export class MemorySessionProvider implements BffSessionProvider {
  readonly scope = 'process' as const
  private readonly records = new Map<string, BffRecord>()
  private readonly config: Required<Omit<MemorySessionProviderConfig, 'replicas' | 'workers'>>
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false

  constructor(config: MemorySessionProviderConfig = {}) {
    if ((config.replicas !== undefined && config.replicas !== 1) || (config.workers !== undefined && config.workers !== 1))
      throw new BffError('CONFIGURATION_INVALID', 400)
    this.config = {
      maxSessions: config.maxSessions ?? 10_000, maxPrelogins: config.maxPrelogins ?? 1_000,
      maxRecordBytes: config.maxRecordBytes ?? 65_536, cleanupIntervalMs: config.cleanupIntervalMs ?? 60_000,
      sessionAbsoluteMs: config.sessionAbsoluteMs ?? 3_600_000, sessionIdleMs: config.sessionIdleMs ?? 3_600_000,
      preloginTtlMs: config.preloginTtlMs ?? 600_000, now: config.now ?? Date.now,
    }
    if (typeof this.config.now !== 'function' ||
      Object.entries(this.config).some(([k, v]) => k !== 'now' && (typeof v !== 'number' || !positive(v))))
      throw new BffError('CONFIGURATION_INVALID', 400)
    this.timer = setInterval(() => this.purge(), this.config.cleanupIntervalMs)
    this.timer.unref()
  }
  private assertOpen() { if (this.closed) throw new BffError('SESSION_STORE_CLOSED', 503) }
  private purge() {
    const now = this.config.now()
    for (const [id, r] of this.records)
      if (Math.min(r.absoluteExpiresAt, r.idleExpiresAt) <= now) this.records.delete(id)
  }
  private snapshot(record: BffRecord): BffRecord {
    if (Buffer.byteLength(JSON.stringify(record)) > this.config.maxRecordBytes)
      throw new BffError('SESSION_STORE_CAPACITY', 503)
    return structuredClone(record)
  }
  async create(id: string, record: BffRecord): Promise<ProviderResult> {
    this.assertOpen(); this.purge()
    if (this.records.has(id)) return 'CONFLICT'
    const count = [...this.records.values()].filter(r => r.kind === record.kind).length
    if (count >= (record.kind === 'SESSION' ? this.config.maxSessions : this.config.maxPrelogins))
      throw new BffError('SESSION_STORE_CAPACITY', 503)
    const copy = this.snapshot(record)
    copy.absoluteExpiresAt = Math.min(copy.absoluteExpiresAt, copy.createdAt +
      (copy.kind === 'SESSION' ? this.config.sessionAbsoluteMs : this.config.preloginTtlMs))
    copy.idleExpiresAt = Math.min(copy.absoluteExpiresAt, copy.idleExpiresAt, this.config.now() +
      (copy.kind === 'SESSION' ? this.config.sessionIdleMs : this.config.preloginTtlMs))
    this.records.set(id, copy)
    return 'COMMITTED'
  }
  async read(id: string) {
    this.assertOpen(); this.purge()
    const r = this.records.get(id)
    return r ? structuredClone(r) : null
  }
  async compareAndSet(id: string, expected: BffRecord, replacement: BffRecord): Promise<ProviderResult> {
    this.assertOpen(); this.purge()
    const r = this.records.get(id)
    if (!r || r.version !== expected.version || r.owner !== expected.owner ||
      r.operation?.fence !== expected.operation?.fence || r.lifecycle !== expected.lifecycle)
      return 'CONFLICT'
    if (r.operation && r.operation.expiresAt <= this.config.now()) {
      this.records.delete(id)
      return 'CONFLICT'
    }
    if (replacement.version !== r.version + 1 || replacement.owner !== r.owner ||
      replacement.clientId !== r.clientId || replacement.kind !== r.kind ||
      replacement.createdAt !== r.createdAt || replacement.absoluteExpiresAt > r.absoluteExpiresAt ||
      replacement.profile?.id !== r.profile?.id ||
      replacement.profile?.authenticationContext.sessionId !== r.profile?.authenticationContext.sessionId)
      throw new BffError('SESSION_STORE_UNAVAILABLE', 503)
    const copy = this.snapshot(replacement)
    copy.idleExpiresAt = Math.min(copy.idleExpiresAt, copy.absoluteExpiresAt,
      this.config.now() + (r.kind === 'SESSION' ? this.config.sessionIdleMs : this.config.preloginTtlMs))
    this.records.set(id, copy)
    return 'COMMITTED'
  }
  async invalidate(id: string) {
    this.assertOpen(); this.purge()
    const r = this.records.get(id)
    this.records.delete(id)
    if (r?.successorId) {
      const successor = this.records.get(r.successorId)
      this.records.delete(r.successorId)
      return successor ? structuredClone(successor) : null
    }
    return r ? structuredClone(r) : null
  }
  async rotate(id: string, expected: BffRecord, nextId: string, session: BffRecord): Promise<ProviderResult> {
    this.assertOpen(); this.purge()
    const current = this.records.get(id)
    if (!current || current.kind !== 'PRELOGIN' || current.lifecycle !== 'SEND_INTENT' ||
      current.version !== expected.version || current.owner !== expected.owner ||
      current.operation?.fence !== expected.operation?.fence || current.successorId || this.records.has(nextId))
      return 'CONFLICT'
    if (!current.operation || current.operation.expiresAt <= this.config.now()) {
      this.records.delete(id)
      return 'CONFLICT'
    }
    // All checks/copies happen before mutation. No await permits an interleaving.
    const copy = this.snapshot(session)
    if (copy.kind !== 'SESSION') throw new BffError('SESSION_STORE_UNAVAILABLE', 503)
    if ([...this.records.values()].filter(r => r.kind === 'SESSION').length >= this.config.maxSessions)
      throw new BffError('SESSION_STORE_CAPACITY', 503)
    copy.absoluteExpiresAt = Math.min(copy.absoluteExpiresAt, copy.createdAt + this.config.sessionAbsoluteMs)
    copy.idleExpiresAt = Math.min(copy.idleExpiresAt, copy.absoluteExpiresAt, this.config.now() + this.config.sessionIdleMs)
    this.records.set(nextId, copy)
    this.records.set(id, { ...current, successorId: nextId, login: undefined, registrations: undefined,
      absoluteExpiresAt: Math.min(current.absoluteExpiresAt, this.config.now() + 60_000),
      idleExpiresAt: Math.min(current.idleExpiresAt, this.config.now() + 60_000) })
    return 'COMMITTED'
  }
  async close() {
    clearInterval(this.timer)
    this.records.clear()
    this.closed = true
  }
}
