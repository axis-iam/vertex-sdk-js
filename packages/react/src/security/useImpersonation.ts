import { useMemo } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { requestNoContent } from '../core/http-client'

/**
 * Detect and manage impersonation sessions.
 * When an admin impersonates a user, the JWT contains an `act` claim
 * with `sub` (admin ID) and `session_id` (impersonation session).
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
  const sessionId = useMemo(() => (user?.raw.act as { session_id?: string } | undefined)?.session_id, [user])

  async function endImpersonation(): Promise<void> {
    const token = client.getAccessToken()
    if (!token || !sessionId) return

    const config = await client.discover()
    await requestNoContent(`${config.issuer}/platform/v1/impersonate/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      bearerToken: token,
    })

    client.logout()
  }

  return { isImpersonating, actorId, sessionId, endImpersonation }
}
