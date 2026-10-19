## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `1efc6e521941418e43d688535eaaec2101a25625` (on `6c4a2c8a9`). The base `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` was
resolved live. The worktree was clean at the start and at the end (`git status --short` was empty).

My evidence is persisted under `E = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/scratch/HEL-1630/eval3/`.
Each probe and mutation file was added or edited by `run.py` (in `E`), which refuses an ambiguous match. Afterwards it removed or restored
the file byte for byte (checked by sha256; the engine sha `dc0a37ae…` was verified after each run).

**C6 is verified.** In `events.jsonl`, line 43 is `escalation.raised` with id `HEL-1630-1792302936622-e05911`. Line 44 is an
`answer_discarded` 31 ms after the raise, a stale answer and not the owner's. Line 45 is `escalation.answered` with `answer: structural-bound`
and `answer_source: human`; line 46 is the dashboard copy.

### Phase 1: Spec Review — FAIL

What holds:
- **evaluation-2 CR1 (a) and (d), as specified.** The cycle-3 code does the following:
  - The draft walk is leaf-first (`InProcessPipelineEngine.scala:521-523`).
  - A live-cell budget of 1,800,000 is checked after each node (`:566-571`). A node over it becomes that step's `error`, with the
    memory-limit message, and its dependents are pruned.
  - The heap spec measures four shapes at every node boundary and asserts that the max is at most 96 MB and that the formula gives 2.
  - My own `testFull` reproduces the numbers: chain 74.2, comb 53.5 (49 of 49 steps, no error), lane-held 50.2, select-held 83.7. The
    max is 83.7, and `floor(192 / 83.7) = 2`.
  - The cycle-2 "82.3 MB worst case / release cannot go lower" statements are corrected in design.md, `DraftPreviewConfig.scala:16-22` and
    `CLAUDE.md:71`.
