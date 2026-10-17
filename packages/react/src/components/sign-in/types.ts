import type { ReactNode } from 'react'
import type { AuthMethodIdpProviderResponse, IamUser } from '../../core/types'
import type { Appearance } from '../styles'

export interface SignInProviderButtonRenderProps {
  provider: AuthMethodIdpProviderResponse
  label: string
  disabled: boolean
  isLoading: boolean
  onClick: () => Promise<void>
}

export interface SignInProps {
  /** 'redirect' (default) jumps to iam-server login page; 'embedded' renders inline form */
  mode?: 'redirect' | 'embedded'
  /** Show the SDK-owned signup footer when server registration policy permits it. Defaults to true. */
  allowSignUp?: boolean
  /** Called after successful embedded login */
  onSuccess?: (user: IamUser) => void
  /** Called on error */
  onError?: (error: Error) => void
  /** Override appearance (merged with branding) */
  appearance?: Appearance
  /** URL for the application's forgot-password page. */
  forgotPasswordUrl?: string
  /** Callback for opening forgot-password UI without requiring a router. */
  onForgotPassword?: () => void
  /** Customize embedded provider buttons while reusing SDK discovery/login logic. */
  renderProviderButton?: (props: SignInProviderButtonRenderProps) => ReactNode
  /** Compact presentation for a container that already supplies the auth dialog title and frame. */
  presentation?: 'standalone' | 'dialog'
}
