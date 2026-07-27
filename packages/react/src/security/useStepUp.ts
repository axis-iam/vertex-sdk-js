import { useCallback, useMemo } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { requestNoContent } from '../core/http-client'

/**
 * Step-up authentication hook.
 * Triggers MFA challenge for sensitive operations.
 *
 * @example
 * ```tsx
 * const { stepUp, isSteppedUp } = useStepUp()
 * async function handleSensitive() {
 *   if (!isSteppedUp) await stepUp({ reason: 'Confirm payment' })
 *   // proceed with sensitive action
 * }
 * ```
 */
export function useStepUp() {
  const { user, client } = useIamContext()

  const isSteppedUp = useMemo(() => {
    return user?.raw.acr === 'urn:iam:acr:mfa'
  }, [user?.raw.acr])

  const stepUp = useCallback(async (options?: { reason?: string }) => {
    const token = client.getAccessToken()
    if (!token) throw new Error('Not authenticated')

    await requestNoContent(`${(await client.discover()).issuer}/api/v1/auth/step-up/challenge`, {
      method: 'POST',
      bearerToken: token,
      json: { reason: options?.reason },
    })

    // After step-up, the server issues a new token with elevated acr
    // The token refresh mechanism will pick up the new token
    const authenticationProvenance = client.tokenManager.getAuthenticationProvenance()
    const refreshProvenance = client.tokenManager.getRefreshProvenance()
    if (!authenticationProvenance || !refreshProvenance) throw new Error('Refresh token provenance is missing')
    const tokens = await client.refreshToken()
    client.tokenManager.store(tokens, authenticationProvenance, refreshProvenance)
    await client.fetchPermissions()
  }, [client])

  return { stepUp, isSteppedUp }
}
