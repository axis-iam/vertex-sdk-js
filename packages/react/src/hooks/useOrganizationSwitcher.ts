import { useCallback, useState } from 'react'
import type { OrganizationSwitchResponse } from '../core/types'
import { IamApiError } from '../core/types'
import { useIamContext } from '../provider/IamProvider'
import { useAccountOrganizations } from './useAccountOrganizations'
import type { UseAccountOrganizationsOptions } from './useAccountOrganizations'

export interface UseOrganizationSwitcherOptions extends UseAccountOrganizationsOptions {}

export interface UseOrganizationSwitcherResult extends ReturnType<typeof useAccountOrganizations> {
  isSwitching: boolean
  switchResponse: OrganizationSwitchResponse | null
  switchOrganization: (organizationId: string) => Promise<OrganizationSwitchResponse>
}

export function useOrganizationSwitcher(
  options: UseOrganizationSwitcherOptions = {},
): UseOrganizationSwitcherResult {
  const { client, isAuthenticated } = useIamContext()
  const organizationsState = useAccountOrganizations(options)
  const [isSwitching, setIsSwitching] = useState(false)
  const [switchResponse, setSwitchResponse] = useState<OrganizationSwitchResponse | null>(null)

  const switchOrganization = useCallback(async (organizationId: string) => {
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      throw next
    }

    setIsSwitching(true)
    try {
      const next = await client.switchAccountOrganization(organizationId)
      setSwitchResponse(next)
      return next
    } finally {
      setIsSwitching(false)
    }
  }, [client, isAuthenticated])

  return {
    ...organizationsState,
    isSwitching,
    switchResponse,
    switchOrganization,
  }
}
