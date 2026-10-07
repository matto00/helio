## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 67c8ab22459fe64faa511ca507aba25436378f0d (the change dir is still untracked). Artifacts read: ticket.md, proposal.md, design.md, tasks.md, workflow-state.md.

### What I verified (with evidence)

1. **Premise: the test and its sleep.** `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala:776-796` is the never-run test. It has `Thread.sleep(200)` at :785, then asserts `materialized=false` and empty `items`. Confirmed.
2. **Premise: the Future is discarded.** `OutputService.scala:61-66` `triggerBackfill` returns `Unit` and drops `backfillOutputNode`'s Future. `PipelineRunService` is `final class` (`PipelineRunService.scala:36`). Confirmed.
3. **No registration race (D1).** In `create`, `triggerBackfill(output, user)` runs synchronously inside the `.map` on `outputRepo.insertInternal(...)` (`OutputService.scala:141-150`), before that `.map` produces `Right((output, config))`. The route answers with `ServiceResponse.run(outputService.create(...))` (`OutputRoutes.scala:50`), so the HTTP response cannot exist before the observer has run. `update` behaves the same way: `triggerBackfill` at :244 runs synchronously inside the `flatMap` before `findConfigById`. The claim holds.
4. **The Future covers the whole chain.** `backfillOutputNode` (`PipelineRunService.scala:692-716`) is one `flatMap` chain: `listRows` → `latestSuccessfulCompletedAtInternal` → `evaluateNodeRowsForBackfill`. In both arms, `evaluateNodeRowsForBackfill` (:727-784) chains `backend.execute(...).flatMap(persistBackfilledRows(...))`. `persistBackfilledRows` chains `overwriteRows` → `listByPipelineInternal` → `Future.sequence(updateSchemaInternal...)`. I found no detached Future anywhere. The outer `recoverWith` makes it never fail. The claim holds. One caveat, out of scope: `listRows(...)` is called eagerly, so a synchronous throw there would escape the Future. That is how the code already behaves and does not affect this test.
5. **Call sites compile unchanged.** `grep "new OutputService("` gives 1 production site (`ApiRoutes.scala:481`) and 6 spec sites. All are positional/named prefixes of the current parameter list, so a trailing defaulted parameter before the implicit list breaks none of them. Confirmed by reading; to be re-confirmed by compile in 1.1.
6. **Would the planned late-backfill mutation be observable on `newSharedPipeline`'s fixture? No. That is the defect below.**
   - `newSharedPipeline()` (`OutputRoutesSpec.scala:189-199`) inserts a bare `DatasetSource` with no dataset rows. Compare the positive test, which explicitly seeds rows via `DatasetRowsTestSupport.seedActionsFromRaw` (:732-738).
   - With zero source rows, `backend.execute` returns zero rows. Even if it raised instead, `.recover` would log and no-op. `overwriteRowsAction` (`NodeSnapshotRepository.scala:123-154`) then runs the DELETE plus **zero** INSERTs, so no `node_snapshots` row is written.
   - `materializedFor` (`OutputService.scala:419-430`): unfiltered, `rawExists = paged.total > 0` is false. It then falls to `latestSuccessfulCompletedAtInternal`, which is `None` for a never-run pipeline. So `materialized = false` and `items` stays empty.
   - The only other side effect is `updateSchemaInternal` writing an empty schema, and the test does not assert schema.
   - **Result: on the current fixture, the D3 mutation produces no effect this test can observe, so the new test would stay GREEN under it.** The ticket's mutation AC ("if the forbidden effect happens late, the test still goes red") would be unmet.
   - design.md D3 also offers "materialized may still flip to true (snapshot written with zero rows)". That is factually wrong: zero rows writes no snapshot row, and `materialized` is derived from `total > 0` or a successful run.

### Verdict: REFUTE

The core design (D1 hook location, synchronous observer, D2 await-then-assert, fail-loud if no Future is recorded) is sound, and all three orchestrator claims I was asked to check hold. The plan is refuted on one point: D3 leaves the decisive question open as a runtime conditional ("executor must confirm ... and, if it does not, seed"), and ground truth already settles it. With the fixture as planned, the ticket's mutation AC cannot be met. As worded, the plan also lets the seeding live only in the uncommitted mutation run ("evidence, not committed"). That would leave a committed test that cannot catch the late-forbidden-backfill regression the ticket targets. This is a correctness gap in the plan, not a nit.

### Change Requests

1. **design.md D3, "Note" paragraph:** replace the hedged conditional with the determined fact. On `newSharedPipeline()`'s empty `DatasetSource`, a backfill writes zero `node_snapshots` rows, so `materialized` stays `false` and `items` stays empty (cite `NodeSnapshotRepository.overwriteRowsAction` and `OutputService.materializedFor`). Delete the incorrect "may still flip to true (snapshot written with zero rows)" alternative.
2. **design.md D2 + tasks.md 2.1:** make it a decision that the **committed** never-run test uses a source with real dataset rows, e.g. seed via `DatasetRowsTestSupport.seedActionsFromRaw` the way the positive HEL-947 test does at `OutputRoutesSpec.scala:732-738`, or with a small seeded variant of `newSharedPipeline`. Then a forbidden backfill would make `materialized=true` and `items` non-empty. State explicitly that this seeding is committed test code, not mutation-only scaffolding. The pipeline must still never be run, so the unmutated path stays a no-op.
3. **tasks.md 3.1:** drop "(seed rows if needed)". Require the mutation evidence to run against the committed, seeded test, and to show the observable forbidden effect under the mutation (new test RED on `materialized`/`items`, old sleep-200 test GREEN). Without that, RED-under-mutation could not be told apart from a failure for some unrelated reason.

### Non-blocking notes

- D1 says to wrap the observer in `try/catch NonFatal`. That is fine, and the D2 "no Future recorded" guard keeps a swallowed observer failure loud in the test. `NonFatal` is not yet imported in `OutputService.scala`. Trivial.
- The design caps scope correctly. It states that work `backfillOutputNode` detaches from its own Future is invisible to the hook. Point 4 above found no such detachment today.
- A 10 s named give-up deadline matches the spec's `await` helper and is consistent with the HEL-1341 C6/D9 naming convention already in the file (`BackfillMaterializedStateWaitDeadline`).
