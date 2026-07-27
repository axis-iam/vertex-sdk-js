import { useEffect, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { requestJson } from '../core/http-client'
import type { Appearance } from './styles'

export interface BrandingConfig {
  logoUrl?: string
  primaryColor?: string
  backgroundColor?: string
  loginLayout?: string
  welcomeTitle?: string
  welcomeSubtitle?: string
}

/**
 * Fetch branding configuration from the IAM server.
 * Falls back to defaults if the endpoint is unavailable.
 */
export function useBranding(): { branding: BrandingConfig | null; isLoading: boolean } {
  const { client } = useIamContext()
  const [branding, setBranding] = useState<BrandingConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchBranding() {
      try {
        const config = await client.discover()
        // Branding endpoint: GET /api/v1/apps/{clientId}/branding (public, no auth)
        const next = await requestJson<BrandingConfig>(`${config.issuer}/api/v1/apps/${client.clientId}/branding`)
        if (!cancelled) setBranding(next)
      } catch {
        // Branding not available — use defaults
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchBranding()
    return () => { cancelled = true }
  }, [client])

  return { branding, isLoading }
}

/** Merge branding config into Appearance */
export function brandingToAppearance(branding: BrandingConfig | null): Partial<Appearance> {
  if (!branding) return {}
  return {
    primaryColor: branding.primaryColor,
    backgroundColor: branding.backgroundColor,
  }
}
