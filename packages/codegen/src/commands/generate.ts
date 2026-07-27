import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { preparePermissionManifest } from '@axis-iam/vertex/server'
import { generatePermissionsTsFromManifest } from '../generators/typescript.js'
import { loadManifest } from './upload.js'

export interface GenerateOptions {
  manifest: string
  output: string
  constName?: string
}

/** Local-only manifest generation. No HTTP client or credential is constructed. */
export async function generateCommand(options: GenerateOptions): Promise<void> {
  const manifest = loadManifest(options.manifest)
  await preparePermissionManifest(manifest, 'validate')
  const source = generatePermissionsTsFromManifest(manifest, options.constName)
  mkdirSync(dirname(options.output), { recursive: true })
  writeFileSync(options.output, source, 'utf8')
}
