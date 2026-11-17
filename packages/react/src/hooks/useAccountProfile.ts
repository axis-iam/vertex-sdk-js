import { useCallback, useEffect } from 'react'
import type { AccountProfile, AccountUpdateProfileInput } from '../core/types'
import { IamApiError } from '../core/types'
import { useAccountRequestState } from './useAccountRequestState'

export interface UseAccountProfileOptions {
  enabled?: boolean
}

export interface UseAccountProfileResult {
  profile: AccountProfile | null
  isLoading: boolean
  isUpdating: boolean
  error: Error | null
  refetch: () => Promise<AccountProfile | null>
  updateProfile: (input: AccountUpdateProfileInput) => Promise<AccountProfile>
}

export function useAccountProfile(options: UseAccountProfileOptions = {}): UseAccountProfileResult {
  const { enabled = true } = options
  const { client, isAuthenticated, isLoaded, begin, patch, value } = useAccountRequestState({
    profile: null as AccountProfile | null, isLoading: enabled, isUpdating: false, error: null as Error | null,
  })

  const requireAuthenticated = useCallback(() => {
    if (isAuthenticated) return null
    return new IamApiError('Authentication is required', {
      status: 401,
      code: 'UNAUTHENTICATED',
    })
  }, [isAuthenticated])

  const refetch = useCallback(async () => {
    const request = begin('profile')
    if (!request.isCurrent()) return null
    const authError = requireAuthenticated()
    if (authError) {
      patch(request, { profile: null, error: authError, isLoading: false })
      return null
    }

    patch(request, { isLoading: true, isUpdating: false, error: null })
    try {
      const next = await client.getAccountProfile()
      if (!request.isCurrent()) return null
      patch(request, { profile: next })
      return next
    } catch (err) {
      if (!request.isCurrent()) return null
      const next = err instanceof Error ? err : new Error('Account profile is unavailable')
      patch(request, { profile: null, error: next })
      return null
    } finally {
      patch(request, { isLoading: false })
    }
  }, [client, requireAuthenticated, begin, patch])

  const updateProfile = useCallback(async (input: AccountUpdateProfileInput) => {
    const request = begin('profile')
    request.assertCurrent()
    const authError = requireAuthenticated()
    if (authError) {
      patch(request, { error: authError })
      throw authError
    }

    patch(request, { isUpdating: true, isLoading: false, error: null })
    try {
      const next = await client.updateAccountProfile(input)
      request.assertCurrent()
      patch(request, { profile: next })
      return next
    } catch (err) {
      request.assertCurrent()
      const next = err instanceof Error ? err : new Error('Account profile could not be updated')
      patch(request, { error: next })
      throw next
    } finally {
      patch(request, { isUpdating: false })
    }
  }, [client, requireAuthenticated, begin, patch])

  useEffect(() => {
    const request = begin('profile')
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
    updateProfile,
  }
}
