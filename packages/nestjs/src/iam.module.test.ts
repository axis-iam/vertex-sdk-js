import { describe, expect, it, vi } from 'vitest'
import { IamModule, type IamModuleConfig } from './iam.module.js'

const config: IamModuleConfig = {
  endpoint: 'https://issuer.test',
  clientId: 'server-client',
  clientSecret: 'secret',
  resourceAudience: 'api://app',
}

describe('IamModule permission manifest startup', () => {
  it('defaults to disabled with zero network work', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const module = IamModule.forRoot(config)
    const provider = module.providers?.find(value => typeof value === 'object' && value !== null && 'provide' in value && value.provide === 'IAM_BOOTSTRAP') as { useFactory: () => Promise<void> }
    await provider.useFactory()
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('guarantees a redacted adapter event for explicit CONTINUE', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('issuer unavailable')))
    const module = IamModule.forRoot({ ...config, permissionManifest: {
      portalApiEndpoint: 'https://portal.test',
      manifest: { manifestId: 'nest-app', revision: '1', permissions: [] },
      startup: { mode: 'DEVELOPMENT_STARTUP', failurePolicy: 'CONTINUE', idempotencyKey: 'nest-continue-key' },
    } })
    const provider = module.providers?.find(value => typeof value === 'object' && value !== null && 'provide' in value && value.provide === 'IAM_BOOTSTRAP') as { useFactory: () => Promise<void> }
    await expect(provider.useFactory()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('IAM permission manifest startup continued', expect.objectContaining({ mode: 'DEVELOPMENT_STARTUP', outcome: 'CONTINUED', status: 0, code: 'UNEXPECTED_ERROR' }))
    expect(JSON.stringify(warn.mock.calls)).not.toContain('issuer unavailable')
    warn.mockRestore()
    vi.unstubAllGlobals()
  })
})
