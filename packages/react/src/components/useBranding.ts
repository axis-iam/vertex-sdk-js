import { useEffect, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { requestJson } from '../core/http-client'
import { IamApiError } from '../core/types'
import type { Appearance } from './styles'

/** Public server-resolved copy and visuals. Document-level fields are data only. */
export interface BrandingConfig {
  logoUrl?: string | null
  faviconUrl?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  backgroundColor?: string | null
  textColor?: string | null
  backgroundImageUrl?: string | null
  loginLayout?: string | null
  showLogo: boolean
  socialButtonPosition?: string | null
  welcomeTitle?: string | null
  welcomeSubtitle?: string | null
  loginButtonText?: string | null
  signupButtonText?: string | null
  footerText?: string | null
  defaultLocale?: string | null
}

export type BrandingIntent = 'login' | 'signup'
export class BrandingFetchError extends Error {
  readonly code = 'BRANDING_FETCH_FAILED'
  constructor(readonly status?: number, readonly cause?: unknown) {
    super('Application branding could not be loaded.')
    this.name = 'BrandingFetchError'
  }
}
export interface UseBrandingResult {
  branding: BrandingConfig | null
  isLoading: boolean
  error: BrandingFetchError | null
  retry: () => void
}

const stringFields = ['logoUrl', 'faviconUrl', 'primaryColor', 'secondaryColor', 'backgroundColor',
  'textColor', 'backgroundImageUrl', 'loginLayout', 'socialButtonPosition', 'welcomeTitle',
  'welcomeSubtitle', 'loginButtonText', 'signupButtonText', 'footerText', 'defaultLocale'] as const
function isBranding(value: unknown): value is BrandingConfig {
  return typeof value === 'object' && value !== null && 'showLogo' in value &&
    typeof value.showLogo === 'boolean' && stringFields.every((field) =>
      !(field in value) || typeof Reflect.get(value, field) === 'string' || Reflect.get(value, field) === null)
}

/** Opt-in branding for Custom consumers; never mutates host styles or document state. */
export function useBranding(intent: BrandingIntent = 'login'): UseBrandingResult {
  const { client } = useIamContext()
  const { locale } = useIamUi()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    client: typeof client; locale: typeof locale; intent: BrandingIntent; attempt: number
    branding: BrandingConfig | null; isLoading: boolean; error: BrandingFetchError | null
  } | null>(null)
  useEffect(() => {
    let active = true
    const identity = { client, locale, intent, attempt }
    setResult({ ...identity, branding: null, isLoading: true, error: null })
    void (async () => {
      try {
        if (client.mode === 'server_session') {
          if (active) setResult({ ...identity, branding: null, isLoading: false, error: null })
          return
        }
        const config = await client.discover()
        if (!active) return
        const url = new URL(`api/v1/apps/${encodeURIComponent(client.clientId)}/branding`, `${config.issuer.replace(/\/$/, '')}/`)
        url.searchParams.set('ui_locales', locale)
        url.searchParams.set('intent', intent)
        const branding = await requestJson<unknown>(url.toString())
        if (!isBranding(branding)) throw new BrandingFetchError()
        if (active) setResult({ ...identity, branding, isLoading: false, error: null })
      } catch (cause) {
        if (active) setResult({ ...identity, branding: null, isLoading: false,
          error: new BrandingFetchError(cause instanceof IamApiError ? cause.status : undefined, cause) })
      }
    })()
    return () => { active = false }
  }, [client, locale, intent, attempt])
  // Render-time ownership prevents even one frame of the previous client's brand.
  const current = result?.client === client && result.locale === locale && result.intent === intent && result.attempt === attempt
  return {
    branding: current ? result.branding : null,
    isLoading: current ? result.isLoading : true,
    error: current ? result.error : null,
    retry: () => setAttempt((value) => value + 1),
  }
}

/** Only component-applicable semantic tokens; no global layout, CSS or images. */
export function brandingToAppearance(branding: BrandingConfig | null, dark = false): Appearance {
  const appearance: Appearance = {}
  if (branding?.primaryColor) appearance.primaryColor = branding.primaryColor
  if (!dark && branding?.secondaryColor) appearance.focusColor = branding.secondaryColor
  if (!dark) {
    if (branding?.backgroundColor) appearance.backgroundColor = branding.backgroundColor
    if (branding?.textColor) appearance.textColor = branding.textColor
  }
  return appearance
}
