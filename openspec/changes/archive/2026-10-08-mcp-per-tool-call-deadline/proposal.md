## Why

HEL-1349 bounded 429 waits to 30s per HTTP request, but a tool call is often several sequential requests
(`run_pipeline` is 2-3). Each request gets its own fresh 30s, so one tool call can wait 60s+ in total and the MCP
client's 60s default timeout fires first: the caller sees an opaque `-32001` instead of an actionable rate-limit error.

## What Changes

- The 429 wait budget becomes shared across every HTTP request made during one MCP tool invocation (and one
  resource read), instead of resetting per request. A wait that would push the invocation's cumulative wait past the
  budget fails at once with the existing rate-limit error carrying the server's retry-after.
- The SDK request's abort signal is honored: once the caller cancels (e.g. its own timeout fired), the client stops
  waiting and re-sending for that invocation.
- Callers outside a tool invocation (scripts, e2e) keep today's per-request budget unchanged.
- No change to the budget value, retry count, backoff schedule, or the `CHAT_LIMIT_REACHED` behavior.

## Non-goals

- HEL-1382 (verify:isolated hardening) and HEL-1383 (splitting verify.ts) -- separate tickets in the same package.
- Rebuilding the gitignored `helio-mcp/dist` or the live session MCP client.
- A wall-clock deadline on non-429 latency (a slow backend that never 429s is out of scope).
- Backend rate-limit changes.

## Capabilities

### New Capabilities

### Modified Capabilities

- `mcp-rate-limit-handling`: the wait budget is scoped to one tool invocation rather than one HTTP request; a
  cancelled invocation stops waiting.

## Impact

- `helio-mcp/src/httpClient.ts` (budget scope, abort handling), `helio-mcp/src/server.ts` (per-invocation scope around
  every registered tool/resource handler), new/updated tests under `helio-mcp/src/`.
- No API, schema, backend or frontend change.
