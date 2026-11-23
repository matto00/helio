## Why

helio-mcp's discovery metadata advertises the `refresh_token` grant (an SDK default) while the server refuses every
refresh grant, and its README says `GET /mcp` answers `405` while an unauthenticated one answers `401` (HEL-1713,
found on the 2026-11-11 prod smoke test). The owner ruled (2026-11-23) that helio-mcp SHALL really issue and honour
refresh tokens, and that an unauthenticated `GET /mcp` stays `401`, documented. MCP 2025-11-25 requires refresh
tokens to rotate for public clients (every helio-mcp client is public) and recommends short-lived access tokens.

## What Changes

- helio-mcp serves its own authorization-server metadata with `grant_types_supported` stated explicitly as
  `["authorization_code","refresh_token"]`, now true.
- **BREAKING (token lifetime):** access tokens issued after deploy live 1 hour (was 90 days). Access tokens issued
  before deploy keep working to their own expiry.
- The code exchange also returns a sealed refresh token (to clients that registered the `refresh_token` grant).
  Refresh tokens rotate on every use, expire 30 days after issue, never outlive the PAT behind them, and are bound
  to client and resource.
- Reuse of a rotated refresh token deletes the PAT behind it, which revokes the whole family and every access token
  sealing that PAT. Revoking the PAT in Settings likewise ends its refresh tokens.
- Backend: new table `mcp_refresh_families` (migration V147) holding only a hash of each family's current token id,
  and two PAT-authenticated routes to create a family and rotate it atomically.
- README: refresh behaviour, and `401` (unauthenticated) vs `405` (authenticated) for `GET`/`DELETE /mcp`.

## Capabilities

### New Capabilities
- `mcp-refresh-token-families`: backend storage and routes for refresh-token family state (create, atomic rotate,
  reuse revokes the PAT, cascade on PAT revocation).

### Modified Capabilities
- `mcp-connector-oauth`: metadata grant list; token exchange lifetime and refresh issuance; new refresh-grant
  requirement; unauthenticated `GET`/`DELETE` scenario.
- `mcp-remote-http-transport`: `GET`/`DELETE /mcp` answer `405` only when authorized, `401` otherwise.

## Impact

- helio-mcp: `src/oauth/provider.ts`, `src/oauth/seal.ts`, `src/httpApp.ts`, a backend client for the two routes,
  tests, `README.md`.
- backend: `V147__mcp_refresh_families.sql`, repository, service, routes wired in `ApiRoutes`, JSON protocols,
  ScalaTest specs; `schemas/mcp/*` contracts.
- Release: backend first, then helio-mcp (an MCP deployed first degrades to issuing no refresh token). Neither is
  deployed by this change.
