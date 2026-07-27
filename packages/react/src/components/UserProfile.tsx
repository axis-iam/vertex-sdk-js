import { useIamContext } from '../provider/IamProvider'
import { useDevices } from '../security/useDevices'
import type { Appearance } from './styles'
import { containerStyle, labelStyle } from './styles'
import type { CSSProperties } from 'react'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'

export interface UserProfileProps {
  appearance?: Appearance
}

/**
 * User profile panel showing account info, security settings, and devices.
 * This component displays runtime/profile data only; it does not expose
 * app-scoped authorization attributes.
 * Embed in a settings page.
 *
 * @example
 * ```tsx
 * <UserProfile />
 * ```
 */
export function UserProfile({ appearance }: UserProfileProps) {
  const { user } = useIamContext()
  const { devices, revokeDevice } = useDevices()
  const { localization: l, locale } = useIamUi()
  const [a] = useIamAppearance(appearance)

  if (!user) return null

  const sectionStyle: CSSProperties = { marginBottom: 24 }
  const fieldRow: CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${a.borderColor}`, fontSize: 14 }
  const fieldLabel: CSSProperties = { color: a.mutedTextColor }
  const fieldValue: CSSProperties = { fontWeight: 500 }

  return (
    <div style={{ ...containerStyle(a), maxWidth: 480 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 24px' }}>{l.userProfile.title}</h2>

      {/* Account Info */}
      <div style={sectionStyle}>
        <h3 style={{ ...labelStyle(a), fontSize: 14, marginBottom: 12, color: a.textColor }}>{l.userProfile.account}</h3>
        <div style={fieldRow}>
          <span style={fieldLabel}>{l.userProfile.email}</span>
          <span style={fieldValue}>{user.email ?? l.userProfile.unavailable}</span>
        </div>
        <div style={fieldRow}>
          <span style={fieldLabel}>{l.userProfile.username}</span>
          <span style={fieldValue}>{user.username ?? l.userProfile.unavailable}</span>
        </div>
        <div style={fieldRow}>
          <span style={fieldLabel}>{l.userProfile.name}</span>
          <span style={fieldValue}>{user.name ?? l.userProfile.unavailable}</span>
        </div>
        {user.orgSlug && (
          <div style={fieldRow}>
            <span style={fieldLabel}>{l.userProfile.organization}</span>
            <span style={fieldValue}>{user.orgSlug} ({l.organization.role(user.orgRole)})</span>
          </div>
        )}
      </div>

      {/* Roles */}
      {user.roles.length > 0 && (
        <div style={sectionStyle}>
          <h3 style={{ ...labelStyle(a), fontSize: 14, marginBottom: 12, color: a.textColor }}>{l.userProfile.roles}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {user.roles.map((role) => (
              <span key={role} style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 12,
                borderRadius: 4,
                backgroundColor: a.subtleColor,
                color: a.textColor,
              }}>
                {role}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Devices */}
      {devices.length > 0 && (
        <div style={sectionStyle}>
          <h3 style={{ ...labelStyle(a), fontSize: 14, marginBottom: 12, color: a.textColor }}>{l.userProfile.devices}</h3>
          {devices.map((d) => (
            <div key={d.id} style={{ ...fieldRow, alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: a.mutedTextColor }}>{l.userProfile.lastSeen(formatLastSeen(d.lastSeen, locale))}</div>
              </div>
              <button
                onClick={() => revokeDevice(d.id)}
                style={{
                  fontSize: 12,
                  color: a.dangerColor,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                {l.userProfile.revoke}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatLastSeen(value: string, locale: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
