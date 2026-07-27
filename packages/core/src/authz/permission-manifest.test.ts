import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  PermissionManifestClient,
  PermissionManifestError,
  preparePermissionManifest,
  runPermissionManifestStartup,
} from './permission-manifest.js'

const nullManifest = {
  manifestId: 'orders-api',
  revision: 'git:abc123',
  permissions: [{ resource: 'posts', action: 'read', name: 'Read posts', description: null }],
}

const sharedFixture = JSON.parse(readFileSync(new URL('../../../../../docs/fixtures/permission-manifest-vectors.json', import.meta.url), 'utf8')) as {
  vectors: Array<{ name: string, permissions: typeof nullManifest.permissions, fingerprint: string }>
  localReject: string[]
  responseReject: string[]
  retry: { statuses: number[], terminalStatuses: number[], validRetryAfterSeconds: number[], invalidRetryAfter: string[] }
}

describe('permission manifest synchronization', () => {
  it('consumes the complete shared vector matrix', async () => {
    for (const vector of sharedFixture.vectors) {
      const prepared = await preparePermissionManifest({ ...nullManifest, permissions: vector.permissions }, 'validate')
      expect(prepared.fingerprint, vector.name).toBe(vector.fingerprint)
    }
    for (const name of sharedFixture.localReject) {
      let permissions: typeof nullManifest.permissions
      switch (name) {
        case 'duplicate-resource-action-key': permissions = [nullManifest.permissions[0]!, nullManifest.permissions[0]!]; break
        case 'non-nfc-string': permissions = [{ ...nullManifest.permissions[0]!, name: 'Cafe\u0301' }]; break
        case 'malformed-or-wildcard-key': permissions = [{ ...nullManifest.permissions[0]!, resource: '*' }]; break
        case 'name-over-128-utf16-units': permissions = [{ ...nullManifest.permissions[0]!, name: 'x'.repeat(129) }]; break
        case 'description-over-512-utf16-units': permissions = [{ ...nullManifest.permissions[0]!, description: 'x'.repeat(513) }]; break
        default: throw new Error(`unknown shared localReject vector ${name}`)
      }
      await expect(preparePermissionManifest({ ...nullManifest, permissions }, 'validate'), name).rejects.toThrow()
    }
  })

  it('shares three attempts across issuer and Portal and redacts invalid token bodies', async () => {
    const observations: unknown[] = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'sensitive-bearer', token_type: 'Bearer', expires_in: 60, scope: 'wrong' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret', maxRetryDelayMs: 1, observer: event => observations.push(event) })
    const error = await client.validate(nullManifest).catch((value: unknown) => value) as PermissionManifestError
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(error.code).toBe('INVALID_TOKEN_SCOPE')
    expect(JSON.stringify(error)).not.toContain('sensitive-bearer')
    expect(observations).toEqual([expect.objectContaining({ mode: 'validate', outcome: 'ERROR', status: 200 })])
    expect(JSON.stringify(observations)).not.toContain('sensitive-bearer')
    vi.unstubAllGlobals()
  })

  it('uses one three-attempt budget across issuer and Portal', async () => {
    const unavailable = JSON.stringify({ status: 503, error: 'UNAVAILABLE', message: 'down', timestamp: '2026-07-17T00:00:00Z' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(unavailable, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(unavailable, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret', maxRetryDelayMs: 1 })
    await expect(client.validate(nullManifest)).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })

  it('uses one stable code for malformed error and result responses', () => {
    expect(PermissionManifestError.fromResponse(400, [], null).code).toBe('INVALID_ERROR_RESPONSE')
  })

  it('rejects a success response missing required fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    const error = await client.validate(nullManifest).catch((value: unknown) => value) as PermissionManifestError
    expect(error.code).toBe('INVALID_MANIFEST_RESPONSE')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://portal.test/open/v1/permission-manifests:sync')
    vi.unstubAllGlobals()
  })

  it('returns the stable typed error when only counts is missing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as Record<string, unknown>
        return Promise.resolve(new Response(JSON.stringify({ mode: request.mode, manifestId: request.manifestId, revision: request.revision, fingerprint: request.fingerprint, applied: false, results: [], drift: [] }), { status: 200 }))
      })
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    await expect(client.validate(nullManifest)).rejects.toMatchObject({ code: 'INVALID_MANIFEST_RESPONSE' })
    vi.unstubAllGlobals()
  })

  it.each([
    'mode', 'manifestId', 'revision', 'fingerprint', 'applied', 'results', 'drift', 'counts',
    'counts.created', 'counts.updated', 'counts.unchanged', 'counts.resurrected', 'counts.conflict', 'counts.drift',
    'item.key', 'item.operation', 'item.reason', 'drift.key', 'drift.kind', 'drift.source',
  ])('maps missing required response field %s to INVALID_MANIFEST_RESPONSE', async (missing) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as Record<string, unknown>
        const counts: Record<string, unknown> = { created: 0, updated: 0, unchanged: 0, resurrected: 0, conflict: 0, drift: 0 }
        const result: Record<string, unknown> = { mode: request.mode, manifestId: request.manifestId, revision: request.revision, fingerprint: request.fingerprint, applied: false, results: [], drift: [], counts }
        if (missing.startsWith('counts.')) delete counts[missing.slice('counts.'.length)]
        else if (missing.startsWith('item.')) {
          const item: Record<string, unknown> = { key: 'posts:read', operation: 'UNCHANGED', reason: 'DECLARATION_ACCEPTED' }
          delete item[missing.slice('item.'.length)]
          result.results = [item]
          counts.unchanged = 1
        } else if (missing.startsWith('drift.')) {
          const drift: Record<string, unknown> = { key: 'posts:read', kind: 'ABSENT_DECLARATION', source: 'CODE' }
          delete drift[missing.slice('drift.'.length)]
          result.drift = [drift]
          counts.drift = 1
        } else delete result[missing]
        return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))
      })
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    await expect(client.validate(nullManifest)).rejects.toMatchObject({ code: 'INVALID_MANIFEST_RESPONSE' })
    vi.unstubAllGlobals()
  })

  it('never retains malformed token JSON or issuer descriptions', async () => {
    const malformedFetch = vi.fn().mockResolvedValue(new Response('{"access_token":"sensitive-bearer"', { status: 200 }))
    vi.stubGlobal('fetch', malformedFetch)
    const malformedClient = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret', maxRetries: 0 })
    const malformed = await malformedClient.validate(nullManifest).catch((value: unknown) => value) as PermissionManifestError
    expect(malformed).toMatchObject({ code: 'INVALID_JSON_RESPONSE', details: undefined })
    expect(JSON.stringify(malformed)).not.toContain('sensitive-bearer')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client', error_description: 'secret diagnostic' }), { status: 400 })))
    const protocolClient = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret', maxRetries: 0 })
    const protocol = await protocolClient.validate(nullManifest).catch((value: unknown) => value) as PermissionManifestError
    expect(protocol).toMatchObject({ code: 'invalid_client', message: 'Permission manifest machine token request failed', details: undefined })
    expect(JSON.stringify(protocol)).not.toContain('secret diagnostic')
    vi.unstubAllGlobals()
  })

  it.each(sharedFixture.responseReject)('rejects shared response vector %s', async (name) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 }))
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        if (name === 'malformed-json') return Promise.resolve(new Response('{', { status: 200 }))
        if (name === 'missing-required-field') return Promise.resolve(new Response('{}', { status: 200 }))
        const request = JSON.parse(String(init.body)) as Record<string, unknown>
        const result = { mode: request.mode, manifestId: request.manifestId, revision: request.revision, fingerprint: request.fingerprint, applied: false, results: [] as unknown[], drift: [], counts: { created: 0, updated: 0, unchanged: 0, resurrected: 0, conflict: 0, drift: 0 } }
        if (name === 'unknown-result-enum') { result.results = [{ key: 'posts:read', operation: 'UNKNOWN', reason: 'DECLARATION_ACCEPTED' }] }
        if (name === 'wrong-counts') result.counts.created = 1
        if (name === 'duplicate-json-member-where-supported') return Promise.resolve(new Response(JSON.stringify(result).replace('{"mode":"validate"', '{"mode":"validate","mode":"invalid"'), { status: 200 }))
        if (!['unknown-result-enum', 'wrong-counts'].includes(name)) throw new Error(`unknown shared responseReject vector ${name}`)
        return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))
      })
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    await expect(client.validate(nullManifest)).rejects.toMatchObject({ code: name === 'malformed-json' ? 'INVALID_JSON_RESPONSE' : 'INVALID_MANIFEST_RESPONSE' })
    vi.unstubAllGlobals()
  })
  it('matches the backend frozen JCS null vector', async () => {
    const prepared = await preparePermissionManifest(nullManifest, 'validate')
    expect(prepared.fingerprint).toBe('bd2036720114f62abecb2850b61c165763a9cf1ee3736eab2bd59b9646aae9b5')
    expect(prepared.permissions[0]?.description).toBeNull()
  })

  it('sorts structured declarations and rejects duplicate and non-NFC input', async () => {
    const prepared = await preparePermissionManifest({
      manifestId: 'orders-api', revision: '1', permissions: [
        { resource: 'users', action: 'read', name: 'Read users', description: null },
        { resource: 'orders_', action: 'write', name: 'Write underscored orders', description: null },
        { resource: 'orders-', action: 'write', name: 'Write dashed orders', description: null },
        { resource: 'orders', action: 'write', name: 'Café', description: 'café/日' },
      ],
    }, 'upsert')
    expect(prepared.permissions.map((item) => `${item.resource}:${item.action}`)).toEqual([
      'orders-:write', 'orders:write', 'orders_:write', 'users:read',
    ])
    await expect(preparePermissionManifest({ ...nullManifest, permissions: [nullManifest.permissions[0]!, nullManifest.permissions[0]!] }, 'validate')).rejects.toThrow('duplicate')
    await expect(preparePermissionManifest({ ...nullManifest, permissions: [{ ...nullManifest.permissions[0]!, name: 'Cafe\u0301' }] }, 'validate')).rejects.toThrow('NFC')
    await expect(preparePermissionManifest({ ...nullManifest, permissions: [{ ...nullManifest.permissions[0]!, resource: '*' }] }, 'validate')).rejects.toThrow('key')
    await expect(preparePermissionManifest({ ...nullManifest, permissions: [{ ...nullManifest.permissions[0]!, name: 'x'.repeat(129) }] }, 'validate')).rejects.toThrow('name')
    await expect(preparePermissionManifest({ ...nullManifest, permissions: [{ ...nullManifest.permissions[0]!, description: 'x'.repeat(513) }] }, 'validate')).rejects.toThrow('description')
  })

  it('defaults startup to disabled with zero network work', async () => {
    const client = { validate: vi.fn(), upsert: vi.fn() } as unknown as PermissionManifestClient
    await expect(runPermissionManifestStartup(client, nullManifest)).resolves.toEqual({ networkAttempted: false, continued: false, result: null })
    expect(client.validate).not.toHaveBeenCalled()
    expect(client.upsert).not.toHaveBeenCalled()
  })

  it('requires an explicit development failure policy', async () => {
    const client = { validate: vi.fn(), upsert: vi.fn() } as unknown as PermissionManifestClient
    await expect(runPermissionManifestStartup(client, nullManifest, { mode: 'DEVELOPMENT_STARTUP' })).rejects.toThrow('failurePolicy')
  })

  it('requires and emits a redacted CONTINUE event', async () => {
    const error = new PermissionManifestError('sdk-owned message', 503, 'UNAVAILABLE', { secret: 'must-not-flow' })
    const client = { upsert: vi.fn().mockRejectedValue(error) } as unknown as PermissionManifestClient
    await expect(runPermissionManifestStartup(client, nullManifest, { mode: 'DEVELOPMENT_STARTUP', failurePolicy: 'CONTINUE', idempotencyKey: 'continue-key' })).rejects.toThrow('onContinueError')
    const events: unknown[] = []
    await expect(runPermissionManifestStartup(client, nullManifest, { mode: 'DEVELOPMENT_STARTUP', failurePolicy: 'CONTINUE', idempotencyKey: 'continue-key', onContinueError: event => events.push(event) })).resolves.toEqual({ networkAttempted: true, continued: true, result: null })
    expect(events).toEqual([{ mode: 'DEVELOPMENT_STARTUP', outcome: 'CONTINUED', status: 503, code: 'UNAVAILABLE' }])
    expect(JSON.stringify(events)).not.toContain('must-not-flow')
  })

  it('maps typed errors and accepts only bounded numeric Retry-After', () => {
    const valid = PermissionManifestError.fromResponse(429, { status: 429, error: 'RATE_LIMITED', message: 'limited', timestamp: '2026-07-16T00:00:00Z', correlationId: 'c' }, '12')
    expect(valid.retryAfterSeconds).toBe(12)
    const invalid = PermissionManifestError.fromResponse(503, { status: 503, error: 'UNAVAILABLE', message: 'down', timestamp: '2026-07-16T00:00:00Z', correlationId: 'c' }, 'Wed, 21 Oct 2015 07:28:00 GMT')
    expect(invalid.retryAfterSeconds).toBeUndefined()
    for (const seconds of sharedFixture.retry.validRetryAfterSeconds) expect(PermissionManifestError.fromResponse(429, { status: 429, error: 'RATE_LIMITED', message: 'limited', timestamp: '2026-07-16T00:00:00Z' }, String(seconds)).retryAfterSeconds).toBe(seconds)
    for (const value of sharedFixture.retry.invalidRetryAfter) expect(PermissionManifestError.fromResponse(429, { status: 429, error: 'RATE_LIMITED', message: 'limited', timestamp: '2026-07-16T00:00:00Z' }, value).retryAfterSeconds).toBeUndefined()
  })

  it.each(sharedFixture.retry.statuses)('retries shared retry status %s', async (status) => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      calls += 1
      if (calls === 1) return Promise.resolve(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 }))
      if (calls === 2) return Promise.resolve(new Response('{}', { status }))
      const request = JSON.parse(String(init.body)) as Record<string, unknown>
      return Promise.resolve(new Response(JSON.stringify({ mode: request.mode, manifestId: request.manifestId, revision: request.revision, fingerprint: request.fingerprint, applied: false, results: [], drift: [], counts: { created: 0, updated: 0, unchanged: 0, resurrected: 0, conflict: 0, drift: 0 } }), { status: 200 }))
    }))
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret', maxRetryDelayMs: 1 })
    await expect(client.validate({ ...nullManifest, permissions: [] })).resolves.toMatchObject({ mode: 'validate' })
    expect(calls).toBe(3)
    vi.unstubAllGlobals()
  })

  it.each(sharedFixture.retry.terminalStatuses)('does not retry shared terminal status %s', async (status) => {
    const body = { status, error: 'TERMINAL', message: 'terminal', timestamp: '2026-07-17T00:00:00Z' }
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'safe', token_type: 'Bearer', expires_in: 60, scope: 'permissions:sync' }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new PermissionManifestClient({ issuerEndpoint: 'https://issuer.test', portalApiEndpoint: 'https://portal.test', clientId: 'id', clientSecret: 'secret' })
    await expect(client.validate(nullManifest)).rejects.toMatchObject({ status })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
})

