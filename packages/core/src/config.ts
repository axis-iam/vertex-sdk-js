/** Core SDK configuration */
export interface IamSdkConfig {
  /** IAM server endpoint (e.g. https://auth.example.com) */
  endpoint: string
  /** ApplicationClient.clientId. Server-side packages should use a WEB/M2M confidential client. */
  clientId: string
  /** WEB/M2M confidential ApplicationClient secret (server-side only, never expose to browser) */
  clientSecret: string
  /** Application.resourceAudience. Used to verify access-token aud; this is not clientId. */
  resourceAudience: string
  /** JWKS cache duration in ms (default: 3600000 = 1 hour) */
  jwksRefreshMs?: number
  /** Permission cache TTL in ms (default: 300000 = 5 min) */
  permissionCacheTtlMs?: number
  /** Permission cache max entries (default: 10000) */
  permissionCacheMax?: number
  /** Permission resolve mode (default: 'on-demand') */
  resolveMode?: 'full-sync' | 'on-demand'
  /** Behavior when permission resolution fails (default: 'close') */
  failMode?: 'open' | 'close'
}

/** Subset config for browser-side usage (no clientSecret) */
export interface IamBrowserConfig {
  endpoint: string
  /** SPA/NATIVE public ApplicationClient.clientId. Public clients have no secret. */
  clientId: string
  /** Optional Application.resourceAudience sent to OAuth authorize; this is not clientId. */
  audience?: string
  permissionCacheTtlMs?: number
  permissionCacheMax?: number
}
