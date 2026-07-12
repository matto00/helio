## Why

GitHub reports 6 open Dependabot alerts (echarts XSS, `@babel/core` arbitrary-file-read, three
`js-yaml` DoS variants) and 2 open CodeQL alerts (an unescaped regex in a quality-gate script, and
session tokens stored in clear-text `sessionStorage`) on `main`. Per an explicit decision on the
CodeQL clear-text-storage finding, the token-storage alert gets the real fix — an httpOnly-cookie
session — rather than a documented-risk acceptance, since the SPA's current design exposes the
session token to any script running on the page (XSS blast-radius amplifier).

## What Changes

- Bump `echarts` to `^6.1.0` (direct dep, `frontend/package.json`).
- Add scoped `overrides` (nested under the specific transitive parent, not blanket) in both
  `package.json` files to resolve `@babel/core` to `>=7.29.6` and `js-yaml` to `>=3.15.0` / `>=4.2.0`
  depending on which major line pulls it in. Include a scoped `brace-expansion` override only if it
  resolves cleanly with no side effects (npm-audit-only finding, not an open GitHub alert).
- Fix `scripts/check-scala-quality.mjs`'s regex-escape helper to escape all regex metacharacters, not
  just `.`.
- **BREAKING (internal contract):** migrate session auth from a bearer token returned in the JSON
  response body + `sessionStorage` to an `HttpOnly` session cookie set by the backend on
  login/register/OAuth-callback and cleared on logout. `AuthResponse` no longer carries `token` in
  the body. The frontend stops persisting/reading a session token entirely; `httpClient` sends
  `withCredentials: true`. A custom-header CSRF defense is added for mutating requests, since
  cookie-based auth is no longer inherently limited to same-origin requests once `SameSite` allows
  cross-site (required by this app's frontend/backend split-domain deployment — see design.md).
  Personal Access Token (`helio_pat_...`) bearer-header auth is unaffected — untouched code path.

## Capabilities

### New Capabilities

- `csrf-protection`: custom-header requirement on state-changing `/api` requests, the primary CSRF
  defense once the session cookie is sent cross-site.

### Modified Capabilities

- `request-authentication`: session identity now resolves from an `HttpOnly` cookie, not an
  `Authorization: Bearer` header (PAT bearer auth is a separate, unchanged path).
- `frontend-auth-state`: `authSlice` state drops `token`; no `sessionStorage` persistence.
- `email-password-auth`: login/register responses no longer include `token` in the body; a
  `Set-Cookie` header is set instead.
- `google-oauth-login`: OAuth-callback response no longer includes `token` in the body; same
  `Set-Cookie` mechanism.

## Impact

`backend/src/main/scala/com/helio/api/{AuthDirectives,routes/AuthRoutes,routes/OAuthRoutes,protocols/AuthProtocol,ApiRoutes}.scala`,
`backend/src/main/scala/com/helio/services/AuthService.scala`,
`frontend/src/{services/httpClient.ts,features/auth/**,features/pipelines/hooks/usePipelineRunEvents.ts}`
(this last file independently reads the removed `sessionStorage` token for its own authenticated SSE
fetch — see design.md D7), both `package.json`/`package-lock.json` pairs,
`scripts/check-scala-quality.mjs`. No database migration needed (session table/hashing unchanged, per
HEL-288).
