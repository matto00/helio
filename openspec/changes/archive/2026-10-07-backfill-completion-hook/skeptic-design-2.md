## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 67c8ab22459fe64faa511ca507aba25436378f0d (the change dir is still untracked). Artifacts read: ticket.md, proposal.md, design.md, tasks.md, workflow-state.md, skeptic-design-1.md.

### What I verified (with evidence)

1. **All three round-1 change requests are addressed.**
   - CR1: design.md D3 "Fixture fact" now states the settled fact. On a bare `DatasetSource`, a backfill writes zero `node_snapshots` rows, so `materialized=false` and `items` is empty. It cites `overwriteRowsAction` and `materializedFor`. The wrong "may still flip to true (snapshot written with zero rows)" alternative has been removed.
   - CR2: design.md D2 now makes it a decision, in bold, that the **committed** never-run test seeds real rows via `DatasetRowsTestSupport.seedActionsFromRaw`, as in `OutputRoutesSpec.scala:732-738`, and never runs the pipeline. tasks.md 2.1 repeats this. The helper exists: `DatasetRowsTestSupport.scala:47`, `seedActionsFromRaw(dataSourceId, rawPayload, now)`.
   - CR3: tasks.md 3.1 no longer says "seed rows if needed". The mutation now has to run against the committed seeded test, fail specifically on `materialized`/`items`, and the old sleep-200 shape on the same fixture has to stay GREEN.
2. **With the seeded fixture, the D3 mutation produces an observable forbidden effect.** I traced this through the live code:
   - Mutation site: `PipelineRunService.scala:707-713`, `hasSucceededOnce.flatMap { case false => Future.successful(()) ... }`. Making the `false` arm call `evaluateNodeRowsForBackfill` after a delay bypasses the only never-run gate.
   - `evaluateNodeRowsForBackfill` (:727-784) does not depend on any run. It uses `findByIdShared`, then `resolveAllRootDataSourcesInternal` (:329-334, which reads only the pipeline roots and data sources), then `backend.execute` on the seeded dataset rows, then `persistBackfilledRows`, then `overwriteRows` with N>0 rows. A never-run pipeline therefore gets real `node_snapshots` rows written.
   - The read side is `OutputService.materializedFor` (:419-430). Unfiltered, `rawExists = paged.total > 0` is true, so `materialized=true` and `items` is non-empty. Both assertions of the negative test would fail.
   - Empirical corroboration that this exact path materializes items with this exact seeding: the positive HEL-947 test (:729-770) uses the same `seedActionsFromRaw` fixture. Its run writes no snapshot, because `onUnblockedRunSuccess` only writes `outputsByNodeKey.keySet ∩ nodeOutcomes.keySet` (:1414-1422) and no Output exists at that point. So the rows it asserts on (`materialized=true`, `items` non-empty) are produced by `evaluateNodeRowsForBackfill` itself. The never-run mutation reaches that same function; the only thing it skips is the run-history check.
   - The proposed delay (~1 s) is longer than the old 200 ms sleep plus the GET. So "old shape GREEN under mutation" is achievable, which proves the mutation lands in the late-effect gap.
3. **No race between the hook firing and the test reading it (D1), re-confirmed.** `triggerBackfill(output, user)` runs synchronously inside `insertInternal(...).map { ... }` at `OutputService.scala:146-147`, before `Right((output, config))`. On update, the call at :244 also runs before `findConfigById`. The Future is recorded before the HTTP response exists. The "fail if no Future recorded" guard (D2 step 2, tasks 3.2) is checked by its own mutation.
4. **The Future covers the whole chain.** `backfillOutputNode` (:703-720) is a single `flatMap` chain ending in `recoverWith`, with nothing detached. The D3 mutation chains its delay into the returned Future, so the await correctly waits for it.
5. **Call sites compile.** There are 7 `new OutputService(` sites in main+test. A trailing defaulted parameter placed before the implicit list keeps all of them source-compatible; task 1.1 re-verifies this by compiling.
6. **Scope and coverage.** AC1 (assert only after the hook fires) is covered by D2 steps 2-4 and task 2.1. AC2 (a late forbidden effect still turns the test red) is covered by D3 and task 3.1, and is now achievable per point 2. There is no API/schema change, so no contract delta is needed. `skip_specs` is justified. I found no placeholders or TBDs.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md ends with an empty "## Standing Constraints" heading. This is harmless.
- `NonFatal` is not yet imported in `OutputService.scala`. This is trivial.
- Under the mutation, the old-shape run leaves a delayed backfill still in flight after its assertion. That run is evidence-only and the mutation is reverted afterwards, so the committed suite is not affected.
- The seeded fixture inserts into `data_sources` through the superuser `db`, as the positive test does. Mirror that exactly, so the RLS app-pool role does not block the seed.
