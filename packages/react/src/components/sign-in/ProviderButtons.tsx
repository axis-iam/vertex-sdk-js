import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useProviderLogin } from '../../hooks/useProviderLogin'
import type { AuthMethodIdpProviderResponse } from '../../core/types'
import type { Appearance } from '../styles'
import { buttonStyle, errorStyle } from '../styles'
import type { SignInProviderButtonRenderProps } from './types'
import { useIamUi } from '../../provider/IamUiProvider'

const PROVIDER_ICONS: Record<string, string> = {
  google: '🔵',
  github: '⚫',
  wechat: '🟢',
  enterprise_wechat: '🟢',
}

export function ProviderButtons({ providers, appearance: a, onError, renderProviderButton }: {
  providers: AuthMethodIdpProviderResponse[]
  appearance: Required<Appearance>
  onError?: (error: Error) => void
  renderProviderButton?: (props: SignInProviderButtonRenderProps) => ReactNode
}) {
  const { startProviderLogin } = useProviderLogin()
  const { localization: l } = useIamUi()
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)

  const handleProviderLogin = useCallback(async (provider: AuthMethodIdpProviderResponse) => {
    setLoginError(null)
    setActiveProviderId(provider.id)
    try {
      const url = await startProviderLogin(provider)
      if (typeof window !== 'undefined') {
        window.location.href = url
      }
    } catch {
      const error = new Error(l.errors.signInFailed)
      setLoginError(l.errors.signInFailed)
      onError?.(error)
    } finally {
      setActiveProviderId(null)
    }
  }, [l.errors.signInFailed, onError, startProviderLogin])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {providers.map((provider) => {
        const providerKey = provider.providerType.toLowerCase()
        const isProviderLoading = activeProviderId === provider.id
        const disabled = activeProviderId !== null
        const label = l.auth.providerSignIn(provider.displayName)
        const onClick = () => handleProviderLogin(provider)

        if (renderProviderButton) {
          return (
            <div key={provider.id}>
              {renderProviderButton({
                provider,
                label,
                disabled,
                isLoading: isProviderLoading,
                onClick,
              })}
            </div>
          )
        }

        return (
          <button key={provider.id} type="button" onClick={onClick} disabled={disabled}
            style={{ ...buttonStyle(a, 'ghost'), opacity: disabled && !isProviderLoading ? 0.6 : 1 }}>
            {PROVIDER_ICONS[providerKey] ?? '🔗'} {isProviderLoading ? l.auth.redirecting : label}
          </button>
        )
      })}
      {loginError && <p role="status" style={errorStyle(a)}>{loginError}</p>}
    </div>
  )
}
