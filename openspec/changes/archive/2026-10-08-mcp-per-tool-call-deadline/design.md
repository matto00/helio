## Context

See proposal.md - Why. Today `HelioHttpClient.dispatch` (`helio-mcp/src/httpClient.ts`) keeps `let waitedMs = 0` as a
local per call, compared against `RATE_LIMIT_WAIT_BUDGET_MS` (30 000). `HelioApi` (`helioApi.ts`) has well over a
hundred methods that call `this.http.get/post/...`; tools are registered through `server.registerTool(...)` (~90 call
sites across `src/tools/*.ts`) plus one `server.registerResource(...)` in `server.ts`, all inside
`createServer(api)`. No source file uses the deprecated `server.tool(`/`server.resource(` forms. Handlers catch
`HelioApiError` and render `isError` results (e.g. `guarded` in `tools/read.ts`). The SDK hands every handler an
`extra` whose `signal` aborts when the client sends `notifications/cancelled` -- which the SDK client does when its own
60s timeout fires (`shared/protocol.js` `cancel(...)`). The server never learns the client's timeout value, so the abort
signal alone arrives too late to turn a timeout into a rate-limit error; a shared budget is what fixes the bug.

## Goals / Non-Goals

**Goals:** one wait budget per tool invocation / resource read; honor `extra.signal` during waits; zero change for
callers outside an invocation (`scripts/`, `e2e/`); keep HEL-1349 guards meaningful.

**Non-Goals:** see proposal.md Non-goals. No wall-clock deadline over non-429 latency.

## Decisions

### D1. Invocation scope via `AsyncLocalStorage`, not an explicit parameter on every `HelioApi` method

`httpClient.ts` exports `runWithRateLimitScope(signal: AbortSignal | undefined, fn)` which runs `fn` inside an
`AsyncLocalStorage<{ waitedMs: number; signal?: AbortSignal }>` store. `dispatch` reads the store: inside a scope it
charges/compares the shared `waitedMs`; outside one it uses a fresh local counter exactly as today.

This IS "threading the deadline through `HelioApi`": every `HelioApi` call made during the handler's async continuation
(including `await`ed helpers and `Promise.all` branches) sees the same store, with no signature change.

Alternatives: (a) add `signal`/`budget` to every `HelioApi` method and every tool call site -- ~100+ signature changes,
every future method must remember it, and a forgotten site silently reverts to per-request (exactly the bug). (b) Bind
a per-invocation `HelioApi`/`HelioHttpClient` copy -- requires changing every `register*Tools(server, api)` to take a
factory. ALS gives one choke point with no per-site discipline. Node >= 20 (package `engines`) ships it stably.

### D2. One choke point: wrap `registerTool`/`registerResource` inside `createServer`

Before any `register*Tools` call, `createServer` replaces the instance's `registerTool` and `registerResource` with
wrappers that pass the original arguments through but wrap the final callback argument so it runs as
`runWithRateLimitScope(extra.signal, () => cb(...args))`. Every tool registered via `createServer` -- present and
future -- is scoped without touching any tool file. A unit guard test asserts that a tool registered on the returned
server runs inside a scope (and goes red if the wrapper is removed), and a guard asserts no `src/` non-test file calls
the deprecated `server.tool(`/`server.resource(` forms, `registerToolTask`, or prompt registration that would bypass
the wrapper.

Alternative: wrap at the low-level `server.server.setRequestHandler("tools/call")` -- couples to SDK internals that
`McpServer` owns; rejected.

### D3. Budget semantics: shared cumulative sleep, same value

The shared counter sums the sleeps actually performed, compared with the unchanged `RATE_LIMIT_WAIT_BUDGET_MS`. A
wait that would push the invocation past it throws `HelioRateLimitError` with the 429's retry-after (existing
message contract parsed by `scripts/rateLimitRetry.ts` is unchanged). Two 25s Retry-Afters in one invocation: first
waits (25 <= 30), second throws "retry after 25s". The other half of the SDK's 60s remains for round trips, as in
HEL-1349. Concurrent branches (`Promise.all`) each charge their sleep: conservative (fails earlier, never later).

Alternative: wall-clock deadline (invocation start + budget). Rejected: a legitimately slow, never-throttled call (a
large `run_pipeline`) would make any later short 429 fail even though it fits the 60s; it also changes semantics for
the single-request path that HEL-1349 tests pin.

### D4. Abort signal

Only on the 429 path, inside a scope: if the scope's `signal` is already aborted when a wait is about to start, or
aborts during the wait, the client does not sleep (or stops sleeping) and does not re-send; it throws
`HelioRateLimitError` with that 429's retry-after and a message stating the invocation was cancelled while rate
limited, and still containing the `retry after <N>s` text `scripts/rateLimitRetry.ts` parses. The sleep is raced against the signal's `abort` event and the listener is removed afterwards (no leak per
retry); the production sleep's timer is cleared (or `unref`'d) when the abort wins. Non-429 paths do not consult the signal (out of scope). The `sleep` test seam keeps its signature; the race lives
in `dispatch`, so injected fake sleeps still work.

## Risks / Trade-offs

- [ALS context lost across a non-async boundary, e.g. a callback-style API] -> all helio-mcp HTTP goes through
  `fetch`/promises; the seam test drives the real SDK + real client end to end to prove propagation.
- [A future handler registered outside `createServer`] -> the deprecated-form guard plus the scope guard test; such a
  handler degrades to today's per-request behavior, not worse.
- [Over-counting in parallel branches] -> fails earlier than strictly necessary; acceptable, never times out.

## Test plan (binding)

- New seam test (real SDK `Client` default timeout, `InMemoryTransport`, real `HelioHttpClient`, fake timers): the
  `run_pipeline` tool; the injected `fetchImpl` takes 5s of fake time per request; POST run answers 429
  `Retry-After: 25` then 200 (with non-empty `stepRowCounts`); GET summary answers 429 `Retry-After: 25` then 200; GET
  steps 200. Base: 5+25+5+5+25+5+5 = 75s > 60s -> `-32001`. Fix: isError at t~40s naming the rate limit and "25s".
  Must be shown RED against base `httpClient.ts`/`server.ts` (record the failing output) before GREEN.
- httpClient unit: shared scope -- two sequential requests each 429(25) -> first sleeps, second throws
  `HelioRateLimitError` with `retryAfterSeconds === 25`; outside a scope the same sequence sleeps both (per-request
  preserved); abort during a wait stops without re-send.
- HEL-1349 guards kept and proven failable: record mutations `RATE_LIMIT_WAIT_BUDGET_MS = 31_000` (budget<=timeout/2
  test red) and removing the D2 wrapper (new seam test + scope guard red).

## Planner Notes

- Self-approved: ALS over explicit threading (D1) -- internal, no API/dependency change (Node built-in).
- `runPipeline` makes 2 requests always, 3 when `stepRowCounts` is non-empty (premise correction vs ticket's "3").
