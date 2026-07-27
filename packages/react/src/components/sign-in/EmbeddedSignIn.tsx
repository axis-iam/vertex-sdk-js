import type { ReactNode } from 'react'
import { useIamContext } from '../../provider/IamProvider'
import { useBranding, brandingToAppearance } from '../useBranding'
import { containerStyle, dividerStyle, errorStyle, hrStyle, linkStyle } from '../styles'
import type { SignInProps } from './types'
import { useSignInFlow } from './useSignInFlow'
import { IdentifierStep } from './IdentifierStep'
import { MethodChooser } from './MethodChooser'
import { PasswordStep } from './PasswordStep'
import { SmsOtpStep } from './SmsOtpStep'
import { MagicLinkStep } from './MagicLinkStep'
import { EmailOtpStep } from './EmailOtpStep'
import { ProviderButtons } from './ProviderButtons'
import { ForgotPasswordAction } from './ForgotPasswordAction'
import { useIamAppearance, useIamUi } from '../../provider/IamUiProvider'
import { BrandingLogo } from '../BrandingLogo'

export function EmbeddedSignIn({ appearance, onSuccess, onError, forgotPasswordUrl, onForgotPassword, renderProviderButton, presentation = 'standalone' }: Pick<SignInProps, 'appearance' | 'onSuccess' | 'onError' | 'forgotPasswordUrl' | 'onForgotPassword' | 'renderProviderButton' | 'presentation'>) {
  const { client } = useIamContext()
  const { branding } = useBranding()
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance, brandingToAppearance(branding))
  const flow = useSignInFlow(client)
  const shellStyle = presentation === 'dialog' ? compactContainerStyle(a) : containerStyle(a)

  const renderShell = (children: ReactNode) => (
    <div style={shellStyle}>
      {branding?.logoUrl && <BrandingLogo logoUrl={branding.logoUrl} alt={l.auth.logoAlt} />}
      {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>
        {branding?.welcomeTitle ?? l.auth.signIn}
      </h2>}
      {children}
    </div>
  )

  if (flow.authMethodsLoading) {
    return renderShell(<p style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: 0 }}>{l.auth.loadingOptions}</p>)
  }

  if (flow.authMethodsError) {
    return renderShell(<p role="status" style={errorStyle(a)}>{l.auth.optionsUnavailable}</p>)
  }

  if (!flow.hasAnyCredentialMethods && !flow.hasProviderMethods) {
    return renderShell(<p role="status" style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: 0 }}>{l.auth.noMethodAvailable}</p>)
  }

  const state = flow.state

  return (
    <div style={shellStyle}>
      {branding?.logoUrl && <BrandingLogo logoUrl={branding.logoUrl} alt={l.auth.logoAlt} />}
      {presentation !== 'dialog' && <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>
        {branding?.welcomeTitle ?? l.auth.signIn}
      </h2>}

      {state.step === 'identifier' && (
        <IdentifierStep
          appearance={a}
          value={state.identifierDraft}
          error={state.identifierError}
          onChange={(value) => flow.dispatch({ type: 'editIdentifier', value })}
          onContinue={(value) => flow.dispatch({ type: 'continueIdentifier', value, invalidIdentifierMessage: l.auth.identifierInvalid })}
        />
      )}

      {state.step === 'error' && (
        <p role="status" style={errorStyle(a)}>{state.identifierError}</p>
      )}

      {state.step === 'method' && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 13, color: a.mutedTextColor, margin: 0, overflowWrap: 'anywhere' }}>
              {l.auth.signingInAs(state.identifier)}
            </p>
            <button type="button" onClick={() => flow.dispatch({ type: 'resetIdentifier' })} style={{ ...linkStyle(a), whiteSpace: 'nowrap' }}>
              {l.auth.change}
            </button>
          </div>

          {flow.credentialMethods.length === 0 ? (
            <p role="status" style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: '12px 0 0' }}>
              {l.auth.noMethodForIdentifier}
            </p>
          ) : (
            <>
              {flow.credentialMethods.length > 1 && flow.selectedMethod && (
                <MethodChooser
                  methods={flow.credentialMethods}
                  selectedMethod={flow.selectedMethod}
                  onSelect={(method) => flow.dispatch({ type: 'selectMethod', method })}
                  appearance={a}
                />
              )}

              {flow.selectedMethod === 'password' && flow.authMethods && (
                <>
                  <PasswordStep
                    client={client}
                    appearance={a}
                    identifier={state.identifier}
                    onSuccess={onSuccess}
                    onError={onError}
                    resendCooldownSeconds={flow.authMethods.resend.emailVerificationCooldownSeconds}
                  />
                  <ForgotPasswordAction appearance={a} forgotPasswordUrl={forgotPasswordUrl} onForgotPassword={onForgotPassword} />
                </>
              )}
              {flow.selectedMethod === 'sms' && (
                <SmsOtpStep client={client} appearance={a} phone={state.identifier} onSuccess={onSuccess} onError={onError} />
              )}
              {flow.selectedMethod === 'magic_link' && (
                <MagicLinkStep client={client} appearance={a} email={state.identifier} onError={onError} />
              )}
              {flow.selectedMethod === 'email_otp' && (
                <EmailOtpStep client={client} appearance={a} email={state.identifier} onSuccess={onSuccess} onError={onError} />
              )}
            </>
          )}
        </div>
      )}

      {flow.providers.length > 0 && (
        <>
          {flow.hasAnyCredentialMethods && <div style={dividerStyle(a)}>
            <hr style={hrStyle(a)} />
            <span>{l.auth.or}</span>
            <hr style={hrStyle(a)} />
          </div>}
          <ProviderButtons
            providers={flow.providers}
            appearance={a}
            onError={onError}
            renderProviderButton={renderProviderButton}
          />
        </>
      )}
    </div>
  )
}

function compactContainerStyle(a: ReturnType<typeof useIamAppearance>[0]) {
  return { ...containerStyle(a), maxWidth: 'none', margin: 0, padding: 0, borderRadius: 0, backgroundColor: 'transparent' }
}
