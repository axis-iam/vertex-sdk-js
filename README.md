# Axis Vertex JavaScript SDK

JavaScript and TypeScript packages for integrating Axis Vertex authentication, RBAC permissions, and security controls.

## Permission manifest synchronization (server only)

Import `PermissionManifestClient` only from `@axis-iam/vertex/server` and pass an explicit structured manifest,
separate issuer/Portal endpoints, and an M2M client persisted with `permissions:sync`. Startup defaults to
`DISABLED`; CI validate and deployment upsert are explicit, and development requires `FAIL_FAST` or `CONTINUE`.
Nest uses `permissionManifest: { portalApiEndpoint, manifest, startup }`; legacy startup registration and regex
upload are retired. Codegen upload consumes structured JSON. Commands share three attempts and fifteen seconds
across issuer and Portal. Observer events contain only mode/outcome/status/duration.
Disabled startup returns `{ networkAttempted: false, continued: false, result: null }`; development `CONTINUE`
always emits a redacted event and cannot silently swallow failure.

## Which JS surface should I use?

| Package | Runtime | Client type | Uses secret? | Main job |
| --- | --- | --- | --- | --- |
| `@axis-iam/vertex-react` | Browser / React SPA | `SPA` public ApplicationClient | No | Components and hooks for sign-in, sign-up, user UI, and permission gating |
| `@axis-iam/vertex` | Shared core | Public/shared | No | JWT parsing helpers, permission utilities, and browser-safe shared types |
| `@axis-iam/vertex/server` | Node.js / CLI / backend runtime | `WEB` or `M2M` confidential ApplicationClient | Yes | Confidential `IamClient`, `PortalOpenApiClient`, HTTP permission resolver, permission sync, and server verification helpers |
| `@axis-iam/vertex-react/server` | Next.js / server runtime | `WEB` or `M2M` confidential ApplicationClient | Yes | Bearer-token route guards, token inspection, and limited middleware redirects |
| `@axis-iam/vertex-express` | Express | `WEB` or `M2M` confidential ApplicationClient | Yes | Middleware for protected routes and permission checks |
| `@axis-iam/vertex-nestjs` | NestJS | `WEB` or `M2M` confidential ApplicationClient | Yes | Guards, decorators, and protected route helpers |
| `@axis-iam/vertex-codegen` | CLI / build tooling | `WEB` or `M2M` confidential ApplicationClient | Yes | Permission sync/upload against IAM |

Browser/React always means SPA/public client + PKCE + no `clientSecret`. Server/runtime tooling always means confidential client + bearer-token inspection or permission sync. Redirect sign-in in the React package uses the Axis Vertex login page through a SPA public client. Embedded sign-in discovers backend-enabled provider buttons for the current SPA client and asks Axis Vertex to start the selected broker flow.

## Application Client Contract

Create one business Application for your product, then create the ApplicationClients it needs:

