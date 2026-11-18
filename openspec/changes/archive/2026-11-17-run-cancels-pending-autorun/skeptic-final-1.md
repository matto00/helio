## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b48ca69e101da52ef1805aa471615fc96f18927a`. Review base resolved live with `resolve-review-base.sh`: `ff667dd571ce2f86ba3298c2f742f1f08c138c22`, which equals `git merge-base HEAD origin/main`. origin/main has since gained fd7090bf6 (HEL-1740). It adds V141 only and touches none of this change's files.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/run-cancels-pending-autorun/HEL-1739`.
- **Diff scope** (`git diff --stat BASE...HEAD`): V144 migration, the debounce repository, `PipelineRunExecutor`, `PipelineRunSucceededWrites`, the `PipelineRunService` constructor, `ApiRoutes` wiring, 2 new specs, 3 e2e files, change artifacts and CLAUDE.md.
  - The CLAUDE.md diff is a Prettier re-wrap of the env table. A word-diff shows a single content change: the `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` row now describes the cancel, and the description is accurate.
  - `submit` and the admission transaction are untouched. The `PipelineRunService` diff is constructor-only, which honours the HEL-1734 constraint.
- **Production wiring is real, not null.** `Main.scala:150` builds one `PipelineAutoRunDebounceRepository`.
  - It is passed to `ApiRoutes` (:275), and `ApiRoutes.scala:511` hands it to the single `PipelineRunService`.
  - `PipelineSchedulerService` reuses `apiRoutes.pipelineRunService` (Main :297-304), so manual, scheduled, hook and auto-run runs all go through the same wired executor.
  - `autoRunDebounceRepo` is a constructor parameter of `ApiRoutes`, not a later `val`, so there is no initialization-order null.
- **AC1, a test that fails first for each case.** All 11 tests in `RunCancelsPendingAutoRunSpec` drive interleavings through a backend seam, with no timing dependence. The recorded mutation evidence is in `.concertino/scratch/HEL-1739/mutations.md` and `M1-M6.out`:
  - **Cancel:** M1 (cancel removed, which equals base) turns the cancel test and the in-flight carve-out test red.
  - **Write during the run:** M2 (delete by `pipeline_id`, ignoring the generation) turns the write-during-run and ABA tests red.
  - **Failure path:** M3 (snapshot-then-delete at start) turns the failure, refused-admission and carve-out tests red.
  - **Other mutations:** M5 (the conflict path keeps the old generation) and M6 (a per-row counter, the ABA case) each turn their target tests red. M4 (GRANT removed) was green at first, because V38's default privileges already cover the sequence. The executor then added a revoke-and-replay test, and the re-run of M4 is red.
  - **Guards, labelled honestly as guards:** the dry run, the no-repository service and "snapshot saw no row".
- **AC2, the spec delta.** The ADDED requirement covers the cancel, a write after the snapshot, the failure, blocked, write-back, refused and reaped cases, dry runs, and multi-instance behaviour.
  - The HEL-1504 in-flight requirement is MODIFIED with an explicit carve-out, and its first scenario's WHEN clause is narrowed.
  - The failure-path decision the ticket asked for is stated in D4: nothing is cancelled, so the auto-run fires.
  - I grepped the other `openspec/specs/*` files and found no other requirement contradicted by the new behaviour.
- **AC3, the e2e workaround is removed.** `cancelPendingAutoRun` has zero remaining references in `e2e/`, `frontend/` and `backend/`. Each removed call precedes a synchronous `runPipeline`.
  - `PUT /rows` goes through `replaceRows` → `triggerAutoRunAwaited` (`DataSourceService.scala:887-927`), so the debounce row exists before the run snapshots it.
  - The hel1392 comment was refreshed accordingly.
  - `userId` is still used in hel1277 (by `setUserTierForTest`), and `SAFE_ID`/`UUID` are still used in historySeed, so nothing is left dangling.
- **AC4, multi-instance safety.** The snapshot is a DB read, and the cancel is `DELETE ... WHERE pipeline_id = ? AND write_generation = ?` on a value drawn from a sequence (never reused).
  - The upsert's conflict path sets `write_generation = EXCLUDED.write_generation`, which is the fresh DEFAULT `nextval`.
  - The firer's later `releaseClaim`/`unclaim` match zero rows harmlessly. Per `PipelineAutoRunDebounceFirer.scala:76`, `releaseClaim` returns `Unit` with no row-count assertion.
- **Cancel placement.** In `PipelineRunSucceededWrites.scala:264-275` the cancel sits inside `afterTerminalWin(runId, "succeeded", won)`. It is sequenced in the chain after `updateMeta`, so before the publish, and it is listed in the `deletedRecovery` siblings. Its `NonFatal` recover only logs.
  - Blocked runs, write-back failures and engine failures never reach `onUnblockedRunSuccess`'s cancel.
  - A reaped run loses `afterTerminalWin`, so its cancel never runs either.
- **Grants (C15).** `AutoRunDebounceWriteGenerationGrantsSpec` runs on the NOSUPERUSER migration-chain harness and replays V144's GRANT after a REVOKE.
  - The table-level privileges for the new column come from V38's default privileges, the same as V110/V125.
- **Fresh gates, run by me.** `nice -n 19 sbt -J-Xmx3g "testOnly RunCancelsPendingAutoRunSpec AutoRunDebounceWriteGenerationGrantsSpec PipelineAutoRunDebounceRepositorySpec DatasetWriteAutoRun* AutoRun*"` gave exit 0: `Suites: completed 9`, `Tests: succeeded 64, failed 0`, `All tests passed.` Output: `.concertino/scratch/HEL-1739/skeptic-final-tests.out`.
  - The only stack trace in that output is the seam's deliberate forced failure (`RunCancelsPendingAutoRunSpec.scala:119`).
  - `npm run check:e2e-types` gave exit 0.
- **Evaluator evidence, read rather than trusted.** The pasted full `sbt testFull` tail (`eval2-testFull.out`) reads `Tests: succeeded 9702, failed 0, canceled 5 / All tests passed / exit=0`. The pasted lint and format outputs are clean.
- **UI judgment:** not applicable. No `frontend/**` change; the e2e edits are a removed helper and a comment.

### Verdict: CONFIRM

### Non-blocking notes

- **Rolling-deploy window.** During a Cloud Run rollout, an old-revision instance's `upsertDebounce` conflict path does not bump `write_generation` (old SQL). So a write handled by an old instance after a new instance's run took its snapshot would keep the snapshotted generation, and that write's auto-run could be cancelled even though the run did not read it. This lasts only for the duration of the rollout and is self-healing on the next write or run. The migration comment "Additive; old code ignores the column" understates this. Worth a sentence in design Risks, not a blocker.
- **Coalescing wording.** The base requirement "coalesce into exactly one eventual run" is left unmodified on the "upper bound" reading (D7). The ADDED requirement makes zero auto-runs explicit, so the spec is consistent, but a reader of the base requirement alone may still read "exactly one".
- **hel1277 not run live.** `e2e/hel1277-output-history-scrubber.spec.ts` has not been run live against V144. CI's e2e job is its first real measurement, so check that result on the PR before merging, as the evaluator also notes.
