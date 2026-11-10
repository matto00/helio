## Context

- `helio-mcp/src/index.ts` builds one `HelioApi(new HelioHttpClient(loadConfig()))` from `HELIO_PAT` and connects
  `createServer(api)` to stdio with a 64 MiB buffer. `createServer` scopes each tool call's 429 budget
  (`runWithRateLimitScope`, an `AsyncLocalStorage`, HEL-1381). SDK 1.32.1 ships stateless `streamableHttp`,
  `mcpAuthRouter`, `requireBearerAuth` and `OAuthServerProvider`; `express` and `cors` are SDK dependencies.
- PATs: `POST /api/tokens {name, expiresInDays}` returns the raw token once; `GET /api/tokens` is PAT-callable;
  names cap at 100 chars (`RequestValidation.scala:117`). Frontend: `apiTokenService.ts`, `ProtectedRoute`
  (`state.from`), `PublicOnlyRoute`, `LoginPage`, `MfaVerifyPage`, `OAuthCallbackPage` (`consumeReturnTo`).
- Owner rulings (Planning escalation, 2026-11-09) are Standing Constraints C1-C5 in tasks.md.

## Goals / Non-Goals

**Goals:** claude.ai-compatible remote MCP, per-user OAuth, no store, stdio untouched. **Non-Goals:** see proposal.

## Decisions

**D1. Stateless Streamable HTTP.** `POST /mcp` builds `HelioHttpClient({baseUrl, pat})` from the verified token,
`createServer(api)`, `StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})`,
`handleRequest(req, res, req.body)`, closing both on `res` close. GET/DELETE answer `405` (`Allow: POST`): the MCP
spec permits it for a server with no server-initiated stream, and sessions would need sticky routing or a store.

**D2. Sealing.** `oauth/seal.ts`: AES-256-GCM, random 12-byte IV, `v1.<iv>.<ct+tag>` base64url, JSON payload with
`kind`; subkeys `HKDF-SHA256(HELIO_MCP_TOKEN_KEY, info="helio-mcp/<kind>")` for `client`, `pending`, `code`,
`access`. `open()` checks `kind`, and checks `exp` when the kind has one: `pending` 10 min, `code` 60 s, `access`
90 d; **`client` seals carry no `exp`** (connectors must not silently become `invalid_client`; a key rotation that
drops `_PREVIOUS` invalidates them, documented). `HELIO_MCP_TOKEN_KEY_PREVIOUS` is tried on open only. All `exp` and
`expiresAt` values are Unix **seconds** (the SDK's `bearerAuth` compares seconds; ms would never expire).

**D3. Provider** (`oauth/provider.ts`):
- `registerClient(info)`: rejects any redirect URI that is not `https:` or loopback `http:` (MCP MUST; the SDK admits
  plain http). If `HELIO_MCP_ALLOWED_REDIRECT_HOSTS` is set, non-loopback hosts must be in it. Deletes
  `client_secret` and `client_secret_expires_at` (the SDK's `register.js` adds them whenever the method is not
  `none`, including when omitted) and sets `token_endpoint_auth_method: "none"`. Seals a minimal projection
  (`redirect_uris`, `client_name` stripped and cut to 40 chars, grant/response types, method), refusing a projection
  over 2 KiB. `getClient(id)` unseals or returns `undefined` (`invalid_client`).
- `authorize`: `resource`, when supplied, must equal `<HELIO_MCP_PUBLIC_URL>/mcp` after the SDK's normalisation
  (fragment dropped, one trailing slash ignored), else `invalid_target`. An **omitted `resource` binds to that canonical
  URL**, so `AuthInfo.resource` is always set (the SDK client omits it when PRM is unavailable, and `bearerAuth`'s
  `expectedResource` refuses an undefined one forever). Then 302 to `<HELIO_APP_URL>/connect/mcp?request=<seal pending
  {clientIdHash, clientName, redirectUri, codeChallenge, state}>`. `authorize` re-applies the redirect-host allow-list
  (a client sealed under a wider list is refused once narrowed) and caps `state` at 1 KiB (`invalid_request`). Pending,
  code and access seals carry `clientIdHash` (SHA-256 of the client id), so a maximal client cannot bloat a URL.
- `challengeForAuthorizationCode` opens the code; `exchangeAuthorizationCode` checks `clientIdHash`, and `redirectUri`
  only when supplied (OAuth 2.1), returns `{access_token: seal access {pat, clientIdHash}, token_type: "bearer",
  expires_in}`. The access token has a fixed 90 d maximum lifetime; it does not track the PAT's own expiry (the
  callback cannot learn it); earlier expiry or revocation is caught by D5. No refresh (`InvalidGrantError`).
  `verifyAccessToken` returns `AuthInfo{token, clientId: clientIdHash, scopes: [], expiresAt (s), resource (always the
  configured canonical URL; there is one resource), extra: {pat}}`;
  `requireBearerAuth` gets `expectedResource`.
