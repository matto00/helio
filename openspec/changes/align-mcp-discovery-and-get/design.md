## Context

HEL-1709 made helio-mcp an OAuth 2.1 authorization server with no store: client ids, pending requests,
codes and access tokens are AES-256-GCM seals (`helio-mcp/src/oauth/seal.ts`). The access token is the
user's 90-day Helio PAT, sealed, with a fixed 90-day `exp`. `exchangeRefreshToken` always throws
`invalid_grant`, yet the SDK's `mcpAuthRouter` (`@modelcontextprotocol/sdk` 1.32.2, `router.js:41`) hardcodes
`grant_types_supported: ["authorization_code","refresh_token"]`.

Owner rulings (HEL-1713 escalation, 2026-11-23, chat):
- Q1 `implement-refresh-tokens`: helio-mcp issues and honours refresh tokens.
- Q2 `keep-401-document-it`: an unauthenticated `GET /mcp` (and `DELETE`) stays `401` (bearer check before
  the method check); an authenticated one stays `405` + `Allow: POST`. Code and test already do this
  (`httpApp.test.ts:74`); only the README changes.

Spec text this design is held to (verbatim, fetched 2026-11-23):
- MCP 2025-11-25 Authorization, "Token Theft": "Authorization servers SHOULD issue short-lived access tokens to
  reduce the impact of leaked tokens." and "For public clients, authorization servers MUST rotate refresh tokens
  as described in OAuth 2.1 Section 4.3.1".
- MCP 2025-11-25 Authorization, "Token Handling": "Invalid or expired tokens MUST receive a HTTP 401 response."
- MCP 2025-11-25 Transports: "The server MUST either return Content-Type: text/event-stream in response to this
  HTTP GET, or else return HTTP 405 Method Not Allowed".
- RFC 8414 section 2, `grant_types_supported`: "If omitted, the default value is "["authorization_code",
  "implicit"]"." (so the field is always stated explicitly).
- Every helio-mcp client is public (`token_endpoint_auth_method: "none"`), so the MCP MUST applies to all of them.

Hard constraint from the infrastructure: helio-mcp runs on Cloud Run with `--min-instances=0
--max-instances=2` (`infra/deploy-mcp.sh`). In-memory state is lost on scale-to-zero and is not shared between
the two instances, so reuse detection cannot live in helio-mcp memory (the used-code set is per-instance and
that is acceptable only because codes live 60 s). Reuse detection needs durable shared state, which helio-mcp
does not have. The backend (Postgres) is the only shared store, reachable with the PAT.

## Goals / Non-Goals

**Goals:** issue rotating refresh tokens to public clients; detect reuse and revoke the whole family; bind each
refresh token to its client and resource; expire it; make PAT revocation kill its refresh tokens; standard
RFC 6749 section 5.2 errors; metadata and README that describe exactly what the server does.

**Non-Goals:** minting a new PAT on refresh (a refresh chain never outlives the PAT the user consented to);
confidential clients; scopes; changing the consent page or `POST /api/tokens`; any prod probe or deploy.

## Decisions

**D1. Metadata.** helio-mcp serves `GET /.well-known/oauth-authorization-server` itself, mounted before
`mcpAuthRouter`, with the SDK's `createOAuthMetadata(...)` output and `grant_types_supported` set to
`["authorization_code","refresh_token"]` explicitly (now true). The override exists so the field is ours, not an
SDK default that changed meaning under us: a test asserts the exact array, and a second test asserts the
metadata advertises no grant `exchangeRefreshToken`/`exchangeAuthorizationCode` would refuse. No
`revocation_endpoint` is added (the provider has no `revokeToken`; unchanged).

**D2. Refresh token format: sealed, never stored.** New seal kind `refresh` (its own HKDF subkey, so an access
token or code can never be presented as a refresh token). Payload: `{pat, clientIdHash, resource, familyId,
jti, exp}`, `jti` = 32 random bytes base64url. The backend never sees the token or the PAT-in-token; it stores
only `sha256(jti)` (D4). "At rest" therefore means: the token itself exists only at the client, sealed with
`HELIO_MCP_TOKEN_KEY`; the server side keeps a hash.

