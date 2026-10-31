import { ServerSessionClient } from '../core/server-session-client'
import type { AuthClient } from '../core/auth-client'
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { OAuthClient } from '../core/oauth-client'
import type {
  AppContinuation,
  IamConfig,
  IamUser,
  LogoutOptions,
  LogoutUrlOptions,
  RedirectCallbackOptions,
  RedirectCallbackResult,
  IamTokenRefreshError,
  TokenSet,
} from '../core/types'
import { IamUiProvider } from './IamUiProvider'
import type { IamUiConfig } from './IamUiProvider'

export interface IamContextValue {
  /** Current authenticated user (null if not logged in) */
  user: IamUser | null
  /** Whether the SDK has finished initializing */
  isLoaded: boolean
  /** Whether user is authenticated */
  isAuthenticated: boolean
  /** Initialization failure from discovery or startup permission refresh. */
  initializationError: Error | null
  /** Most recent permissions fetch error. Permissions remain fail-closed on error. */
  permissionFetchError: Error | null
  sessionView: ReturnType<AuthClient['state']['getViewState']>
  /** Safe failure metadata for automatic or manual refresh. */
  tokenRefreshError: IamTokenRefreshError | null
  /** Refresh and atomically apply tokens and authoritative authorization. */
  refreshToken: () => Promise<TokenSet>
  /** Redirect to login page (Authorization Code + PKCE flow) */
  login: (options?: { locale?: string }) => Promise<void>
  /** Handle OAuth callback (exchange code for tokens) */
  handleCallback: (code: string, state: string) => Promise<void>
  /** Handle and scrub the current OAuth redirect callback URL */
  handleRedirectCallback: (options?: RedirectCallbackOptions) => Promise<RedirectCallbackResult>
  /** Resolve app-owned continuation values and configured client-level logout redirect */
  getAppContinuation: () => Promise<AppContinuation>
  /** Build a valid IAM RP-Initiated Logout URL, or null when it cannot be started safely */
  getLogoutUrl: (options?: LogoutUrlOptions) => Promise<string | null>
  /** Logout and optionally redirect to end session endpoint */
  logout: (options?: LogoutOptions) => Promise<void>
  /** Get current access token (for API calls) */
  getAccessToken: () => string | null
  /** Underlying OAuthClient instance (advanced usage) */
  client: AuthClient
}

const IamContext = createContext<IamContextValue | null>(null)

export interface IamProviderProps extends IamConfig, IamUiConfig {
  children: ReactNode
}

export function IamProvider({ children, locale, localization, colorScheme, appearance, darkAppearance, ...config }: IamProviderProps) {
  const clientRef = useRef<AuthClient | null>(null)
  const lifecycleEpoch = useRef(0)
  const [user, setUser] = useState<IamUser | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [initializationError, setInitializationError] = useState<Error | null>(null)
  const [permissionFetchError, setPermissionFetchError] = useState<Error | null>(null)
  const [tokenRefreshError, setTokenRefreshError] = useState<IamTokenRefreshError | null>(null)

  // Initialize OAuthClient once
  if (!clientRef.current) {
    clientRef.current = config.sessionMode === 'server_session' ? new ServerSessionClient(config) : new OAuthClient(config, { startPaused: true })
  }
  const client = clientRef.current
  const [sessionView, setSessionView] = useState(() => client.state.getViewState())

  // Listen for token changes
  useEffect(() => {
    const epoch = ++lifecycleEpoch.current
    let active = true
    const update = () => {
      if (!active) return
      setUser(client.state.getUser())
      setSessionView(client.state.getViewState())
      if (client.mode === 'oauth_tokens') {
        setPermissionFetchError(client.tokenManager.getLastPermissionError())
        setTokenRefreshError(client.tokenManager.getLastRefreshError())
      }
    }
    const unsubscribe = client.state.subscribe(update)
    update()
    client.initialize()
      .then(() => { if (active) { setInitializationError(null); update() } })
      .catch((err: unknown) => { if (active) setInitializationError(err instanceof Error ? err : new Error('IAM initialization failed')) })
      .finally(() => { if (active) setIsLoaded(true) })

    return () => {
      active = false
      unsubscribe()
      // StrictMode immediately resubscribes to the same client; only real unmount disposes it.
      queueMicrotask(() => { if (lifecycleEpoch.current === epoch) client.dispose() })
    }
  }, [client])

  const login = useCallback(async (options?: { locale?: string }) => {
    const url = await client.startAuthorizationFlow(options)
    window.location.href = url
  }, [client])

  const handleCallback = useCallback(async (code: string, state: string) => {
    await client.handleCallback(code, state)
  }, [client])

  const handleRedirectCallback = useCallback(async (options?: RedirectCallbackOptions) => {
    return await client.handleRedirectCallback(options)
  }, [client])

  const getAppContinuation = useCallback(async () => {
    return await client.getAppContinuation()
  }, [client])

  const getLogoutUrl = useCallback(async (options?: LogoutUrlOptions) => {
    return await client.getLogoutUrl(options)
  }, [client])

  const logout = useCallback(async (options?: LogoutOptions) => {
    await client.logout({
      ...options,
      redirect: options?.redirect !== false,
    })
  }, [client])

  const getAccessToken = useCallback(() => {
    return client.getAccessToken()
  }, [client])

  const refreshToken = useCallback(() => client.refreshToken(), [client])

  const value = useMemo<IamContextValue>(() => ({
    user,
    sessionView,
    isLoaded,
    isAuthenticated: !!user,
    initializationError,
    permissionFetchError,
    tokenRefreshError,
    refreshToken,
    login,
    handleCallback,
    handleRedirectCallback,
    getAppContinuation,
    getLogoutUrl,
    logout,
    getAccessToken,
    client,
  }), [user, sessionView, isLoaded, initializationError, permissionFetchError, tokenRefreshError, refreshToken, login, handleCallback, handleRedirectCallback, getAppContinuation, getLogoutUrl, logout, getAccessToken, client])

  return (
    <IamUiProvider locale={locale} localization={localization} colorScheme={colorScheme} appearance={appearance} darkAppearance={darkAppearance}>
      <IamContext.Provider value={value}>{children}</IamContext.Provider>
    </IamUiProvider>
  )
}

export function useIamContext(): IamContextValue {
  const ctx = useContext(IamContext)
  if (!ctx) {
    throw new Error('useIamContext must be used within <IamProvider>')
  }
  return ctx
}
