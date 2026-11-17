import { useCallback, useEffect } from 'react'
import type { AccountOrganization } from '../core/types'
import { IamApiError } from '../core/types'
import { useAccountRequestState } from './useAccountRequestState'

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
  const { enabled = true } = options
  const { client, isAuthenticated, isLoaded, begin, patch, value } = useAccountRequestState({
    organizations: [] as AccountOrganization[], currentOrganization: null as AccountOrganization | null,
    isLoading: enabled, error: null as Error | null,
  })

  const refetch = useCallback(async () => {
    const request = begin('read')
    if (!request.isCurrent()) return []
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      patch(request, { organizations: [], currentOrganization: null, error: next, isLoading: false })
      return []
    }

    patch(request, { isLoading: true, error: null })
    try {
      const next = await client.listAccountOrganizations()
      if (!request.isCurrent()) return []
      patch(request, { organizations: next, currentOrganization: next.find((item) => item.current) ?? null })
      return next
    } catch (err) {
      if (!request.isCurrent()) return []
      const next = err instanceof Error ? err : new Error('Organizations are unavailable')
      patch(request, { organizations: [], currentOrganization: null, error: next })
      return []
    } finally {
      patch(request, { isLoading: false })
    }
  }, [client, isAuthenticated, begin, patch])

  useEffect(() => {
    const request = begin('read')
    if (!enabled) {
      patch(request, { isLoading: false })
      return
    }
    if (!isLoaded) {
      patch(request, { isLoading: true })
      return
    }

    void refetch()
  }, [enabled, isLoaded, refetch, begin, patch])

  return {
    ...value,
    refetch,
  }
}
