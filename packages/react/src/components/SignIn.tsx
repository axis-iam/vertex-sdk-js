import { useIamContext } from '../provider/IamProvider'
import { useBranding, brandingToAppearance } from './useBranding'
import { buttonStyle, containerStyle } from './styles'
import { EmbeddedSignIn } from './sign-in/EmbeddedSignIn'
import { ForgotPasswordAction } from './sign-in/ForgotPasswordAction'
import type { SignInProps } from './sign-in/types'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { BrandingLogo } from './BrandingLogo'

export type { SignInProps, SignInProviderButtonRenderProps } from './sign-in/types'

export function SignIn({ mode = 'redirect', onSuccess, onError, appearance, redirectUrl, forgotPasswordUrl, onForgotPassword, renderProviderButton, presentation = 'standalone' }: SignInProps) {
  if (mode === 'redirect') {
    return <RedirectSignIn appearance={appearance} redirectUrl={redirectUrl} forgotPasswordUrl={forgotPasswordUrl} onForgotPassword={onForgotPassword} presentation={presentation} />
  }
  return (
    <EmbeddedSignIn
      appearance={appearance}
      onSuccess={onSuccess}
      onError={onError}
      forgotPasswordUrl={forgotPasswordUrl}
      onForgotPassword={onForgotPassword}
      renderProviderButton={renderProviderButton}
      presentation={presentation}
    />
  )
}

function RedirectSignIn({ appearance, redirectUrl: _redirectUrl, forgotPasswordUrl, onForgotPassword, presentation }: Pick<SignInProps, 'appearance' | 'redirectUrl' | 'forgotPasswordUrl' | 'onForgotPassword' | 'presentation'>) {
  const { login, isAuthenticated, user } = useIamContext()
  const { branding } = useBranding()
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance, brandingToAppearance(branding))
  const shellStyle = presentation === 'dialog' ? compactContainerStyle(a) : containerStyle(a)

  if (isAuthenticated) {
    return (
      <div style={shellStyle}>
        <p style={{ textAlign: 'center', margin: 0 }}>{l.auth.signedInAs(user?.email ?? '')}</p>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      {branding?.logoUrl && <BrandingLogo logoUrl={branding.logoUrl} alt={l.auth.logoAlt} />}
      {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>
        {branding?.welcomeTitle ?? l.auth.signIn}
      </h2>}
      {branding?.welcomeSubtitle && (
        <p style={{ fontSize: 14, textAlign: 'center', color: a.mutedTextColor, margin: '-16px 0 24px' }}>
          {branding.welcomeSubtitle}
        </p>
      )}
      <button onClick={() => login()} style={buttonStyle(a, 'primary')}>
        {l.auth.signIn}
      </button>
      <ForgotPasswordAction appearance={a} forgotPasswordUrl={forgotPasswordUrl} onForgotPassword={onForgotPassword} />
    </div>
  )
}

function compactContainerStyle(a: ReturnType<typeof useIamAppearance>[0]) {
  return { ...containerStyle(a), maxWidth: 'none', margin: 0, padding: 0, borderRadius: 0, backgroundColor: 'transparent' }
}