describe.skipIf(process.env.IAM_PERMISSION_MANIFEST_E2E !== '1')('permission manifest live E2E', () => {
  it('runs exact-scope sync, replay, authorization negatives, and stored-state validation', async () => {
    const config = {
      issuerEndpoint: requireEnv('IAM_MANIFEST_ISSUER'),
      portalApiEndpoint: requireEnv('IAM_MANIFEST_PORTAL'),
      clientId: requireEnv('IAM_MANIFEST_CLIENT_ID'),
      clientSecret: requireEnv('IAM_MANIFEST_CLIENT_SECRET'),
      maxRetries: 0,
    }
    const manifest = {
      manifestId: requireEnv('IAM_MANIFEST_ID'),
      revision: 'e2e-1',
      permissions: [
        { resource: 'orders', action: 'write', name: 'Café', description: 'café/日' },
        { resource: 'users', action: 'read', name: 'Read users', description: null },
      ],
    }
    const client = new PermissionManifestClient(config)
    const validate = await client.validate(manifest)
    const first = await client.upsert(manifest, 'sdk-js-replay-key')
    const replay = await client.upsert(manifest, 'sdk-js-replay-key')
    const stored = await client.validate(manifest)
    expect(validate.fingerprint).toBe(first.fingerprint)
    expect(replay).toEqual(first)
    expect(stored.results.every((item) => item.operation === 'UNCHANGED')).toBe(true)
    await expect(client.upsert({ ...manifest, revision: 'e2e-2' }, 'sdk-js-replay-key')).rejects.toMatchObject({ status: 409 })
    const wrong = new PermissionManifestClient({ ...config, clientId: requireEnv('IAM_MANIFEST_WRONG_CLIENT_ID'), clientSecret: requireEnv('IAM_MANIFEST_WRONG_CLIENT_SECRET') })
    await expect(wrong.validate(manifest)).rejects.toMatchObject({ status: 401 })
    const cross = new PermissionManifestClient({ ...config, clientId: requireEnv('IAM_MANIFEST_CROSS_CLIENT_ID'), clientSecret: requireEnv('IAM_MANIFEST_CROSS_CLIENT_SECRET') })
    await expect(cross.validate(manifest)).rejects.toMatchObject({ status: 404 })
    const crossApplication = new PermissionManifestClient({ ...config, clientId: requireEnv('IAM_MANIFEST_APP_B_CLIENT_ID'), clientSecret: requireEnv('IAM_MANIFEST_APP_B_CLIENT_SECRET') })
    const isolated = await crossApplication.validate(manifest)
    expect(isolated.results.every((item) => item.operation === 'CREATE')).toBe(true)
  })

})

