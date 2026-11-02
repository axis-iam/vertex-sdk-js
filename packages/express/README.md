# @axis-iam/vertex-express

Express authentication and permission middleware for Axis Vertex server applications.

This README describes the current **unpublished candidate**, not an npm beta release. Package version `0.1.0` does not identify the new APIs; older preview tarballs remain separate. See the [candidate and integration map](../../docs/current-integration.md) before choosing matching reviewed artifacts.

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
