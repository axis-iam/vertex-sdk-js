import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../core/oauth-client'
import type { IdentityProviderOption } from '../core/types'
import { useIdentityProviders } from './useIdentityProviders'

vi.mock('../provider/IamProvider', () => ({ useIamContext: () => ({ client }) }))
let client: OAuthClient
const provider: IdentityProviderOption = {
  id: 'backend-id', applicationId: 'app', name: 'backend-name', displayName: 'Backend label', providerType: 'OIDC',
  enabled: true, protocol: 'OIDC', supportsBrokeredToken: true,
  authorizationUrl: 'https://iam.example.invalid/provider', samlAcsUrl: null,
}
beforeEach(() => {
  client = new OAuthClient({ clientId: 'canonical-client', issuerUri: 'https://iam.example.invalid', redirectUri: '/callback' })
})
afterEach(() => { cleanup(); client.dispose(); vi.restoreAllMocks() })

describe('useIdentityProviders canonical discovery', () => {
  it('preserves exact backend IDs/labels across load and refetch without matching aliases', async () => {
    const twin = { ...provider, id: 'other-id' }
    const list = vi.spyOn(client, 'listIdentityProviders').mockResolvedValue([provider, twin, { ...provider, enabled: false }])
    const h = renderHook(() => useIdentityProviders())
    await waitFor(() => expect(h.result.current.isLoading).toBe(false))
    expect(h.result.current.error).toBeNull()
    expect(h.result.current.providers).toEqual([provider, twin])
    const updated = { ...twin, displayName: 'Updated by backend' }
    list.mockResolvedValue([updated])
    await act(async () => { expect(await h.result.current.refetch()).toEqual([updated]) })
    expect(h.result.current.providers).toEqual([updated])
  })

  it('exposes unsupported discovery only on explicit request, without marking it enabled', async () => {
    const disabled = { ...provider, enabled: false, protocol: 'SAML', authorizationUrl: null }
    vi.spyOn(client, 'listIdentityProviders').mockResolvedValue([disabled])
    const h = renderHook(() => useIdentityProviders({ includeUnsupported: true }))
    await waitFor(() => expect(h.result.current.isLoading).toBe(false))
    expect(h.result.current.providers).toEqual([disabled])
    expect(h.result.current.providers[0]?.enabled).toBe(false)
  })

  it('preserves empty and failed discovery as distinct states rather than inventing providers', async () => {
    const list = vi.spyOn(client, 'listIdentityProviders').mockResolvedValue([])
    const h = renderHook(() => useIdentityProviders())
    await waitFor(() => expect(h.result.current.isLoading).toBe(false))
    expect(h.result.current.providers).toEqual([])
    expect(h.result.current.error).toBeNull()
    const failure = new Error('Discovery failed')
    list.mockRejectedValue(failure)
    await act(async () => { await h.result.current.refetch() })
    expect(h.result.current.providers).toEqual([])
    expect(h.result.current.error).toBe(failure)
  })

  it('does not discover until enabled', async () => {
    const list = vi.spyOn(client, 'listIdentityProviders').mockResolvedValue([provider])
    const h = renderHook(({ enabled }) => useIdentityProviders({ enabled }), { initialProps: { enabled: false } })
    expect(list).not.toHaveBeenCalled()
    expect(h.result.current.providers).toEqual([])
    h.rerender({ enabled: true })
    await waitFor(() => expect(h.result.current.providers).toEqual([provider]))
  })
})