- React/browser uses a `SPA` public ApplicationClient. It has no secret; browser config only takes `clientId`.
- Native/mobile uses a `NATIVE` public ApplicationClient. It has no secret.
- Express/NestJS/Node server packages and `@axis-iam/vertex-codegen` use a `WEB` or `M2M` confidential ApplicationClient with `clientSecret`.
- If a customer WEB app implements interactive browser login itself, the authorization-code flow must use both confidential client authentication at the token endpoint and S256 PKCE (`code_challenge_method=S256` plus matching `code_verifier`). Store OAuth `state` and the PKCE verifier server-side or in an equivalent secure BFF session.
- `clientId` means `ApplicationClient.clientId`.
- `resourceAudience` means `Application.resourceAudience`, for example `api://socratiq`. Resource servers use it to verify access-token `aud`.
- Browser signup, SMS, and passwordless requests use the SPA public `clientId` as JSON `client_id`; they do not take an IAM internal Application UUID or send `X-Application-Id`.

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@axis-iam/vertex`](./packages/core/) | Core runtime -- JWT verification, permission resolution, API client | [![npm](https://img.shields.io/npm/v/@axis-iam/vertex)](https://www.npmjs.com/package/@axis-iam/vertex) |
| [`@axis-iam/vertex-react`](./packages/react/) | React SDK -- pre-built auth components, RBAC hooks, security hooks | [![npm](https://img.shields.io/npm/v/@axis-iam/vertex-react)](https://www.npmjs.com/package/@axis-iam/vertex-react) |
| [`@axis-iam/vertex-nestjs`](./packages/nestjs/) | NestJS integration -- `IamModule`, guards, and decorators | [![npm](https://img.shields.io/npm/v/@axis-iam/vertex-nestjs)](https://www.npmjs.com/package/@axis-iam/vertex-nestjs) |
| [`@axis-iam/vertex-express`](./packages/express/) | Express middleware -- JWT auth + RBAC permission checking | [![npm](https://img.shields.io/npm/v/@axis-iam/vertex-express)](https://www.npmjs.com/package/@axis-iam/vertex-express) |
| [`@axis-iam/vertex-codegen`](./packages/codegen/) | CLI tool -- sync and upload permission definitions to IAM server | [![npm](https://img.shields.io/npm/v/@axis-iam/vertex-codegen)](https://www.npmjs.com/package/@axis-iam/vertex-codegen) |
| [`@axis-iam/vertex-testing`](./packages/test/) | Test utilities -- mock resolver, test helpers | [![npm](https://img.shields.io/npm/v/@axis-iam/vertex-testing)](https://www.npmjs.com/package/@axis-iam/vertex-testing) |

`@axis-iam/vertex/server`, Express, NestJS, and codegen are server-side surfaces. They verify tokens, resolve permissions through confidential clients, call management APIs, or sync permission definitions. They are not browser login flows and do not replace the Axis Vertex login page.

The `@axis-iam/vertex-react/server` middleware still contains a limited `/login?client_id=...&redirect_uri=...` redirect for unauthenticated protected routes. It is not a complete WEB Authorization Code login helper under current Axis Vertex behavior because it does not generate/store `state`, does not generate/store a PKCE verifier, does not send `code_challenge_method=S256`, and does not handle confidential token exchange with `clientSecret` plus `code_verifier`. Do not use it as the recommended WEB login implementation; use the React SPA PKCE flow, or implement a dedicated server-side WEB/BFF login flow with secret + PKCE.

## Quick Start

### NestJS

```bash
npm install @axis-iam/vertex @axis-iam/vertex-nestjs
```

```ts
import { Controller, Get, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { permKey, type IamJwtPayload } from '@axis-iam/vertex'
import { IamModule, RequirePerm, CurrentUser, Public } from '@axis-iam/vertex-nestjs'

const MyPermissions = {
  POSTS_READ: permKey('posts', 'read'),
  POSTS_CREATE: permKey('posts', 'create'),
} as const

@Controller('posts')
class PostsController {
  @Get()
  @RequirePerm(MyPermissions.POSTS_READ)
  list(@CurrentUser() user: IamJwtPayload & { permissions: string[] }) {
    return { posts: [], userId: user.sub }
  }

  @Get('health')
  @Public()
  health() {
    return { status: 'ok' }
  }
}

@Module({
  imports: [
    IamModule.forRoot({
      endpoint: process.env.IAM_ENDPOINT!,
      // WEB/M2M confidential ApplicationClient for this Node/NestJS server.
      clientId: process.env.IAM_CLIENT_ID!,
      clientSecret: process.env.IAM_CLIENT_SECRET!,
      // Application.resourceAudience copied from Portal/Admin SDK Config.
      resourceAudience: process.env.IAM_RESOURCE_AUDIENCE ?? 'api://socratiq',
      permissions: [
        { ...MyPermissions.POSTS_READ, displayName: 'Read posts' },
        { ...MyPermissions.POSTS_CREATE, displayName: 'Create posts' },
      ],
    }),
  ],
  controllers: [PostsController],
})
class AppModule {}
```

See full example: [`examples/nestjs-demo/`](./examples/nestjs-demo/)

### Express

```bash
npm install @axis-iam/vertex @axis-iam/vertex-express
```

```ts
import express from 'express'
import { permKey } from '@axis-iam/vertex'
import { iamAuth, requirePerm } from '@axis-iam/vertex-express'

const MyPermissions = {
  POSTS_READ: permKey('posts', 'read'),
  POSTS_CREATE: permKey('posts', 'create'),
} as const

const app = express()

// Verify JWT + resolve permissions on every request
app.use(iamAuth({
  endpoint: process.env.IAM_ENDPOINT!,
  // WEB/M2M confidential ApplicationClient for this Express server.
  clientId: process.env.IAM_CLIENT_ID!,
  clientSecret: process.env.IAM_CLIENT_SECRET!,
  // Application.resourceAudience copied from Portal/Admin SDK Config.
  resourceAudience: process.env.IAM_RESOURCE_AUDIENCE ?? 'api://socratiq',
}))

// Require specific permissions per route
app.get('/posts', requirePerm(MyPermissions.POSTS_READ), (req, res) => {
  res.json({ posts: [] })
})

app.post('/posts', requirePerm(MyPermissions.POSTS_CREATE), (req, res) => {
  res.json({ created: true })
})
```

See full example: [`examples/express-demo/`](./examples/express-demo/)

### React SPA Phase 1 quickstart

```bash
npm install @axis-iam/vertex @axis-iam/vertex-react
```

In the IAM Portal:

1. Create one business Application for your product.
2. Create a `SPA` public ApplicationClient for the React app.
3. Add the SPA redirect URI, for example `https://app.example.com/callback`.
4. Add the SPA post-logout redirect URI, for example `https://app.example.com/signed-out`.
5. Add the SPA origin to that ApplicationClient's allowed origins, for example `https://app.example.com`.
6. Configure Application-level `loginInitiationUri` and `postVerificationRedirectUri` for app-owned continuation after IAM hosted email verification.
7. Configure App-level IdPs if needed. Redirect mode lists them on the backend-owned IAM login page. Embedded mode discovers them from IAM for this SPA client. Do not link to `/oauth2/authorization/{id}` from the SDK.

```tsx
import { useState } from 'react'
import {
  IamProvider,
  ForgotPassword,
  ResetPassword,
  SignIn,
  SignUp,
  useRegistrationGrantPreview,
  useIdentityProviders,
  useProviderLogin,
  useAuth,
  usePasswordReset,
  usePermission,
  PermissionGate,
  ConnectedAccounts,
  useAccountLinkCallback,
  AccountCenter,
  OrganizationSwitcher,
  OrganizationInvitationAccept,
  UserButton,
} from '@axis-iam/vertex-react'

function App() {
  return (
    <IamProvider
      clientId="your-spa-public-client-id"
      issuerUri="https://auth.example.com"
      redirectUri="https://app.example.com/callback"
      postLogoutRedirectUri="https://app.example.com/signed-out"
    >
      <Dashboard />
    </IamProvider>
  )
}

function Dashboard() {
  const { isAuthenticated, user, login, logout, handleRedirectCallback } = useAuth()
  const canCreate = usePermission('posts:create')
  const [accountCenterOpen, setAccountCenterOpen] = useState(false)

  async function completeCallback() {
    const result = await handleRedirectCallback({ cleanUrl: '/' })
    if (result.status === 'error') throw result.error
  }

  if (!isAuthenticated) return <SignIn />

  return (
    <div>
      <UserButton />
      <p>Hello, {user?.name}</p>
      {canCreate && <button>New Post</button>}
      <PermissionGate permission="admin:access" fallback={null}>
        <AdminPanel />
      </PermissionGate>
      <button type="button" onClick={() => setAccountCenterOpen(true)}>Account settings</button>
      <AccountCenter
        open={accountCenterOpen}
        onOpenChange={setAccountCenterOpen}
        organizationId={user?.orgId ?? null}
        sessionsProps={{ onLoggedOut: () => { void logout({ redirect: true }) } }}
      />
      <OrganizationSwitcher
        onSwitch={(response) => {
          if (response.tokenRefreshRequired) {
            // Refresh or reauthenticate in the app flow before relying on a new org_id claim.
          }
        }}
      />
      <ConnectedAccounts redirectUri="https://app.example.com/account-link/callback" />
    </div>
  )
}
```

The default Authorization Code + PKCE scope set is `openid profile email offline_access`, so a public
SPA client configured with the `refresh_token` grant receives a rotated OAuth refresh token. Supplying
`scopes` overrides that default; omitting `offline_access` intentionally creates a non-refreshable OAuth
session.

`IamProvider` keeps OAuth tokens and resolved permissions in memory by default. This avoids browser-readable durable storage for `access_token`, `refresh_token`, `id_token`, and permissions; users must sign in again after a full page reload. Apps that deliberately accept the XSS/storage risk can opt in to reload-scoped persistence:

```tsx
<IamProvider
  clientId="your-spa-public-client-id"
  issuerUri="https://auth.example.com"
  redirectUri="https://app.example.com/callback"
  tokenStorage="sessionStorage"
>
  <Dashboard />
</IamProvider>
```

Short-lived OAuth PKCE verifier/state and account-linking state still use `sessionStorage` for redirect correlation. They are not full token-set persistence.

Pre-GA breaking change: persisted token state now uses version 3 of the `axis_iam_session` envelope. It contains tokens, current authorization roles, resolved permissions, an explicit authentication provenance for logout routing, and a separate optional refresh provenance. Authentication provenance is retained even when a caller intentionally omits `offline_access` and receives no refresh token. The SDK deletes the legacy `iam_tokens` and `iam_permissions` keys without reading or migrating them, and clears older session-envelope versions that cannot represent both provenance contracts. Applications that previously enabled `tokenStorage="sessionStorage"` require users to sign in once after upgrading. Direct Auth refresh tokens are sent only to `/api/v1/auth/token/refresh`; Authorization Code + PKCE refresh tokens are sent only to the discovered OAuth token endpoint. Direct logout uses the authenticated JSON endpoint, while OAuth sessions retain OIDC end-session support with or without a refresh token. The SDK never infers or falls back between these protocols.

`clientId` in React is the `SPA` public `ApplicationClient.clientId`; do not pass or expose a `clientSecret` in browser code. If you pass `audience`, use the Application `resourceAudience` copied from Portal/Admin SDK Config, not a client id. The React SDK discovers `GET {issuer}/.well-known/openid-configuration`, uses Authorization Code + PKCE, and exchanges tokens as a public client. Axis Vertex publishes JWKS at `{issuer}/oauth2/jwks`.

Account-center and B2B Organization surfaces are browser-safe connected-app helpers. Use `AccountCenter` when the host owns one entry trigger and the SDK should provide the accessible Profile, Password, Sessions, and Permissions dialog navigation. It is controlled with `open` / `onOpenChange`; use `initialSection`, `organizationId`, and individual panel props for composition. The standalone `AccountProfilePanel`, `PasswordChangeForm`, `AccountSessionsPanel`, and `AccountPermissionsPanel` remain available. The `OAuthClient` facade also exposes password change/forgot/reset, email verification send/verify, session list/revoke/logout, membership checks, and current-user permission summary/check helpers. Organization switching calls `POST /api/v1/auth/me/organizations/current` and returns the backend continuation response; the SDK does not edit JWT `org_id` claims locally.

### Auth entry dialog

`AuthDialog` is the controlled entry point for applications that want an SDK-provided sign-in/sign-up surface. It composes the same `SignIn` and `SignUp` engines as the standalone components; it does not add a second request, PKCE, provider, password-reset, or registration-grant flow. The default is embedded mode for an in-place dialog. `mode="redirect"` remains available when the application wants the existing hosted redirect behavior.

```tsx
import { useState } from 'react'
import { AuthDialog, SignInButton } from '@axis-iam/vertex-react'

function AuthEntry() {
  const [open, setOpen] = useState(false)

  return (
    <AuthDialog
      open={open}
      onOpenChange={setOpen}
      initialView="sign-in"
      allowSignUp
      signInProps={{ onSuccess: () => setOpen(false) }}
      signUpProps={{ registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: shortLivedProof } }}
    >
      <SignInButton>Continue</SignInButton>
    </AuthDialog>
  )
}
```

`SignInButton` and `SignUpButton` have localized defaults and accept ordinary button props, children, `className`, and `appearance`. `AuthDialog` is controlled: close controls, Escape, the backdrop, and its trigger call `onOpenChange`; the host owns the resulting state. It renders a centered dialog on desktop and a full-screen surface at mobile widths, traps keyboard focus while open, and restores trigger focus when it closes. Provider locale/localization, `light`/`dark`/`system`, branding, and Appearance precedence are inherited from `IamProvider`; changing them does not recreate the OAuth client or discard an open embedded form. `registrationGrant` is passed only to `SignUp` and is never persisted by the dialog.

Use the surfaces according to their request ownership:

- Hosted redirect: `<SignIn />` or `<SignUp />` with `mode="redirect"` sends the browser to the IAM-hosted authentication page. In `AuthDialog mode="redirect"`, login and signup share that one hosted entry unless `signUpProps.registrationGrant` contains a non-blank hosted-supported `EMAIL_LINK` or `ACCESS_CODE` proof; only then is a separate Sign Up tab shown. `ORG_INVITATION` remains embedded-only because hosted signup rejects it.
- Embedded: `<SignIn mode="embedded" />` and `<SignUp mode="embedded" />` render SDK forms in place. `AuthDialog mode="embedded"` keeps its Sign In / Sign Up tabs because the panes use distinct embedded engines.
- AuthDialog: the dialog is a controlled composition and does not create another authentication flow. Choose embedded mode for meaningful tabs, or redirect mode for one hosted entry (with an explicit registration grant only when a distinct hosted signup path is required).

`AccountCenter` includes responsive modal styling, so Tailwind or host CSS is not required. On desktop it
uses a left menu and one content pane; on small screens it becomes a full-screen dialog with a Menu return
control. A host supplies only its trigger and controlled state. The same additive `appearance`, `className`,
and `style` contract remains available:

```tsx
const accountAppearance = {
  primaryColor: '#164e63',
  textColor: '#17202a',
  mutedTextColor: '#52606d',
  surfaceColor: '#ffffff',
  subtleColor: '#f4f7f8',
  borderColor: '#d7e0e5',
  successColor: '#15803d',
  warningColor: '#a16207',
  dangerColor: '#b42318',
  focusColor: '#0284c7',
  borderRadius: '6px',
}

function AccountSettings({ organizationId }: { organizationId?: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Account settings</button>
      <AccountCenter open={open} onOpenChange={setOpen} appearance={accountAppearance} organizationId={organizationId} />
    </>
  )
}
```

The host owns its trigger and state while the SDK owns the dialog and section navigation. `backgroundColor`,
`inputBackgroundColor`, and the other existing/new appearance
tokens can be omitted independently; safe defaults fill every omitted token.

`IamProvider` has a dependency-free host-owned UI configuration contract. Pass the current locale once through
`locale`; built-in `en` and `zh-CN` catalogs are complete, while `zh`, `zh-Hans`, and `zh-CN` resolve to
Simplified Chinese and `en-*` resolves to English. Pass typed `localization` partial overrides only for the copy
you own; the SDK merges them over the selected complete catalog. `colorScheme` accepts `'light'`, `'dark'`, or
`'system'`; `appearance` remains the light/custom appearance and `darkAppearance` is the additive dark override.
Locale and theme changes update text in place without recreating the OAuth client, closing dialogs, clearing form
state, resetting an Account Center section, or refetching data. The SDK does not persist locale or add an i18n runtime.
All SDK-owned visible text, placeholders, ARIA labels, loading/error/success/busy states, and locale-sensitive dates
use this provider-level source. SDK errors use stable error codes first; unrecognized responses render a generic safe
localized message rather than a raw server response.

```tsx
import { IamProvider, type PartialIamLocalization } from '@axis-iam/vertex-react'

const localization: PartialIamLocalization = {
  auth: { signIn: '立即登录' },
  accountCenter: { title: '账户设置' },
}

<IamProvider
  clientId="your-spa-public-client-id"
  issuerUri="https://auth.example.com"
  redirectUri="https://app.example.com/callback"
  locale={i18n.resolvedLanguage}
  colorScheme="system"
  darkAppearance={{ primaryColor: '#0284c7' }}
  localization={localization}
>
  <Dashboard />
</IamProvider>
```

`iamLocalizationEnglish` and `iamLocalizationZhCN` are exported for inspection, but consumers never need to copy
or merge a full catalog. The host owns locale/theme state; the SDK adds no i18n runtime or persistence.

Current-user permission checks call `GET /api/v1/auth/me/permissions` or `POST /api/v1/auth/me/permissions:check` with the user's bearer token. Wildcard semantics are backend-owned for these remote checks; local wildcard utilities remain offline helpers only.

Public Organization invitation routes can preview without a bearer token and accept with the current bearer token only when one exists:

```tsx
function InvitationRoute({ token }: { token: string }) {
  return (
    <OrganizationInvitationAccept
      token={token}
      onLoginRequired={() => {
        window.location.assign('/login')
      }}
    />
  )
}
```

`LOGIN_REQUIRED` with `LOGIN_OR_REGISTER_THEN_RETRY_ACCEPT` means the app should login or register the user, then retry the same user-visible invitation link. Do not store raw invitation tokens in browser storage.

Generate shared permission constants locally from the same explicit structured manifest:

```bash
pnpm vertex-codegen generate --manifest iam-permission-manifest.json --output src/generated/permissions.gen.ts
```

The generated `PermissionKey` values can be passed unchanged to NestJS `RequirePerm`, React `usePermission`, and
`PermissionGate`; see `examples/shared-permission-consumer`. Generation reads local JSON only and performs zero
network work. Server-side runtime permission resolution remains available through `IamClient` from
`@axis-iam/vertex/server`; it is intentionally absent from the browser-safe root entry. Publication remains a
separate server-only V2 command: `@axis-iam/vertex-codegen upload` obtains an exact `permissions:sync` machine token and
calls Portal. The compatibility V1 registrar and remote `sync` command remain only pending M7 retirement and are
not active onboarding paths.

Portal Open API management calls use a different server-side client and a different auth contract. Import `PortalOpenApiClient` from `@axis-iam/vertex/server` only from a server, CLI, or background job with an `M2M` confidential ApplicationClient. It requests an explicit `client_credentials` machine token from `{issuer}/oauth2/token` with `portal:openapi:read` for `GET` calls and `portal:openapi:write` for `POST` / `PUT` / `PATCH` / `DELETE` calls, then sends `Authorization: Bearer <machine_token>` to `iam-portal /open/v1/**`. It does not send Basic Auth, `X-IAM-Client-Id`, `X-Application-Id`, or an internal Application UUID to Portal Open API endpoints.

```ts
import { PortalOpenApiClient } from '@axis-iam/vertex/server'

const portal = new PortalOpenApiClient({
  issuer: process.env.IAM_ISSUER!,             // iam-server, for /oauth2/token
  portalEndpoint: process.env.IAM_PORTAL_URL!, // iam-portal, for /open/v1/**
  clientId: process.env.IAM_M2M_CLIENT_ID!,
  clientSecret: process.env.IAM_M2M_CLIENT_SECRET!,
})

const roles = await portal.requestJson<Array<{ id: string; key: string }>>('GET', '/open/v1/roles')
await portal.requestJson('POST', '/open/v1/roles', { key: 'manager', name: 'Manager' })
```

No-scope `client_credentials` token requests fail with `invalid_scope` in Axis Vertex. `PortalOpenApiClient` therefore never requests a token without an explicit Portal Open API scope. Read and write machine tokens are cached separately with `expires_in` skew; a read token is never used for writes, and read calls do not silently request write scope. `invalid_scope` means the caller forgot `portal:openapi:read` / `portal:openapi:write` or the M2M client is not allowed to receive that scope. Portal guard failures are normalized as `OPEN_API_MACHINE_TOKEN_REQUIRED`, `OPEN_API_INVALID_AUDIENCE`, or `OPEN_API_SCOPE_INSUFFICIENT`.

Do not import `PortalOpenApiClient`, `IamClient`, or `@axis-iam/vertex/server` from browser/React code, and do not pass `clientSecret` to `@axis-iam/vertex-react`.

### Server Registration Grant Management

Registration Grant management is available only from `@axis-iam/vertex/server`. The M2M client must be explicitly allowed `registration_grants:read`, `registration_grants:write`, and `registration_grants:redemptions:read`; legacy `portal:openapi:*` scopes do not grant this capability.

```ts
const created = await portal.createRegistrationGrant({ type: 'EMAIL_LINK', allowedEmail: 'new.user@example.test' })
if (!created.registrationGrantToken) throw new Error('missing one-time proof')
// Deliver immediately. Never log, cache, or persist the proof.
await portal.revokeRegistrationGrant(created.grant.id)
```

`redirectUri` and `postLogoutRedirectUri` are OAuth ApplicationClient-level allowlisted URIs. `loginInitiationUri` and `postVerificationRedirectUri` are Application-level continuation settings and can be read with `useAuth().getAppContinuation()`. The SDK returns the configured `postLogoutRedirectUri` separately; it never guesses logout redirect from Application continuation fields.

On your OAuth callback route, prefer `handleRedirectCallback()` over manual query parsing. It reads `code`, `state`, `error`, and `error_description` from the current URL or a supplied URL, calls the existing `handleCallback(code, state)` on success, and scrubs callback parameters when running in the browser. `handleCallback(code, state)` remains available for existing integrations.

`logout({ redirect: true, postLogoutRedirectUri })` clears local tokens in all cases. It starts IAM RP-Initiated Logout only when discovery exposes `end_session_endpoint` and the SDK has an `id_token_hint`; otherwise it performs local logout and, when a client-level post-logout URI is configured or supplied, redirects there instead of sending the user to an invalid IAM logout page.

`<SignIn />` in redirect mode starts the standard OAuth flow. If App-level IdPs are enabled, the backend-owned IAM login page lists only runtime-supported providers. Do not use the legacy `/oauth2/authorization/{id}` App-level IdP route in customer apps.

`<SignIn mode="embedded" />` renders an identifier-first SDK UI and backend-discovered provider buttons. Users first enter an email or phone-like identifier. For email identifiers, the SDK shows only the runtime-available password, email code, and magic-link actions. For phone-like identifiers, it shows SMS only when `SMS_OTP.availableForLogin=true`. Redirect mode remains hosted IAM UI and is not affected by embedded behavior.

Password direct-auth posts the SPA public client id as `client_id` and reads OAuth-style snake_case token fields:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "identifier": "user@example.com",
  "password": "********",
  "client_id": "your-spa-public-client-id"
}
```

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "id_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "permissions": ["orders:read"]
}
```

