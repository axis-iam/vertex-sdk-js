import { useCallback } from 'react'
import { useIamContext } from '../provider/IamProvider'
import type { RegistrationGrantInput, RegistrationGrantPreviewResponse } from '../core/types'

/** Preview a caller-held registration proof without authenticating the browser request. */
export function useRegistrationGrantPreview(): (input: RegistrationGrantInput) => Promise<RegistrationGrantPreviewResponse> {
  const { client } = useIamContext()
  return useCallback(async (input: RegistrationGrantInput) => await client.previewRegistrationGrant(input), [client])
}
