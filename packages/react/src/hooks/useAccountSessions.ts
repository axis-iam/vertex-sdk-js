import { useCallback, useEffect } from 'react'
import type { AccountSession } from '../core/types'
import { IamApiError } from '../core/types'
import { useAccountRequestState } from './useAccountRequestState'

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
  logoutAccount: () => Promise<void>
}

export function useAccountSessions(options: UseAccountSessionsOptions = {}): UseAccountSessionsResult {
  const { enabled = true } = options
  const { client, isAuthenticated, isLoaded, begin, patch, value } = useAccountRequestState({
    sessions: [] as AccountSession[], isLoading: enabled, isRevoking: false,
    isRevokingOthers: false, isLoggingOut: false, error: null as Error | null,
  })

  const requireAuthenticated = useCallback(() => {
    if (isAuthenticated) return null
    return new IamApiError('Authentication is required', {
      status: 401,
      code: 'UNAUTHENTICATED',
    })
  }, [isAuthenticated])

  const refetch = useCallback(async () => {
    const request = begin('read')
    if (!request.isCurrent()) return []
    const authError = requireAuthenticated()
    if (authError) {
      patch(request, { sessions: [], error: authError, isLoading: false })
      return []
    }

    patch(request, { isLoading: true, error: null })
    try {
      const next = await client.listAccountSessions()
      if (!request.isCurrent()) return []
      patch(request, { sessions: next })
      return next
    } catch (err) {
      if (!request.isCurrent()) return []
      const next = err instanceof Error ? err : new Error('Account sessions are unavailable')
      patch(request, { sessions: [], error: next })
      return []
    } finally {
      patch(request, { isLoading: false })
    }
  }, [client, requireAuthenticated, begin, patch])

  const revokeSession = useCallback(async (sessionId: string) => {
    const request = begin('revoke')
    request.assertCurrent()
    const authError = requireAuthenticated()
    if (authError) {
      patch(request, { error: authError })
      throw authError
    }

    patch(request, { isRevoking: true, error: null })
    try {
      await client.revokeAccountSession(sessionId)
      request.assertCurrent()
      patch(request, current => ({ sessions: current.sessions.filter(session => session.sessionId !== sessionId) }))
    } catch (err) {
      request.assertCurrent()
      const next = err instanceof Error ? err : new Error('Account session could not be revoked')
      patch(request, { error: next })
      throw next
    } finally {
      patch(request, { isRevoking: false })
    }
  }, [client, requireAuthenticated, begin, patch])

  const revokeOtherSessions = useCallback(async () => {
    const request = begin('revokeOthers')
    request.assertCurrent()
    const authError = requireAuthenticated()
    if (authError) {
      patch(request, { error: authError })
      throw authError
    }

    patch(request, { isRevokingOthers: true, error: null })
    try {
      await client.revokeOtherAccountSessions()
      request.assertCurrent()
      patch(request, current => ({ sessions: current.sessions.filter(session => session.current) }))
    } catch (err) {
      request.assertCurrent()
      const next = err instanceof Error ? err : new Error('Other account sessions could not be revoked')
      patch(request, { error: next })
      throw next
    } finally {
      patch(request, { isRevokingOthers: false })
    }
  }, [client, requireAuthenticated, begin, patch])

  const logoutAccount = useCallback(async () => {
    const request = begin('logout')
    request.assertCurrent()
    const authError = requireAuthenticated()
    if (authError) {
      patch(request, { error: authError })
      throw authError
    }

    patch(request, { isLoggingOut: true, error: null })
    // Both clients clear synchronously before awaiting the server response.
    // Capture that intentional cleared generation, including on the error path.
    const completion = client.logoutAccount()
    const generation = client.state.generation
    try {
      await completion
      client.state.assertCurrent(generation)
      request.assertAttached()
    } catch (err) {
      client.state.assertCurrent(generation)
      request.assertAttached()
      const next = err instanceof Error ? err : new Error('Account logout could not be completed')
      patch(request, { error: next })
      throw next
    } finally {
      patch(request, { isLoggingOut: false })
    }
  }, [client, requireAuthenticated, begin, patch])

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
    revokeSession,
    revokeOtherSessions,
    logoutAccount,
  }
}
