import {
  IamProvider,
  ConnectedAccounts,
  SignIn,
  UserButton,
  useAuth,
  usePermission,
  PermissionGate,
  useIdentityProviders,
  useProviderLogin,
  useAccountLinkCallback,
} from '@axis-iam/vertex-react'
import { hasPermission } from '@axis-iam/vertex'
import { useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Phase 1 paired quickstart: browser half
//
// This app uses the React/browser surface:
// - @axis-iam/vertex-react
// - SPA public ApplicationClient.clientId
// - Authorization Code + PKCE
// - no clientSecret in browser code
//
// Pair it with sdk-java/examples/spring-boot-demo for the protected API half.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Permission constants shared with the protected API
// ---------------------------------------------------------------------------
const Permissions = {
  POSTS_READ: 'posts:read',
  POSTS_CREATE: 'posts:create',
  ADMIN_PANEL: 'admin:access',
} as const

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '')

type ApiResult = {
  status: string
  body: string
}

async function readApiResult(response: Response): Promise<ApiResult> {
  const text = await response.text()
  let body = text || '<empty>'
  try {
    body = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    // Plain text is fine for smoke output.
  }

  return {
    status: `${response.status} ${response.statusText}`.trim(),
    body,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ApiSmokePanel({ getAccessToken }: { getAccessToken: () => string | null }) {
  const [publicResult, setPublicResult] = useState<ApiResult | null>(null)
  const [postsResult, setPostsResult] = useState<ApiResult | null>(null)
  const [publicLoading, setPublicLoading] = useState(false)
  const [postsLoading, setPostsLoading] = useState(false)

  async function fetchPublic() {
    setPublicLoading(true)
    try {
      setPublicResult(await readApiResult(await fetch(`${API_BASE_URL}/public`)))
    } catch (error) {
      setPublicResult({ status: 'Request failed', body: errorMessage(error) })
    } finally {
      setPublicLoading(false)
    }
  }

  async function fetchPosts() {
    const token = getAccessToken()
    if (!token) {
      setPostsResult({ status: 'Missing token', body: 'No access token is available for this session.' })
      return
    }

    setPostsLoading(true)
    try {
      setPostsResult(await readApiResult(await fetch(`${API_BASE_URL}/posts`, {
        headers: { Authorization: `Bearer ${token}` },
      })))
    } catch (error) {
      setPostsResult({ status: 'Request failed', body: errorMessage(error) })
    } finally {
      setPostsLoading(false)
    }
  }

  return (
    <section data-testid="api-smoke-panel" style={{ marginTop: 24, padding: 16, border: '1px solid #e5e5e5', borderRadius: 8 }}>
      <h2>API Smoke</h2>
      <p><code>{API_BASE_URL}</code></p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" data-testid="fetch-public" onClick={() => void fetchPublic()} disabled={publicLoading}>
          {publicLoading ? 'Fetching...' : 'Fetch public'}
        </button>
        <button type="button" data-testid="fetch-posts" onClick={() => void fetchPosts()} disabled={postsLoading}>
          {postsLoading ? 'Fetching...' : 'Fetch protected posts'}
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <ApiResultBlock id="api-public" title="/public" result={publicResult} />
        <ApiResultBlock id="api-posts" title="/posts" result={postsResult} />
      </div>
    </section>
  )
}

function ApiResultBlock({ id, title, result }: { id: string; title: string; result: ApiResult | null }) {
  return (
    <div>
      <strong>{title}</strong>
      <div data-testid={`${id}-status`}>Status: {result?.status ?? 'not run'}</div>
      {result && (
        <pre style={{
          marginTop: 8,
          maxHeight: 180,
          overflow: 'auto',
          padding: 12,
          background: '#f7f7f7',
          borderRadius: 6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        >
          {result.body}
        </pre>
      )}
    </div>
  )
}

function CustomProviderSignIn() {
  const { providers, isLoading, error } = useIdentityProviders()
  const { startProviderLogin, isLoading: providerLoginLoading } = useProviderLogin()
  const [status, setStatus] = useState<string | null>(null)

  async function start(providerId: string) {
    setStatus(null)
    try {
      const provider = providers.find((item) => item.id === providerId)
      if (!provider) {
        setStatus('Provider sign-in is unavailable.')
        return
      }
      const authorizationUrl = await startProviderLogin(provider)
      window.location.href = authorizationUrl
    } catch {
      setStatus('Provider sign-in is unavailable.')
    }
  }

  if (isLoading) return <p>Loading sign-in options...</p>
  if (error) return <p role="status">Provider sign-in is unavailable.</p>
  if (providers.length === 0) return <p role="status">No embedded providers are enabled for this client.</p>

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          onClick={() => void start(provider.id)}
          disabled={providerLoginLoading}
        >
          Continue with {provider.displayName}
        </button>
      ))}
      {status && <p role="status">{status}</p>}
    </div>
  )
}

