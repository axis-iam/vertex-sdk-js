import type { ReactNode } from 'react'
import { useBranding } from '@axis-iam/vertex-react'
import type { BrandingIntent } from '@axis-iam/vertex-react'

/** Opt-in host presentation, alongside useAuthFlow; no Headless style side effects. */
export function CustomBranding({ intent, children }: { intent: BrandingIntent; children: ReactNode }) {
  const { branding, isLoading, error, retry } = useBranding(intent)
  if (isLoading) return <p role="status">Loading application branding…</p>
  if (error) return <p role="alert">Branding unavailable. <button onClick={retry}>Retry</button></p>
  return <section aria-label="Application authentication">
    {branding?.showLogo && branding.logoUrl && <img src={branding.logoUrl} alt="Application logo" style={{ maxWidth: '100%', maxHeight: 48 }} />}
    <h1>{branding?.welcomeTitle}</h1>
    <p>{branding?.welcomeSubtitle}</p>
    {children}
    <footer>{branding?.footerText}</footer>
  </section>
}
