## Context

Today: `AuthService` mints a 64-char hex session token (30-day TTL, hashed at rest per HEL-288,
`V45` wiped all live sessions) and returns it in `AuthResponse.token`. `authSlice.ts` persists it to
`sessionStorage` (CodeQL #8) and calls `setAuthToken()` to set a default `Authorization: Bearer`
header on the shared `httpClient` axios instance. `AuthDirectives.resolveBearer` reads that header
for every request, checking session tokens first, then falling back to Personal Access Tokens
(`helio_pat_...`, HEL-148, used by `helio-mcp` and other non-browser API clients) — both are hashed
and compared the same way, so this fix must not disturb PAT resolution.

**Deployment topology (load-bearing for the cookie-attribute decision):** frontend is Firebase
Hosting (`helioapp.dev`); backend is Cloud Run (`helio-backend-...run.app`). `frontend/firebase.json`
has no `/api/**` rewrite to the backend — there is no reverse proxy in production. `VITE_API_BASE_URL`
points directly at the Cloud Run origin. Every API call in production is genuinely **cross-site**
(different registrable domains), not just cross-origin. Only in dev does Vite's proxy (`vite.config.ts`,
`/api` → `localhost:$BACKEND_PORT`) make requests same-origin. The OAuth callback exchange
(`OAuthCallbackPage.tsx` → `oauthCallbackRequest`) is an XHR call from the already-loaded frontend
page, not a literal top-level navigation hitting the backend — Google's redirect (`GOOGLE_REDIRECT_URI`)
targets the frontend's `/auth/callback`, not the backend.

## Goals / Non-Goals

**Goals:** remove the session token from JS-readable storage entirely (real fix, not scanner-quieting);
keep PAT/API-token auth (helio-mcp) working unchanged; keep the fix deployable as a single coordinated
release; close the 6 Dependabot alerts + CodeQL #7 in the same change.

**Non-Goals:** refresh-token rotation, "remember me" duration changes, multi-cookie/JWT redesign,
changes to PAT issuance/lifecycle, CSRF-protecting `GET` requests (idempotent, not in scope).

## Decisions

**D1 — Cookie attributes, `SameSite` deviates from the initially-suggested `Lax`.** Given the
cross-site prod topology above, `SameSite=Lax` would prevent the cookie from ever being set or sent
on the cross-site XHR calls this app makes in production (`Lax`'s top-level-navigation GET exception
does not apply to `fetch`/`XHR`) — login would appear to succeed but the cookie would silently never
attach, breaking every subsequent request. **Decision: `SameSite=None; Secure=true` in prod,
`SameSite=Lax; Secure=false` in dev** (dev is same-origin via the Vite proxy, so `Lax` is fine and
`Secure` would simply fail to ever be set over `http://localhost`). Both chosen via an env var
(`COOKIE_SECURE`, default `false`; `SameSite` derived from it: `None` iff `Secure`, else `Lax`) rather
than hardcoded — same lever the ticket asked for `Secure`, extended to `SameSite` since they're
coupled by the same evidence. `HttpOnly=true` always. `Path=/`. `Max-Age=2592000` (30 days, matching
`AuthService.SessionTtlSeconds`). Cookie name: `helio_session`.

**D2 — Hard cutover for session auth; PAT path untouched.** `AuthDirectives` gains a
`resolveSessionCookie` path reading `helio_session` from the `Cookie` header (via `optionalCookie`),
hashing and looking up exactly as `resolveBearer` does today. The `Authorization: Bearer` path is
**kept only for PAT tokens** (`helio_pat_` prefix) — raw session tokens are no longer accepted via
header at all. Safe because HEL-288's `V45` migration deleted every live session; the only issuer of
session tokens is this same deploy's frontend, which switches to cookies atomically. No dual-mode
read-fallback window is needed.

**D3 — `AuthResponse` drops `token`.** Body becomes `{ expiresAt, user }`; the token is delivered
`Set-Cookie` only. Applies to `POST /api/auth/login`, `POST /api/auth/register`,
`GET /api/auth/google/callback`. `logout` no longer needs a body/header token — it becomes an
authenticated route (resolved via `authenticate`, cookie-derived) that deletes the resolved session
and responds with the expiring `Set-Cookie`.

