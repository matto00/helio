## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 60fdb87ded6dd8d571767199b8d3fa05f6b093c7 (planning artifacts untracked in the change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/mcp-rate-limit-backoff-cap/HEL-1349`.

### What I verified (with evidence)

- **verify.ts call-site count, re-counted independently.** `grep -c "client.callTool(" helio-mcp/scripts/verify.ts` = 23.
  I classified every site from the source:
  - `parse()` (15): :123, :133, :142, :153, :184, :220, :239, :257, :262, :272, :323, :357, :382, :407, :418
  - `textOf()` print-only (5): :163, :173, :196, :210, :229
  - expected-error text checks (2): :286 (`missing required field 'n'`), :304 (`Unknown pipeline shape`)
  - `run_pipeline` loop (1): :388
  This matches proposal Impact and design D7 exactly. The round-2 CR1 is resolved. D7 routes all 23 through one helper
  with explicit bounds (3 re-calls, 180 s sleep per site, N+1 s per wait), and its done-check (`grep -c` == 1) can be
  checked mechanically.
- **Parser placement.** `verify.ts:434` calls `main()` at module load, so the separate importable
  `scripts/rateLimitRetry.ts` that D7 specifies is necessary and correct. `tsconfig.typecheck.json` includes
  `scripts/**/*.ts`, and the root jest `testMatch` collects `*.test.ts`. (`scripts/verifyPayloads.test.ts` already exists,
  which shows scripts tests are collected.)
- **Current httpClient behaviour matches the design's Context.** `MAX_RATE_LIMIT_RETRIES = 5` (:62),
  `BASE_BACKOFF_MS = 1000` (:64) and `MAX_BACKOFF_MS = 60_000` (:66). `retryDelayMs` clamps each wait with `Math.min`
  (:245), and nothing bounds the cumulative wait in `dispatch` (:185-232). `CHAT_LIMIT_REACHED` short-circuits at :206.
  The exhaustion path throws a plain `HelioApiError` (:225-226).
- **SDK claim.** The installed `@modelcontextprotocol/sdk` is 1.31.0. `dist/esm/shared/protocol.js:8` has
  `export const DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`, and :712 uses it as the default. The package `./*` export maps to
  `dist/esm/*`, so D4's import path `@modelcontextprotocol/sdk/shared/protocol.js` resolves. Existing tests already
  import the SDK subpaths the D5(b) seam test needs (`client/index.js`, `inMemory.js`; see `server.test.ts:25-26` and
  `tools/read.test.ts:10-11`).
- **D3 subclassing claim.** Every tool shell (`read.ts`, `placements.ts`, `combinedProposal.ts`, `pipelines.ts`,
  `outputs.ts`, `refinement.ts`, `proposal.ts`, `connectorHandlers.ts`, `outputControls.ts`) formats a caught error as
  `err instanceof HelioApiError ? \`${err.name} (status ...) for ${err.url}: ${err.message}\``. A subclass therefore
  flows through without any edits to the tool files. The `isError` text will start with `HelioRateLimitError`, which is
  what D7's parser keys on.
- **Arithmetic.**
  - D6a: the no-header backoff spends 1+2+4+8 = 15 s, and the next 16 s wait would bring the total to 31 s, which
    exceeds the 30 s budget. The planned schedule of 4 sleeps is correct.
  - Existing tests stay valid under the budget: :105 (six `retry-after: 1`) waits 5 s in total and then exhausts, and
    :160-185 wait 2 s and 3+3 s. D6 lists the two tests that must change (:83 absurd Retry-After, and :105's error
    type).
  - D5(a) is red before the fix: the old code sleeps 59000 and returns the 200.
- **AC coverage.**
  - AC1 (bounded backoff and/or structured error) is covered by D1, D2 and D3 and by tasks 2.1 and 2.2.
  - AC2 (red-first test with a mocked long Retry-After) is covered by D5 and tasks 1.1-1.3, with C1 binding the red
    capture.
  - AC3 (check against SDK >= 1.31.0) is covered by D4 and task 1.4, a permanent guard test.
  - Non-scope (the five `verify:isolated` items) is explicit and handed back as a follow-up.
- **Internal consistency.** Proposal, design, tasks and spec agree on:
  - the 30 s budget
  - no partial sleep
  - `retryAfterSeconds` being undefined on the backoff path
  - the no-retry-after message wording (the spec now covers the "otherwise that no retry-after was given" case)
  - the `CHAT_LIMIT_REACHED` path being unchanged
  I found no placeholders or TBDs. No API or schema contract changes, so no delta is required.

### Verdict: CONFIRM

### Non-blocking notes

- **verify.ts :388 run loop and its existing deadline.** Once :388 is wrapped, the helper can sleep up to 180 s inside
  one iteration. The loop's `HISTORY_RUN_BUDGET_MS` (6 min) is only checked before its own 15 s sleep, so the run can
  overshoot the deadline by up to one helper cycle before it fails. This is harmless: it fails loudly and later. The
  executor may still want the helper's sleep to make the loop's own 15 s fallback mostly dead code, and should note
  that in a comment.
- **D5(b) real-time cost.** With the default 60 s timeout and real timers, the RED run of the seam test takes about
  60 s. The documented fallback (a sleep that never resolves plus an explicit short `{ timeout }`) is acceptable only
  if the PR states that the substitution was made. With an explicit timeout, the test no longer proves the default
  timeout. The unit-level D4 guard covers that link.
- **Gates.** No config gate matches `helio-mcp/**`. The evaluator must actually run task 3.1 (helio-mcp typecheck,
  lint, prettier and jest) rather than rely on configured gates. Round 2 also raised this.
