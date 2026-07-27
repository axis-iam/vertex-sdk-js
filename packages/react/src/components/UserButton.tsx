import { useState, useRef, useEffect, useCallback } from 'react'
import { useIamContext } from '../provider/IamProvider'
import type { Appearance } from './styles'
import type { CSSProperties } from 'react'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'

export interface UserButtonProps {
  /** Override appearance */
  appearance?: Appearance
  /** Called after logout completes */
  afterLogout?: () => void
}

/**
 * User avatar button with dropdown menu.
 * Shows user avatar/initials, click to open menu with profile info + logout.
 *
 * @example
 * ```tsx
 * <UserButton />
 * ```
 */
export function UserButton({ appearance, afterLogout }: UserButtonProps) {
  const { user, isAuthenticated, logout } = useIamContext()
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleLogout = useCallback(async () => {
    setOpen(false)
    await logout({ redirect: true })
    afterLogout?.()
  }, [logout, afterLogout])

  if (!isAuthenticated || !user) return null

  const initials = getInitials(user.name ?? user.email ?? '?')

  const avatarStyle: CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    backgroundColor: a.primaryColor,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    fontFamily: a.fontFamily,
  }

  const dropdownStyle: CSSProperties = {
    position: 'absolute',
    top: 44,
    right: 0,
    width: 240,
    backgroundColor: a.surfaceColor,
    border: `1px solid ${a.borderColor}`,
    borderRadius: a.borderRadius,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 9999,
    overflow: 'hidden',
    fontFamily: a.fontFamily,
  }

  const menuItemStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    fontSize: 14,
    textAlign: 'left',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: a.textColor,
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(!open)} style={avatarStyle} aria-label={l.userButton.menuAria}>
        {initials}
      </button>

      {open && (
        <div style={dropdownStyle}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${a.borderColor}` }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: a.textColor }}>{user.name ?? user.username ?? l.userButton.fallbackUser}</div>
            {user.email && <div style={{ fontSize: 12, color: a.mutedTextColor, marginTop: 2 }}>{user.email}</div>}
          </div>

          {user.orgSlug && (
            <div style={{ padding: '8px 16px', fontSize: 12, color: a.mutedTextColor, borderBottom: `1px solid ${a.borderColor}` }}>
              {l.userButton.organization(user.orgSlug)}
            </div>
          )}

          <button
            onClick={handleLogout}
            style={{ ...menuItemStyle, color: a.dangerColor }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = a.subtleColor }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = 'transparent' }}
          >
            {l.userButton.signOut}
          </button>
        </div>
      )}
    </div>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}
