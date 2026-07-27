import { useCallback, useEffect, useState } from 'react'
import type { AccountSecuritySummary } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseAccountSecurityOptions {
  enabled?: boolean
}

export interface UseAccountSecurityResult {
  security: AccountSecuritySummary | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<AccountSecuritySummary | null>
}

export function useAccountSecurity(options: UseAccountSecurityOptions = {}): UseAccountSecurityResult {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true } = options
  const [security, setSecurity] = useState<AccountSecuritySummary | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setSecurity(null)
      setError(next)
      setIsLoading(false)
      return null
    }

    setIsLoading(true)
    setError(null)
    try {
      const next = await client.getAccountSecuritySummary()
      setSecurity(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account security summary is unavailable')
      setSecurity(null)
      setError(next)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [client, isAuthenticated])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }
    if (!isLoaded) {
      setIsLoading(true)
      return
    }

    let cancelled = false
    async function load() {
      const next = await refetch()
      if (cancelled) return
      setSecurity(next)
    }

    void load()
    return () => { cancelled = true }
  }, [enabled, isLoaded, refetch])

  return {
    security,
    isLoading,
    error,
    refetch,
  }
}
