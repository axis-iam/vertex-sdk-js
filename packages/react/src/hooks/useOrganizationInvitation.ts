import { useCallback, useEffect, useState } from 'react'
import type {
  PublicOrganizationInvitationAcceptResponse,
  PublicOrganizationInvitationPreview,
} from '../core/types'
import { useIamContext } from '../provider/IamProvider'

export interface UseOrganizationInvitationOptions {
  enabled?: boolean
}

export interface UseOrganizationInvitationResult {
  preview: PublicOrganizationInvitationPreview | null
  acceptResponse: PublicOrganizationInvitationAcceptResponse | null
  isPreviewLoading: boolean
  isAccepting: boolean
  error: Error | null
  previewInvitation: () => Promise<PublicOrganizationInvitationPreview | null>
  acceptInvitation: () => Promise<PublicOrganizationInvitationAcceptResponse>
}

export function useOrganizationInvitation(
  token: string | null | undefined,
  options: UseOrganizationInvitationOptions = {},
): UseOrganizationInvitationResult {
  const { client } = useIamContext()
  const { enabled = true } = options
  const [preview, setPreview] = useState<PublicOrganizationInvitationPreview | null>(null)
  const [acceptResponse, setAcceptResponse] = useState<PublicOrganizationInvitationAcceptResponse | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(Boolean(enabled && token))
  const [isAccepting, setIsAccepting] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const requireToken = useCallback(() => {
    if (token) return token
    throw new Error('Organization invitation token is required')
  }, [token])

  const previewInvitation = useCallback(async () => {
    if (!token) {
      setPreview(null)
      setIsPreviewLoading(false)
      return null
    }

    setIsPreviewLoading(true)
    setError(null)
    try {
      const next = await client.previewOrganizationInvitation(token)
      setPreview(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Invitation preview is unavailable')
      setPreview(null)
      setError(next)
      return null
    } finally {
      setIsPreviewLoading(false)
    }
  }, [client, token])

  const acceptInvitation = useCallback(async () => {
    const rawToken = requireToken()
    setIsAccepting(true)
    setError(null)
    try {
      const next = await client.acceptOrganizationInvitation(rawToken)
      setAcceptResponse(next)
      return next
    } catch (err) {
      const next = err instanceof Error ? err : new Error('Invitation could not be accepted')
      setError(next)
      throw next
    } finally {
      setIsAccepting(false)
    }
  }, [client, requireToken])

  useEffect(() => {
    if (!enabled) {
      setIsPreviewLoading(false)
      return
    }

    void previewInvitation()
  }, [enabled, previewInvitation])

  return {
    preview,
    acceptResponse,
    isPreviewLoading,
    isAccepting,
    error,
    previewInvitation,
    acceptInvitation,
  }
}
