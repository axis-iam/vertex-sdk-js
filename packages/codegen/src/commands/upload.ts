import { readFileSync } from 'node:fs'
import { evaluate, parse, traverse, type ObjectNode } from '@humanwhocodes/momoa'
import {
  PermissionManifestClient,
  preparePermissionManifest,
  type PermissionManifest,
} from '@axis-iam/vertex/server'

export interface UploadOptions {
  issuerEndpoint: string
  portalApiEndpoint: string
  clientId: string
  clientSecret: string
  manifest: string
  mode: 'validate' | 'upsert'
  idempotencyKey?: string
}

export async function uploadCommand(opts: UploadOptions): Promise<void> {
  const manifest = loadManifest(opts.manifest)
  await preparePermissionManifest(manifest, opts.mode)
  const client = new PermissionManifestClient(opts)
  const result = opts.mode === 'validate'
    ? await client.validate(manifest)
    : await client.upsert(manifest, requiredIdempotencyKey(opts.idempotencyKey))
  console.log(`mode=${result.mode} created=${result.counts.created} updated=${result.counts.updated} unchanged=${result.counts.unchanged} conflict=${result.counts.conflict} drift=${result.counts.drift}`)
}

export function loadManifest(path: string): PermissionManifest {
  const source = readFileSync(path, 'utf8')
  const ast = parse(source)
  traverse(ast, {
    enter(node) {
      if (node.type !== 'Object') return
      const names = new Set<string>()
      for (const member of (node as ObjectNode).members) {
        const name = member.name.type === 'String' ? member.name.value : member.name.name
        if (names.has(name)) throw new TypeError(`manifest contains duplicate JSON member ${name}`)
        names.add(name)
      }
    },
  })
  const value = evaluate(ast.body) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('manifest must be a JSON object')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== 'manifestId,permissions,revision') throw new TypeError('manifest must contain exactly manifestId, revision and permissions')
  if (!Array.isArray(record.permissions)) throw new TypeError('manifest permissions must be an array')
  const permissions = record.permissions.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('manifest permission declaration must be an object')
    const declaration = item as Record<string, unknown>
    if (Object.keys(declaration).sort().join(',') !== 'action,description,name,resource') throw new TypeError('manifest permission declaration fields must be exact')
    return {
      resource: declaration.resource as string,
      action: declaration.action as string,
      name: declaration.name as string,
      description: declaration.description as string | null,
    }
  })
  return { manifestId: record.manifestId as string, revision: record.revision as string, permissions }
}

function requiredIdempotencyKey(value: string | undefined): string {
  if (!value) throw new TypeError('upsert requires --idempotency-key')
  return value
}
