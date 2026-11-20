# @axis-iam/vertex-express

Express authentication and permission middleware for Axis Vertex server applications.

This README describes the current **unpublished candidate**, not an npm beta release. Package version `0.1.0` does not identify the new APIs; older preview tarballs remain separate. See the [candidate and integration map](../../docs/current-integration.md) before choosing matching reviewed artifacts.

## Connected application BFF

```ts
import express from 'express'
import { MemorySessionProvider } from '@axis-iam/vertex/server'
import { createBff, getBffUser } from '@axis-iam/vertex-express'

const app = express()
const provider = new MemorySessionProvider({ workers: 1, replicas: 1 })
const bff = createBff({
  provider,
  issuer: 'https://iam.example.com',
  audience: 'configured-resource-audience',
  clientId: process.env.IAM_WEB_CLIENT_ID!,
  clientSecret: process.env.IAM_WEB_CLIENT_SECRET!,
  applicationOrigin: 'https://app.example.com',
  redirectUri: 'https://app.example.com/auth/callback',
  successRedirect: '/signed-in',
  postLogoutRedirect: '/signed-out',
})
app.use(bff.basePath, bff.router)
app.get('/api/private', bff.requireSession, (req, res) => {
  res.json({ userId: getBffUser(req)!.id })
})
// Close provider when this app shuts down.
```

Register one WEB client with CLIENT_SECRET and S256, the exact callback and the canonical app origin. The resource
audience is configured independently of client ID and resolved by IAM registration, not sent as an arbitrary OAuth
audience parameter. All return destinations are fixed same-origin configuration. Proxy trust is host configuration;
the adapter never derives origin from Host or forwarded headers.

First fetch `GET /auth/session/bootstrap`, then navigate to `GET /auth/login`. Missing bootstrap binding fails
before navigation. Callback accepts exact `code,state`, `AUTH_CONTINUATION` for a bound CUSTOM Provider MFA return,
or a bound error; duplicates/mixed parameters/replays reject. Final redirect contains no proof. GET navigation uses
the prelogin binding/state/PKCE/nonce; every POST requires canonical Origin and the bootstrap `X-CSRF-Token`.
Cookie defaults: `__Host-axis-session`, host-only, Path=/, HttpOnly, Secure, SameSite=Lax. Local HTTP needs
`allowInsecureLoopback:true` plus an explicit non-__Host cookie name; this is loopback only.

A query-free GET callback serves a transient CSP-restricted email fragment bridge. It validates exact origin/path,
unique allowed proof keys and the local binding, clears the fragment before I/O, and submits only transactionId/state/
proof through same-origin CSRF. Necessary MFA resumes at the configured successRedirect, without an internal recovery
page. Provider popups also wait for that clean successRedirect; React's sessionProviderReturnUri names this landing,
not the upstream callback carrying query parameters. A bound Provider denial returns terminal non-authentication state
to that landing and cannot exchange or replay its attempt.

The router supplies bootstrap/session, Hosted login/callback, CUSTOM login/authenticate/challenges/authorize/mfa/
complete/cancel/magic, configured-client auth-methods/auth-policy, registration and EMAIL password recovery.
It sends no-store and no-referrer. `requireSession` explicitly performs online validation before business code;
`getBffUser`/`getBffSession` only read its verified request value. Mount protection and your business permission checks
on each protected API. Explicit Bearer input at this Cookie entry is rejected.
For every method except GET/HEAD/OPTIONS, `requireSession` also checks exact
canonical Origin and the current Cookie-bound `X-CSRF-Token` before using any
request identity cache. Send the token from the current safe session view for
business writes; failed checks return 403 before application code executes.

Use `expressSessionBinding()` with existing express-session middleware to reuse its single Cookie owner:

```ts
import { expressSessionBinding } from '@axis-iam/vertex-express'
// app.use(existingSessionMiddleware) before bff.router.
// In createBff config set binding: expressSessionBinding('axisVertexBff')
// Omit standalone cookieName / allowInsecureLoopback when supplying binding.
```

Only a namespaced opaque authentication reference enters the native session; tokens, prelogin control and refresh
fences stay in the chosen provider. Login rotates native session ID and preserves unrelated host fields; logout
removes the authentication namespace and saves through the host lifecycle. A stale automatic resave/touch may retain
a dead reference but cannot recreate provider authentication. The host Cookie may continue for unrelated fields.
The native bridge inherits the host Cookie policy, backend and lifecycle; it does not certify arbitrary native stores
as shared coordination. Choose a shared provider for multiple processes. The supplied memory provider is explicitly
single-process, bounded and volatile.

`POST /auth/session/logout` returns separate local/remote outcomes and 503 for partial confirmation; local invalidation
precedes remote I/O. Current session logout is the default. SSO end-session navigation is a separate explicit choice.
The core README documents defaults, atomic provider methods, request budgets and the old helper migration.

## WEB/BFF Hosted Login

`createWebAuth` composes the framework-neutral `WebAuthClient` from `@axis-iam/vertex/server` into named Express
handlers: `login`, `callback`, `refresh`, `logout`, and `requireSession`.

```ts
import express from 'express'
import { createWebAuth } from '@axis-iam/vertex-express'

const auth = createWebAuth({
  issuer: 'https://auth.example.com',
  clientId: process.env.IAM_WEB_CLIENT_ID!,
  clientSecret: process.env.IAM_WEB_CLIENT_SECRET!,
  applicationOrigin: 'https://app.example.com',
  redirectUri: 'https://app.example.com/auth/callback',
  successRedirect: '/dashboard',
  postLogoutRedirect: '/signed-out',
  transactionStore,
  sessionStore,
})

const app = express()
app.get('/auth/login', auth.login)
app.get('/auth/callback', auth.callback)
app.post('/auth/refresh', auth.refresh)
app.post('/auth/logout', auth.logout)
app.get('/api/private', auth.requireSession, (req, res) => {
  // req.webAuthSession exposes an access token only to server middleware.
  res.json({ authenticated: true })
})
```

The transaction and session stores are required and must implement the Core atomicity contracts. Cookies contain
only independent opaque identifiers and default to `HttpOnly`, `Secure`, and `SameSite=Lax`. Set fixed same-origin
redirects during startup; callback query parameters never select the destination. For local HTTP development,
explicitly set `secureCookies: false` and choose cookie names without the `__Host-` or `__Secure-` prefix.