Embedded `<SignIn mode="embedded" />` first resolves `GET {issuer}/api/v1/apps/{clientId}/auth-methods`. Password, Email OTP, Email Magic Link, SMS, and provider buttons are visible only when IAM reports the corresponding method/provider as available for login. `IamConfig.authMethods` is deprecated metadata and no longer creates visible methods.

SMS, Email OTP, and Magic Link direct-auth requests also post the SPA public client id as `client_id`. The browser SDK never asks for an IAM internal Application UUID:

```http
POST /api/v1/auth/sms/send
Content-Type: application/json

{
  "phone": "+8613800138000",
  "client_id": "your-spa-public-client-id"
}
```

If IAM returns `EMAIL_VERIFICATION_REQUIRED` during embedded password sign-in, the component shows an email-verification required state. When the typed identifier is an email address, it offers a resend action through `POST /api/v1/auth/email/verification/send` using `{ "email": "...", "client_id": "your-spa-public-client-id" }` and uses `auth-methods.resend.emailVerificationCooldownSeconds` for local cooldown. IAM hosted `/verify-email?token=...` handles the verification token; applications should configure Application-level `loginInitiationUri` / `postVerificationRedirectUri` back to their own login/start route and then call SDK login to start a fresh OAuth PKCE flow. The browser SDK does not send `X-Application-Id`.

