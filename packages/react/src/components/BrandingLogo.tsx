import type { CSSProperties } from 'react'

interface BrandingLogoProps {
  logoUrl: string
  alt: string
}

const logoStyle: CSSProperties = {
  display: 'block',
  width: 'auto',
  height: 'auto',
  maxWidth: '100%',
  maxHeight: 48,
  marginInline: 'auto',
  objectFit: 'contain',
}

export function BrandingLogo({ logoUrl, alt }: BrandingLogoProps) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <img src={logoUrl} alt={alt} style={logoStyle} />
    </div>
  )
}
