import { describe, expect, it } from 'vitest'
import { IamClient } from '../server.js'

describe.skipIf(process.env.IAM_PERMISSION_COMPATIBILITY_E2E !== '1')('permission compatibility live E2E', () => {
  it('parses the real nested snapshot and resolves the same role permissions', async () => {
    const clientId = required('IAM_COMPAT_CLIENT_ID')
    const client = new IamClient({
      endpoint: required('IAM_COMPAT_ISSUER'),
      clientId,
      clientSecret: required('IAM_COMPAT_CLIENT_SECRET'),
    })
    await expect(client.resolvePermissions(clientId, [])).resolves.toEqual({ permissions: [] })
    const snapshot = await client.listPermissions(clientId)
    const role = snapshot.roles.find((item) => item.key === 'm7d_reader')
    expect(new Set(role?.permissions)).toEqual(new Set(['orders:write', 'orders:*', '*:*']))
    const resolved = await client.resolvePermissions(clientId, ['m7d_reader'])
    expect(new Set(resolved.permissions)).toEqual(new Set(['orders:write', 'orders:*', '*:*']))
  })
})

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
