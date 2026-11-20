# @axis-iam/vertex-nestjs

NestJS module, guards and decorators for Axis Vertex server applications.

This README describes the current **unpublished candidate**, not an npm beta release. Package version `0.1.0` does not identify the new APIs; older preview tarballs remain separate. See the [candidate and integration map](../../docs/current-integration.md) before choosing matching reviewed artifacts.

## Connected application BFF (Nest Express adapter)

```ts
import { NestFactory } from '@nestjs/core'
import { MemorySessionProvider } from '@axis-iam/vertex/server'
import { mountBff } from '@axis-iam/vertex-nestjs'

const app = await NestFactory.create(AppModule)
const provider = new MemorySessionProvider({ workers: 1, replicas: 1 })
const bff = mountBff(app, {
  provider, issuer: 'https://iam.example.com', audience: 'configured-resource',
  clientId: process.env.IAM_WEB_CLIENT_ID!, clientSecret: process.env.IAM_WEB_CLIENT_SECRET!,
  applicationOrigin: 'https://app.example.com',
  redirectUri: 'https://app.example.com/auth/callback',
  successRedirect: '/signed-in', postLogoutRedirect: '/signed-out',
})
// Explicitly protect application API paths before listen/init.
app.use('/api/private', bff.requireSession)
await app.listen(3000)
```

Mount before init/listen. Auth routes complete in middleware before Nest guards, so an existing global Bearer guard
cannot reject anonymous login. Business guards remain active; Cookie-only controllers must explicitly use `@Public()`
to skip the Bearer guard after mounting `bff.requireSession`, and must apply their business authorization. Do not
mark the whole application public. `getBffUser`/`getBffSession` read only the validated request value; do not substitute
the Bearer-specific `@CurrentUser` decorator. Express-backed Nest 10/11 is the declared adapter; Fastify is rejected.

This package composes `@axis-iam/vertex-express` and the same core provider. It does not implement a second protocol.
For native Session reuse, mount your existing middleware first and use exported `expressSessionBinding()`.
The Express README defines Cookie/CSRF routes, safe views, finite capabilities, native namespace and shutdown contract.
The core memory provider is bounded, volatile and single-process. Close it in your application's shutdown hook.
