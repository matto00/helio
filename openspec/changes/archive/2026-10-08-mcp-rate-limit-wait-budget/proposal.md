## Why

helio-mcp's HTTP client retries a backend 429 by sleeping the server's `Retry-After`, clamped to 60 s per wait, up to 5 times. The calling MCP client (TS SDK 1.31.0) times a tool call out at 60 s (`DEFAULT_REQUEST_TIMEOUT_MSEC`). So a single near-60 s `Retry-After` — which the HEL-505 pipeline-run guard really sends — or a few moderate ones in a row turn a clear, actionable rate-limit refusal into an opaque `-32001` request timeout, while helio-mcp keeps sleeping and re-sending in the background for a caller that has already given up.

## What Changes

- Bound the **total** time one HTTP request may spend waiting out 429s to a budget comfortably below the SDK request timeout (not just each individual wait).
- When honouring a 429's wait would exceed the remaining budget, stop immediately (no partial sleep, no further re-send) and surface a structured rate-limit error to the tool caller that carries the server's retry-after, so an agent can decide to wait and retry itself.
- Short waits within the budget keep retrying transparently, as today (bursty agent runs keep working).
- A guard test ties the budget to the installed SDK's own `DEFAULT_REQUEST_TIMEOUT_MSEC`, so an SDK bump that lowers the timeout fails a test instead of silently reintroducing the bug.

## Non-goals

- The five `verify:isolated` hardening items the ticket lists outside its Acceptance block (createdb signal window,
  tsx-wrapper SIGKILL orphan, PID re-signal, README backend-log note, HEL-1297 design.md D3 wording) — separate
  harness code with its own verification needs; handed back to the driver as a follow-up ticket.
- A per-tool-call (multi-request) deadline — see design.md Risks.
- Changing the backend's `Retry-After` values or rate limits.

## Capabilities

### New Capabilities
- `mcp-rate-limit-handling`: how helio-mcp handles backend 429 responses — bounded transparent retry, and a structured, retry-after-carrying rate-limit error when the wait would outlast the caller's request timeout.

### Modified Capabilities
<!-- none: no existing spec covers the helio-mcp client's 429 behaviour -->

## Impact

- `helio-mcp/src/httpClient.ts` (retry loop, new error type), `helio-mcp/src/httpClient.test.ts`.
- Tool error text for a long-rate-limited call changes from a `-32001` timeout to an `isError` result naming the rate
  limit and retry-after. `scripts/verify.ts` IS affected: of its 23 `client.callTool` sites (orchestrator re-count), 15 go through `parse()`
  (throws on any error result), 2 expect a specific validation error and check its text (:286, :304), 5 only print the
  result (:163, :173, :196, :210, :229), and 1 is the `run_pipeline` loop (:388). A 31-58 s `Retry-After` that verify
  used to survive would now fail or mislead at all of them, so this change routes all 23 through one bounded helper that
  waits the reported retry-after and retries (design D7).
- No backend, schema, or dependency change.
