import { useCallback, useState } from 'react'
import type { ChangePasswordInput } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseChangePasswordResult {
  isChanging: boolean
  error: Error | null
  changePassword: (input: ChangePasswordInput) => Promise<void>
}

export function useChangePassword(): UseChangePasswordResult {
  const { client, isAuthenticated } = useIamContext()
  const [isChanging, setIsChanging] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const changePassword = useCallback(async (input: ChangePasswordInput) => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setError(next)
      throw next
    }

    setIsChanging(true)
    setError(null)
    try {
      await client.changePassword(input)
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Password could not be changed')
      setError(next)
      throw next
    } finally {
      setIsChanging(false)
    }
  }, [client, isAuthenticated])

  return {
    isChanging,
    error,
    changePassword,
  }
}
