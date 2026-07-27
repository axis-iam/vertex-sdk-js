import type { Appearance } from '../styles'
import { linkStyle } from '../styles'
import { useIamUi } from '../../provider/IamUiProvider'

export function ForgotPasswordAction({ appearance: a, forgotPasswordUrl, onForgotPassword }: {
  appearance: Required<Appearance>
  forgotPasswordUrl?: string
  onForgotPassword?: () => void
}) {
  const { localization: l } = useIamUi()
  if (!forgotPasswordUrl && !onForgotPassword) return null

  const style = { ...linkStyle(a), display: 'inline-block', marginTop: 12 }
  if (forgotPasswordUrl) {
    return (
      <div style={{ textAlign: 'center' }}>
        <a href={forgotPasswordUrl} style={style}>{l.auth.forgotPassword}</a>
      </div>
    )
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <button type="button" onClick={onForgotPassword} style={style}>{l.auth.forgotPassword}</button>
    </div>
  )
}
