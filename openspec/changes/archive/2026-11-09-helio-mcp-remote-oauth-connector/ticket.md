# HEL-1709: helio-mcp: public Streamable HTTP /mcp endpoint with OAuth sign-in, so it can be added as a claude.ai custom connector

## Description

### Why

helio-mcp only speaks MCP over stdio today, so it can only run as a local process. A claude.ai custom connector needs a remote HTTPS URL. The goal is to add Helio as a connector so an agent can post content (for example a daily morning brief as a markdown panel via `create_content_panel`) onto a Helio dashboard.

### Current state

- `helio-mcp/src/index.ts` connects `createServer(api)` to a `StdioServerTransport`. No HTTP or SSE transport exists anywhere in the repo.
- Auth is one Personal Access Token read from the `HELIO_PAT` env var. The target backend comes from `HELIO_API_BASE_URL` (default `http://localhost:8080`).
- Backend runs on Cloud Run (see `infra/README.md`, `infra/deploy-backend.sh`); the app is at helioapp.dev.

## Scope

1. **Streamable HTTP transport.** Add an HTTP entry point that serves the same `createServer` tool set over MCP Streamable HTTP at `/mcp` (POST and GET). Keep the stdio entry point working unchanged for local clients.
2. **Per-user auth (OAuth).** A remote server must not run with one baked-in PAT: anyone with the URL could write to that workspace. Implement MCP's OAuth authorization flow (protected resource metadata, authorization server metadata, dynamic client registration) so claude.ai's connector sign-in works, and each request acts as the signed-in Helio user. Map the OAuth access token to that user's Helio API calls (via a minted PAT or a backend-issued token, whichever fits the existing auth model). Unauthenticated requests get 401 with the right `WWW-Authenticate` header.
3. **Public HTTPS deploy.** Deploy it publicly, e.g. as its own Cloud Run service, or as a route under the existing domain. Document the final connector URL (e.g. `https://<host>/mcp`).
4. **Docs.** Update `helio-mcp/README.md` with the HTTP mode, env vars, deploy steps, and how to add it as a claude.ai custom connector.

## Acceptance Criteria

- Adding the `/mcp` URL as a custom connector in claude.ai completes sign-in and lists Helio's tools.
- From that connector, `create_content_panel` (type `markdown`) creates a panel on a chosen dashboard as the signed-in user.
- A request without a valid token is refused; no secret, key or PAT is committed or logged.
- stdio mode still passes its existing tests.

## Notes

- Related: HEL-1561 (publish helio-mcp to npm), HEL-1568 (PAT bootstrap doc is out of date).
- Watch the existing rate-limit and per-tool-call deadline behavior (HEL-1381) under HTTP.
- Large inbound requests: stdio raised its buffer to 64 MiB for CSV uploads; set a matching request body limit for HTTP.