```http
POST /api/v1/auth/sms/verify
Content-Type: application/json

{
  "phone": "+8613800138000",
  "code": "123456",
  "client_id": "your-spa-public-client-id"
}
```

```http
POST /api/v1/auth/passwordless/magic-link
Content-Type: application/json

{
  "email": "user@example.com",
  "client_id": "your-spa-public-client-id"
}
```

```http
POST /api/v1/auth/passwordless/email-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "client_id": "your-spa-public-client-id"
}
```

```http
POST /api/v1/auth/passwordless/email-otp/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456",
  "client_id": "your-spa-public-client-id"
}
```

Email OTP verification reuses the same direct-auth token normalization path as password and SMS. If the response includes `permissions`, the SDK keeps them with the active token state for `usePermission()`; it does not read permissions from JWT claims. By default that state is memory-only; `tokenStorage="sessionStorage"` persists both tokens and resolved permissions for the browser session.

For embedded provider buttons, the SDK uses `GET {issuer}/api/v1/apps/{clientId}/auth-methods` and renders only `idpProviders` where social login is enabled, the provider is enabled/configured/clickable, `availableForLogin=true`, and `authorizationUrl` is non-empty. It starts the selected provider with:

```http
POST {provider.authorizationUrl}
Content-Type: application/json

{
  "completionMode": "AUTHORIZATION_CODE",
  "redirectUri": "https://app.example.com/callback",
  "scope": "openid profile email offline_access",
  "state": "<sdk-generated-oauth-state>",
  "codeChallenge": "<sdk-generated-pkce-challenge>",
  "codeChallengeMethod": "S256"
}
```

