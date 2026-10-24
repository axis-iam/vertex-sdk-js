import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useIdentityOperations } from './useIdentityOperations'

const store = vi.hoisted(() => ({
  subscribe: () => () => {},
  getSnapshot: () => null,
  cancelProviderWindow: vi.fn(),
}))
vi.mock('../provider/IamProvider', () => ({ useIamContext: () => ({ client: {} }) }))
vi.mock('../core/identity-operation-store', () => ({ identityOperationStore: () => store }))

it('revokes the owned provider window when the hook unmounts', () => {
  const hook = renderHook(() => useIdentityOperations())
  expect(store.cancelProviderWindow).not.toHaveBeenCalled()
  hook.unmount()
  expect(store.cancelProviderWindow).toHaveBeenCalledOnce()
})
