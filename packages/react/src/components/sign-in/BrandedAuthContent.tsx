import type { ComponentProps } from 'react'
import { AuthFlowForm } from './AuthFlowForm'
import { useBranding, brandingToAppearance } from '../useBranding'
import { BrandingLogo } from '../BrandingLogo'
import { useIamAppearance, useIamUi } from '../../provider/IamUiProvider'
import { containerStyle, linkStyle } from '../styles'
import type { Appearance } from '../styles'

export function useAuthBranding(intent: 'sign-in' | 'sign-up', appearance?: Appearance) {
  const result = useBranding(intent === 'sign-up' ? 'signup' : 'login')
  const [resolved, scheme] = useIamAppearance(appearance,
    brandingToAppearance(result.branding), brandingToAppearance(result.branding, true))
  return { ...result, appearance: resolved, scheme }
}

/** One inner view for Embedded, SignUp and Dialog. The flow owner remains outside. */
export function BrandedAuthContent({ brand, presentation = 'standalone', ...props }:
  Omit<ComponentProps<typeof AuthFlowForm>, 'appearance'> & {
    brand: ReturnType<typeof useAuthBranding>
    presentation?: 'standalone' | 'dialog'
  }) {
  const { localization: l } = useIamUi()
  const { branding: b, appearance: a, isLoading, error, retry } = brand
  const title = b?.welcomeTitle ?? (props.flow.state.intent === 'sign-up' ? l.signUp.title : l.auth.signIn)
  return (
    <div data-axis-branded-auth data-color-scheme={brand.scheme} style={{
      ...containerStyle(a), overflowWrap: 'anywhere',
      ...(presentation === 'dialog' ? { maxWidth: 'none', margin: 0, padding: 0, borderRadius: 0 } : {}),
    }}>
      {isLoading && <p role="status">{l.auth.brandingLoading}</p>}
      {error && <p role="status" style={{ fontSize: 13, color: a.dangerColor }}>
        {l.auth.brandingUnavailable}{' '}
        <button type="button" onClick={retry} style={linkStyle(a)}>{l.auth.retryBranding}</button>
      </p>}
      {b?.showLogo && b.logoUrl && <BrandingLogo logoUrl={b.logoUrl} alt={l.auth.logoAlt} />}
      {presentation !== 'dialog' && <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3, margin: '0 0 20px' }}>{title}</h2>}
      {b?.welcomeSubtitle && <p style={{ fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>{b.welcomeSubtitle}</p>}
      <AuthFlowForm {...props} appearance={a} branding={b} />
      {b?.footerText && <p style={{ fontSize: 12, lineHeight: 1.6, textAlign: 'center', margin: '24px 0 0' }}>{b.footerText}</p>}
    </div>
  )
}
