import { useCallback } from 'react'
import type { OrganizationSwitchResponse } from '../core/types'
import { IamApiError } from '../core/types'
import { useAccountRequestState } from './useAccountRequestState'
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
  const { client, isAuthenticated, begin, patch, value } = useAccountRequestState({
    isSwitching: false, switchResponse: null as OrganizationSwitchResponse | null,
  })
  const organizationsState = useAccountOrganizations(options)

  const switchOrganization = useCallback(async (organizationId: string) => {
    const request = begin('switch')
    request.assertCurrent()
    if (!isAuthenticated) {
      const next = new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
      throw next
    }

    patch(request, { isSwitching: true })
    try {
      const next = await client.switchAccountOrganization(organizationId)
      request.assertCurrent()
      patch(request, { switchResponse: next })
      return next
    } catch (error) {
      request.assertCurrent()
      throw error
    } finally {
      patch(request, { isSwitching: false })
    }
  }, [client, isAuthenticated, begin, patch])

  return {
    ...organizationsState,
    ...value,
    switchOrganization,
  }
}