**D3. Issuance.** `exchangeAuthorizationCode` returns `{access_token, token_type, expires_in, refresh_token}`.
A refresh token is issued only when the client's sealed registration lists `refresh_token` in `grant_types`
(RFC 7591: an omitted `grant_types` means `["authorization_code"]`); such a client gets today's response with no
`refresh_token`. Issuance creates the family on the backend first (D4), then maps the outcome:

| `POST /api/mcp-refresh-families` outcome | code exchange answer |
| --- | --- |
| `201` | access token + refresh token |
| `401` (PAT revoked or expired since the callback) | `400 invalid_grant` "authorization was revoked; authorize again", no tokens |
| any other status (`400`, `403`, `404`, `429`, `5xx`), network error or timeout | access token, no refresh token, one log line (status only, no token material) |

On a timeout the family row may have been created anyway; it is harmless (no token ever carries its id) and dies
with the PAT. The access token TTL becomes 1 hour (O1).

**Sealed resource.** The `resource` sealed into a refresh token and stored on the family is always the canonical
`config.resourceUrl` in `comparableResource` form, whether or not the client sent `resource` on either grant (a
`resource` that was sent must equal it, else `invalid_target`, as today).

**D4. Family state on the backend (migration `V147__mcp_refresh_families.sql`, next free number re-checked on
main before commit).**

```sql
CREATE TABLE mcp_refresh_families (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_token_id    UUID NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  client_id_hash  TEXT NOT NULL,
  resource        TEXT NOT NULL,
  current_jti_hash TEXT NOT NULL,
  generation      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);
```

Owner-only RLS (V42 pattern, `FORCE`), index on `user_id` and `api_token_id`. `ON DELETE CASCADE` from
`api_tokens` is the revocation link: revoking the PAT (`DELETE /api/tokens/:id` deletes the row) deletes every
family it backs. `expires_at` = the PAT's `expires_at` (the backend knows it; the callback could not), per O2.

Two PAT-authenticated routes on the authenticated tree (unscoped PATs only: `confineScopedToken` already
refuses scoped tokens; a session caller is refused `403` because `tokenId` is absent), each confined to families
whose `api_token_id` is the authenticating token's id (`AuthenticatedUser.tokenId`), so a PAT can only ever
touch its own families:
- `POST /api/mcp-refresh-families` `{clientIdHash, resource, jtiHash}` -> `201 {familyId, expiresAt}`.
- `POST /api/mcp-refresh-families/:id/rotate` `{clientIdHash, resource, presentedJtiHash, nextJtiHash}` ->
  one transaction: `UPDATE ... SET current_jti_hash = next, generation = generation + 1, last_rotated_at = now()
  WHERE id = :id AND api_token_id = :tok AND current_jti_hash = presented AND client_id_hash = :c AND resource = :r
  AND expires_at > now() RETURNING ...` -> `200 {generation, expiresAt}`. On zero rows the
  row is read under `FOR UPDATE`: unknown or another token's -> `404`; expired -> `409 {reason: "expired"}`; client/resource mismatch -> `409 {reason: "mismatch"}` (no state change);
  a well-formed but non-current `presentedJtiHash` -> reuse: revoke the family and delete the PAT (O3) ->
  `409 {reason: "reused"}`.
Contracts in `schemas/mcp/` (request/response schemas), plus OpenAPI entries alongside the other routes.

**D5. Refresh grant (`exchangeRefreshToken(client, token, scopes, resource)`).** In order:
1. Open the `refresh` seal; malformed, tampered, wrong kind or past `exp` -> `invalid_grant`.
2. `clientIdHash` must equal `sha256(client.client_id)` -> else `invalid_grant` ("issued to another client").
3. `resource`, when given, must be this server's canonical resource (`checkResource`) -> else `invalid_target`;
   the sealed `resource` must also equal it -> else `invalid_grant`.
