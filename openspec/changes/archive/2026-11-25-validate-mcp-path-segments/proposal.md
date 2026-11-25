## Why

helio-mcp interpolates agent-supplied ids raw into REST request paths that carry the user's PAT. An id such as
`1/../../tokens`, `x?force=true` or `x#y` reaches a different endpoint, injects query parameters, or truncates the
path (HEL-1160). `encodeURIComponent` alone does not stop `..` traversal, and `buildUrl` would follow a `//host` path
to another origin.

## What Changes

- One helper turns an agent-supplied id into a single opaque path segment: it rejects empty, `.`, `..`, and any value
  containing `/`, `?`, `#` or `\` with a typed error, and percent-encodes everything else.
- Every id interpolated into a request path in `helio-mcp/src` (60 sites in `helioApi.ts`, one in
  `oauth/familyClient.ts`) goes through the helper.
- `HelioHttpClient.buildUrl` throws a typed error for a path starting with `//` and for any URL whose origin differs
  from the configured base.
- A rejected id surfaces to the agent as an `isError` tool result naming the bad value; no request is sent.
- A GUARD test fails if a request path interpolates a value without the helper.

## Capabilities

### New Capabilities

- `mcp-request-path-safety`: agent-supplied ids in helio-mcp request paths are single, encoded path segments, and every
  outgoing request stays on the configured API origin.

### Modified Capabilities

(none)

## Impact

- `helio-mcp/src/helioApi.ts`, `helio-mcp/src/httpClient.ts`, `helio-mcp/src/oauth/familyClient.ts`, one new helper
  module and new tests under `helio-mcp/src`.
- No REST API, schema, migration, backend or frontend change. Valid UUID/slug ids produce byte-identical URLs.

## Non-goals

- HEL-1161 (base URL path prefix dropped by absolute `/api` paths), HEL-1162 (Retry-After parsing), HEL-1163 (request
  timeout).
- Validating ids in request bodies or query parameters (query values are already encoded by `URLSearchParams`).
- No deploy of the hosted MCP service.
