## 1. Production completion hook

- [x] 1.1 Add the defaulted no-op `backfillObserver: (OutputId, Future[Unit]) => Unit` parameter to `OutputService` (design D1), forward `backfillOutputNode`'s Future and the Output id from `triggerBackfill`, guard the observer call with `NonFatal` + log; verify `ApiRoutes` and every other `new OutputService(` call site still compiles unchanged (`sbt compile` / `Test/compile`).

## 2. Spec uses the hook

- [x] 2.1 Wire a `TrieMap`-recording observer into `OutputRoutesSpec`'s `OutputService` fixture, and rewrite the never-run negative test per design D2 (committed fixture seeds real dataset rows into the never-run pipeline's source via `DatasetRowsTestSupport.seedActionsFromRaw`; fail loudly if no Future recorded, await with a named deadline, then assert; remove `Thread.sleep(200)`); verify `sbt "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec"` passes.

## 3. Mutation proof (evidence, not committed)

- [x] 3.1 Apply the late-forbidden-backfill mutation from design D3 against the committed, seeded test; record full logs showing the new test RED specifically on the `materialized`/`items` assertion (the observable forbidden effect), the old sleep-200 assertion shape (same seeded fixture, sleep instead of await) GREEN under the same mutation, then the new test GREEN once reverted.
- [x] 3.2 Mutate `triggerBackfill` to skip the observer; record the new test failing on the "no backfill Future recorded" guard. Revert.

## 4. Gates

- [x] 4.1 Run the backend gates the pre-commit hook runs plus `sbt testFull` scoped as the executor's gate-selection requires; all green.

## Standing Constraints
