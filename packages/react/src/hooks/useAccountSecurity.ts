import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MfaCapabilities } from '@axis-iam/vertex'
import type { AccountSecuritySummary } from '../core/types'
import { useIamContext } from '../provider/IamProvider'
import { accountSecurityStore } from '../core/account-security-store'

export interface UseAccountSecurityOptions { enabled?: boolean }
export function useAccountSecurity(options: UseAccountSecurityOptions = {}) {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true } = options
  const generation = client.state.generation
  const actions = accountSecurityStore(client)
  const operationState = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot)
  const [result, setResult] = useState<{ client: typeof client; generation: number; security: AccountSecuritySummary | null; capabilities: MfaCapabilities | null; recoveryCodesRemaining: number | null; isLoading: boolean; error: Error | null }>({ client, generation, security: null, capabilities: null, recoveryCodesRemaining: null, isLoading: enabled, error: null })
  const epoch = useRef(0)
  const active = useRef(false)
  const refetch = useCallback(async () => {
    const request = ++epoch.current
    const current = () => active.current && request === epoch.current && generation === client.state.generation
    if (!enabled || !isLoaded || !isAuthenticated) {
      if (current()) setResult({ client, generation, security: null, capabilities: null, recoveryCodesRemaining: null, isLoading: enabled && !isLoaded, error: null })
      return null
    }
    // A refreshing snapshot is no longer an authority for a new mutation.
    if (current()) setResult({ client, generation, security: null, capabilities: null, recoveryCodesRemaining: null, isLoading: true, error: null })
    try {
      const [security, capabilities, recoveryCodesRemaining] = await Promise.all([client.getAccountSecuritySummary(), client.getMfaCapabilities(), client.getRecoveryCodesRemaining()])
      if (!current()) return null
      setResult({ client, generation, security, capabilities, recoveryCodesRemaining, isLoading: false, error: null })
      return security
    } catch (e) {
      if (current()) setResult({ client, generation, security: null, capabilities: null, recoveryCodesRemaining: null, isLoading: false, error: e instanceof Error ? e : new Error('Account security is unavailable') })
      return null
    }
  }, [client, generation, enabled, isAuthenticated, isLoaded])
  useEffect(() => {
    active.current = true
    void refetch()
    return () => { active.current = false; ++epoch.current }
  }, [refetch])
  const visible = enabled && isAuthenticated && !operationState.recoveryReceipt && result.client === client && result.generation === generation
  return {
    security: visible ? result.security : null,
    capabilities: visible ? result.capabilities : null,
    recoveryCodesRemaining: visible ? result.recoveryCodesRemaining : null,
    isLoading: visible ? result.isLoading : enabled && !isLoaded,
    error: visible ? result.error : null,
    refetch, state: operationState, actions,
  }
}
export type UseAccountSecurityResult = ReturnType<typeof useAccountSecurity>