- **CR2 is fixed.** The report is written only when `HELIO_HEAP_EVIDENCE_PATH` is set, and only after every assertion has passed
  (`DraftPreviewHeapSpec.scala:170-175`). My full run and my five sbt runs did not touch `heap-measurement.txt`: its mtime is still 23:08
  (the executor's run), sha `e889b4be…`, and its chain figure is 76.1 while my run measured 74.2.
- **CR3 is fixed.** `DraftPreviewRoutes.scala:69` is indented.
- **Runs and the saved preview are unchanged, by code.** `maxLiveCells` is set only by `DraftPreviewStandIns.scala:43`. Every new branch
  in the engine is gated on `ctx.maxLiveCells.isDefined` or on `retainOnly`. Moving `releaseConsumed` after `onNodeFrame` does nothing when
  `retainOnly = None`. See the non-blocking note on M3: no test pins the walk-order part of this.
- **C1-C5 hold, with no regression from cycles 1-2.** The full suite is green, including the cycle-2 admission, reading-pool, abort and
  RLS specs.
- **The trade-off for real drafts is acceptable.** The client sends samples of at most 1,000 rows, so a realistic draft (1,000 x 50 x 50
  steps) uses about 100k cells. The spec shows it runs even at a tenth of the budget. Hitting the budget needs a join fan-out to around
  20,000 rows with about 42 or more columns. Even then the result is an actionable step `error` ("Reduce the rows or columns, or end the
  branch earlier") in the preview only, not a run failure.

What fails:

1. **Spec divergence from C6: the bound is not structural. It holds for the shapes measured, not for one request within the caps.**
   - C6's text is: "live-cell budget so one request stays <= 96 MB … keeps C5 accept-2 as a guarantee".
   - The cell budget counts rows x columns. It has no measure of how large a cell is, and `compute` (`concat`, `upper`, …) can create a
     fresh string per row per step, as large as its inputs.
   - My probe uses the heap spec's own method (gc x2 at every node boundary, 3 runs, body at the 4 MiB cap, production engine and budget).
     Source: `E/EvalTmpCellSizeHeapSpec.scala`. Log: `E/probe-cellsize-heap.log`.

   | Shape | Steps | Budget fired? | Peak per run (MB) | `floor(192 / max)` |
   |---|---|---|---|---|
   | Fresh-string chain: lane join to 20,000 rows, then 49 steps of `concat($pad, $i)` (pad is 331 chars) | 42 step lines | Yes, at step 42, as designed | 354.0 / 350.8 / 350.8 | 0 |
   | Doubling: lane join, then `d1 = concat($pad, $pad)` and `dN = concat($d(N-1), $d(N-1))`, 5 steps | 6 steps | No (about 9 cells per row, about 20 % of the budget) | 421.9 / 418.4 / 418.9 | 0 |

   - **One request can exhaust a heap the size of production's.** I ran the same doubling shape with 6 steps:
     - In a forked test JVM capped at 768 MB (`HELIO_TEST_JVM_XMX=768m`, `maxMemory MB 768`, the prod heap size), `d6` fails as
       `{"message":"step execution failed"}` (`E/probe-doubling6-prodheap.log:249`).
     - The control at 3 GB completes all 7 steps with no error (`E/probe-doubling6-3g.log:247`). So the 768 MB failure is heap exhaustion.
     - It surfaces as a step error only because the engine's existing `catch { case ex: Throwable => Future.failed(ex) }`
       (`InProcessPipelineEngine.scala:297`, already on base) swallows the `OutOfMemoryError`.
     - In production, every other request on the instance shares that exhausted heap during the window. A 7th doubling step would need
       about 1.9 GB inside one node.
     - The post-node check cannot catch this, because the node has already allocated its frame by the time the check runs.
   - This makes three current statements false, the same kind of finding as evaluation-2 CR1:
     - design.md: "the per-request bound is structural, not a property of one shape", and "[the figures] exclude a step's internal
       working set, which `maxNodeRows` bounds". `maxNodeRows` bounds rows, not bytes.
     - `DraftPreviewConfig.scala:19-20`: "The bound is structural".
     - `DraftPreviewHeapSpec.scala:22-24`: "the per-request bound is structural … not a property of one lucky shape".
   - The new spec requirement "A request's live memory is bounded" (spec.md) is met only literally, because its SHALL defines the
     budget as a cell count.
   - **Context.** The escalation the owner answered noted that "repeated string concatenation in compute can also grow cells without
     bound, in runs too" as a note for the run-path follow-up HEL-1660. It did not say that this breaks the draft endpoint's own C6
     bound by 4x at 5 steps, or that it exhausts a prod-sized heap at 6 steps. So I do not treat the owner's ruling as having accepted
     this gap.

### Phase 2: Code Review — FAIL (finding 1 above; the gates are green)

Gates, run fresh by me in `WORKTREE_PATH` at `1efc6e521`:
- `sbt testFull` (flock, nice 19, `-Xmx3g`): 9287 succeeded, 0 failed, 4 canceled (the existing `HELIO_MEASURE` specs). "All tests
  passed." Log: `E/gate-sbt-testFull.log`.
- `npm run lint`, `format:check`, `typecheck`, `check:scala-quality`, `check:openspec`, `check:spec-structure` and `check:schemas` all
  exit 0.
- `npm test` (2 workers): root 61/61 suites and 524 tests; frontend 730/730 suites and 9124 tests (`E/gate-npm-test.log`).
- `npm --prefix frontend run build`: exit 0.

My mutation spot-checks (C3):
- **M1 (new): released frames are never removed from the cell tally** (the `cellsOf.filterInPlace` line is deleted). The heap spec fails
  with "10 was not greater than or equal to 40" (`:166`), and the realistic-draft spec errors at `p2` (`:201`). Red:
  `E/red-eval3-m1.log`.
- **M2 (new): `countCells` counts rows instead of cells.** The heap spec fails with "111.1 was not <= 96.0" (`:169`), and the budget-trip
  spec fails with "Vector() was not equal to Vector("s0")" (`:186`). Red: `E/red-eval3-m2.log`.
- **M3 (new): the leaf-first order also applies to runs and the saved preview** (`if (ctx.maxLiveCells.isDefined)` becomes `if (true)`).
  **It survived.** `com.helio.domain.engine.*`, `api.routes.pipelines.*` and `services.pipelines.*` all passed: 3525 succeeded, 0 failed
  (`E/red-eval3-m3.log`). This is non-blocking, because a run's per-node outputs do not depend on order. Only the progress-event order and
  which error a fail-fast run reports first can change. Still, nothing guards the "runs keep `structuralRank`" claim.
- **Executor red logs.** `red-c6-budget-check-removed` (111.3 MB > 96, plus the trip spec), `red-c6-old-walk-order` (comb 18 != 49) and
  `red-c6-frame-release-disabled` (chain 10 < 40, plus the realistic spec) each fail for the reason given in the README.

Code quality: no CONTRIBUTING [mechanical] violations in the cycle-3 diff. `MemoryLimitMessage` is a `def` with an upper-case name; that
is a style nit, non-blocking. The only Phase 2 finding is finding 1.

### Phase 3: UI Review — N/A

No UI is wired by this change (HEL-1631 does that). Cycle 3 has no frontend diff, and the jest suite and the build are green.

### Overall: FAIL

### Change Requests
1. **Make the per-request bound hold for cell size, not only for cell count, or have the owner explicitly accept the gap.** Files:
   `InProcessPipelineEngine.scala` `countCells`/`memoryViolation`, `DraftPreviewHeapSpec`, design.md D7, `DraftPreviewConfig.scala:16-22`,
   `CLAUDE.md:71`.
   - (a) **Budget by weight.** Weight a `String` cell by its length in `countCells` (for example `1 + s.length / B`, with B taken from the
     measured bytes per cell, about 46 for the boxed-number shapes). This makes the fresh-string chain trip the budget, and it must be
     re-measured.
   - (b) **Bound a single node's working set while it emits, in drafts only.** The doubling shape exhausts the heap inside one node, before
     any post-node check. One option is a cap on the length of a string that a draft `compute`/`stringops` can create, as a step `error`.
     Another is a while-emitting byte check, as `RowBudget` already does for rows.
   - (c) **Prove it.** Add the fresh-string chain and the doubling shapes (the sources are in `E/`) to `DraftPreviewHeapSpec`'s max. Show
     each red against the current code and green after the fix.
   - (d) Whatever is decided, correct the three "structural" statements listed in Phase 1, and the claim that `maxNodeRows` bounds a
     step's internal working set.

### Critical Path (final cycle, `EXECUTION_CYCLES` = 3)
- The one blocking issue is CR1. Everything else that evaluation-2 asked for is done and green: the comb is fixed, the evidence file is
  CI-safe and the indentation is fixed. C1-C6 hold as written, and runs and the saved preview are unchanged.
- **Recommendation for the human: decide whether CR1 belongs in HEL-1630 or in HEL-1660.**
  - **In HEL-1630:** a draft-only cap on string length or bytes (CR1 a-b) is small and local. Without it, C6's "<= 96 MB, accept-2 as a
    guarantee" is false, and one editor's request can exhaust a prod instance's heap.
  - **Deferred to HEL-1660:** C6 should be amended to "bounded in cells", the "structural" wording corrected (CR1 d), and HEL-1660 told
    that the draft endpoint shares the gap, with these probe numbers.
  - The run path has the same exposure: it already did before this branch, and the base's catch-all `Throwable` hides the OOM there too.
  - My recommendation is the draft-only cap in HEL-1630. This endpoint is driven at drag frequency (120 requests a minute per principal),
    so it exposes the gap far more cheaply than a run, which is behind the HEL-505 guard.

### Non-blocking Suggestions
- Pin the "runs keep `structuralRank` order" claim with a test that M3 would fail. For example, a fail-fast branching run whose
  first-reported error, or whose progress order, depends on the walk order.
- Pre-existing, for HEL-1660: `InProcessPipelineEngine.scala:297` catches `Throwable`, so an `OutOfMemoryError` becomes a "step execution
  failed" step error, and the JVM carries on with whatever else failed during the exhausted window. Consider `NonFatal` there.
- The suggestions carried over from evaluation-2 are still open (`DraftPreviewAdmissionSpec` latch in a `finally`; `parentFrame`'s silent
  fallback; rejecting a stream with no terminal line).