The response contains the upstream provider `authorizationUrl`. The browser redirects there, and the final business app callback calls `handleRedirectCallback()` to exchange the Axis Vertex authorization code with PKCE and scrub the callback URL. The browser SDK does not construct Google/GitHub URLs and never takes provider secrets.

For custom login pages, use the headless hooks:

```tsx
function CustomProviderLogin() {
  const { providers, isLoading, error } = useIdentityProviders()
  const { startProviderLogin } = useProviderLogin()

  async function login(providerId: string) {
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) return
    const authorizationUrl = await startProviderLogin(provider)
    window.location.href = authorizationUrl
  }

  if (isLoading) return <p>Loading sign-in options...</p>
  if (error) return <p>Provider sign-in is unavailable.</p>

  return (
    <>
      {providers.map((provider) => (
        <button key={provider.id} onClick={() => void login(provider.id)}>
          Continue with {provider.displayName}
        </button>
      ))}
    </>
  )
}
```

`IamConfig.socialProviders` is deprecated for embedded provider buttons. Static entries are only legacy display-name overrides for matching backend-enabled providers; they cannot create clickable providers that IAM has not enabled for the current `ApplicationClient`.

JWTs carry identity and roles, but not final business permissions. `IamProvider` keeps permissions returned by embedded login responses and otherwise fetches `GET /api/v1/auth/me/permissions` with the IAM access token, so `usePermission()` and `<PermissionGate>` work from resolved permissions.

