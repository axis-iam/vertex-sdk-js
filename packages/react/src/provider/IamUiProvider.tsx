import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { mergeAppearances, useResolvedAppearance } from '../components/styles'
import type { Appearance } from '../components/styles'
import { resolveIamLocalization } from '../localization'
import type { IamLocale, IamLocalization, PartialIamLocalization } from '../localization'

declare const process: { env?: { NODE_ENV?: string } } | undefined

export type IamColorScheme = 'light' | 'dark' | 'system'

export interface IamUiConfig {
  locale?: IamLocale
  localization?: PartialIamLocalization
  colorScheme?: IamColorScheme
  appearance?: Appearance
  darkAppearance?: Appearance
}

export interface IamUiContextValue {
  locale: 'en' | 'zh-CN'
  localization: IamLocalization
  colorScheme: IamColorScheme
  appearance?: Appearance
  darkAppearance?: Appearance
}

const IamUiContext = createContext<IamUiContextValue | null>(null)

export function IamUiProvider({ children, locale, localization, colorScheme = 'light', appearance, darkAppearance }: IamUiConfig & { children: ReactNode }) {
  const resolved = useMemo(() => resolveIamLocalization(locale, localization), [locale, localization])

  useEffect(() => {
    if (resolved.unsupported && typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production') {
      console.warn(`[axis-iam] Unsupported locale "${locale}"; using the complete English catalog.`)
    }
  }, [locale, resolved.unsupported])

  const value = useMemo<IamUiContextValue>(() => ({
    locale: resolved.locale,
    localization: resolved.localization,
    colorScheme,
    appearance,
    darkAppearance,
  }), [appearance, colorScheme, darkAppearance, resolved])

  return <IamUiContext.Provider value={value}>{children}</IamUiContext.Provider>
}

export function useIamUi(): IamUiContextValue {
  const context = useContext(IamUiContext)
  if (!context) throw new Error('useIamUi must be used within <IamProvider>')
  return context
}

export function useIamAppearance(componentAppearance?: Appearance, baseAppearance?: Appearance) {
  const ui = useIamUi()
  const appearance = mergeAppearances(baseAppearance, ui.appearance, componentAppearance)
  return useResolvedAppearance(ui.colorScheme, appearance, ui.darkAppearance)
}
