import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadManifest } from './upload.js'

describe('loadManifest', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../../testdata/permission-manifest-vectors.json', import.meta.url), 'utf8')) as {
    manifestFiles: { accept: Array<{ name: string, json: string }>, reject: Array<{ name: string, json: string }> }
  }
  for (const vector of fixture.manifestFiles.accept) it(`accepts shared file vector ${vector.name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'iam-manifest-'))
    try {
      const path = join(directory, 'manifest.json')
      writeFileSync(path, vector.json, { mode: 0o600 })
      expect(loadManifest(path).manifestId).toBe('orders-api')
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
  for (const vector of fixture.manifestFiles.reject) it(`rejects shared file vector ${vector.name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'iam-manifest-'))
    try {
      const path = join(directory, 'manifest.json')
      writeFileSync(path, vector.json, { mode: 0o600 })
      expect(() => loadManifest(path)).toThrow()
    } finally {
      rmSync(directory, { recursive: true })
    }
  })
})
