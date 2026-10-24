import { useEffect, useSyncExternalStore } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { identityOperationStore } from '../core/identity-operation-store'

/** Custom and AccountCenter consume the same operation state and public actions. */
export function useIdentityOperations() {
  const { client } = useIamContext()
  const actions = identityOperationStore(client)
  useEffect(() => () => actions.cancelProviderWindow(), [actions])
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot)
  return { state, actions }
}
