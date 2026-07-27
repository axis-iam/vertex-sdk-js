import { useCallback, useEffect, useState } from 'react'
import type {
  AccountPermissionCheckInput,
  AccountPermissionCheckResponse,
  AccountPermissionSummary,
} from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseAccountPermissionsOptions {
  enabled?: boolean
  organizationId?: string | null
}

export interface UseAccountPermissionsResult {
  summary: AccountPermissionSummary | null
  lastCheck: AccountPermissionCheckResponse | null
  isLoading: boolean
  isChecking: boolean
  error: Error | null
  refetch: (organizationId?: string | null) => Promise<AccountPermissionSummary | null>
  checkPermission: (input: AccountPermissionCheckInput) => Promise<AccountPermissionCheckResponse>
}

export function useAccountPermissions(options: UseAccountPermissionsOptions = {}): UseAccountPermissionsResult {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true, organizationId = null } = options
  const [summary, setSummary] = useState<AccountPermissionSummary | null>(null)
  const [lastCheck, setLastCheck] = useState<AccountPermissionCheckResponse | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [isChecking, setIsChecking] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const requireAuthenticated = useCallback(() => {
    if (isAuthenticated) return null
    return new IamApiError('Authentication is required', {
      status: 401,
      code: 'UNAUTHENTICATED',
    })
  }, [isAuthenticated])

  const refetch = useCallback(async (nextOrganizationId?: string | null) => {
    const authError = requireAuthenticated()
    if (authError) {
      setSummary(null)
      setError(authError)
      setIsLoading(false)
      return null
    }

    setIsLoading(true)
    setError(null)
    try {
      const targetOrganizationId = nextOrganizationId === undefined ? organizationId : nextOrganizationId
      const next = await client.getAccountPermissionSummary(targetOrganizationId)
      setSummary(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account permissions are unavailable')
      setSummary(null)
      setError(next)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [client, organizationId, requireAuthenticated])

  const checkPermission = useCallback(async (input: AccountPermissionCheckInput) => {
    const authError = requireAuthenticated()
    if (authError) {
      setError(authError)
      throw authError
    }

    setIsChecking(true)
    setError(null)
    try {
      const next = await client.checkAccountPermission({
        ...input,
        organizationId: input.organizationId === undefined ? organizationId : input.organizationId,
      })
      setLastCheck(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account permission could not be checked')
      setError(next)
      throw next
    } finally {
      setIsChecking(false)
    }
  }, [client, organizationId, requireAuthenticated])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }
    if (!isLoaded) {
      setIsLoading(true)
      return
    }

    void refetch(organizationId)
  }, [enabled, isLoaded, organizationId, refetch])

  return {
    summary,
    lastCheck,
    isLoading,
    isChecking,
    error,
    refetch,
    checkPermission,
  }
}
