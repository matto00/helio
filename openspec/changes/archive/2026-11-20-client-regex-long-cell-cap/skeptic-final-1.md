## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: e876c4c07ee9a49a4cd5924bc5f37d4c7a68b617. Base resolved live with resolve-review-base.sh: 16a6042d6 (three-dot diff).

### What I verified (with evidence)

**Acceptance criteria**
- AC1, item 1 decided and implemented: met. D1 adds a deterministic predicted-work decline. `StepHandler.declinesInput` is called in
  evaluateStep.ts:66-67 after `problems` and before `apply`. stringOps.ts `regexStepWork` and `declinesInput` sum `cellWork`
  (regexInputCost.ts:31-52) with an early exit, and a step over the budget declines as `regexInputCost`. The draft-preview
  routing keys on node status (draftEvaluation.ts:118), so an input-level decline reaches the server. I saw this live: a
  draft-preview POST was made in every run.
- AC1, red-first long-task probe: met. In `git log 16a6042d6..HEAD`, 17919c4d7 ("Red: ...") comes before the first
  implementation commit bd10d1767, and its diff touches only e2e/hel1683-regex-main-thread.spec.ts. The red premise holds:
  V8 runs `(a*)b` over 400 x 3,000 cells in 1,816 ms in node (red-run.md reports 3,816 ms in the browser). The AC names
  the long-task probe, and the probe was committed red on its own. The Jest decision tests were committed with the
  implementation because the pre-commit hook runs the full suite. That is acceptable: their redness is covered by
  red-run.md and by 12 recorded mutations, two of which the evaluator reproduced.
- AC2, item 3: met. javaRegex.ts is 203 lines and javaRegexClass.ts is 129. The allowlist ids moved with
  ESCAPED_META/SIMPLE_ESCAPES.
- AC2, item 4: met, checked in the diff. The stale "~165 ms per cell" text is gone. The overrun locator is
  `.filter({ hasText: OVERRUN_PATTERN })`. The live branch asserts both `out` cells are `—`.
- AC3: met. `git diff 16a6042d6...HEAD --stat -- shared-test-fixtures` is empty.

**Gates (my own runs)**
- `nice -n 19 npx jest --maxWorkers=3 src/features/pipelines/evaluator src/shared/session`: 17 suites, 940 tests passed.
  This includes the parity corpus test.
- typecheck: clean. eslint `--max-warnings 0` on the evaluator directory and the e2e spec: clean.
- e2e/hel1683-regex-main-thread.spec.ts, full file, 2 runs: 2/2 passed both times, against fresh lane servers (helio_hel1697,
  ANTHROPIC_API_KEY empty). Long-cell probe longest task: 0.0 ms in the first run, 60.0 ms in the second. Server outcome
  both times: time-budget error.

**The `REGEX_WORK_BUDGET = 4.00e6` pin**
- The pin is deterministic. For `(\d+)`, A=1, W=max(1, min 1)=1, m=0 (no item after the wide atom) and f=1 (one range).
  Per 2,000-digit cell that gives 1·(2000 + 2000·1·1) = 4,000, so 4,000,000 in total. This is exact integer arithmetic
  well below 2^53, and the decision is `cost > budget`, so the frame stays client-side.
- The pin is intended. Design addendum 4 says to pin at 4.00e6 if the derivation falls below it, and the derivation
  gave 3.99e6 (calibration "Derivation and pin").
- Zero margin means any model change that adds a unit flips the scenario. The `(a+)`/`(\d+)` "exactly at the budget"
  test is the guard for that, which is correct.

**Question (b): the cause of the 56-73 ms long task.** The evaluator said it was "not code this diff touches". That is wrong.
- Scripts are in /home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic-final/:
  - trace.cjs: CDP trace.
  - profile.cjs: CPU profile of the longest busy segment after the fill.
  - browserscan.cjs and scan.cjs: scan timing.
- What the long task is. The trace shows one `RunTask` of 40-72 ms on each fill that is `EventDispatch` ->
  `dispatchDiscreteEvent` (react-dom). It is the synchronous React input handler, not the server response and not GC.
  Measured over 6 pages: 72.2, 69.5, 40.2, 0, 0, 0 ms.
- What is inside it. Self time in the longest busy segment, over 3 pages (segments 58 / 71 / 91 ms; the observer reported
  57 / 56 / 74 ms):

  | Component | Self time (ms) |
  |---|---|
  | `cellWork@regexInputCost.ts` | 14.2 / 14.2 / 18.7 |
  | `useScrollEdges.ts:31` | 13.7 / 13.4 / 18.1 |
  | `jsxDEV` (dev-build render) | 11.6 / 13.2 / 17.1 |
  | `RegExp: (x)` | ~1.2 |

- Why `cellWork` runs at all. `(a*)b` exits after its first cell (0.0 ms in browserscan), so the `cellWork` time is the
  same input handler re-walking the saved `(x)` step. `(x)` is under the budget, so the new O(len) run scan reads all
  1.2 M characters of the 400 x 3,000 frame, about 12x the cost of the regex itself (RegExp (x) ~1.2 ms).
