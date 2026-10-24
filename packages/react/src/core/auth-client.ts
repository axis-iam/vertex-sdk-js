import type { OAuthClient } from './oauth-client'
import type { ServerSessionClient } from './server-session-client'
export type AuthClient = OAuthClient | ServerSessionClient
