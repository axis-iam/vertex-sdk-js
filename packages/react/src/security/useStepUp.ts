import { useCallback } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { requestJson } from '../core/http-client'
import { IamConfigurationError } from '../core/types'

export type StepUpTrigger = 'PASSWORD_CHANGE' | 'MFA_CHANGE' | 'LOGIN_METHOD_CHANGE' | 'ACCOUNT_DELETE'
  | 'ADMIN_ACCOUNT_RECOVERY_VERIFY' | 'ADMIN_ACCOUNT_RECOVERY' | 'ADMIN_IMPERSONATION'
  | 'GLOBAL_IDENTITY_FREEZE' | 'SECRET_ROTATION'

/** The server owns purpose/session-bound grants; displayed assurance is never a grant. */
export function useStepUp() {
  const { user, client } = useIamContext()
  const start = useCallback(async (trigger: StepUpTrigger, reason?: string) => {
    if (client.mode === 'server_session') return client.startStepUp(trigger, reason ?? trigger)
    const token = client.getAccessToken()
    if (!token || !client.isAuthenticated()) throw new Error('Not authenticated')
    const generation = client.state.generation
    const config = await client.discover()
    client.state.assertCurrent(generation, token)
    const data = await requestJson<{ challengeId: string; availableMethods: string[] }>(
      `${config.issuer}/api/v1/auth/step-up/start`, { bearerToken: token, json: { trigger, ...(reason ? { reason } : {}) } })
    client.state.assertCurrent(generation, token)
    if (!data || typeof data.challengeId !== 'string' || !data.challengeId || !Array.isArray(data.availableMethods)
      || !data.availableMethods.every(method => method === 'totp' || method === 'webauthn'))
      throw new IamConfigurationError('Invalid step-up challenge')
    // Continuations capture this token and generation; another login cannot reuse the challenge.
    return { challengeId: data.challengeId, availableMethods: data.availableMethods, verifyTotp: async (code: string) => {
      client.state.assertCurrent(generation, token)
      if (!client.isAuthenticated()) throw new Error('Not authenticated')
      if (!data.availableMethods.includes('totp')) throw new IamConfigurationError('TOTP is unavailable for this challenge')
      const result = await requestJson<{ verified: boolean }>(`${config.issuer}/api/v1/auth/step-up/verify`,
        { bearerToken: token, json: { challengeId: data.challengeId, code } })
      client.state.assertCurrent(generation, token)
      if (result?.verified !== true) throw new IamConfigurationError('Step-up was not verified')
      // The sensitive API consumes the server grant. No refresh or local "stepped up" flag.
    } }
  }, [client])
  return { start, authenticationContext: user?.authenticationContext ?? null }
}
