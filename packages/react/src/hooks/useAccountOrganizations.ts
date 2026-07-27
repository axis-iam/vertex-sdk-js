import { useCallback, useEffect, useState } from 'react'
import type { AccountOrganization } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseAccountOrganizationsOptions {
  enabled?: boolean
}

export interface UseAccountOrganizationsResult {
  organizations: AccountOrganization[]
  currentOrganization: AccountOrganization | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<AccountOrganization[]>
}

export function useAccountOrganizations(options: UseAccountOrganizationsOptions = {}): UseAccountOrganizationsResult {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true } = options
  const [organizations, setOrganizations] = useState<AccountOrganization[]>([])
  const [currentOrganization, setCurrentOrganization] = useState<AccountOrganization | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setOrganizations([])
      setCurrentOrganization(null)
      setError(next)
      setIsLoading(false)
      return []
    }

    setIsLoading(true)
    setError(null)
    try {
      const next = await client.listAccountOrganizations()
      setOrganizations(next)
      setCurrentOrganization(next.find((item) => item.current) ?? null)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Organizations are unavailable')
      setOrganizations([])
      setCurrentOrganization(null)
      setError(next)
      return []
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

    void refetch()
  }, [enabled, isLoaded, refetch])

  return {
    organizations,
    currentOrganization,
    isLoading,
    error,
    refetch,
  }
}
