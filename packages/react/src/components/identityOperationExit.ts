import { createContext, useState, useSyncExternalStore } from 'react'
import { identityOperationStore } from '../core/identity-operation-store'
import { operationReference } from '../core/server-session-client'
import { useIamContext } from '../provider/IamProvider'

const terminal = (state: string) => ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(state)

/** Retains the first exit intent until this generation receives a definite cancellation. */
export function useIdentityOperationExit() {
  const { client } = useIamContext()
  const actions = identityOperationStore(client)
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot)
  const [intent, setIntent] = useState<{ client: typeof client; generation: number; ref: string; leave?: () => void } | null>(null)
  const current = intent?.client === client && intent.generation === client.state.generation && state.operation && intent.ref === operationReference(state.operation) ? intent : null
  const confirming = current !== null && state.operation !== null && !terminal(state.operation.state)
  const request = (leave?: () => void) => {
    const snapshot = actions.getSnapshot()
    if (snapshot.pending || snapshot.uncertain || snapshot.uncertainCreate || snapshot.cancelUnconfirmed) return
    if (snapshot.operation && !terminal(snapshot.operation.state)) {
      if (!current) setIntent({ client, generation: client.state.generation, ref: operationReference(snapshot.operation), leave })
      return
    }
    leave?.()
  }
  const keep = () => { if (!actions.getSnapshot().pending) setIntent(null) }
  const confirm = async () => {
    const snapshot = actions.getSnapshot()
    if (!current || !confirming || !snapshot.operation || operationReference(snapshot.operation) !== current.ref || client.state.generation !== current.generation || snapshot.pending || snapshot.uncertain || snapshot.uncertainCreate || snapshot.cancelUnconfirmed) return
    try {
      const recipient = snapshot.operation.type === 'TRANSFER' && !snapshot.operation.requiredProofs.some(proof => proof.purpose === 'CURRENT_ACCOUNT')
      const result = await (recipient ? actions.confirmTransfer('REJECT') : actions.cancel())
      const latest = actions.getSnapshot()
      if (client.state.generation !== current.generation || !latest.operation || operationReference(latest.operation) !== current.ref || latest.pending || latest.uncertain || latest.cancelUnconfirmed) return
      if (['CANCELLED', 'EXPIRED', 'REJECTED'].includes(result.state) && current.leave) { actions.acknowledge(); current.leave() }
    } finally {
      setIntent(previous => previous === current ? null : previous)
    }
  }
  return { confirming, request, keep, confirm, reset: () => setIntent(null) }
}

export const IdentityOperationExitContext = createContext<ReturnType<typeof useIdentityOperationExit> | null>(null)
