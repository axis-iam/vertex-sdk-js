import { useCallback, useEffect, useRef, useState } from 'react'
import { clearPendingAccountLink, getPendingAccountLink } from '../core/account-linking'
import type { AccountLinkCallbackResult } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export type AccountLinkCallbackStatus = 'idle' | 'loading' | 'success' | 'error'

export interface UseAccountLinkCallbackOptions {
  enabled?: boolean
  searchParams?: URLSearchParams | string
  scrubUrl?: boolean
  onSuccess?: (result: AccountLinkCallbackResult) => void
  onError?: (error: Error) => void
}

export interface UseAccountLinkCallbackResult {
  status: AccountLinkCallbackStatus
  result: AccountLinkCallbackResult | null
  error: Error | null
  handleCallback: () => Promise<AccountLinkCallbackResult | null>
}

export function useAccountLinkCallback(
  options: UseAccountLinkCallbackOptions = {},
): UseAccountLinkCallbackResult {
  const { client } = useIamContext()
  const {
    enabled = true,
    searchParams,
    scrubUrl = true,
    onSuccess,
    onError,
  } = options
  const [status, setStatus] = useState<AccountLinkCallbackStatus>(enabled ? 'loading' : 'idle')
  const [result, setResult] = useState<AccountLinkCallbackResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  }, [onSuccess, onError])

  const handleCallback = useCallback(async () => {
    setStatus('loading')
    setResult(null)
    setError(null)

    const params = resolveSearchParams(searchParams)
    const linkTicket = params.get('link_ticket')
    const state = params.get('state')
    const failed = params.get('account_link') === 'failed' || params.has('error')

    if (scrubUrl) {
      scrubCurrentUrl()
    }

    try {
      if (!client.isAuthenticated()) {
        clearPendingAccountLink()
        throw new IamApiError('Authentication is required', {
          status: 401,
          code: 'UNAUTHENTICATED',
        })
      }

      if (failed) {
        clearPendingAccountLink()
        throw new IamApiError('Account linking was not completed', {
          status: 400,
          code: 'ACCOUNT_LINK_FAILED',
        })
      }

      if (!linkTicket || !state) {
        clearPendingAccountLink()
        throw new IamApiError('Account linking callback is incomplete', {
          status: 400,
          code: 'ACCOUNT_LINK_CALLBACK_INVALID',
        })
      }

      const pending = getPendingAccountLink()
      if (!pending || pending.state !== state) {
        clearPendingAccountLink()
        throw new IamApiError('Account linking could not be verified', {
          status: 400,
          code: 'ACCOUNT_LINK_STATE_MISMATCH',
        })
      }

      const exchangeResult = await client.exchangeAccountLinkTicket({
        linkTicket,
        state,
      })
      clearPendingAccountLink()
      setResult(exchangeResult)
      setStatus('success')
      onSuccessRef.current?.(exchangeResult)
      return exchangeResult
    } catch (err) {
      clearPendingAccountLink()
      const next = err instanceof Error ? err : new Error('Account linking could not be completed')
      setError(next)
      setStatus('error')
      onErrorRef.current?.(next)
      return null
    }
  }, [client, scrubUrl, searchParams])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }

    void handleCallback()
  }, [enabled, handleCallback])

  return {
    status,
    result,
    error,
    handleCallback,
  }
}

function resolveSearchParams(searchParams: URLSearchParams | string | undefined): URLSearchParams {
  if (searchParams instanceof URLSearchParams) {
    return searchParams
  }
  if (typeof searchParams === 'string') {
    return new URLSearchParams(searchParams.startsWith('?') ? searchParams.slice(1) : searchParams)
  }
  if (typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search)
  }
  return new URLSearchParams()
}

function scrubCurrentUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const nextUrl = `${window.location.pathname}${window.location.hash}`
    window.history.replaceState({}, document.title, nextUrl)
  } catch {
    // Ignore history failures in embedded or restricted browser contexts.
  }
}
