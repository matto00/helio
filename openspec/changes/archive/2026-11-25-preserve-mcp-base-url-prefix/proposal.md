## Why

helio-mcp drops the path prefix of `HELIO_API_BASE_URL` (`https://host/helio` sends to `https://host/api/...`), so any deployment behind a path-prefixed gateway silently targets the wrong URL. A malformed base is never validated and surfaces as a synchronous `TypeError` from a request method, escaping `.catch()`. HEL-1160 also left two gaps: its path guard only scans `/api/`-prefixed templates, and `FamilyClient` joins `apiBaseUrl + path` with no origin check.

## What Changes

- One shared request-URL builder resolves a request path under the base URL's full path prefix (trailing slash or not, identical result), keeps HEL-1160's protocol-relative and origin checks, and additionally refuses any path whose resolved pathname leaves the prefix (for example via `..` or a root-relative escape).
- `HelioHttpClient`, `FamilyClient` and `checkPat` all build their URLs with that builder; no module joins a base URL and a path by string concatenation any more.
- Every `HelioHttpClient` request method (`get`, `post`, `patch`, `put`, `delete`, `postMultipart`) returns a rejected promise on a URL-building failure instead of throwing synchronously.
- `loadConfig` (stdio) and `loadHttpConfig` (HTTP mode) reject a `HELIO_API_BASE_URL` that is not an absolute `http:`/`https:` URL (or carries a query or fragment) with a message naming `HELIO_API_BASE_URL`.
- `requestPathGuard.test.ts` is widened to also flag request URLs built by joining a base/prefix variable with a path (template or `+` concatenation) and `fetch(...)` calls that bypass the builder.
- **BREAKING (internal test contract only):** HEL-1160's origin-guard tests asserted a synchronous throw; they now assert a rejected promise with the same typed error.

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-request-path-safety`: requests stay under the base URL's path prefix as well as its origin; URL-building failures are rejected promises, not synchronous throws; the base URL is validated at config load.

## Impact

- Code: `helio-mcp/src/httpClient.ts`, new `helio-mcp/src/requestUrl.ts`, `helio-mcp/src/config.ts`, `helio-mcp/src/httpConfig.ts`, `helio-mcp/src/oauth/familyClient.ts`, `helio-mcp/src/oauth/patCheck.ts`, and their tests (`httpClient.originGuard.test.ts`, `requestPathGuard.test.ts`, `oauth/familyClient.test.ts`, config tests).
- No backend, frontend, schema or migration change. No MCP deploy.
