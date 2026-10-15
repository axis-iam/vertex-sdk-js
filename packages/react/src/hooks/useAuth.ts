import { useIamContext } from '../provider/IamProvider'

/**
 * Core authentication hook.
 *
 * @example
 * ```tsx
 * function LoginButton() {
 *   const { login, logout, isAuthenticated, user } = useAuth()
 *   if (isAuthenticated) {
 *     return <button onClick={() => logout()}>Logout {user?.email}</button>
 *   }
 *   return <button onClick={() => login()}>Login</button>
 * }
 * ```
 */
export function useAuth() {
  const {
    user,
    isLoaded,
    isAuthenticated,
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
  } = useIamContext()

  return {
    /** Current user (null if not authenticated) */
    user,
    /** SDK has finished initializing */
    isLoaded,
    /** Whether user is authenticated */
    isAuthenticated,
    /** Initialization failure, if discovery or startup checks failed */
    initializationError,
    /** Most recent permission refresh error; permissions remain fail-closed */
    permissionFetchError,
    /** Last automatic/manual refresh failure, with safe retry metadata. */
    tokenRefreshError,
    /** Shared refresh transaction; applies rotated tokens before resolving. */
    refreshToken,
    /** Redirect to OAuth login */
    login,
    /** Handle OAuth callback — call this from your /callback route */
    handleCallback,
    /** Handle the current OAuth callback URL and scrub callback parameters */
    handleRedirectCallback,
    /** Read app continuation URIs from IAM auth-methods plus configured client logout redirect */
    getAppContinuation,
    /** Build a valid IAM logout URL, or null if local-only logout is required */
    getLogoutUrl,
    /** Logout (clears tokens, optionally redirects to end session) */
    logout,
    /** Get current access token for API calls */
    getAccessToken,
  }
}
