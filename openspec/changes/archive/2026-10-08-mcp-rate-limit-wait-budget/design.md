## Context

`helio-mcp/src/httpClient.ts` `dispatch()` loops: on a generic 429 with attempts left (`MAX_RATE_LIMIT_RETRIES = 5`) it
sleeps `retryDelayMs()` — `Retry-After` seconds, else `1s * 2^attempt` — clamped per wait to `MAX_BACKOFF_MS = 60_000`,
then re-sends. Nothing bounds the cumulative wait (worst case ~300 s). The calling MCP client's default request
timeout is `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` in `@modelcontextprotocol/sdk` 1.31.0 (`shared/protocol.js`,
re-exported via the package's `./*` export as `@modelcontextprotocol/sdk/shared/protocol.js`). Tool shells (`guarded`
in `tools/read.ts`, `tools/placements.ts`, `tools/combinedProposal.ts`, ...) already turn any thrown `HelioApiError`
into an `isError` result `"<name> (status <s>) for <url>: <message>"`. `sleep`/`fetchImpl`/`warn` are injectable
(`HelioHttpClientDeps`), which the existing `httpClient.test.ts` uses to assert schedules without real timers.

## Goals / Non-Goals

**Goals:** a throttled request either completes within a budget well under the caller's timeout or fails fast with a
retry-after-carrying rate-limit error. **Non-goals:** see proposal.md Non-goals.

## Decisions

**D1 — Cumulative wait budget, not just a smaller per-wait clamp.** Add `RATE_LIMIT_WAIT_BUDGET_MS = 30_000` (half the
SDK timeout: leaves ~30 s for the request round-trips themselves and for a tool that makes a second HTTP call).
`dispatch` tracks `waitedMs`; before sleeping it computes the wanted delay and, if `waitedMs + delay > budget`, throws
instead of sleeping. Alternative rejected: just lowering `MAX_BACKOFF_MS` to e.g. 30 s — five 30 s waits still total
150 s, so the timeout remains reachable; and clamping a 59 s `Retry-After` down to 30 s guarantees the re-send is
refused again (the window has not reset), wasting the wait.

**D2 — Never sleep less than the server asked.** A `Retry-After` larger than the remaining budget surfaces at once
(no partial wait). `MAX_BACKOFF_MS` is removed: with D1 the budget is the only ceiling, and an absurd `Retry-After`
(86400) now fails fast instead of sleeping 60 s and retrying into the same refusal.

**D3 — `HelioRateLimitError extends HelioApiError`** (status 429, `name = "HelioRateLimitError"`), field
`retryAfterSeconds: number | undefined` (the server's header value when it sent a usable delta-seconds; `undefined` on
the no-header backoff path). Message: `"429 Too Many Requests: rate limited by the Helio backend; retry after <N>s
(<server message>)"`-shaped — exact wording is the executor's, but it MUST contain "rate limit" and the retry-after
seconds when known. Subclassing keeps every `guarded` shell and every `instanceof HelioApiError` caller working with no
tool-file edits. It is thrown both on budget overrun and on attempt exhaustion (today's exhaustion path throws a plain
`HelioApiError` 429 — this upgrades it so the caller always gets the retry-after). `CHAT_LIMIT_REACHED` keeps its
existing immediate plain-`HelioApiError` path unchanged (it is a daily cap, not a window).

**D4 — The budget is tested against the SDK, not a copied constant.** A test imports `DEFAULT_REQUEST_TIMEOUT_MSEC`
from `@modelcontextprotocol/sdk/shared/protocol.js` and asserts the exported budget `<= timeout / 2`. This is the
"check against the SDK version" acceptance item made permanent. Export the budget constant for that purpose.

**D5 — Red-first evidence at two levels.** (a) Unit: `httpClient.test.ts` — 429 `Retry-After: 59` then 200; assert
zero sleeps, one fetch, rejection with `HelioRateLimitError` `retryAfterSeconds === 59`. Red on the unmodified code
(it sleeps 59000 and returns the 200). Plus a cumulative scenario (e.g. five 15 s `Retry-After`s) asserting
sum(slept) <= budget, also red before. (b) Seam: a real SDK `Client` + `McpServer` over `InMemoryTransport`
(pattern already in `server.test.ts`/`tools/read.test.ts`) with the client's *default* request timeout, a stub
`fetchImpl` answering 429 `Retry-After: 59`, and a `sleep` that resolves only on real or fake timers — showing before
the fix the call rejects with `McpError` code `-32001`, after the fix it resolves `isError` naming the rate limit. If
fake timers cannot drive the SDK's timeout cleanly, the executor may instead inject a sleep that never resolves and a
short explicit `{ timeout }` on `callTool`, documenting the substitution — the red/green transcript must be captured
either way.

