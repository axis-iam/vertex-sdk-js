import { createContext, useState, useSyncExternalStore } from 'react'
import { accountSecurityStore } from '../core/account-security-store'
import { useIamContext } from '../provider/IamProvider'

const terminal = (state: string) => ['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(state)

/** Internal only: the panel renders the host's confirmation instead of a second prompt. */
export function useAccountSecurityExit() {
  const { client } = useIamContext()
  const actions = accountSecurityStore(client)
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot)
  const [intent, setIntent] = useState<{ client: typeof client; generation: number; ref: string; leave?: () => void; trigger: HTMLElement | null } | null>(null)
  const current = intent?.client === client && intent.generation === client.state.generation && intent.ref === state.operation?.ref ? intent : null
  const confirming = current !== null && state.operation !== null && !terminal(state.operation.state)
  const request = (leave?: () => void) => {
    const snapshot = actions.getSnapshot()
    if (snapshot.pending || snapshot.uncertain || snapshot.uncertainCreate) return
    if (snapshot.operation && !terminal(snapshot.operation.state)) {
      // Repeated close/Escape/navigation keeps the first exit intent and its focus target.
      if (!current) setIntent({ client, generation: client.state.generation, ref: snapshot.operation.ref, leave, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null })
      return
    }
    if (leave) {
      if (snapshot.operation) actions.acknowledge()
      actions.clearSensitive()
      leave()
    }
  }
  const keep = () => {
    if (actions.getSnapshot().pending) return
    setIntent(null)
    if (current?.trigger?.isConnected && current.trigger.getClientRects().length > 0) current.trigger.focus()
  }
  const confirm = async () => {
    const snapshot = actions.getSnapshot()
    if (!current || !confirming || snapshot.operation?.ref !== current.ref || client.state.generation !== current.generation || snapshot.pending || snapshot.uncertain || snapshot.uncertainCreate) return
    try {
      const result = await actions.cancel()
      const latest = actions.getSnapshot()
      if (client.state.generation !== current.generation || latest.operation?.ref !== current.ref || latest.pending || latest.uncertain) return
      if (result?.state === 'CANCELLED' || result?.state === 'EXPIRED') {
        if (current.leave) { actions.acknowledge(); current.leave() }
      }
    } finally {
      setIntent(previous => previous === current ? null : previous)
    }
  }
  return { confirming, request, keep, confirm, reset: () => setIntent(null) }
}

export const AccountSecurityExitContext = createContext<ReturnType<typeof useAccountSecurityExit> | null>(null)