#### Connected accounts

Use account linking on an authenticated account settings page. This is separate from sign-in: it requires the current access token, uses the current-user account-linking endpoints, exchanges only an account-link ticket, and never calls `handleCallback(code, state)` or the OAuth token endpoint.

```tsx
import { ConnectedAccounts, useAccountLinkCallback } from '@axis-iam/vertex-react'

function AccountSecurity() {
  return (
    <ConnectedAccounts redirectUri="https://app.example.com/account-link/callback" />
  )
}

function AccountLinkCallbackRoute() {
  const { status, result } = useAccountLinkCallback({
    onSuccess: () => {
      window.location.assign('/settings/account')
    },
  })

  if (status === 'success') {
    return <p>{result?.method.displayName} is connected.</p>
  }
  if (status === 'error') {
    return <p role="alert">Account connection could not be completed.</p>
  }
  return <p>Completing account connection...</p>
}
```

`<ConnectedAccounts />` lists `GET /api/v1/auth/me/login-methods` and `GET /api/v1/auth/me/linkable-identity-providers` with the current bearer token. It starts only enabled, unlinked `OIDC` and `OAUTH2` providers that support account linking, stores a separate `iam_account_link_state` pending state, verifies the effective state returned by IAM, then redirects to the backend-provided provider URL.

