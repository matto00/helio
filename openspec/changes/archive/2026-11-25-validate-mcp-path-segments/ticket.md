# HEL-1160: Encode and validate agent-supplied IDs in helio-mcp request paths

## Description

helio-mcp exposes tools whose arguments (`sourceId`, `pipelineId`, `dataSourceId`, ...) come from an LLM agent.
`helioApi.ts` interpolates them straight into request paths (e.g. `/api/pipelines/${pipelineId}`), and
`encodeURIComponent` appears only once in the file. `HelioHttpClient` attaches `Authorization: Bearer <PAT>` to every
request. Found via an adversarial LLM review of `helio-mcp/src/httpClient.ts`; the URL behaviours below were
reproduced in node.

Observed:

* `sourceId = "1/../../tokens"` produces `GET /api/tokens/preview`: an authenticated request to an endpoint the tool
  never intended to reach.
* `id = "x?force=true"` injects query parameters (e.g. can override `DELETE /api/data-sources/:id/rows/:rowId?updatedAt=...`).
* `id = "x#y"` truncates the path at the fragment.
* Plain `encodeURIComponent` is NOT sufficient: `encodeURIComponent("..") === ".."`.
* Defense in depth: a path beginning with `//` resolves to a different host. `buildUrl` does not prevent it.

Expected: any agent-supplied identifier is treated as a single opaque path segment, or rejected with a clear tool
error. `buildUrl` can never produce a URL whose origin differs from the configured base.

## Scope

Add one helper (e.g. `pathSegment(id)`) that rejects empty, `.`, `..`, and anything containing `/`, `?`, `#`, `\`,
then percent-encodes; use it at every interpolation site (re-derived from the current tree: all of `helio-mcp/src`,
including `oauth/familyClient.ts`, not only `helioApi.ts`). Add an origin check in `buildUrl`.

## Acceptance criteria

- [ ] Every ID interpolated into a request path in `helio-mcp/src` goes through the helper (a grep-based GUARD test
      shows no raw `${...}` in a request path).
- [ ] Unit tests (red first, each failable by mutation): `..`, `.`, `a/b`, `a?b=1`, `a#b`, `a\b`, `""` are rejected
      with a typed error; normal UUIDs and slugs pass unchanged.
- [ ] Unit test: `buildUrl` throws for a path starting with `//` and for any result whose origin differs from the
      base URL's.
- [ ] A tool-level test shows a rejected id surfaces to the agent as a typed `isError` tool result (not a crash) and
      that no HTTP request is sent.
- [ ] Existing helio-mcp tests, typecheck and lint still pass.

## Out of scope

HEL-1161 (base URL path prefix), HEL-1162 (Retry-After parsing), HEL-1163 (request timeout).
