import { useCallback, useEffect, useMemo, useState } from 'react'
const isActionableLinkProvider = (provider: LinkableIdentityProvider) => provider.canLink
import type { LinkableIdentityProvider } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseLinkableIdentityProvidersOptions {
  enabled?: boolean
  includeUnsupported?: boolean
}

export interface UseLinkableIdentityProvidersResult {
  providers: LinkableIdentityProvider[]
  actionableProviders: LinkableIdentityProvider[]
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<LinkableIdentityProvider[]>
}

export function useLinkableIdentityProviders(
  options: UseLinkableIdentityProvidersOptions = {},
): UseLinkableIdentityProvidersResult {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const { enabled = true, includeUnsupported = true } = options
  const [providers, setProviders] = useState<LinkableIdentityProvider[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | null>(null)

  const visibleProviders = useMemo(() => {
    return includeUnsupported ? providers : providers.filter(isActionableLinkProvider)
  }, [includeUnsupported, providers])

  const actionableProviders = useMemo(() => {
    return providers.filter(isActionableLinkProvider)
  }, [providers])

  const loadProviders = useCallback(async () => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setProviders([])
      setError(next)
      setIsLoading(false)
      throw next
    }

    setIsLoading(true)
    setError(null)
    try {
      const next = await client.listLinkableIdentityProviders()
      setProviders(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Linkable providers are unavailable')
      setProviders([])
      setError(next)
      throw next
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
          setProviders([])
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
        const next = await client.listLinkableIdentityProviders()
        if (!cancelled) setProviders(next)
      } catch (err) {
        if (!cancelled) {
          setProviders([])
          setError(err instanceof Error ? err : new Error('Linkable providers are unavailable'))
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [client, enabled, isAuthenticated, isLoaded])

  return {
    providers: visibleProviders,
    actionableProviders,
    isLoading,
    error,
    refetch: loadProviders,
  }
}
