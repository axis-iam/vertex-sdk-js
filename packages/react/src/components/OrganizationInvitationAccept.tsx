import type { CSSProperties } from 'react'
import type { PublicOrganizationInvitationAcceptResponse } from '../core/types'
import { useOrganizationInvitation } from '../hooks/useOrganizationInvitation'
import type { Appearance } from './styles'
import { buttonStyle, containerStyle, errorStyle } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'

export interface OrganizationInvitationAcceptProps {
  token: string
  appearance?: Appearance
  onAccepted?: (response: PublicOrganizationInvitationAcceptResponse) => void | Promise<void>
  onLoginRequired?: (response: PublicOrganizationInvitationAcceptResponse) => void | Promise<void>
}

export function OrganizationInvitationAccept({
  token,
  appearance,
  onAccepted,
  onLoginRequired,
}: OrganizationInvitationAcceptProps) {
  const { localization: l, locale } = useIamUi()
  const [a] = useIamAppearance(appearance)
  const {
    preview,
    acceptResponse,
    isPreviewLoading,
    isAccepting,
    error,
    acceptInvitation,
  } = useOrganizationInvitation(token)

  async function accept() {
    const response = await acceptInvitation()
    if (response.status === 'LOGIN_REQUIRED') {
      await onLoginRequired?.(response)
      return
    }
    await onAccepted?.(response)
  }

  const title = preview
    ? l.invitation.join(preview.organizationName)
    : l.invitation.title
  const detail = preview
    ? l.invitation.detail(preview.applicationName, preview.inviteeEmail, l.organization.role(preview.role))
    : l.invitation.loading
  const statusText = acceptResponse?.status === 'LOGIN_REQUIRED'
    ? l.invitation.loginRequired
    : acceptResponse?.status === 'ACCEPTED'
      ? l.invitation.accepted
      : null

  return (
    <section style={{ ...containerStyle(a), maxWidth: 520 }} aria-label={l.invitation.aria}>
      <h2 style={headingStyle}>{title}</h2>
      <p style={metaStyle(a)}>{isPreviewLoading ? l.invitation.loading : detail}</p>
      {preview?.expiresAt && <p style={metaStyle(a)}>{l.invitation.expires(formatDate(preview.expiresAt, locale))}</p>}

      {error && <div role="alert" style={{ ...errorStyle(a), marginTop: 16 }}>{localizeError(error, l, 'invitationFailed')}</div>}
      {statusText && <p role="status" style={{ ...metaStyle(a), marginTop: 16 }}>{statusText}</p>}

      <button
        type="button"
        disabled={!preview || isAccepting}
        onClick={() => { void accept() }}
        style={{ ...buttonStyle(a), marginTop: 20, opacity: !preview || isAccepting ? 0.65 : 1 }}
      >
        {isAccepting ? l.invitation.accepting : l.invitation.accept}
      </button>
    </section>
  )
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const headingStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  margin: '0 0 8px',
}

function metaStyle(a: Required<Appearance>): CSSProperties {
  return {
  margin: 0,
  color: a.mutedTextColor,
  fontSize: 14,
  lineHeight: '20px',
  }
}
