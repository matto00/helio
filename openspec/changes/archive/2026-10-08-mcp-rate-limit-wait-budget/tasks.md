## Standing Constraints

- [C1] Iron Law: every new behavioural test is run and observed RED against the unmodified httpClient.ts before the fix; the red output is captured in the commit/PR evidence.
- [C2] No writes under ~: npm cache/logs go to the worktree or scratchpad; never HUSKY=0 or commit -n without disclosure.

## 1. Tests (red first)

- [x] 1.1 Add httpClient.test.ts case: 429 Retry-After 59 then 200 -> zero sleeps, one fetch, HelioRateLimitError retryAfterSeconds 59; verify RED on unmodified code
- [x] 1.2 Add cumulative case: repeated 429 Retry-After 15 -> sum(slept) <= RATE_LIMIT_WAIT_BUDGET_MS and rate-limit error thrown; verify RED on unmodified code
- [x] 1.3 Add seam test (real SDK Client + server over InMemoryTransport, default timeout) per design D5(b): RED shows -32001, GREEN shows isError naming the rate limit and 59s
- [x] 1.3a Add no-Retry-After case: sleeps exactly [1000,2000,4000,8000] then HelioRateLimitError retryAfterSeconds undefined (design D6a)
- [x] 1.3b Add unit test for the rate-limit text parser module (scripts/rateLimitRetry.ts): 'retry after 42s' -> 42; non-rate-limit error and no-retry-after text -> no retry
- [x] 1.4 Add SDK guard test: RATE_LIMIT_WAIT_BUDGET_MS <= DEFAULT_REQUEST_TIMEOUT_MSEC / 2 imported from @modelcontextprotocol/sdk/shared/protocol.js

## 2. helio-mcp: implementation

- [x] 2.1 Add exported HelioRateLimitError (extends HelioApiError, status 429, retryAfterSeconds) and export RATE_LIMIT_WAIT_BUDGET_MS = 30_000; verify typecheck passes
- [x] 2.2 Rework dispatch/retryDelayMs: track cumulative wait, throw HelioRateLimitError when next wait exceeds remaining budget or retries exhausted, remove MAX_BACKOFF_MS; verify 1.1-1.4 GREEN
- [x] 2.3 Update the header doc comment in httpClient.ts to describe the budget and the error; verify by reading
- [x] 2.3a Add bounded retrying callTool helper (D7: 3 re-calls, 180s cap) and route ALL 23 verify.ts callTool sites through it; verify `grep -c 'client.callTool(' scripts/verify.ts` == 1, typecheck + 1.3b green
- [x] 2.4 Update existing tests encoding the 60s clamp / plain exhaustion error per design D6; verify full helio-mcp jest suite green

## 3. Verification

- [x] 3.1 Run helio-mcp typecheck, lint, prettier check and the helio-mcp jest tests; all green, outputs captured
