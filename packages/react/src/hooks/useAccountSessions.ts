import { useCallback, useEffect, useState } from 'react'
import type { AccountSession, LogoutAccountOptions } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseAccountSessionsOptions {
  enabled?: boolean
}

export interface UseAccountSessionsResult {
  sessions: AccountSession[]
  isLoading: boolean
  isRevoking: boolean
  isRevokingOthers: boolean
  isLoggingOut: boolean
  error: Error | null
  refetch: () => Promise<AccountSession[]>
  revokeSession: (sessionId: string) => Promise<void>
  revokeOtherSessions: () => Promise<void>
  logoutAccount: (options?: LogoutAccountOptions) => Promise<void>
}

export function useAccountSessions(options: UseAccountSessionsOptions = {}): UseAccountSessionsResult {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true } = options
  const [sessions, setSessions] = useState<AccountSession[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [isRevoking, setIsRevoking] = useState(false)
  const [isRevokingOthers, setIsRevokingOthers] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
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
      setSessions([])
      setError(authError)
      setIsLoading(false)
      return []
    }

    setIsLoading(true)
    setError(null)
    try {
      const next = await client.listAccountSessions()
      setSessions(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account sessions are unavailable')
      setSessions([])
      setError(next)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [client, requireAuthenticated])

  const revokeSession = useCallback(async (sessionId: string) => {
    const authError = requireAuthenticated()
    if (authError) {
      setError(authError)
      throw authError
    }

    setIsRevoking(true)
    setError(null)
    try {
      await client.revokeAccountSession(sessionId)
      setSessions((current) => current.filter((session) => session.sessionId !== sessionId))
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account session could not be revoked')
      setError(next)
      throw next
    } finally {
      setIsRevoking(false)
    }
  }, [client, requireAuthenticated])

  const revokeOtherSessions = useCallback(async () => {
    const authError = requireAuthenticated()
    if (authError) {
      setError(authError)
      throw authError
    }

    setIsRevokingOthers(true)
    setError(null)
    try {
      await client.revokeOtherAccountSessions()
      setSessions((current) => current.filter((session) => session.current))
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Other account sessions could not be revoked')
      setError(next)
      throw next
    } finally {
      setIsRevokingOthers(false)
    }
  }, [client, requireAuthenticated])

  const logoutAccount = useCallback(async (logoutOptions?: LogoutAccountOptions) => {
    const authError = requireAuthenticated()
    if (authError) {
      setError(authError)
      throw authError
    }

    setIsLoggingOut(true)
    setError(null)
    try {
      await client.logoutAccount(logoutOptions)
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account logout could not be completed')
      setError(next)
      throw next
    } finally {
      setIsLoggingOut(false)
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

    void refetch()
  }, [enabled, isLoaded, refetch])

  return {
    sessions,
    isLoading,
    isRevoking,
    isRevokingOthers,
    isLoggingOut,
    error,
    refetch,
    revokeSession,
    revokeOtherSessions,
    logoutAccount,
  }
}