4. `scope` given -> ignored (no scopes are issued; same as today's code exchange).
5. Call rotate (D4) with the PAT as bearer. `200` -> seal a new access token and a new refresh token (same
   `familyId`, new `jti`, `exp` per O2) and return both. `401` from the backend (PAT revoked/expired) ->
   `invalid_grant` ("authorization was revoked; authorize again"). `404`/`409` -> `invalid_grant` with a
   reason-specific description that never echoes token material. Backend unavailable -> `ServerError` (HTTP 500,
   `server_error`). Two cases, stated honestly:
   - **Determinate (nothing rotated):** connection refused, DNS failure, or a `429`/`5xx` the backend's own
     handler produced before the rotate transaction (the family routes answer `503`/`429` from directives that run
     before the service). The presented token is still current and a retry works.
   - **Indeterminate:** a timeout, or a `5xx` from a layer that does not stop the handler (Cloud Run `504`, the
     Pekko request-timeout `503`). The transaction may have committed; under O4 a retry with the same token is then
     reuse and ends the connection (PAT deleted). This is the accepted cost of O4; no idempotency key or
     deterministic next token is added, because either would hand a replayed old token the new one (a grace window).
Error sources: `invalid_grant` is RFC 6749 section 5.2 / OAuth 2.1 section 3.2.4; `invalid_target` is RFC 8707
section 2; `server_error` (HTTP 500) is not a token-endpoint code in either and is what the SDK's handler emits for a
`ServerError`. Every refusal is `400 invalid_grant` except the resource case (`invalid_target`) and backend
unavailability (`500 server_error`); `invalid_client` (unknown `client_id`), `invalid_request` (missing `refresh_token`) and
`unsupported_grant_type` keep coming from the SDK's handler unchanged. The response carries `Cache-Control:
no-store` (SDK).

**D6. Revocation paths, all of which kill refresh:** PAT revoked in Settings -> family rows cascade-deleted and
every rotate call is `401` (both, independently). PAT expired -> rotate `401` and the family's `expires_at` has
passed. Reuse -> PAT deleted, families cascade-deleted (O3). Key rotation: a `refresh` seal opens under
`HELIO_MCP_TOKEN_KEY_PREVIOUS` exactly like the other kinds.

**D7. `/mcp` 401 ordering (Q2).** No code change. README states: unauthenticated `GET`/`DELETE /mcp` answer
`401` with `WWW-Authenticate` (the auth challenge comes first on every method, which is how a client discovers
the authorization server); authenticated `GET`/`DELETE` answer `405` with `Allow: POST`. The existing test is
kept and extended to assert the `WWW-Authenticate` header on the 401.

**D8. README.** Replace "No refresh tokens ... `GET /mcp` answers `405`" with the refresh behaviour (lifetimes,
rotation, reuse revokes the family, revoking the PAT in Settings ends the connection including its refresh
tokens, re-authorize after the PAT's 90 days) and the D7 sentence. The PR states helio-mcp and the backend both
need a deploy at release (backend first: helio-mcp's refresh depends on the new routes).

**D9. Proof (red first).** Jest in helio-mcp (`oauthFlow.test.ts` style, a fake backend for the two routes):
metadata exact array; code exchange issues a refresh token only for a client registered with `refresh_token`;
rotation returns a new pair and the old token is then refused; replaying an old token revokes the family
(the newest token is refused afterwards); wrong client, wrong resource, expired, tampered, access-token-as-refresh;
backend 401 -> `invalid_grant`; backend 5xx -> `500` and the same token still works after. ScalaTest for the
routes and repository on a real DB: CAS rotation, reuse revokes, cross-token `404`, scoped PAT refused, session
refused, cascade on PAT delete, expiry; plus an RLS check under the non-BYPASSRLS role (MISTAKES.md). A seam test
asserting helio-mcp's request bodies match `schemas/mcp/*`. Mutations: drop the CAS predicate, drop the
reuse-revoke, drop the client binding, drop the cascade.

## Owner rulings on lifetimes and revocation (escalation answered 2026-11-23, chat)

- **O1 = `1h`.** `ACCESS_TTL_SECONDS` becomes 3600 for every access token issued after deploy (code exchange and
  refresh alike). MCP: "SHOULD issue short-lived access tokens".
- **O2 = `30d-sliding-capped-at-pat`.** A refresh token's sealed `exp` = min(now + 30 days, family `expires_at`);
  every rotation issues a new one, so the 30 days slide. The family's `expires_at` = the PAT's `expires_at`
  (90 days from consent; a PAT with NULL `expires_at` cannot occur for a connector PAT, but if it did the family
  gets now + 90 days). The backend refuses rotation past `expires_at` (`409 expired`) regardless of the seal.
  The user re-consents every 90 days, as today.
- **O3 = `family-and-pat`.** On reuse the rotate transaction deletes the `api_tokens` row behind the family
  (the user's own row, so the owner-only RLS policy admits it on the app pool). The FK cascade deletes the
  reused family and every other family of that PAT, so the table needs no `revoked_at` column: a revoked family
  is a deleted one. The `409 reused` answer is computed before the delete. The delete goes
  through the same audit mechanism as `ApiTokenService.revoke`: it writes an `audit_events` row with action
  `token.revoke` and details `{reason: "mcp_refresh_reuse", familyId, generation}` (token id as the target, no
  token material), so the user's Settings deletion has a trace. Every access token sealing that PAT then fails the
  `/mcp` liveness gate within `HELIO_MCP_LIVENESS_TTL_SECONDS` (300 s default), and the next token presented
  from the family gets `401` from the backend -> `invalid_grant`.
- **O4 = `none`.** No grace window: a retry with the previous refresh token after a lost response is reuse.

**Tokens issued before deploy.** The `access` seal format and kind are unchanged, so a 90-day access token
issued before this deploy keeps working until its own sealed `exp` (or until its PAT is revoked/expires, via the
liveness gate as today). Those clients hold no refresh token; at expiry they get `401` and re-authorize, and from
then on receive a 1-hour access token plus a refresh token. Nothing is invalidated at deploy. Release order:
backend first (migration + routes), then helio-mcp; an MCP deployed first would fail family creation and issue
tokens without a refresh token (D3 fallback), so the wrong order degrades but does not break sign-in.

## Risks / Trade-offs

- New backend dependency on the token path: a backend outage fails refresh with `500`. Retryable only in the
  determinate case (D5); a timeout or proxy `5xx` is indeterminate and a retry may count as reuse.
- O4 none: a client on a flaky network can lose its connection to a lost response; it re-consents. A client that
  refreshes in parallel (two workers racing on one expired access token) triggers reuse and loses its PAT.
- O1 1 hour: a client registered without the `refresh_token` grant, and any connection made while the D3 fallback
  fires (including an MCP deployed before the backend), gets a 1-hour session with no refresh; each re-consent mints
  a new 90-day PAT in Settings. Check claude.ai's registration and refresh behaviour during HEL-1710.
- Token-endpoint rate limit is 300 requests / 15 min per client IP (`httpApp.ts`). Refresh traffic rises from
  once per 90 days to once per hour per connection: one shared egress IP saturates at about 1,200 connections
  refreshing hourly (300 x 4 per hour). Fine at beta scale; revisit if a hosted client concentrates traffic.
- Family rows of an expired PAT are not purged; they go when the PAT row is deleted. One row per consent, so
  growth is bounded.
- Two deploys at release, backend first.

## Design-gate round 2 notes (adopted)

- D1's handler keeps the SDK metadata handler's behaviour: `cors()` and GET/OPTIONS only.
- No OpenAPI document exists in the tree; the `schemas/mcp/*` contracts plus the seam test are the contract (no new
  OpenAPI file).
- D5 is total: a rotate `400`, `403` or any other unexpected status maps to `ServerError` (500 `server_error`);
  it cannot happen in normal operation, and a retry is not guaranteed safe.
- The reuse audit event goes through `AuditService.record`, which appends after the transaction on the privileged
  pool and only logs a failed append, the same as every other `token.revoke`.
- Rotate's zero-row evaluation order is fixed and commented in the repository: missing/foreign (`404`), then expired
  (`409 expired`, no revoke: the PAT is at or past its own expiry), then client/resource mismatch, then reuse.
- README's revocation paragraph says an access token already issued keeps working for up to the liveness TTL
  (300 s by default) after a revocation or reuse, not immediately.

## Gate-Chain Implications Checklist

Not applicable: this change touches no `.husky/**` script or script the pre-commit hook invokes.
