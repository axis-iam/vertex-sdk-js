import { useMemo } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { requestNoContent } from '../core/http-client'

/**
 * Detect and manage impersonation sessions.
 * Reads the authenticated API context and its exact impersonation ID.
 *
 * @example
 * ```tsx
 * const { isImpersonating, actorId, endImpersonation } = useImpersonation()
 * if (isImpersonating) {
 *   return <Banner>Admin {actorId} is impersonating you</Banner>
 * }
 * ```
 */
export function useImpersonation() {
  const { user, client } = useIamContext()

  const isImpersonating = useMemo(() => user?.isImpersonating ?? false, [user])
  const actorId = useMemo(() => user?.actorId, [user])
  const sessionId = user?.authenticationContext.impersonation?.impersonationId

  async function endImpersonation(): Promise<void> {
    const token = client.getAccessToken()
    if (!token || !sessionId || !client.isAuthenticated()) throw new Error('No active impersonation session')

    const generation = client.state.generation
    const config = await client.discover()
    client.state.assertCurrent(generation, token)
    await requestNoContent(`${config.issuer}/platform/v1/impersonate/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      bearerToken: token,
    })

    client.state.assertCurrent(generation, token)
    client.state.clear()
  }

  return { isImpersonating, actorId, sessionId, endImpersonation }
}
