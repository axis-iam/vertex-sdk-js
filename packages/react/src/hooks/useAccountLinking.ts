import { useCallback, useState } from 'react'
import {
  generateAccountLinkState,
  isActionableLinkProvider,
  storePendingAccountLink,
} from '../core/account-linking'
import type {
  AccountLinkAuthorizeOptions,
  AccountLinkAuthorizeResult,
  LinkableIdentityProvider,
} from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface StartAccountLinkOptions extends AccountLinkAuthorizeOptions {
  provider?: LinkableIdentityProvider
  redirect?: boolean
  navigate?: (authorizationUrl: string) => void
}

export interface UseAccountLinkingOptions {
  onAfterChange?: () => void | Promise<void>
}

export interface UseAccountLinkingResult {
  isLoading: boolean
  isStarting: boolean
  isUnlinking: boolean
  error: Error | null
  startLink: (
    providerOrId: string | LinkableIdentityProvider,
    options?: StartAccountLinkOptions,
  ) => Promise<AccountLinkAuthorizeResult>
  unlink: (methodId: string) => Promise<void>
}

export function useAccountLinking(options: UseAccountLinkingOptions = {}): UseAccountLinkingResult {
  const { client, isAuthenticated } = useIamContext()
  const [isStarting, setIsStarting] = useState(false)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const startLink = useCallback(async (
    providerOrId: string | LinkableIdentityProvider,
    startOptions: StartAccountLinkOptions = {},
  ) => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setError(next)
      throw next
    }

    const provider = typeof providerOrId === 'string' ? startOptions.provider : providerOrId
    if (provider && !isActionableLinkProvider(provider)) {
      const next = new IamApiError('This provider cannot be connected', {
        status: 400,
        code: 'PROVIDER_NOT_LINKABLE',
      })
      setError(next)
      throw next
    }

    const idpId = typeof providerOrId === 'string' ? providerOrId : providerOrId.id
    const state = startOptions.state ?? generateAccountLinkState()

    setIsStarting(true)
    setError(null)
    try {
      const result = await client.startAccountLink(idpId, {
        redirectUri: startOptions.redirectUri,
        state,
      })
      if (result.state !== state) {
        const next = new IamApiError('Account linking could not be started safely', {
          status: 400,
          code: 'ACCOUNT_LINK_STATE_MISMATCH',
        })
        setError(next)
        throw next
      }

      storePendingAccountLink(result.state, {
        expiresAt: result.expiresAt,
        provider: provider
          ? {
              id: provider.id,
              displayName: provider.displayName,
              providerType: provider.providerType,
            }
          : { id: idpId },
      })

      if (startOptions.redirect !== false) {
        if (startOptions.navigate) {
          startOptions.navigate(result.authorizationUrl)
        } else if (typeof window !== 'undefined') {
          window.location.assign(result.authorizationUrl)
        }
      }

      return result
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account linking could not be started')
      setError(next)
      throw next
    } finally {
      setIsStarting(false)
    }
  }, [client, isAuthenticated])

  const unlink = useCallback(async (methodId: string) => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      setError(next)
      throw next
    }

    setIsUnlinking(true)
    setError(null)
    try {
      await client.unlinkAccountLoginMethod(methodId)
      await options.onAfterChange?.()
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Account could not be disconnected')
      setError(next)
      throw next
    } finally {
      setIsUnlinking(false)
    }
  }, [client, isAuthenticated, options])

  return {
    isLoading: isStarting || isUnlinking,
    isStarting,
    isUnlinking,
    error,
    startLink,
    unlink,
  }
}