**D6a — No-`Retry-After` path.** Backoff 1+2+4+8 s spends 15 s; the next 16 s wait would exceed 30 s, so the budget
stops it after 4 retries and the 5-retry cap becomes unreachable on that path (it still bounds the `Retry-After`
path, e.g. five 1 s waits). A test pins the schedule `[1000, 2000, 4000, 8000]` then a `HelioRateLimitError` with
`retryAfterSeconds === undefined`. On budget overrun the error carries the server's `Retry-After` from THAT response,
never the remaining budget.

**D7 — `scripts/verify.ts` waits out reported rate limits itself.** Add one helper (e.g. `callToolRetrying(client,
call)`) and route ALL 23 `client.callTool(` sites in verify.ts through it (15 `parse()` sites; the two expected-error
sites :286/:304, whose text check would otherwise see a rate-limit error instead of the shape's own validation
message; the five print-only sites :163/:173/:196/:210/:229, which would otherwise print a rate-limit error instead
of real output; the `run_pipeline` loop :388). Behaviour: when a result is `isError` and its text identifies a
`HelioRateLimitError` with a parseable `retry after <N>s`, sleep N s + 1 s and re-call; at most 3 re-calls and at
most 180 s total sleeping per call site, after which the last result is returned unchanged; anything else (including a
rate-limit error with no retry-after) is returned unchanged. Done-check: `grep -c "client.callTool(" verify.ts` equals
1 (inside the helper). The text parser lives in its own importable module (e.g. `scripts/rateLimitRetry.ts`) because
`verify.ts` runs `main()` on import; it is unit-tested (42 s text → 42; non-rate-limit error → no retry; rate-limit
text without a retry-after → no retry). The D3 message format is therefore a contract: it MUST contain the literal
`HelioRateLimitError` name (already prefixed by `guarded`) and `retry after <N>s` when the server sent a value; with
no server value the message says the backend sent no retry-after and to retry later. Alternative rejected: leaving
verify to regress and filing a follow-up — the ticket names plain `npm run verify` as an exposed consumer.

**D6 — Existing tests updated, not deleted.** "caps a single wait so an absurd Retry-After cannot stall a run" becomes
"surfaces an absurd Retry-After immediately"; the exhaustion test asserts `HelioRateLimitError`. Any other assertion
that encoded the 60 s clamp is changed with a one-line reason in the commit.

## Risks / Trade-offs

- [A tool making several sequential HTTP calls can still exceed 60 s if each one spends close to 30 s throttled] →
  accepted residual; a per-tool-call deadline needs the SDK request `signal` threaded through `HelioApi` (wide change).
  Named in the PR as a possible follow-up.
- [Regression band: a `Retry-After` of ~31-58 s used to be waited out silently AND succeed even for clients on the
  default 60 s timeout; with `InMemoryRateLimiter` sending the window remainder (~1-60 s) that is roughly half of
  general-limiter 429s if arrivals were uniform, and likely the common case for bursty callers like verify, whose
  window starts at their first request] → accepted deliberately. Why 30 s and not ~50 s: the 60 s clock runs from request send and
  covers every HTTP round trip of the tool, not just the wait; `runPipeline` makes 3 sequential requests and pipeline
  runs themselves take seconds, so a ~50 s budget leaves no room for even one more throttled or slow call and the tool
  times out anyway — the exact `-32001` this ticket removes. 30 s keeps one full-budget wait plus real work inside the
  timeout. The cost in the band is one actionable error with the exact retry-after, which an agent (and verify.ts,
  D7) can honour by retrying; that is strictly better than the band's other half (59-60 s), which times out today.
- [Non-TS MCP clients may use a different timeout] → 30 s budget is conservative for any client with timeout >= 60 s.

## Planner Notes

- Self-approved: hybrid of both acceptance options (bounded retry + structured error); no product escalation needed
  since the ticket pre-authorizes surfacing the error. Self-approval accepts the 31-58 s regression band described
  in Risks (all clients, default timeout included) on the 30 s budget argument there, and absorbs it in verify.ts (D7).
- Self-approved: the HEL-1297 `verify:isolated` items are excluded and returned to the driver as a follow-up.
