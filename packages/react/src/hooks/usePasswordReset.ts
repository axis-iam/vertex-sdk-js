import { useCallback, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import type { RequestPasswordResetInput, ResetPasswordInput } from '../core/types'

export interface UsePasswordResetResult {
  requestPasswordReset: (input: RequestPasswordResetInput) => Promise<void>
  resetPassword: (input: ResetPasswordInput) => Promise<void>
  isLoading: boolean
  error: Error | null
}

export function usePasswordReset(): UsePasswordResetResult {
  const { client } = useIamContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const requestPasswordReset = useCallback(async (input: RequestPasswordResetInput) => {
    setIsLoading(true)
    setError(null)
    try {
      await client.requestPasswordReset(input)
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Password reset request failed')
      setError(next)
      throw next
    } finally {
      setIsLoading(false)
    }
  }, [client])

  const resetPassword = useCallback(async (input: ResetPasswordInput) => {
    setIsLoading(true)
    setError(null)
    try {
      await client.resetPassword(input)
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Password reset failed')
      setError(next)
      throw next
    } finally {
      setIsLoading(false)
    }
  }, [client])

  return {
    requestPasswordReset,
    resetPassword,
    isLoading,
    error,
  }
}
