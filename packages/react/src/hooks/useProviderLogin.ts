import { useCallback, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import type { AuthMethodIdpProviderResponse, IdentityProviderOption, ProviderAuthorizationOptions } from '../core/types'

export interface UseProviderLoginResult {
  isLoading: boolean
  error: Error | null
  startProviderLogin: (
    provider: string | IdentityProviderOption | AuthMethodIdpProviderResponse,
    options?: ProviderAuthorizationOptions,
  ) => Promise<string>
}

export function useProviderLogin(): UseProviderLoginResult {
  const { client } = useIamContext()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const startProviderLogin = useCallback(async (
    provider: string | IdentityProviderOption | AuthMethodIdpProviderResponse,
    options?: ProviderAuthorizationOptions,
  ) => {
    setIsLoading(true)
    setError(null)
    try {
      return await client.startProviderAuthorizationFlow(provider, options)
    } catch (err) {
      const errorValue = err instanceof Error ? err : new Error('Provider sign-in failed')
      setError(errorValue)
      throw errorValue
    } finally {
      setIsLoading(false)
    }
  }, [client])

  return {
    isLoading,
    error,
    startProviderLogin,
  }
}
