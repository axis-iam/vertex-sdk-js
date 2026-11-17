import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { OrganizationSwitchResponse } from '../core/types'
import { useOrganizationSwitcher } from '../hooks/useOrganizationSwitcher'
import type { Appearance } from './styles'
import { buttonStyle, errorStyle } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'
import { useAccountRequestState } from '../hooks/useAccountRequestState'

export interface OrganizationSwitcherProps {
  appearance?: Appearance
  hideWhenSingleOrganization?: boolean
  onSwitch?: (response: OrganizationSwitchResponse) => void | Promise<void>
}

export interface OrgSwitcherProps {
  appearance?: Appearance
  hideWhenSingleOrganization?: boolean
  onSwitch?: (orgId: string, response: OrganizationSwitchResponse) => void | Promise<void>
}

export function OrganizationSwitcher({
  appearance,
  hideWhenSingleOrganization = true,
  onSwitch,
}: OrganizationSwitcherProps) {
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance)
  const {
    organizations,
    currentOrganization,
    isLoading,
    isSwitching,
    error,
    switchOrganization,
  } = useOrganizationSwitcher()
  const { begin, patch, value: { open, actionError } } = useAccountRequestState({
    open: false, actionError: null as Error | null,
  })
  const setOpen = (next: boolean) => patch(begin('menu'), { open: next })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function selectOrganization(organizationId: string) {
    const request = begin('select')
    patch(request, { actionError: null })
    try {
      const response = await switchOrganization(organizationId)
      request.assertCurrent()
      patch(request, { open: false })
      await onSwitch?.(response)
    } catch (err) {
      patch(request, { actionError: err instanceof Error ? err : new Error(l.errors.organizationSwitchFailed) })
    }
  }

  if (hideWhenSingleOrganization && organizations.length <= 1) return null
  if (isLoading && organizations.length === 0) return null

  const label = currentOrganization?.name ?? l.organization.select
  const safeError = actionError || error ? localizeError(actionError ?? error, l, 'organizationSwitchFailed') : null

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', minWidth: 220 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isSwitching}
        aria-label={isSwitching ? l.organization.switching : label}
        style={{ ...buttonStyle(a, 'ghost'), width: '100%', padding: '6px 12px', fontSize: 13 }}
      >
        {label}
        <span aria-hidden="true" style={{ marginLeft: 8 }}>v</span>
      </button>

      {safeError && <div role="alert" style={{ ...errorStyle(a), marginTop: 8 }}>{safeError}</div>}

      {open && (
        <div style={dropdownStyle(a)}>
          {organizations.map((organization) => (
            <button
              key={organization.organizationId}
              type="button"
              onClick={() => { void selectOrganization(organization.organizationId) }}
              disabled={isSwitching || organization.current}
              style={{
                ...orgItemStyle,
                fontWeight: organization.current ? 600 : 400,
                backgroundColor: organization.current ? a.subtleColor : 'transparent',
                color: a.textColor,
                cursor: isSwitching || organization.current ? 'default' : 'pointer',
              }}
            >
              <span>{organization.name}</span>
              <span style={{ fontSize: 11, color: a.mutedTextColor }}>{l.organization.role(organization.role)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function OrgSwitcher({ onSwitch, ...props }: OrgSwitcherProps) {
  return (
    <OrganizationSwitcher
      {...props}
      onSwitch={(response) => onSwitch?.(response.organizationId, response)}
    />
  )
}

function dropdownStyle(a: Required<Appearance>): CSSProperties {
  return {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    width: '100%',
    minWidth: 220,
    backgroundColor: a.surfaceColor,
    border: `1px solid ${a.borderColor}`,
    borderRadius: a.borderRadius,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 9999,
    maxHeight: 240,
    overflowY: 'auto',
  }
}

const orgItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  textAlign: 'left',
  border: 'none',
  backgroundColor: 'transparent',
}
