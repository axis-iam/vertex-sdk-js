import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { ProviderOperationWindow } from './provider-operation-window'
let popup: {
  closed: boolean
  location: { href: string }
  close: ReturnType<typeof vi.fn>
}
let owner: boolean
const binding = {
  redirectUri: 'https://app.test/callback',
  authorizationUrl: 'https://provider.test/auth',
  authorizationId: 'authz',
  operationId: 'op',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
}
const callback =
  'https://app.test/callback?operation_id=op&authorization_id=authz&identity_operation=proof_pending'
beforeEach(() => {
  owner = true
  popup = { closed: false, location: { href: 'about:blank' }, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
})
afterEach(() => vi.restoreAllMocks())
const open = () =>
  new ProviderOperationWindow(() => {
    if (!owner) throw new Error('owner changed')
  })
it('opens from the gesture and accepts only its exact registered callback source and IDs', () => {
  const flow = open()
  expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
  flow.navigate(binding)
  expect(popup.location.href).toBe(binding.authorizationUrl)
  expect(() => flow.callbackUrl()).toThrow()
  popup.location.href = callback
  expect(flow.callbackUrl()).toBe(callback)
  flow.close()
  expect(popup.close).toHaveBeenCalledOnce()
  expect(() => flow.callbackUrl()).toThrow()
})
it('reports blocked popup before any authorization request or top-level navigation', () => {
  vi.mocked(window.open).mockReturnValue(null)
  expect(open).toThrow('blocked')
})
it.each([
  'origin',
  'state',
  'duplicate',
  'token',
  'closed',
  'expired',
  'owner',
] as const)('rejects %s result', (mode) => {
  const flow = open()
  flow.navigate(binding)
  popup.location.href = callback
  if (mode === 'origin')
    popup.location.href = callback.replace('app.test', 'evil.test')
  if (mode === 'state')
    popup.location.href = callback.replace(
      'authorization_id=authz',
      'authorization_id=other',
    )
  if (mode === 'duplicate') popup.location.href += '&operation_id=op'
  if (mode === 'token') popup.location.href += '&access_token=never'
  if (mode === 'closed') popup.closed = true
  if (mode === 'expired')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(binding.expiresAt))
  if (mode === 'owner') owner = false
  expect(() => flow.callbackUrl()).toThrow()
})
