# React Demo

Browser half of the Phase 1 paired quickstart. This app uses `@axis-iam/vertex-react` with a `SPA` public `ApplicationClient.clientId`, Authorization Code + PKCE, and no browser secret.

Pair it with `../../../sdk-java/examples/spring-boot-demo` for the protected Spring Boot API half.

## Portal/Admin Setup

Create one business Application for the demo, then create two ApplicationClients under it:

| Runtime | Client type | Used by | Secret |
| --- | --- | --- | --- |
| React SPA | `SPA` public | `VITE_IAM_CLIENT_ID` | No |
| Spring Boot API | `WEB` or `M2M` confidential | `IAM_CLIENT_ID` / `IAM_CLIENT_SECRET` on the server | Yes |

For the SPA public client:

- Set redirect URI to `http://localhost:5173/callback`, or update `VITE_IAM_REDIRECT_URI` to the exact value you configured.
- Set post-logout redirect URI to `http://localhost:5173/`, or update `VITE_IAM_POST_LOGOUT_REDIRECT_URI` to the exact value you configured.
- Set allowed origin to `http://localhost:5173`, matching the Vite dev origin. `Application.frontendOrigins` suggestions do not grant CORS by themselves.
- Use the SPA public `ApplicationClient.clientId` as `VITE_IAM_CLIENT_ID`.
- Do not put a `clientSecret` in browser code, `.env.local`, or frontend docs.

For the Application:

- Configure `loginInitiationUri` and `postVerificationRedirectUri` to an app login/start route such as `http://localhost:5173/`.
- IAM hosted `/verify-email?token=...` consumes verification tokens. The app route should call SDK login to start a fresh OAuth PKCE flow; it should not parse verification tokens.

App-level IdP choice is owned by `iam-server`. If the Application has enabled IdPs, the Axis Vertex login page/runtime lists and starts the supported providers; this demo does not link to legacy provider routes directly.

Embedded signup/sign-in flows use the same SPA public `clientId`. Embedded sign-in is identifier-first: email identifiers can show password, Email OTP, and Magic Link actions; phone-like identifiers can show SMS. Visible sign-in methods, provider buttons, signup availability, email-verification mode, and verification resend cooldown are driven by `GET /api/v1/apps/{clientId}/auth-methods`; verification resend and passwordless requests post public `client_id` and never use an IAM internal Application UUID.

The `/callback` route uses `useAuth().handleRedirectCallback()` as the primary path. It does not manually parse OAuth `code`, `state`, or `error` query parameters, and the SDK scrubs callback parameters after completion. Logout uses `useAuth().logout({ redirect: true })`; the SDK starts IAM RP-Initiated Logout only when a valid `id_token_hint` and discovery `end_session_endpoint` are available, otherwise it clears local tokens and returns to the configured client-level post-logout URI.

Browser permissions come from the login response or `GET /api/v1/auth/me/permissions` with the IAM access token. They are what power `usePermission()` and `<PermissionGate>`.

After login, the demo also exposes a small API smoke panel:

- `VITE_API_BASE_URL/public` without a token.
- `VITE_API_BASE_URL/posts` with the current access token from the public `useAuth().getAccessToken()` API.

The panel never renders the token.

## Run

From `sdk-js/`:

```powershell
pnpm install
cd examples\react-demo
Copy-Item .env.example .env.local
notepad .env.local
pnpm dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://localhost:5173`. The first sign-in should redirect to the Axis Vertex login page at `VITE_IAM_ISSUER_URI`, then return to `VITE_IAM_REDIRECT_URI`.

## Verify The Backend Half

Start the Spring Boot demo on `VITE_API_BASE_URL`, then sign in through the React demo and use the API Smoke panel. The expected local result is:

- `GET /public` returns 200.
- `GET /posts` returns 200 when the signed-in user has `posts:read`.

You can also use a valid IAM access token to exercise the paired backend with the Spring Boot demo smoke script:

```powershell
$env:TOKEN = "<paste a local IAM access token with posts:read>"
cd ..\..\..\sdk-java\examples\spring-boot-demo
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\phase1-paired-example-smoke.ps1
```

Do not commit real tokens or secrets.

## Local Checks

```powershell
pnpm typecheck
pnpm build
```
