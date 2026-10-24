import { useEffect, useState } from 'react'
import type { AccountIdentifier } from '@axis-iam/vertex'
import { useIamContext } from '../provider/IamProvider'
import { IamConfigurationError } from '../core/types'

/** The profile header uses the same primary-email facts as the identifiers list. */
export function usePrimaryEmail(revision = 0) {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const generation = client.state.generation
  const [result, setResult] = useState<{
    client: typeof client
    generation: number
    email: AccountIdentifier | null
    error: Error | null
  } | null>(null)
  useEffect(() => {
    if (!isLoaded || !isAuthenticated) return
    let active = true
    void client.identity.identifiers().then((facts) => {
      client.state.assertCurrent(generation)
      const primary = facts.items.filter((item) => item.kind === 'EMAIL' && item.isPrimary && item.status === 'ACTIVE')
      if (primary.length > 1) throw new IamConfigurationError('Multiple primary email identifiers')
      if (active) setResult({ client, generation, email: primary[0] ?? null, error: null })
    }).catch((error: unknown) => {
      if (active && client.state.generation === generation)
        setResult({ client, generation, email: null, error: error instanceof Error ? error : new IamConfigurationError('Primary email facts unavailable') })
    })
    return () => { active = false }
  }, [client, generation, isAuthenticated, isLoaded, revision])
  return result?.client === client && result.generation === generation && isAuthenticated
    ? result : { email: null, error: null }
}
