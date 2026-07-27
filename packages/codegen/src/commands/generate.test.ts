import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { generateCommand } from './generate.js'

describe('generateCommand', () => {
  it('generates locally without calling fetch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vertex-codegen-'))
    const manifest = join(directory, 'manifest.json')
    const output = join(directory, 'permissions.gen.ts')
    writeFileSync(manifest, JSON.stringify({
      manifestId: 'orders-api', revision: '1',
      permissions: [{ resource: 'orders', action: 'read', name: 'Read orders', description: null }],
    }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await generateCommand({ manifest, output })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(readFileSync(output, 'utf8')).toContain("ORDERS_READ: permKey(\"orders\", \"read\")")
    fetchSpy.mockRestore()
  })
})
