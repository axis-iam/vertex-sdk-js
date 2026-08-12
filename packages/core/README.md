# @axis-iam/vertex

Core Axis Vertex runtime for TypeScript applications. It provides the browser-safe root export and the explicit
`@axis-iam/vertex/server` entry point for confidential server integrations.

Install the first beta with `npm install @axis-iam/vertex@beta`.

## Confidential WEB/BFF authentication

Import `WebAuthClient` and its store contracts from `@axis-iam/vertex/server`. The client implements OIDC discovery,
Authorization Code + S256 PKCE, HTTP Basic confidential token exchange, refresh-token rotation, and local-first
logout. It is server-only and is not exported from the browser-safe package root.

```ts
import {
  WebAuthClient,
  type WebAuthTransactionStore,
  type WebAuthSessionStore,
} from '@axis-iam/vertex/server'

const client = new WebAuthClient({
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
```

`WebAuthTransactionStore.consume` must atomically read and delete one transaction.
`WebAuthSessionStore.replace` must atomically compare the expected revision and replace the session. Store values
contain the verifier or tokens and therefore belong only in customer-controlled server storage. The SDK provides no
implicit in-memory, Redis, database, or process-global store.
