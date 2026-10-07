## Context

See proposal.md (Why). `OutputService.triggerBackfill` calls `pipelineRunService.backfillOutputNode(...)`, which already returns a `Future[Unit]` that completes only after the whole backfill chain (snapshot existence check -> `latestSuccessfulCompletedAtInternal` -> optional evaluate+persist) has finished, and which never fails (`recoverWith` -> `()`). That Future is the natural completion signal; it is simply thrown away. `PipelineRunService` is `final` and the spec constructs it directly, so the test cannot intercept the call any other way.

## Goals / Non-Goals

**Goals:**
- The negative assertion in the never-run test runs strictly after the backfill started by that test's `POST` has completed.
- A late forbidden backfill (one that completes inside `backfillOutputNode`'s Future but after any fixed delay) turns the test red.

**Non-Goals:**
- Changing the positive HEL-947 backfill test (HEL-1341 already gave it a named state-wait deadline; it is a positive check, so polling is sound there).
- Making production await the backfill, or changing backfill semantics.
- Other wall-clock sites (HEL-1357 / HEL-1355).
- Catching work that `backfillOutputNode` itself detaches from its own returned Future (a mutation that spawns an un-chained Future). The hook observes exactly what `backfillOutputNode`'s contract says it covers; see Risks.

## Decisions

### D1: Hook lives on `OutputService`, as a defaulted constructor parameter

`backfillObserver: (OutputId, Future[Unit]) => Unit = OutputService.NoBackfillObserver` (a no-op). `triggerBackfill` captures the Future from `backfillOutputNode` and passes it, with `output.id`, to the observer. When `pipelineRunService` is null no backfill starts and the observer is not called.

- Why `OutputService` and not `PipelineRunService`: the Future is discarded in `OutputService`, and the Output id (the test's natural key) is known only there. `PipelineRunService.backfillOutputNode` is already observable (it returns its Future); nothing there needs to change.
- Why a constructor parameter, not a mutable listener/registry or a returned Future from `create`: it follows the file's existing optional-collaborator wiring pattern, cannot leak state between instances, and leaves `create`/`update` signatures (and therefore routes) untouched. Making `create` return the Future would change the route-facing API for a test concern.
- The observer is invoked synchronously inside `triggerBackfill`, i.e. before `create`'s Future completes and therefore before the HTTP response is produced. So by the time the test's `Post ... ~> check` returns, the Future for that Output id is already recorded -- no race between "response arrived" and "hook registered".
- An observer that throws must not fail `create`/`update`: wrap the call in `try/catch NonFatal` and log, mirroring the "never blocks or fails the caller" contract.

### D2: Spec records Futures per Output id; negative test awaits then asserts

**The committed never-run test seeds real dataset rows** into its source (via `DatasetRowsTestSupport.seedActionsFromRaw`, exactly as the positive HEL-947 test does at `OutputRoutesSpec.scala:732-738`), and creates its pipeline over that source **without ever running it**. This is committed test code, not mutation-only scaffolding: without rows, a forbidden backfill writes no snapshot and the negative assertion could not fail (see D3's fixture fact). The unmutated path is still a no-op because `latestSuccessfulCompletedAtInternal` is `None`.

The spec builds `OutputService` with an observer that puts each Future into a `TrieMap[OutputId, Future[Unit]]` (create and update can both fire for an id; keep the latest, and the never-run test only creates). The negative test:
1. Seed a dataset source with rows; create a pipeline over it (never run); `POST` creates the Output (captures id).
2. Looks up the recorded Future for that id -- fails the test loudly (`fail(...)`) if none was recorded, so a broken hook cannot make the test vacuous.
3. `Await.result(future, BackfillCompletionDeadline)` -- a named give-up bound (not a sleep; it returns the moment the backfill finishes).
4. Asserts `materialized=false` and empty items, as today.

`Thread.sleep(200)` is deleted.

### D3: Mutation proof

Executor records, in the evaluation evidence (not committed code), a temporary mutation of `backfillOutputNode`'s `hasSucceededOnce` branch so the `false` case also evaluates and persists rows, but only after a delay (e.g. `akka/pekko after(1.second)` or a `Future { Thread.sleep(1000) }.flatMap(...)` chained into the returned Future) -- the "forbidden effect happens late" case from the ticket. Required results with full logs:
- New test: RED under the mutation.
- Old test (sleep 200 ms) under the same mutation: GREEN -- proves the mutation actually exercises the late-effect gap the ticket describes, i.e. the mutation hits the right branch.
- Mutation reverted: new test GREEN.
Also verify the "no Future recorded" guard by mutating `triggerBackfill` to skip the observer: test must fail at step 2.

Fixture fact (verified, skeptic-design-1): on `newSharedPipeline()`'s bare `DatasetSource` (no dataset rows), a forbidden backfill evaluates zero rows, `NodeSnapshotRepository.overwriteRowsAction` runs the DELETE plus zero INSERTs, so no `node_snapshots` row is written; `OutputService.materializedFor` then derives `materialized=false` (`total > 0` false, and no successful run) and `items` stays empty. A forbidden backfill is therefore unobservable on that fixture -- which is why D2 seeds real rows in the committed test.

## Risks / Trade-offs

- [Work detached inside `backfillOutputNode` is invisible to the hook] -> Out of scope by design; the hook's guarantee is exactly `backfillOutputNode`'s returned-Future contract. Documented in the observer's scaladoc.
- [A production-code seam added only for tests] -> Defaulted no-op, one line at the call site, no behaviour change; same pattern as the file's other nullable-optional collaborators.
- [Give-up deadline too short under CI load] -> Use a generous named bound (10 s, matching the spec's own `await` helper); it is a give-up, not a pacing wait.

## Migration Plan

None. No schema or runtime behaviour change.
