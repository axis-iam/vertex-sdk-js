import { useCallback, useEffect, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import type { IdentityProviderOption } from '../core/types'
import { applyLegacySocialProviderOverrides, isClickableIdentityProvider } from '../core/identity-providers'

export interface UseIdentityProvidersOptions {
  /** Include SAML, disabled, or otherwise unsupported providers in the result. */
  includeUnsupported?: boolean
  /** Set to false to skip discovery until the caller is ready. */
  enabled?: boolean
}

export interface UseIdentityProvidersResult {
  providers: IdentityProviderOption[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<IdentityProviderOption[]>
}

export function useIdentityProviders(options: UseIdentityProvidersOptions = {}): UseIdentityProvidersResult {
  const { client } = useIamContext()
  const { includeUnsupported = false, enabled = true } = options
  const [providers, setProviders] = useState<IdentityProviderOption[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  const loadProviders = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const discovered = await client.listIdentityProviders()
      const withOverrides = applyLegacySocialProviderOverrides(
        discovered,
        client.config.socialProviders,
      )
      const visibleProviders = includeUnsupported
        ? withOverrides
        : withOverrides.filter(isClickableIdentityProvider)
      setProviders(visibleProviders)
      return visibleProviders
    } catch (err) {
      const errorValue = err instanceof Error ? err : new Error('Identity provider discovery failed')
      setError(errorValue)
      setProviders([])
      return []
    } finally {
      setIsLoading(false)
    }
  }, [client, includeUnsupported])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    client.listIdentityProviders()
      .then((discovered) => {
        if (cancelled) return
        const withOverrides = applyLegacySocialProviderOverrides(
          discovered,
          client.config.socialProviders,
        )
        setProviders(includeUnsupported ? withOverrides : withOverrides.filter(isClickableIdentityProvider))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error('Identity provider discovery failed'))
        setProviders([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [client, includeUnsupported, enabled])

  return {
    providers,
    isLoading,
    error,
    refetch: loadProviders,
  }
}
