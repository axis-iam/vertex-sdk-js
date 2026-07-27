import { useCallback, useEffect, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import type { AccountLoginMethod } from '../core/types'
import { IamApiError } from '../core/types'

export interface UseAccountLoginMethodsOptions {
  enabled?: boolean
}

export interface UseAccountLoginMethodsResult {
  methods: AccountLoginMethod[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<AccountLoginMethod[]>
}

export function useAccountLoginMethods(options: UseAccountLoginMethodsOptions = {}): UseAccountLoginMethodsResult {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true } = options
  const [methods, setMethods] = useState<AccountLoginMethod[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  const loadMethods = useCallback(async () => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setMethods([])
      setError(next)
      setIsLoading(false)
      return []
    }

    setIsLoading(true)
    setError(null)
    try {
      const next = await client.listAccountLoginMethods()
      setMethods(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Login methods are unavailable')
      setMethods([])
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

    let cancelled = false
    async function load() {
      if (!isAuthenticated) {
        if (!cancelled) {
          setMethods([])
          setError(new IamApiError('Authentication is required', {
            status: 401,
            code: 'UNAUTHENTICATED',
          }))
          setIsLoading(false)
        }
        return
      }

      setIsLoading(true)
      setError(null)
      try {
        const next = await client.listAccountLoginMethods()
        if (!cancelled) setMethods(next)
      } catch (err) {
        if (!cancelled) {
          setMethods([])
          setError(err instanceof Error ? err : new Error('Login methods are unavailable'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [client, enabled, isAuthenticated, isLoaded])

  return {
    methods,
    isLoading,
    error,
    refetch: loadMethods,
  }
}