function AccountLinkCallbackView() {
  const { status, error, result } = useAccountLinkCallback({
    onSuccess: () => {
      window.setTimeout(() => {
        window.location.assign('/')
      }, 600)
    },
  })

  if (status === 'success') {
    return <p>Connected {result?.method.displayName ?? 'account'}.</p>
  }

  if (status === 'error') {
    return <p role="alert">{errorMessage(error ?? new Error('Account linking could not be completed.'))}</p>
  }

  return <p>Completing account connection...</p>
}

// ---------------------------------------------------------------------------
// 2. Inner app — rendered inside IamProvider
// ---------------------------------------------------------------------------
function Dashboard() {
  const { isAuthenticated, isLoaded, user, logout, handleRedirectCallback, getAccessToken } = useAuth()
  const canCreatePost = usePermission(Permissions.POSTS_CREATE)
  const callbackStarted = useRef(false)
  const [callbackStatus, setCallbackStatus] = useState<string | null>(null)
  const [callbackBusy, setCallbackBusy] = useState(false)
  const [signInMode, setSignInMode] = useState<'redirect' | 'embedded' | 'custom'>('redirect')

  useEffect(() => {
    if (callbackStarted.current || window.location.pathname !== '/callback') {
      return
    }
    callbackStarted.current = true

    setCallbackBusy(true)
    setCallbackStatus('Completing sign-in...')
    handleRedirectCallback({ cleanUrl: '/' })
      .then((result) => {
        if (result.status === 'success') {
          setCallbackStatus('Sign-in completed.')
          return
        }
        if (result.status === 'error') {
          setCallbackStatus(`Sign-in failed: ${errorMessage(result.error)}`)
          return
        }
        setCallbackStatus('Sign-in failed: callback is missing code or state.')
      })
      .catch((error: unknown) => {
        setCallbackStatus(`Sign-in failed: ${errorMessage(error)}`)
      })
      .finally(() => {
        setCallbackBusy(false)
      })
  }, [handleRedirectCallback])

  if (!isLoaded || callbackBusy) {
    return <p>{callbackStatus ?? 'Loading...'}</p>
  }

  if (window.location.pathname === '/account-link/callback') {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto' }}>
        <AccountLinkCallbackView />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: 400, margin: '80px auto' }}>
        <h1>My App</h1>
        {callbackStatus && <p role="status">{callbackStatus}</p>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['redirect', 'embedded', 'custom'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSignInMode(mode)}
              aria-pressed={signInMode === mode}
            >
              {mode === 'redirect' ? 'Hosted' : mode === 'embedded' ? 'Embedded' : 'Custom'}
            </button>
          ))}
        </div>
        {signInMode === 'redirect' && <SignIn />}
        {signInMode === 'embedded' && <SignIn mode="embedded" />}
        {signInMode === 'custom' && <CustomProviderSignIn />}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '40px auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <UserButton />
        </div>
      </header>

      <p>Welcome, {user?.name ?? user?.email ?? 'User'}!</p>
      {callbackStatus && <p role="status">{callbackStatus}</p>}

      {/* Imperative permission check */}
      {canCreatePost && (
        <button type="button">New Post</button>
      )}

      {/* Declarative permission gate */}
      <PermissionGate permission={Permissions.ADMIN_PANEL} fallback={null}>
        <section style={{ marginTop: 24, padding: 16, border: '1px solid #e5e5e5', borderRadius: 8 }}>
          <h2>Admin Panel</h2>
          <p>Only visible to users with <code>admin:access</code> permission.</p>
        </section>
      </PermissionGate>

      {/* Programmatic check using core SDK */}
      {user && hasPermission(user.permissions, Permissions.POSTS_READ) && (
        <section style={{ marginTop: 24 }}>
          <h2>Posts</h2>
          <p>You have read access to posts.</p>
        </section>
      )}

      <ApiSmokePanel getAccessToken={getAccessToken} />

      <section style={{ marginTop: 24 }}>
        <ConnectedAccounts redirectUri={`${window.location.origin}/account-link/callback`} />
      </section>

      <button onClick={() => logout({ redirect: true })} style={{ marginTop: 32 }}>
        Logout
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. App root — wraps everything with IamProvider
// IamProvider discovers Java IAM OIDC metadata, starts Authorization Code + PKCE,
// then resolves permissions via GET /api/v1/auth/me/permissions.
// Redirect mode uses the backend-owned iam-server login page. Embedded mode
// discovers enabled provider buttons from Java IAM for this SPA public client.
// ---------------------------------------------------------------------------
export default function App() {
  return (
    <IamProvider
      // SPA public ApplicationClient.clientId. Browser clients have no secret.
      clientId={import.meta.env.VITE_IAM_CLIENT_ID ?? 'iam_spa_public_client_id'}
      issuerUri={import.meta.env.VITE_IAM_ISSUER_URI ?? 'http://localhost:30001'}
      redirectUri={import.meta.env.VITE_IAM_REDIRECT_URI ?? 'http://localhost:5173/callback'}
      postLogoutRedirectUri={import.meta.env.VITE_IAM_POST_LOGOUT_REDIRECT_URI ?? 'http://localhost:5173/'}
    >
      <Dashboard />
    </IamProvider>
  )
}
