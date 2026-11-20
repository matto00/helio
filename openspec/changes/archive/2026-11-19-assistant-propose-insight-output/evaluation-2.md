## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 1788b013aba7251a6206e4060a507c4db73ee265. Diff base: dfb65eebb (resolved live). Cycle-2 delta: 3b3614e3d..1788b013a. The worktree was clean at review time.

### Phase 1: Spec Review — PASS
Issues: none. The cycle-2 delta changes four things and no behaviour:
- the fixed wait in the no-render spec;
- a shared message constant;
- the `OutputKind` comparison;
- the KeysDoc wording.

The cycle-1 Phase 1 findings still hold, and the standing constraints are honoured.

### Phase 2: Code Review — PASS

CR1 (the backfill-registration race) is resolved, and I verified it myself rather than relying on the executor's in-place run:
- `AssistantInsightNoRenderSpec.Wiring.awaitBackfills(expected)` now polls, with a 30 s bound, until `expected` backfill futures are registered. It asserts the count, then awaits them. The no-render assertions now run only after the backfill has really completed.
- **Delay probe:** in a fresh throwaway detached worktree at 1788b013a, since removed, I added a 300 ms delay to the `findById` future in `OutputService.backfillCreated`. The spec stayed green: 4 succeeded, 0 failed. In cycle 1 the same probe was red at `:82`. Log: `.concertino/scratch/HEL-1779/eval2-probe-delay.txt`.
- **Mutation M1:** in the same scratch worktree, with the delay reverted, I made `PipelineRunService.backfillOutputNode` also call `insightTrigger.afterRunSucceeded`. The spec went red with `2 was not equal to 1 (AssistantInsightNoRenderSpec.scala:89)`, so the guard still detects a render-on-backfill. Log: `.concertino/scratch/HEL-1779/eval2-probe-m1.txt`.

Applied suggestions:
- `InsightReadsCheck.NamesOtherOutputsMessage` produces exactly the text that was there before (the prefix plus `: ids`), so the existing message assertions are unaffected.
- `OutputKind.fromString(...).contains(OutputKind.Insight)` replaces the string compare.
- The KeysDoc clause now reads "creating the Output itself writes no render".

Gates (fresh runs at 1788b013a, in WORKTREE_PATH):
- `com.helio.services.*`: 2451 passed, 0 failed, 5 canceled. The 5 cancellations are the existing opt-in measurement tests.
- `infrastructure.*`, `domain.*`, `spark.*`, `eval.*`, `testkit.*`, `testsupport.*`: 4706 passed.
- `com.helio.api.routes.*`: 2200 passed (514 s).
- The rest of `com.helio.api.*` (protocols, http and the top-level api specs): 712 passed.
- Total: 10,069 backend tests, 0 failed. The api total matches cycle 1's 2912.
- `check:scala-quality` is clean. `check-schema-drift.mjs` exits 0. `format:check` is clean.

Logs: `.concertino/scratch/HEL-1779/eval2-{services,infra-domain,api-routes,api-rest}.txt`.

### Phase 3: UI Review — N/A
There is still no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: PASS

### Non-blocking Suggestions
- The executor ran its cycle-2 probe in place in the lane worktree; it restored the file and checked the diff. That is not a defect: HEAD is clean and my independent scratch-worktree probe confirms the result. Running such probes in a throwaway worktree instead keeps the delivery worktree out of the blast radius.
