import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/** Appearance customization props shared by all pre-built components */
export interface Appearance {
  primaryColor?: string
  backgroundColor?: string
  textColor?: string
  mutedTextColor?: string
  surfaceColor?: string
  subtleColor?: string
  borderColor?: string
  inputBackgroundColor?: string
  successColor?: string
  warningColor?: string
  dangerColor?: string
  focusColor?: string
  borderRadius?: string
  fontFamily?: string
}

export type AppearanceColorScheme = 'light' | 'dark' | 'system'

const DEFAULT_APPEARANCE: Required<Appearance> = {
  primaryColor: '#0F172A',
  backgroundColor: '#ffffff',
  textColor: '#1e293b',
  mutedTextColor: '#64748b',
  surfaceColor: '#ffffff',
  subtleColor: '#f8fafc',
  borderColor: '#7b8798',
  inputBackgroundColor: '#ffffff',
  successColor: '#15803d',
  warningColor: '#a16207',
  dangerColor: '#b42318',
  focusColor: '#2563eb',
  borderRadius: '8px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

export const darkAppearanceDefaults: Appearance = {
  primaryColor: '#0369a1',
  backgroundColor: '#101417',
  textColor: '#f4f7f8',
  mutedTextColor: '#a6b0b5',
  surfaceColor: '#151a1e',
  subtleColor: '#20272c',
  borderColor: '#75838c',
  inputBackgroundColor: '#101417',
  successColor: '#6ee7a0',
  warningColor: '#f7c66b',
  dangerColor: '#ff8d85',
  focusColor: '#38bdf8',
}

export function resolveAppearance(custom?: Appearance): Required<Appearance> {
  const resolved = { ...DEFAULT_APPEARANCE, ...custom }
  if (custom?.backgroundColor !== undefined && custom.surfaceColor === undefined) {
    resolved.surfaceColor = custom.backgroundColor
  }
  return resolved
}

/** Combines branding, provider, and component patches without discarding defined tokens. */
export function mergeAppearances(...appearances: Array<Appearance | undefined>): Appearance | undefined {
  const merged = Object.assign({}, ...appearances.filter((appearance): appearance is Appearance => appearance !== undefined))
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function useResolvedAppearance(
  colorScheme: AppearanceColorScheme = 'light',
  appearance?: Appearance,
  darkAppearance?: Appearance,
) {
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    if (colorScheme !== 'system' || typeof window === 'undefined') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(query.matches)
    update()
    query.onchange = update
    query.addEventListener('change', update)
    return () => {
      query.onchange = null
      query.removeEventListener('change', update)
    }
  }, [colorScheme])

  const dark = colorScheme === 'dark' || (colorScheme === 'system' && systemDark)
  const shared = {
    ...(appearance?.primaryColor !== undefined ? { primaryColor: appearance.primaryColor } : {}),
    ...(appearance?.borderRadius !== undefined ? { borderRadius: appearance.borderRadius } : {}),
    ...(appearance?.fontFamily !== undefined ? { fontFamily: appearance.fontFamily } : {}),
  }
  return [dark
    ? resolveAppearance({ ...darkAppearanceDefaults, ...shared, ...darkAppearance })
    : resolveAppearance(appearance), dark ? 'dark' : 'light'] as const
}

// --- Reusable style builders ---

export function containerStyle(a: Required<Appearance>): CSSProperties {
  return {
    fontFamily: a.fontFamily,
    color: a.textColor,
    backgroundColor: a.backgroundColor,
    maxWidth: 400,
    margin: '0 auto',
    padding: 32,
    borderRadius: a.borderRadius,
    boxSizing: 'border-box',
  }
}

export function inputStyle(a: Required<Appearance>): CSSProperties {
  return {
    display: 'block',
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    lineHeight: '20px',
    border: `1px solid ${a.borderColor}`,
    borderRadius: a.borderRadius,
    backgroundColor: a.inputBackgroundColor,
    color: a.textColor,
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  }
}

export function buttonStyle(a: Required<Appearance>, variant: 'primary' | 'ghost' = 'primary'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: '20px',
    borderRadius: a.borderRadius,
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    boxSizing: 'border-box',
  }

  if (variant === 'primary') {
    return { ...base, backgroundColor: a.primaryColor, color: '#fff' }
  }
  return { ...base, backgroundColor: a.surfaceColor, color: a.textColor, border: `1px solid ${a.borderColor}` }
}

export function labelStyle(a: Required<Appearance>): CSSProperties {
  return {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 4,
    color: a.textColor,
  }
}

export function errorStyle(a: Required<Appearance>): CSSProperties {
  return { fontSize: 13, color: a.dangerColor, marginTop: 4 }
}

export function linkStyle(a: Required<Appearance>): CSSProperties {
  return { color: a.focusColor, fontSize: 13, cursor: 'pointer', background: 'none', border: 'none', padding: 0, textDecoration: 'underline' }
}

export function dividerStyle(a: Required<Appearance>): CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', color: a.mutedTextColor, fontSize: 13 }
}

export function hrStyle(a: Required<Appearance>): CSSProperties {
  return { flex: 1, border: 'none', borderTop: `1px solid ${a.borderColor}` }
}
