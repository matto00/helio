## Why

helio-mcp only speaks MCP over stdio, so it can only run as a local process holding one baked-in PAT. A claude.ai
custom connector needs a public HTTPS MCP endpoint that signs each user in with OAuth and acts as that user.

## What Changes

- New HTTP entry point (`helio-mcp/src/http.ts`) serving the existing `createServer` tool set over MCP Streamable
  HTTP at `/mcp`, stateless (one server + transport per request), 32 MiB request body limit (Cloud Run's HTTP/1 cap).
- helio-mcp becomes an OAuth 2.1 authorization server via the SDK's `mcpAuthRouter`: protected-resource metadata,
  authorization-server metadata, dynamic client registration, `/authorize`, `/token`. All OAuth artefacts
  (client ids, pending requests, codes, access tokens) are AES-256-GCM sealed with one server key, so any Cloud Run
  instance can serve any request with no store.
- New frontend consent page `/connect/mcp` (signed-in only): shows the requesting client and its redirect host; on
  Allow it mints a named, expiring PAT through the existing `POST /api/tokens` and hands it to helio-mcp by form POST.
  The access token helio-mcp issues is that PAT, sealed.
- `/mcp` without a valid token answers 401 with `WWW-Authenticate: Bearer resource_metadata=...`.
- `helio-mcp/Dockerfile` and `infra/deploy-mcp.sh` for a new Cloud Run service `helio-mcp` at `mcp.helioapp.dev`
  (request-based billing, min-instances 0, CPU throttling on). The owner runs the deploy, domain mapping and secret.
- `express`, `cors`, `express-rate-limit` declared directly (all already installed as SDK dependencies).
- README/docs: HTTP mode, env vars, deploy, adding the connector in claude.ai.
- stdio entry point unchanged.

## Capabilities

### New Capabilities
- `mcp-remote-http-transport`: Streamable HTTP `/mcp` endpoint, per-request user binding, body limit, deploy shape.
- `mcp-connector-oauth`: helio-mcp's OAuth authorization server, sealed stateless artefacts, and bearer enforcement.
- `mcp-connector-consent-page`: the frontend consent page that mints the PAT and hands it back.

### Modified Capabilities

## Non-goals

- No Scala backend or Flyway change; no backend-issued OAuth tokens.
- No refresh tokens; a connector re-authorizes when its PAT expires.
- No server-initiated SSE stream (stateless mode; `GET /mcp` answers 405).
- Running the production deploy, DNS mapping or Secret Manager creation (owner, after merge).
- Verifying against claude.ai itself (owner, follow-up ticket).

## Impact

- `helio-mcp/src` (new http entry, oauth module, config), `helio-mcp/package.json` (express is already an SDK
  dependency; declared directly), `helio-mcp/Dockerfile`, `infra/deploy-mcp.sh`, `helio-mcp/README.md`.
- `frontend/src` new route + page; new build-time env `VITE_MCP_ORIGIN` (`cd-frontend.yml`).
- Security surface: a new public service holding a key that unseals user PATs.