- A per-instance used-code set rejects same-instance replays; cross-instance replay within 60 s is bounded by PKCE
  and the client/redirect binding.
- SDK per-IP limits set explicitly (`/register` 60/h, `/token` 300/15 min; claude.ai shares egress IPs), plus
  `express-rate-limit` (an SDK dependency, declared directly) on `/oauth/pending` and `/oauth/callback` (60/min/IP).

**D4. Consent hand-off.** `GET /oauth/pending?request=` (CORS via `cors`, origin `HELIO_APP_URL` only, no
credentials) returns `{clientName, redirectHost, expiresAt}` or `400`. `POST /oauth/callback` (urlencoded, 16 KiB)
takes `request` plus `pat` or `deny=1`; deny → redirect with `error=access_denied` and `state`. With a PAT: backend
`GET /api/tokens` with it (a scoped PAT gets non-200 and is refused); success → `302 redirectUri?code=<seal code
{pat, clientIdHash, redirectUri, codeChallenge}>&state=`. Error pages name the minted token ("revoke 'MCP connector: …'
in Settings"). `client_name` comes from unauthenticated DCR, so every dynamic value in helio-mcp's HTML is HTML-escaped,
and every HTML page sends `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and
`X-Frame-Options: DENY`. The PAT travels only in the form body, to the origin fixed by `VITE_MCP_ORIGIN` at build.
Residual (accepted, documented): someone may POST their own PAT against another user's pending request; the victim's
client then acts in the attacker's workspace, never the reverse.

**D4a. Consent-page anti-clickjacking.** One click mints an unscoped PAT for a redirect URI anyone can register.
(a) `frontend/firebase.json` `headers` for `/connect/**`: `frame-ancestors 'none'` and `X-Frame-Options: DENY`
(Firebase applies path headers before rewrites; executor records the evidence). (b) Framed
(`window.top !== window.self`) → error, no actions. (c) Double-click/new-window defence: Allow and Deny stay inert
until the document has been visible and focused for 500 ms continuously, reset on `blur`/`visibilitychange` to
hidden.

**D5. Bearer, liveness, revoked PATs.** Fixed order on `/mcp`: `requireBearerAuth` (resource metadata URL from
`getOAuthProtectedResourceMetadataUrl`) → PAT liveness → large-body slot → `express.json` → transport, so an anonymous
request is refused before any body is read (oversized unauthenticated → 401, not 413). Liveness: per-instance LRU
(10k) keyed by SHA-256 of the token, holding the last successful backend `GET /api/tokens`; older than
`HELIO_MCP_LIVENESS_TTL_SECONDS` (validated integer 1..3600, default 300) → re-check; backend 401 → `/mcp` answers 401
with `error="invalid_token"` and `resource_metadata`, so the client re-authorizes. A backend 429, 5xx, network error or
3 s timeout never yields that 401 (no forced re-consent): the request proceeds to the tool call. Revocation inside the window
surfaces as a tool error via an HTTP-only auth-error hint on `HelioHttpClient` ("reconnect the connector"); stdio's
`HelioAuthError` text stays byte-identical (C4).

**D6. Entry point, config, limits, logging.** `src/httpApp.ts` (factory, importable from Jest), `src/http.ts` (`main`
with the direct-invocation guard; `start:http`, `dev:http`) and `src/httpConfig.ts`
(`loadHttpConfig(env)`: required `HELIO_MCP_PUBLIC_URL` (an origin, no path), `HELIO_APP_URL`, `HELIO_API_BASE_URL`, `HELIO_MCP_TOKEN_KEY`
(32 bytes base64); optional `_PREVIOUS`, `PORT` (8080), `HELIO_MCP_LIVENESS_TTL_SECONDS`,
`HELIO_MCP_LARGE_BODY_SLOTS`, `HELIO_MCP_ALLOWED_REDIRECT_HOSTS`; errors name the variable, never the value).
`main` installs `installUnhandledRejectionGuard` as stdio does. `trust proxy 1`. Root `/.well-known/oauth-protected-resource` served alongside the SDK's `/mcp`-suffixed one.
**Body limit 32 MiB:** Cloud Run caps HTTP/1 requests at 32 MiB (executor confirms from Cloud Run's quotas page and
records it), so `/mcp` accepts up to 32 MiB and answers 413 above, matching prod. Stdio keeps 64 MiB; README states
that a CSV whose JSON-escaped body exceeds 32 MiB (only control-byte-heavy CSVs near the 15 MiB cap: 6x `\uXXXX`
escaping; quotes/newlines at most double) must use stdio. Alternative (h2c + `--use-http2`) rejected: plain express does not serve h2c and the SDK path
over it is unproven. A request over 8 MiB, chunked, or with any `Content-Encoding` other than `identity` (the 32 MiB limit applies to the
inflated body, so a small gzip can inflate past it) takes one of `HELIO_MCP_LARGE_BODY_SLOTS` before parsing, else an
immediate `429` with `Retry-After: 5`. Logging: one line per request (method, `req.path`, status). An explicit express
error handler logs only error name/status (never `err.stack`, which can quote a body snippet); `NODE_ENV=production`
in the image; `server.server.onerror` keeps index.ts's 500-char truncation.

**D7. Frontend.** `features/mcpConnect/ConnectMcpPage.tsx` at `/connect/mcp`, under `ProtectedRoute`, outside
`AppShell`, in the `/login` `auth-page`/`auth-card` layout; local state, no Redux slice. Return-to survives every
sign-in path: password, password+MFA (`from` carried to `/login/verify`; after `verifyMfa`, the navigation to `from`
must win over `PublicOnlyRoute`'s `/home` and `MfaVerifyPage`'s `/login` redirect), Google and Google+MFA
(`OAuthCallbackPage` reads both `state.from` and `consumeReturnTo()`); only same-origin relative paths honoured. Before
minting, the page re-checks the pending `expiresAt` (expired → error, nothing minted). It shows the signed-in account,
falls back to "An MCP client" when `client_name` is absent, and a second click during the mint is ignored. `fetchPendingInfo` does NOT use
the shared `httpClient` (`withCredentials` + custom CSRF header + 401 interceptor would fail CORS against the
no-credentials endpoint): a plain `fetch` with `credentials: "omit"` and no custom headers. Allow: `createApiToken` with
name `"MCP connector: <clientName> (<redirectHost>)"` stripped and cut to 100 chars, `expiresInDays: 90`, then an
off-screen `<form method="post">` to `${VITE_MCP_ORIGIN}/oauth/callback`. DESIGN.md, both themes. `VITE_MCP_ORIGIN`
is read via `config/env.ts` (mocked by `envMock.ts` in Jest), set in `cd-frontend.yml` (`https://mcp.helioapp.dev`) and documented in `docs/deployment.md`.

**D8. Deploy.** `helio-mcp/Dockerfile` (multi-stage `node:22-slim`, non-root, `NODE_ENV=production`,
`CMD ["node","dist/http.js"]`). `infra/deploy-mcp.sh`: `deploy-backend.sh`'s `--image=` guard, region and project;
`helio-mcp`, `--allow-unauthenticated --min-instances=0 --max-instances=2 --cpu=1 --timeout=300`, a dedicated
`--service-account=helio-mcp-sa@helio-493120.iam.gserviceaccount.com` (owner creates it), `HELIO_MCP_TOKEN_KEY` (and an
optional `_PREVIOUS` for rotation) from Secret Manager, the URL env vars, `HELIO_MCP_ALLOWED_REDIRECT_HOSTS` defaulting to `claude.ai,claude.com` (overridable);
never `--no-cpu-throttling`. `--max-instances=2` caps cost on a public endpoint and matches the backend's cap; per-IP
limits and the used-code set are per instance, so effective limits are double the configured ones (README). Sizing:
executor measures peak RSS idle and for one 32 MiB and one 8 MiB `create_csv_data_source` call, records them in
`measurements.md`, and sets `--memory`, `--concurrency`, `HELIO_MCP_LARGE_BODY_SLOTS` so `idle + slots x peak(32) +
(concurrency - slots) x peak(8) < 75 %` of memory. README: secret creation, `roles/secretmanager.secretAccessor`, domain mapping
+ DNS, connector steps, limits, rotation (drops client ids too), reconnect mints a new PAT, access log holds only
sealed query strings; post-deploy checks that `req.ip` is the real client and that small requests are not re-framed
as chunked (which would contend for slots). The owner runs every deploy step.

**D9. Proof.** Jest (existing config): seal (round-trip, tamper, wrong kind, expiry, `client` never expires, seconds,
rotation); provider (http redirect, allow-list, omitted method and `client_secret_post` → no secret and `/token`
without one, wrong resource and trailing-slash resource, wrong verifier, omitted redirect at token, code as access
token); app over an ephemeral port (401 variants incl. revoked PAT with TTL 1 s, oversized unauthenticated → 401, both
PRM docs, 405, 413 above 32 MiB, slot 429 incl. a small gzip inflating past 8 MiB, tools/list parity, two-user isolation, stdio auth text unchanged). Frontend
round-trip tests mount the real `AppRoutes` wrappers (`PublicOnlyRoute`/`ProtectedRoute`) and assert the final
location `/connect/mcp?request=…` per sign-in path; inert-Allow test (immediate click mints nothing, after 500 ms
mints once). `helio-mcp/e2e/oauthConnector.ts` (TTL set low): SDK client OAuth flow with consent-equivalent calls,
listTools, `create_content_panel` markdown read back via REST as that user, second-user isolation, revoke → tool
error inside the window then 401 after it. Playwright, starting signed out, drives the password+MFA path for a
throwaway user (MFA enrolled via API, TOTP computed in the test) through `/connect/mcp`; if infeasible, the reason
and replacement are recorded.

## Risks / Trade-offs

- [Key unseals every connector's PAT] Secret Manager only, never logged; rotation via `_PREVIOUS`.
- [claude.ai behaviour unverified in-lane] Owner verifies post-deploy; follow-up ticket (C3).

## Planner Notes

- Self-approved: 405 for GET; no refresh tokens; 90 d PAT and token lifetime; `GET /api/tokens` liveness with a
  5-min default TTL; 32 MiB HTTP body limit (platform cap); redirect-host allow-list default `claude.ai,claude.com` in
  the deploy script only (code default open; owner can override at deploy); consent page outside AppShell; no Redux.
- `express`, `cors`, `express-rate-limit` declared directly (installed via the SDK), plus dev `@types/express`, `@types/cors`.
- `Origin` is not validated on `/mcp`: the endpoint is public, bearer-only and uses no ambient credentials (no cookies), so a cross-site page holds no token to forge a request with. DNS-rebinding protection is likewise unnecessary for a bearer-gated public host.
- Implementation deviation: in HTTP mode `server.server.onerror` and the unhandled-rejection guard log the error NAME only (not the 500-char truncated message design D6 kept), because task 7.5 requires no body fragment in logs and SDK messages can quote a body.

