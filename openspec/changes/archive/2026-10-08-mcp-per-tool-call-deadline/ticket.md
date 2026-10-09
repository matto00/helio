# HEL-1381: helio-mcp: per-tool-call deadline so a multi-HTTP-call tool can't exceed the SDK's 60s timeout via repeated 429 waits

## Description

origin_kind: followup
origin_ticket: HEL-1349

HEL-1349 capped the total 429-wait per HTTP request at 30s (`RATE_LIMIT_WAIT_BUDGET_MS`, half the SDK's 60s
`DEFAULT_REQUEST_TIMEOUT_MSEC`). But the budget is per request, not per tool call. A tool that makes several HTTP calls
in sequence (e.g. `runPipeline` makes 3) can still spend close to 30s rate-limited on each, and the whole tool call
then exceeds 60s and surfaces as an MCP `-32001` timeout instead of a rate-limit error.

## Acceptance criteria

* A deadline per tool call: thread the SDK request's abort signal (or an equivalent deadline) through `HelioApi`, so
  the wait budget is shared across all HTTP calls in one tool invocation.
* Red-first test: a multi-call tool with two 25s Retry-Afters times out on base and returns a `HelioRateLimitError`
  with retry-after on the fix.
* Keep HEL-1349's SDK-timeout guard test meaningful.

## Premise validation (orchestrator, origin/main 1bf11f55)

Confirmed: the budget is a local `waitedMs` inside `HelioHttpClient.dispatch` (per request). Minor correction:
`runPipeline` makes 2 HTTP calls always (POST run, GET summary) and a 3rd (GET steps) only when the run reports
`stepRowCounts`. Driver constraints: HEL-1382 (verify:isolated hardening) and HEL-1383 (split verify.ts) are separate
tickets in the same package -- do not absorb them. The session MCP runs a stale gitignored `helio-mcp/dist`; validate
via the package's own jest tests/typecheck, never the live session MCP.