The callback route handles `/account-link/callback?link_ticket=...&state=...`, validates the pending state, scrubs the URL, and exchanges the ticket through `POST /api/v1/auth/me/identity-providers/link-ticket/exchange`. The SDK does not store or display the ticket. Unlink uses the stable `methodId` with URL encoding.

If IAM returns `STEP_UP_REQUIRED`, hooks expose a typed `IamApiError` with safe fields such as `status`, `code`, `details.trigger`, and `details.methods`. The prebuilt component shows safe copy only. Customer apps can use `isStepUpRequiredError(error)` to trigger their own step-up UI.

Real Google/GitHub account-link browser validation requires IAM running, provider credentials, stable IAM provider callbacks, the SDK callback URI allowed for the SPA client, a logged-in test account, and an operator completing upstream provider login. Without those inputs, local SDK tests validate the contract with mocked IAM responses only.

Troubleshooting:

- Redirect URI mismatch: the absolute `redirectUri` passed to `IamProvider` must match one URI configured on the SPA ApplicationClient.
- CORS failure: add the browser origin to the SPA ApplicationClient `allowedOrigins`; `Application.frontendOrigins` suggestions do not grant CORS.
- Invalid issuer/JWKS: `issuerUri` must be the Axis Vertex issuer root, and discovery should advertise `jwks_uri` ending in `/oauth2/jwks`.

#### End-user signup

`<SignUp mode="embedded" />` creates users for your customer application:

```tsx
function Register() {
  return (
    <SignUp
      mode="embedded"
      onSuccess={(user) => {
        // Navigate to your sign-in page or show a success state.
      }}
    />
  )
}
```

Embedded signup calls:

```http
POST /api/v1/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "********",
  "client_id": "your-spa-public-client-id"
}
```

The signup response is user info, not OAuth tokens. Embedded `<SignUp mode="embedded" />` resolves `GET /api/v1/apps/{clientId}/auth-methods` before signup. It renders the form only when `signupEnabled=true`, `selfRegistrationEnabled=true`, and the password method is available for signup. It uses `emailVerificationMode` from the same response to choose the next step:

- `OFF`: account created; the user can sign in.
- `OPTIONAL`: account created; the user can sign in and may verify email from the message IAM sends.
- `REQUIRED`: the user must verify email before signing in.

If signup returns `status: "PENDING"`, the SDK treats email verification as required. The SDK does not infer `OFF` or `OPTIONAL` from `emailVerified=false`.

Embedded signup and sign-in verification resend both call:

```http
POST /api/v1/auth/email/verification/send
Content-Type: application/json

{
  "email": "user@example.com",
  "client_id": "your-spa-public-client-id"
}
```

The local resend button cooldown comes from `auth-methods.resend.emailVerificationCooldownSeconds`; backend rate limiting remains authoritative.

The component does not store tokens or assume automatic login after signup.

#### Registration grants

Applications with `signupMode: "INVITE_REQUIRED"` render an access-code entry field and do not send
a no-proof signup request. For email-link or Organization invitation routes, keep the proof in a
short-lived application variable and pass it to the embedded component. `OPEN` applications may
also pass a proof so IAM can apply its normal registration post-action semantics.

