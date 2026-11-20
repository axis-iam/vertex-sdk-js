import { afterEach, expect, it } from 'vitest'
import { MemorySessionProvider } from './memory-session-provider.js'
import type { BffRecord } from './session-provider.js'

const providers: MemorySessionProvider[] = []
afterEach(async () => { await Promise.all(providers.splice(0).map(p => p.close())) })
function provider(config: ConstructorParameters<typeof MemorySessionProvider>[0] = {}) {
  const p = new MemorySessionProvider(config); providers.push(p); return p
}
function record(kind: 'SESSION' | 'PRELOGIN' = 'PRELOGIN', now = 1000): BffRecord {
  return { schemaVersion: 1, version: 0, kind, lifecycle: 'READY', owner: 'owner', csrfToken: 'csrf',
    clientId: 'client', createdAt: now, absoluteExpiresAt: now + 10000, idleExpiresAt: now + 10000 }
}
it('BFF-JS-MEMORY: TTL, finite capacity, isolated copies, close and restart', async () => {
  let now = 1000
  const p = provider({ now: () => now, maxPrelogins: 1, preloginTtlMs: 100 })
  expect(await p.create('a', record())).toBe('COMMITTED')
  await expect(p.create('b', record())).rejects.toMatchObject({ code: 'SESSION_STORE_CAPACITY', status: 503 })
  const copy = await p.read('a'); copy!.owner = 'changed'
  expect((await p.read('a'))!.owner).toBe('owner')
  now += 101
  expect(await p.read('a')).toBeNull()
  expect(await p.create('b', record('PRELOGIN', now))).toBe('COMMITTED')
  await p.close()
  await expect(p.read('b')).rejects.toMatchObject({ code: 'SESSION_STORE_CLOSED' })
  expect(await provider().read('b')).toBeNull()
})
it('BFF-JS-MEMORY: atomic claim, intent, no lease takeover and no late resurrection', async () => {
  const p = provider({ now: () => 1000 }), r = record()
  await p.create('id', r)
  const owned: BffRecord = { ...r, version: 1, lifecycle: 'SEND_INTENT', operation: { fence: 'one', expiresAt: 2000 } }
  expect(await Promise.all([p.compareAndSet('id', r, owned), p.compareAndSet('id', r, { ...owned, operation: { fence: 'two', expiresAt: 2000 } })]))
    .toEqual(['COMMITTED', 'CONFLICT'])
  await p.invalidate('id')
  expect(await p.compareAndSet('id', owned, { ...owned, version: 2, lifecycle: 'READY' })).toBe('CONFLICT')
  expect(await p.read('id')).toBeNull()
})
it('BFF-JS-MEMORY: rotation is atomic and old bound logout fences its successor', async () => {
  const p = provider({ now: () => 1000 }), r: BffRecord = { ...record(), lifecycle: 'SEND_INTENT', operation: { fence: 'f', expiresAt: 2000 } }
  await p.create('old', r)
  expect(await p.rotate('old', r, 'new', record('SESSION'))).toBe('COMMITTED')
  expect(await p.rotate('old', r, 'other', record('SESSION'))).toBe('CONFLICT')
  await p.invalidate('old')
  expect(await p.read('new')).toBeNull()
})
it('BFF-JS-MEMORY: limits and immutable deadlines cannot be bypassed by CAS', async () => {
  const p = provider({ now: () => 1000, maxRecordBytes: 1024 }), r = record()
  await p.create('a', r)
  await expect(p.compareAndSet('a', r, { ...r, version: 1, absoluteExpiresAt: 99999 }))
    .rejects.toMatchObject({ code: 'SESSION_STORE_UNAVAILABLE' })
  await expect(p.create('large', { ...r, owner: 'x'.repeat(2000) })).rejects.toMatchObject({ code: 'SESSION_STORE_CAPACITY' })
  for (const config of [{ replicas: 2 }, { workers: 2 }, { maxPrelogins: 0 }, { cleanupIntervalMs: Infinity }])
    expect(() => provider(config)).toThrow()
})
it('BFF-JS-MEMORY: an expired send intent refuses commit even without another reader', async () => {
  let now = 1000
  const p = provider({ now: () => now })
  const r: BffRecord = { ...record(), lifecycle: 'SEND_INTENT', operation: { fence: 'old', expiresAt: 1100 } }
  await p.create('id', r)
  now = 1200
  expect(await p.compareAndSet('id', r, { ...r, version: 1, lifecycle: 'READY', operation: undefined })).toBe('CONFLICT')
  expect(await p.read('id')).toBeNull()
  await p.create('id', r)
  expect(await p.rotate('id', r, 'late', record('SESSION'))).toBe('CONFLICT')
  expect(await p.read('late')).toBeNull()
})