describe.skipIf(!process.env.IAM_PERMISSION_MANIFEST_NEGATIVE_E2E)('permission manifest negative live E2E', () => {
  it('does not retry terminal 409 and bounds real 429 retry', async () => {
    const mode = requireEnv('IAM_PERMISSION_MANIFEST_NEGATIVE_E2E')
    const manifest = { manifestId: `m3-negative-js-${mode}`, revision: '1', permissions: [] }
    const common = {
      issuerEndpoint: requireEnv('IAM_NEG_ISSUER'),
      clientId: requireEnv(mode === 'rate' ? 'IAM_NEG_RATE_CLIENT_ID' : 'IAM_NEG_CLIENT_ID'),
      clientSecret: requireEnv(mode === 'rate' ? 'IAM_NEG_RATE_CLIENT_SECRET' : 'IAM_NEG_CLIENT_SECRET'),
      maxRetries: mode === 'rate' ? 1 : 2,
      maxRetryDelayMs: 1,
    }
    if (mode === 'terminal') {
      const direct = new PermissionManifestClient({ ...common, portalApiEndpoint: requireEnv('IAM_NEG_PORTAL') })
      await direct.upsert(manifest, 'sdk-js-terminal-key')
      const proxied = new PermissionManifestClient({ ...common, portalApiEndpoint: requireEnv('IAM_NEG_PROXY') })
      await expect(proxied.upsert({ ...manifest, revision: '2' }, 'sdk-js-terminal-key')).rejects.toMatchObject({ status: 409 })
      return
    }
    const proxied = new PermissionManifestClient({ ...common, portalApiEndpoint: requireEnv('IAM_NEG_PROXY') })
    await expect(proxied.validate(manifest)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' })
  })
})

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