**D4 — CSRF: required custom header, not a token.** Since `SameSite=None` in prod removes the
browser's default CSRF mitigation, add a directive requiring header `X-Helio-Requested-With: 1` on
all non-`GET` `/api/*` requests authenticated via the session cookie (PAT-authenticated requests are
exempt — PATs are attached deliberately by non-browser clients, not ambient credentials, so they
aren't subject to cross-site forgery the same way). Cross-site scripts cannot attach a custom header
without triggering a CORS preflight, which the existing `corsAllowedOrigins` allowlist already
rejects for unknown origins. `httpClient.ts` sets this header as a default on all requests (simplest;
harmless on `GET`).

**D5 — CORS.** `pekko-http-cors`'s `CorsSettings.defaultSettings` already defaults
`allowCredentials=true` and the app already uses `withAllowedOrigins` (never `*`) — no change needed
beyond verifying `corsAllowedOrigins` covers the prod frontend origin in the Cloud Run env config
(deploy-config verification, not a code change).

**D7 — `usePipelineRunEvents` SSE hook also reads the removed token; switch it to cookie auth.**
`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` independently reads
`sessionStorage.getItem("helio_auth_token")` and manually sets `Authorization: Bearer <token>` on its
own `fetch()` call to `GET /api/pipelines/:id/run-events` (native `EventSource` can't carry custom
headers, hence the manual `fetch` + `ReadableStream` approach) — a real, tested, authenticated
consumer that design/tasks must not skip since this migration removes the exact mechanism it depends
on. **Decision: pass `credentials: "include"` on this `fetch()` call and delete the
`sessionStorage`/manual-header code**, matching the `withCredentials: true` decision made everywhere
else; update `usePipelineRunEvents.test.ts` accordingly (assert `credentials: "include"` instead of
the `Authorization` header). **Known pre-existing, out-of-scope issue, noted not fixed:** this hook
calls a bare relative URL (`/api/pipelines/...`), not `API_BASE_URL` — per D1's cross-site-prod
finding (no reverse proxy, no `/api/**` rewrite in `firebase.json`), that call almost certainly
already fails in production today, independent of this ticket. Switching the auth mechanism doesn't
make that any more or less broken; fixing the URL is a separate bug, worth a follow-up ticket, not
folded into this security-remediation change.

**D6 — Dependency overrides, scoped not blanket.** Root `package.json` gains an `overrides` block
(none exists today); `frontend/package.json` extends its existing one. Each `js-yaml` override is
nested under its actual parent (`@eslint/eslintrc` → `^4.2.0`; `@istanbuljs/load-nyc-config` →
`^3.15.0`) rather than a blanket top-level pin, so only the vulnerable chains move. `@babel/core` is a
blanket `^7.29.6` override (patch bump, same major, all consumers already on `7.29.0`). `echarts` is a
direct `package.json` bump, no override needed. `brace-expansion`: attempt scoped overrides per
parent (`eslint-plugin-react`, `jest`'s `glob`, `typescript-eslint`) at their first-patched floors;
if `npm install` can't resolve cleanly, drop it and note in the PR (not an open GitHub alert, so this
is a bonus fix, not a requirement).

## Risks / Trade-offs

- [Coordinated deploy required — backend cookie-setting and frontend cookie-consuming ship together]
  → Both are in the same PR/release; `docs/deployment.md`'s pipeline deploys backend + frontend
  together. Rollback is reverting the merge commit (session table/hashing untouched, no migration to
  reverse).
- [`SameSite=None` widens the cookie's cross-site attachment surface vs. the ticket's suggested `Lax`]
  → Mitigated by D4's CSRF header, which is the actual defense for the mutating-request threat model;
  `Secure=true` + `HttpOnly=true` remain in force regardless.
- [Custom-header CSRF check is new server-side logic] → Kept minimal (presence check, not a
  cryptographic token) and scoped to non-GET `/api/*`; unit + Playwright coverage in tasks.md.

## Migration Plan

No DB migration. Deploy backend + frontend together. Verify via Playwright: login/register/OAuth set
the cookie and omit `token` from the body; an authenticated GET succeeds via cookie alone; logout
clears the cookie; `sessionStorage` never contains the token; a mutating request missing the CSRF
header is rejected; PAT bearer auth (existing `helio-mcp` fixture/test) still works unchanged.

**Deploy-wiring gap (found in cycle-1 evaluation, closed in cycle 2):** `COOKIE_SECURE=true` must
actually be set on the live Cloud Run service, not just read as a default-`false` env var by
`CookieConfig.fromEnv()`. Neither `infra/deploy-backend.sh` nor `.github/workflows/cd-backend.yml`
set it as of the original cycle-1 diff — `cd-backend.yml` sets no env vars at all and relies on
whatever was last configured on the service, so shipping D1's cookie logic without also touching the
deploy path would silently deploy with `Secure=false`/`SameSite=Lax`, which this same design doc (D1)
already proved cannot survive this app's cross-site prod topology (Firebase Hosting frontend / Cloud
Run backend, no reverse proxy). Fixed by: `infra/deploy-backend.sh` now hardcodes
`COOKIE_SECURE=true` in its `--set-env-vars` list (not operator-configurable, unlike
`CORS_ALLOWED_ORIGINS`); `infra/.env.deploy.example` and `CLAUDE.md`'s "Production environment
variables" table document why; `docs/deployment.md` documents the required one-time
`gcloud run services update --update-env-vars=COOKIE_SECURE=true` backfill for the live service, in
case the first HEL-287 deploy reaches prod via `cd-backend.yml` alone before an
`infra/deploy-backend.sh` run has set it. See `tasks.md` section 9.

## Planner Notes

Self-approved: cookie name (`helio_session`), CSRF header name/mechanism (custom-header presence
check over a signed-token scheme — sufficient given `SameSite`/`HttpOnly`/`Secure` are all already in
force and the threat model is classic cross-site form/script CSRF, not header-forgeable same-site
XHR), and the `SameSite=None` deviation from the ticket's suggested `Lax` (backed by the deployment-
topology evidence above — `Lax` would not function at all in prod, not a preference call).