- Why cycle 1 measured 0.0 ms. Cycle 1's per-cell cost was a closed-form function of `len` with no scan. The cycle-2 run
  scan adds about 14-19 ms in situ (about 6 ms warm, browserscan.cjs) to a dev-build render of about 25-35 ms. That
  pushes the handler across the 50 ms long-task threshold about half the time, which is why the readings are bimodal
  (0 or 52-78 ms).
- Client-side `(a+)` on the same frame shows the same pattern: 62 / 78 ms tasks, with `cellWork` taking 21.6 / 22.9 ms.
- Is the probe CI-stable? Not by the design's own standard. Observed long tasks across the evaluator's runs, my runs and
  the trace/profile scripts: 52, 56, 57, 60, 62, 64, 69, 72, 73, 74, 78 ms, against a 100 ms bound. That is 1.28-1.9x
  headroom.
  - Design D1 says the margins are meant to hold "on a slower CI runner (2-3x)".
  - CI runs this spec in the `dev` project (playwright.config.ts:188; ci.yml runs the glob through e2e-shard.mjs), so
    CI pays the same jsxDEV cost.
  - By that 2-3x factor, 78 ms local becomes 156-234 ms on CI. A new timing-only flake is likely, and on this machine
    the local gates cannot see it.
- The decision scan has a cost the calibration never measured. Calibration timed only `RegExp.exec`.
  - Worst case at the budget is a frame whose characters are mostly outside U, at about 1 unit per character: about 4 M
    characters scanned.
  - Measured: `(x)` over 1,000 x 4,000 scans in 20-22 ms (node and the dev-build browser), next to a 1.4 ms regex.
  - Where the regex itself is near 20 ms, units per character are high and the scan is short. So the combined step time
    stays about 25 ms or less, under C1's 50 ms. It is still a constant-factor cost of the change that is not recorded
    anywhere.

**Other checks (no defect)**
- The pattern has no inline flags. `(?` is declined at javaRegex.ts:120, and the RegExp is always `"u"` with no `i`.
  So the union set U cannot be undercounted through case folding.
- Groups cannot be quantified: a quantifier after `)` declines because `last !== "atom"`.
- The `cellWork` upper-bound reasoning (runs never charged more than the whole cell) holds by inspection.
- Cleanup: I deleted the one user I registered, by exact id via buildUserDeleteSql. The lane DB holds only
  system@helio.internal. Servers were stopped with stop-servers.sh.

**Gate defect check (CON-160):** no evidence directory in this run discloses unsound mtimes, and no claim here rests on
mtime ordering. The red-first ordering rests on the git commit DAG.

### Verdict: REFUTE

### Change Requests
1. **The long-cell e2e probe lacks CI headroom, and the cause is this change's decision scan.**
   - Location: e2e/hel1683-regex-main-thread.spec.ts, test at line 220; regexInputCost.ts:31-52, called from
     stringOps.ts `regexStepWork`.
   - Problem: the probe's longest task is 52-78 ms against a 100 ms bound in the dev project that CI runs. That is under
     the 2-3x CI headroom design D1 claims. About 14-23 ms of that task is `cellWork` scanning a frame whose step is far
     under the budget.
   - Fix: restore at least 2x headroom, shown by at least 5 recorded probe runs whose longest task is at most 50 ms,
     using either or both of these:
     - (a) A decision-preserving fast path. Before scanning, sum the closed-form whole-cell upper bound
       `f·(A·L + L·A·min(L, W) + m·L²)`, with `L` = `LONE_SURROGATE_UNITS` x the UTF-16 length so lone surrogates stay
       bounded. Run the per-character scan only if that bound exceeds the budget. It is an upper bound on the run-based
       cost, so no decision changes and no test expectation changes, and there is no design change (C2). It must be
       red-tested: with the fast path wrongly bypassing the scan, one over-budget frame must still decline. For the
       probe's saved `(x)` step the bound is 2.4e6, so the scan disappears from the input handler.
     - (b) A smaller probe frame that still produces at least a 10x red on the unmodified tree (design D4), for example
       about 150 x 3,000 cells.
   - Do not raise `LONG_TASK_BOUND_MS`.
2. **Record the decision-scan cost as C1 accepted risk.** Add it to regex-work-calibration.md and the PR body: about
   20-22 ms worst case at the budget for low-unit-per-character frames (`(x)` over 1,000 x 4,000, measured with the
   skeptic-final scripts), with combined step time about 25 ms or less. If CR1(a) ships, record the residual (the scan
   now runs only when the upper bound exceeds the budget).

### Non-blocking notes
- Question (a): the red-first story is acceptable. The AC's "red-first long-task probe" is the e2e probe, which was
  committed red on its own (17919c4d7). The Jest red runs are documented, and the mutations corroborate them.
- Also add evaluation-2's `(.{8})(.{8})x` on Cyrillic (23.5 ms at 4.00e6) to the PR's C1 list, as that report suggested.
- The re-walk of the saved `(x)` step inside the input handler, and the dev-build render cost of a 1.2 MB preview table
  (`useScrollEdges.ts:31`, about 13-18 ms), are pre-existing. They are follow-up candidates, not defects of this change.
