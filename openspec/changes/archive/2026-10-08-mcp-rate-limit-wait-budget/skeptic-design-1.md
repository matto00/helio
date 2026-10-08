## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 60fdb87ded6dd8d571767199b8d3fa05f6b093c7 (change dir untracked; no code changes yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/mcp-rate-limit-backoff-cap/HEL-1349`.

### What I verified (with evidence)

- **httpClient.ts premise — TRUE.** `MAX_RATE_LIMIT_RETRIES = 5` (:62), `BASE_BACKOFF_MS = 1_000` (:64),
  `MAX_BACKOFF_MS = 60_000` (:66) applied per wait in `retryDelayMs` (:245); `dispatch` (:185-232) has no
  cumulative bound; exhaustion throws plain `HelioApiError` 429 (:225-226); `CHAT_LIMIT_REACHED` fast path (:206-208);
  `sleep`/`fetchImpl`/`warn` injectable (:88-98). Matches design Context.
- **SDK version/timeout — TRUE.** `helio-mcp/node_modules/@modelcontextprotocol/sdk/package.json` version `1.31.0`;
  `dist/esm/shared/protocol.js:8 export const DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`, used at :712 as
  `options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC`; `.d.ts:57` declares it.
- **Importability — TRUE.** Package exports `./*` -> `{import: dist/esm/*, require: dist/cjs/*}`. From `helio-mcp/`:
  `node -e "require('@modelcontextprotocol/sdk/shared/protocol.js').DEFAULT_REQUEST_TIMEOUT_MSEC"` -> `60000`; ESM
  dynamic import -> `60000`. Root `jest.config.cjs` runs ts-jest with NodeNext and already resolves sibling subpaths
  (`client/index.js`, `inMemory.js`) in `server.test.ts`/`tools/read.test.ts`, same export mechanism. D4 is feasible.
- **guarded shells — TRUE.** 11 `guarded` copies (read, write, outputs, outputControls, pipelines, placements, proposal,
  pipelineProposal, combinedProposal, connectorHandlers, refinement) plus read.ts:216-224 all branch on
  `instanceof HelioApiError` and format `${err.name} (status ${err.status}) for ${err.url}: ${err.message}` -> a
  subclass with `name = "HelioRateLimitError"` and a message containing "rate limit" surfaces correctly with no tool edits.
- **Retry-After distribution (backend).** `InMemoryRateLimiter.scala:49` `retryAfterSeconds = max(1, window - elapsed)`
  -> the general /api limiter sends Retry-After roughly uniform over 1..60 s; the pipeline-run concurrency path sends a
  fixed 15 s (`PipelineRunGuardConfig.scala:23`). Near-60 s is real, confirming the ticket.
- **Red-first tests are genuinely red on unmodified code.** 1.1 (Retry-After 59 then 200): today sleeps 59000 and
  resolves 200 -> red. 1.2 (repeated 15 s): today sleeps 5x15000 = 75 s > 30 s -> red. Existing tests: only :81-88
  (60 s clamp) and :105-121 / name assertions at :116 encode behaviour D6 changes; :133 is CHAT_LIMIT (unchanged).
- **Ticket AC coverage.** AC1 -> D1/D2/D3 + tasks 2.1-2.2; AC2 -> tasks 1.1-1.3; AC3 -> D4 + task 1.4. All covered.
- **Scope exclusion of the five verify:isolated items — sound.** They are explicitly "low priority, listed outside the
  Acceptance block", live in different code (`scripts/verifyIsolated.ts`/`isolatedRun.ts`, README, an archived
  design.md), and have no bearing on the 429 path. Handing back as a follow-up is correct; the orchestrator must
  actually ensure it is filed (driver), not just noted.
- **Owner product call for surfacing an error — not needed.** The AC offers "keep backoff comfortably below the SDK
  timeout, OR return a structured rate-limit error". Under either branch a Retry-After in the ~30-60 s band cannot be
  waited out silently (honouring it is not "comfortably below"; clamping it guarantees a second refusal because the
  window has not reset). So surfacing a retry-after-carrying error is pre-authorized. The budget VALUE is a design
  judgment, not a product call — but it must be justified on true premises (see CR 2).

### Verdict: REFUTE

Two load-bearing claims in the artifacts are false, and the planner's self-approval leans on them. The code plan
itself is sound; the revisions are to the artifacts' impact/trade-off accounting and one missing decision.

### Change Requests

1. **proposal.md Impact: "`scripts/verify.ts`'s run loop already treats any error result as 'wait and retry', so it is
   unaffected" is false.** Only the `run_pipeline` loop in `verifyOutputHistory` (verify.ts:387-401) retries on
   `isError`, and it sleeps a fixed `RATE_LIMIT_BACKOFF_MS = 15_000` (:369), not the retry-after. The other 22 of 23
   `client.callTool` sites go through `parse()` (verify.ts:58-60), which throws on `isError`. Today a 429 with
   Retry-After 31-~58 s at any of those sites is waited out and verify passes; after this change verify fails
   immediately. The ticket names plain `npm run verify` as an exposed consumer, so this is in scope to decide. Revise
   the artifacts to make an explicit decision and add a task for it: either (a) a small verify.ts helper that, on an
   `isError` result naming the rate limit, waits the reported retry-after and retries (bounded), used by the
   `parse()`-based call sites (and optionally the run loop, which would also bring it closer to the existing
   `mcp-verify-harness` spec's "waiting out any 429 `Retry-After`" wording), or (b) state the verify.ts regression
   plainly and hand it back as a named follow-up. Either is acceptable; "unaffected" is not.

2. **design.md Risks bullet 2 misstates who regresses.** It says a 30-60 s wait "would previously have succeeded
   silently (for clients with a longer timeout than the TS default)". It also previously succeeded for TS-default
   (60 s) clients whenever Retry-After + round-trip < 60 s, i.e. roughly Retry-After 31-~58 s — and per
   `InMemoryRateLimiter.scala:49` that band is about half of all general-limiter 429s. Correct the bullet to state the
   real regression band and its frequency, and re-justify `RATE_LIMIT_WAIT_BUDGET_MS = 30_000` against it (30 s may
   well remain the right answer given multi-request tools such as `runPipeline` = POST + GET + steps GET; just say so
   on true premises). Also update the Planner Notes self-approval line to cite the corrected trade-off.

### Non-blocking notes

- No-Retry-After path: with a 30 s budget the backoff schedule 1+2+4+8 = 15 s, then 16 s would reach 31 s, so the
  budget (not the attempt cap) ends it after 4 retries; `MAX_RATE_LIMIT_RETRIES = 5` becomes unreachable on that path.
  Worth a sentence in D1/D2 and a test pinning the schedule `[1000, 2000, 4000, 8000]` + `retryAfterSeconds: undefined`
  so the behaviour change is deliberate, not incidental. The warn text "attempt n/5" stays accurate as a maximum.
- D5(b) seam test with jest fake timers: modern fake timers also fake `queueMicrotask`/`nextTick`-style scheduling
  depending on config, which can stall `InMemoryTransport`. The documented fallback (never-resolving sleep + short
  explicit `{ timeout }`) is the likely path; fine as written.
- Accepted residual (per-request, not per-tool-call budget) is correctly named; `runPipeline` (helioApi.ts:803-824)
  makes 3 sequential requests, so worst case ~90 s of throttle waiting remains possible, though after one full wait the
  window has reset and further 429s are unlikely.
- When raising the error on budget overrun, `retryAfterSeconds` should be the server value from that response (not
  remaining budget); D3 implies this — keep it explicit in the implementation.
