import { useCallback, useEffect, useState } from 'react'
import type { AccountProfile, AccountUpdateProfileInput } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

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
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true } = options
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const requireAuthenticated = useCallback(() => {
    if (isAuthenticated) return null
    return new IamApiError('Authentication is required', {
      status: 401,
      code: 'UNAUTHENTICATED',
    })
  }, [isAuthenticated])

  const refetch = useCallback(async () => {
    const authError = requireAuthenticated()
    if (authError) {
      setProfile(null)
      setError(authError)
      setIsLoading(false)
      return null
    }

    setIsLoading(true)
    setError(null)
    try {
      const next = await client.getAccountProfile()
      setProfile(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account profile is unavailable')
      setProfile(null)
      setError(next)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [client, requireAuthenticated])

  const updateProfile = useCallback(async (input: AccountUpdateProfileInput) => {
    const authError = requireAuthenticated()
    if (authError) {
      setError(authError)
      throw authError
    }

    setIsUpdating(true)
    setError(null)
    try {
      const next = await client.updateAccountProfile(input)
      setProfile(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account profile could not be updated')
      setError(next)
      throw next
    } finally {
      setIsUpdating(false)
    }
  }, [client, requireAuthenticated])

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
      const authError = requireAuthenticated()
      if (authError) {
        if (!cancelled) {
          setProfile(null)
          setError(authError)
          setIsLoading(false)
        }
        return
      }

      setIsLoading(true)
      setError(null)
      try {
        const next = await client.getAccountProfile()
        if (!cancelled) setProfile(next)
      } catch (err) {
        if (!cancelled) {
          setProfile(null)
          setError(err instanceof Error ? err : new Error('Account profile is unavailable'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [client, enabled, isLoaded, requireAuthenticated])

  return {
    profile,
    isLoading,
    isUpdating,
    error,
    refetch,
    updateProfile,
  }
}
