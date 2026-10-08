## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 60fdb87ded6dd8d571767199b8d3fa05f6b093c7 (change dir untracked; no code changes yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/mcp-rate-limit-backoff-cap/HEL-1349`.

### What I verified (with evidence)

- **httpClient.ts premise: true.** `MAX_RATE_LIMIT_RETRIES = 5` (:62), `BASE_BACKOFF_MS = 1_000` (:64),
  `MAX_BACKOFF_MS = 60_000` (:66) clamps each wait in `retryDelayMs` (:245). `dispatch` (:185-232) has no cumulative
  bound. Exhaustion throws a plain `HelioApiError` 429 (:225-226). The `CHAT_LIMIT_REACHED` fast path is at :206-208.
  Deps are injectable (:88-98). This matches design Context.
- **SDK: true.** `node_modules/@modelcontextprotocol/sdk/package.json` is `"version": "1.31.0"`, and
  `dist/esm/shared/protocol.js:8` has `export const DEFAULT_REQUEST_TIMEOUT_MSEC = 60000;`.
- **Seam test (D5b) is feasible.** `createServer(api: HelioApi)` (server.ts:28) and `new HelioApi(http: HelioHttpClient)`
  (helioApi.ts:238) let a stub-fetch `HelioHttpClient` be wired through a real server. The InMemoryTransport pattern
  is already used in `scripts/verifyPayloads.test.ts`.
- **Guarded error format.** 12 `${err.name} (status ...` sites in helio-mcp/src. A subclass named `HelioRateLimitError`
  therefore reaches the tool text with its name, so D7's "literal `HelioRateLimitError` name" contract can hold.
- **Round-1 CR2 (Risks band): resolved.** The Risks bullet now says 31-58 s used to succeed even on the default 60 s
  timeout. It justifies 30 s using `runPipeline`'s 3 sequential requests, and the Planner Notes cite "all clients,
  default timeout included". `InMemoryRateLimiter.scala` confirms `retryAfterSeconds = max(1, window - elapsed)`, with
  the window starting at the key's first request.
- **D6a arithmetic: correct.** 1+2+4+8 = 15 s, and the next 16 s wait would reach 31 s, which is over 30 s. The
  schedule `[1000,2000,4000,8000]` is right. Existing tests: :81-88 (60 s clamp) and :105-121 (`name: "HelioApiError"`)
  are the only ones whose assertions change. :70-79 (two backoffs, then 200) and :59-68 (Retry-After 7) still pass
  under a 30 s budget.
- **AC coverage.** AC1 is covered by D1/D2/D3 and tasks 2.1/2.2. AC2 by tasks 1.1-1.3 and 1.3a. AC3 by D4 and task 1.4.
- **Existing `mcp-verify-harness` spec** (openspec/specs/mcp-verify-harness/spec.md:50) already requires "waiting out
  any 429 `Retry-After` before retrying, within a bounded total time" for the run loop. D7 moves verify toward that
  spec, so no delta is needed.
- **Round-1 CR1 (verify.ts impact): only partly resolved.** The new count is false, and the D7 routing scope is too
  narrow because of it. See CR 1.
  - I listed every `client.callTool` site in `helio-mcp/scripts/verify.ts`. There are 23 (`grep -c` = 23), and I read
    each one by hand:
    - **15 go through `parse()`:** :123, 133, 142, 153, 184, 220, 239, 257, 262, 272, 323, 357, 382, 407, 418.
    - **5 go through `textOf()` only:** :163, 173, 196, 210, 229. These print evidence and never throw on `isError`.
    - **2 assert on the error text:** :286 and :304. They check `isErrorOf(...)`, then check that `textOf(...)`
      includes `"missing required field 'n'"` or `"Unknown pipeline shape"`.
    - **1 is the `run_pipeline` loop:** :388.
  - So "22 of its 23 `callTool` sites go through `parse()`" (proposal Impact) is false: the real count is 15. The
    figure came from the round-1 report ("The other 22 of 23 ... go through parse()"), and the revision copied it
    without re-counting.
  - :286 and :304 both call `add_outputs_from_shape`. Its handler starts with `api.expandPipelineShape(...)`
    (pipelinesHandlers.ts:229), an HTTP call that is subject to the general `/api` limiter. After this change, a
    31-58 s Retry-After there returns `isError` with `HelioRateLimitError ...`. `isErrorOf` passes, the text check
    fails, and verify exits non-zero with a misleading "expected the shape's own validation message verbatim"
    message. That is exactly the regression D7 says it exists to prevent ("shipping a fix that newly breaks it is not
    a fix"). D7 and task 2.3a only route "`parse()`'s call sites and the `run_pipeline` loop", so these sites are not
    covered.

### Verdict: REFUTE

The code plan is sound and round-1 CR2 is fixed. Round-1 CR1 was revised on a false site count, and that leaves a
concrete `npm run verify` regression path the design claims to close. The fix is cheap and confined to the artifacts.

### Change Requests

1. **Correct the verify.ts site accounting and widen D7's routing to every tool call that can hit the backend.**
   - proposal.md Impact: replace "22 of its 23 `callTool` sites go through `parse()`" with the real breakdown: 15
     `parse()`, 5 `textOf()` evidence prints, 2 negative assertions (:286, :304), and 1 run loop.
   - design.md D7 and tasks.md 2.3a: route all 23 `client.callTool` sites through the retrying helper, for example by
     replacing every `client.callTool(...)` with `callToolRetrying(client, ...)`. At minimum, name the two
     `add_outputs_from_shape` negative-assertion sites (:286, :304) explicitly. If the 5 `textOf()` sites are left out,
     say so and give the reason, since they would silently print a rate-limit error instead of real evidence.
   - Add an acceptance signal to 2.3a, for example: "`grep -c 'client.callTool(' scripts/verify.ts` equals the number
     of calls inside the helper itself".

### Non-blocking notes

- **Parser location.** `verify.ts` runs `main()` at module load (last lines). The D7 parser that task 1.3b unit-tests
  therefore has to live in an importable module, such as `verifyPayloads.ts` or a new `scripts/verifyRetry.ts`, not in
  `verify.ts`. `scripts/verifyPayloads.test.ts` shows the root jest config collects `helio-mcp/scripts/*.test.ts`.
- **Helper caps.** D7's "small attempt cap and total wall-clock cap" are unspecified. The executor should pick them and
  document them. The run loop already has `HISTORY_RUN_BUDGET_MS = 6 min`, which is a natural ceiling there.
- **"Roughly half" assumes a uniform distribution.** The fixed window starts at the key's first request, so a bursty
  caller exhausts its budget early and gets Retry-After values skewed high (more than 30 s). For verify-style bursts,
  the 31-58 s band is probably the common case, not half. This does not change the decision (AC pre-authorizes
  surfacing the error, and D7 absorbs it in verify), but the PR should not quote "half" as measured.
- **Spec wording.** The spec's Requirement says the message states "when to retry" unconditionally. On the no-header
  backoff path there is no server value (D3: "when known"), so the executor should word that case sensibly, for example
  "retry shortly".
- **Gates.** No `concertino.config.json` gate matches `helio-mcp/**`; the gates cover only `frontend/**` and
  `backend/**`. Task 3.1's explicit helio-mcp typecheck/lint/prettier/jest run is the only gate, so the evaluator must
  run it rather than relying on config gates.