```tsx
import { SignUp, useRegistrationGrantPreview, type RegistrationGrantInput } from '@axis-iam/vertex-react'

function RegistrationRoute({ registrationGrant }: { registrationGrant?: RegistrationGrantInput }) {
  const previewRegistrationGrant = useRegistrationGrantPreview()

  async function preview() {
    if (registrationGrant) await previewRegistrationGrant(registrationGrant)
  }

  return <SignUp mode="embedded" registrationGrant={registrationGrant} />
}
```

`RegistrationGrantInput` is a discriminated union, so an email-link token, access code, and
Organization invitation proof cannot be supplied together. The preview helper calls the public
unauthenticated preview endpoint and never attaches a bearer token. Keep proof values in memory;
do not write them to browser storage, cookies, URLs, logs, analytics, or rendered content.

For OIDC/OAuth2 provider continuation, `useProviderLogin().startProviderLogin(provider, {
registrationGrant })` supports only `EMAIL_LINK` and `ACCESS_CODE`. The SDK sends that proof to
IAM's provider-authorize POST for server-side session binding, never in the upstream redirect URL.
`ORG_INVITATION` is intentionally rejected for provider continuation and remains supported by
embedded signup only.

IAM Developer Portal registration is a separate IAM-owned onboarding flow. SDKs must not call `POST /portal/v1/auth/register`; developers register through the IAM Developer Portal web app, not through customer application SDK signup.

#### Password reset

Password reset is a generic customer application user flow. It is separate from IAM Developer Portal developer registration.

```tsx
function ForgotPasswordPage() {
  return <ForgotPassword redirectUri="https://app.example.com/reset-password" />
}

function ResetPasswordPage({ token }: { token: string }) {
  return (
    <ResetPassword
      token={token}
      onSuccess={() => {
        // Navigate to your sign-in page.
      }}
    />
  )
}

function CustomResetButton() {
  const { requestPasswordReset, resetPassword, isLoading, error } = usePasswordReset()

  // requestPasswordReset({ email, redirectUri })
  // resetPassword({ token, newPassword })
  return null
}
```

The SDK calls:

```http
POST /api/v1/auth/password/forgot
{
  "email": "user@example.com",
  "client_id": "your-spa-public-client-id",
  "redirect_uri": "https://app.example.com/reset-password"
}
```

```http
POST /api/v1/auth/password/reset
{
  "token": "opaque-reset-token",
  "newPassword": "NewSecret123!"
}
```

Reset success does not auto-login. Show a success state and send the user through the normal sign-in flow.

`<SignIn />` can link to an app-owned reset page without depending on a router:

```tsx
<SignIn forgotPasswordUrl="/forgot-password" />
<SignIn mode="embedded" onForgotPassword={() => openForgotPassword()} />
```

See the runnable paired quickstart runbook: [`examples/react-demo/`](./examples/react-demo/)

## Profile Metadata And Authorization Attributes

Signup/profile responses may include `metadata`. In the React SDK this is profile metadata for display or registration-related profile extensions. It is not App User authorization attributes.

App User authorization attributes are app-scoped management-plane fields shown or edited in Portal/Admin App User detail and may be used by IAM policy, ABAC, or token-claim generation. This SDK does not add a Portal/Admin App User management API in this scope. Runtime authorization checks use JWT identity plus resolved permissions from login responses or `GET /api/v1/auth/me/permissions`; they never use signup/profile metadata.

## Permission Model

All packages use the `resource:action` permission format with wildcard support:

```ts
import { permKey, hasPermission, matchPermission } from '@axis-iam/vertex'

// Type-safe permission keys
const POSTS_READ = permKey('posts', 'read')   // { resource: 'posts', action: 'read' }

// Wildcard matching
matchPermission('posts:read', 'posts:read')   // true
matchPermission('posts:read', 'posts:*')      // true
matchPermission('posts:read', '*:*')           // true
matchPermission('posts:read', 'users:read')   // false

// Check against user's permission list
hasPermission('posts:read', ['posts:*', 'users:read'])  // true
```

## Development

## Server Authorization Management

Authorization management is available only from `@axis-iam/vertex/server`. Configure the confidential client from environment variables and grant only the exact families it needs:

```ts
import { PortalOpenApiClient } from '@axis-iam/vertex/server'
const iam = new PortalOpenApiClient({ issuer: process.env.IAM_ISSUER!, portalEndpoint: process.env.IAM_PORTAL_ENDPOINT!, clientId: process.env.IAM_CLIENT_ID!, clientSecret: process.env.IAM_CLIENT_SECRET! })
const role = await iam.createRole({ key: 'support', name: 'Support' }, { idempotencyKey: crypto.randomUUID() })
await iam.updateRole(role.id, { description: 'Support agents' }, role.etag)
```

Use the exact `roles:read/write`, `permissions:read/write`, `role_permissions:read/write`, and `user_roles:read/write` scope families. These APIs are intentionally absent from root and React/browser exports.

```bash
pnpm install         # Install all dependencies
pnpm build           # Build all packages
pnpm test            # Run all tests
pnpm clean           # Remove dist/ from all packages
```

## License

Apache License 2.0
