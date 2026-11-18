## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d22f21d0a4ded9b1570f96178e849209a50c1ceb` against live-resolved base `ff667dd571ce2f86ba3298c2f742f1f08c138c22`.

### Phase 1: Spec Review — FAIL

The core implementation matches the ticket, design D1-D7 and the spec delta:
- Cancel, write-during-run and failure-path cases each have a backend test in `RunCancelsPendingAutoRunSpec`. Red evidence is recorded in `.concertino/scratch/HEL-1739/mutations.md` (M1 cancel removed = base, M2 generation ignored, M3 snapshot-then-delete at start, M5/M6 generation/ABA). The spec delta is present. `cancelPendingAutoRun` is removed. All decisions are DB statements: snapshot read, then compare-and-delete on a sequence token (multi-instance safe).
- The snapshot is taken in `PipelineRunExecutor.executeRun`, before admission and outside the admission transaction. `submit` and the HEL-505 guards are untouched, and so are the HEL-1504 firer mechanics.
- Wiring checked: `Main.scala:150` builds `autoRunDebounceRepo`, passes it to `ApiRoutes` (`Main.scala:275`), and from there it goes to `PipelineRunService` (`ApiRoutes.scala:511`, a constructor param, so there is no forward-reference null).
- The e2e workaround removal holds: `PUT /rows` → `DataSourceService.replaceRows` uses `triggerAutoRunAwaited`. The debounce upsert has therefore committed before the PUT returns, and the next synchronous `runPipeline` snapshots it.

Issues:
1. **Task 3.2 is marked `[x]` but was not done, and the comment it names is now false.** In `e2e/hel1392-remount-staleness.spec.ts`, step 3 (lines ~179-187) does an out-of-band `POST /rows` and then an in-app **successful** "Run pipeline". Under this change, that run cancels the auto-run the write armed. The comment at lines 207-209 still says "The out-of-band source write also queues a server-side auto-run (debounce + scheduler tick, up to ~35s) whose succeeded event legitimately invalidates the pipeline once". That auto-run no longer fires (except for the documented post-terminal-window race). The task was conditional ("if the behaviour changed it"), the behaviour did change, and the file is untouched.
2. **Task 4.7 is unchecked.** The `sbt testFull` half is now independently evidenced (see Phase 2). The hel1277 e2e half was not run. Either run it against a lane-private DB, or amend the task to say it was not run and why. Do not leave the task list inconsistent with what was done.

### Phase 2: Code Review — PASS

Gates (fresh, run by the evaluator in WORKTREE_PATH):
- `sbt -J-Xmx3g testFull` (nice 19): `Tests: succeeded 9702, failed 0, canceled 5` (the 5 cancels are the pre-existing HELIO_MEASURE/heap report-only tests), `All tests passed.`, exit 0. `RunCancelsPendingAutoRunSpec` 11/11 and `AutoRunDebounceWriteGenerationGrantsSpec` 3/3 pass. The existing HEL-1093/1504 suites also pass: `DatasetWriteAutoRun*`, `AutoRunGuard*`, `PipelineAutoRunDebounceRepositorySpec`, `AutoRunTriggerServiceSpec`. Output: `.concertino/scratch/HEL-1739/eval-testFull.out`.
- `npm run lint`: exit 0. `npm run format:check`: exit 0 (this also covers the prettier re-flow of the CLAUDE.md table). `npm run check:scala-quality`: clean (soft warnings only, all pre-existing).
- No `frontend/**` files changed, so jest and the frontend build were not required.

The code is sound:
- The upsert's `EXCLUDED.write_generation` draws a fresh `nextval` on both the insert and the conflict path (asserted in a test).
- `unclaim`/`rearm` leave the generation alone (asserted).
- The cancel is sequenced inside the winning `succeeded` terminal write and before publish, and is included in the `deletedRecovery` siblings.
- The grant is proven NOSUPERUSER via revoke-and-replay of V144's own GRANT (C15).

Non-blocking notes are listed below.

### Phase 3: UI Review — N/A

There are no `frontend/**`, `schemas/**` or `openspec/specs/**` changes. The only `ApiRoutes.scala` change is constructor wiring, with no route or contract change. The e2e edits only remove a test helper.

### Overall: FAIL

### Change Requests
1. `e2e/hel1392-remount-staleness.spec.ts:207-209`: rewrite the comment so it matches the new behaviour. The in-app run in step 3 succeeds after the out-of-band write, so it cancels that write's pending auto-run (HEL-1739). Say what, if anything, the 4-attempt reuse loop still guards against, for example the rare post-terminal-window redundant auto-run in design.md Risks. Keep or simplify the loop as you judge, but the comment must not claim an auto-run that no longer fires. Task 3.2 stays `[x]` only once this is done.
2. `openspec/changes/run-cancels-pending-autorun/tasks.md` 4.7: make the task truthful. Either run `e2e/hel1277-output-history-scrubber.spec.ts` against a lane-private `helio_hel1739` DB and record the result, then check the task. Or split or annotate the task so it states that the backend suites and `sbt testFull` passed and that the e2e run was not done, with the reason. The removed helper's assertion is now covered by `RunCancelsPendingAutoRunSpec` "remove the pending auto-run armed by a write before it", plus the awaited upsert in `replaceRows`.

### Non-blocking Suggestions
- `PipelineRunSucceededWrites.scala` cancel `.recover { case ex => ... }` catches everything. Use `case NonFatal(ex)` to match the executor's snapshot recover.
- `mutations.md` lists M2/M4/M5 results without saying what each mutation changed (only M1/M3/M6 are described in the Notes). Add one line each so the red evidence can be read on its own.
- In the spec delta, the MODIFIED requirement's first scenario ("A write lands while the pipeline's run is in flight") now holds only for a write after that run's admission snapshot. Consider saying so in its WHEN clause.
