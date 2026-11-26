# HEL-1161: helio-mcp: keep base URL path prefix and reject invalid base URL at config load

## Description

`HelioHttpClient.buildUrl` forces a leading `/` on every path and resolves it against `` `${baseUrl}/` ``. `HELIO_API_BASE_URL` is a user-provided env var. Found via an adversarial LLM review of `helio-mcp/src/httpClient.ts`.

Observed:

- With `HELIO_API_BASE_URL=https://host/helio`, every request goes to `https://host/api/...` instead of `https://host/helio/api/...` (`new URL("/api/x", "https://h/helio/").toString() === "https://h/api/x"`). Setups behind a path-prefixed gateway silently hit the wrong URL.
- A malformed base such as `localhost:8080` makes `new URL(...)` throw a bare `TypeError: Invalid URL` synchronously out of `get()`/`post()` (before a promise exists), so callers using `.catch()` never see it. It is not a `HelioApiError`.

Expected: path prefixes are preserved. An invalid base URL is rejected once, at config load, with an actionable message naming `HELIO_API_BASE_URL`.

## Acceptance criteria

- [ ] Test: base `https://h/helio` + path `/api/x` requests `https://h/helio/api/x`; a base with or without a trailing slash behaves identically.
- [ ] `loadConfig` rejects a base URL that is not an absolute http(s) URL, with a message that names the variable.
- [ ] No request method throws synchronously; failures are rejected promises.

## Owner scope addition (HEL-1160 gaps, folded in; relayed by the driver from the ticket comment)

- [ ] Widen `helio-mcp/src/requestPathGuard.test.ts` (HEL-1160's guard, MIN_SITES 63) beyond `/api/`-prefixed templates so it covers the base-path handling this ticket introduces, including paths built from a prefix variable or by string joining. The widened guard must fail when an unguarded site of the new shape is planted.
- [ ] Route `FamilyClient.post` (`helio-mcp/src/oauth/familyClient.ts`, which builds `apiBaseUrl + path` with no origin check) through HEL-1160's origin-checked builder.
- [ ] The origin check stays intact under a prefixed base: a prefixed base still rejects an agent path that escapes the origin, and a `..` segment cannot climb above the prefix (tested).

## Driver constraints

- Red-first, mutation-proven tests in helio-mcp: each AC item and both scope additions go red on main. Red run recorded and committed (as .txt) before implementation.
- Do not widen into HEL-1162 (Retry-After) or HEL-1163 (timeout/typed errors). No MCP deploy. No migration.
