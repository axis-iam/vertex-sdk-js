# @axis-iam/vertex-react

React components, providers and hooks for Axis Vertex. React and React DOM are peer dependencies. Server rendering
helpers are available from `@axis-iam/vertex-react/server`.

Install the first beta with `npm install @axis-iam/vertex-react@beta`.

## Browser session lifecycle

`useAuth()` exposes `refreshToken()` and `tokenRefreshError`. Timer and manual callers share one refresh promise per
client/session. It resolves after validating and applying rotated tokens and attempting the authoritative permission
lookup. A permission failure clears permissions and remains observable through `permissionFetchError`; a permission
401 ends the session. `OAuthClient` is also exported for advanced consumers.

Refresh scheduling uses the response's positive integer `expires_in` and its receipt time. It does not read JWT `exp`
for scheduling; the existing JWT-based user/profile contract remains in place. This does not introduce opaque-token
backend support. Explicit `tokenStorage="sessionStorage"` uses envelope version 4 with an absolute `expiresAt`;
reloads preserve that deadline. Older envelopes are cleared and require a new sign-in. Memory remains the default.

Refresh failures expose `IamTokenRefreshError` with stable `code`, `reason`, `retryable`, and optional HTTP/retry
metadata, without provider text or raw response bodies. Network/timeout, 429 and 5xx failures retain the session until
its existing expiry, stop automatic retries, and allow explicit retry. Rejected sessions, invalid rotation responses,
or missing refresh configuration clear local authority. `SessionInvalidatedError` reports a result belonging to a
replaced, logged-out or disposed session; it cannot overwrite a newer session.

Logout invalidates pending work and clears local state before waiting for network activity. Direct Auth logout calls
the authenticated logout endpoint and reports revocation failures. OAuth `logout({ redirect: false })` is local-only;
use the redirect flow for OIDC end-session. Discovery failures remain observable. Provider cleanup cancels timers and
invalidates pending work, including React StrictMode effect replay. If cleanup interrupts an already sent refresh, the server may have consumed its refresh token. The SDK
clears that local session with `SESSION_UNAVAILABLE`; sign in again. This does not claim remote revocation.
A refresh cancelled before transport preserves the session. Ordinary StrictMode replay and reload without a pending
refresh preserve the persisted session. OAuth refresh may omit `id_token`; the existing logout identity is retained.
Expiry notifications continue while refresh or permission bodies are pending; JSON request timeouts include body reads.
Advanced standalone clients must call `dispose()`
when no longer used.

## Reproducible package consumer

From the SDK repository, run `node packages/react/visual-smoke/run-session-lifecycle.mjs --fixtures-only` for packed
ESM/CJS/types and browser race scenarios. The runner builds and packs core/react, installs the tarballs in an isolated
consumer and uses task-owned loopback ports and a temporary Chrome profile. Fixture-only success is not live proof.

For real Direct Auth rotation, replay rejection and logout revocation, omit `--fixtures-only` and supply
`IAM_LIFECYCLE_ISSUER`, `IAM_LIFECYCLE_CLIENT_ID`, `IAM_LIFECYCLE_IDENTIFIER`, and `IAM_LIFECYCLE_PASSWORD` for a disposable
local backend/user. Credentials stay in process memory. `SESSION_LIFECYCLE_OUTPUT`, `SESSION_LIFECYCLE_PORT`, and
`SESSION_LIFECYCLE_CHROME_PORT` select output and isolated ports. Results contain counts and artifact hashes, never
tokens or passwords. Real OAuth grant acquisition is a separate gate; Direct runtime proof does not claim it.
