# Evidence (HEL-1564)

## 1.1 Context claims verified against code (main 273c0b0c9)

Read PipelineRunSucceededWrites, PipelineRunTerminalWrites.publishTerminalAfter, BinaryRefRepository.overwriteForNode and the
spec. design.md Context claims hold (eager futures, fail-fast `for`, `skipPublishOn` only for `RunNoLongerOpen`,
`overwriteForNode` INSERTs with FK to pipelines). No disagreement found. One deviation, recorded under 1.3a below.

## 1.2 RED FIRST -- new/flipped tests vs UNMODIFIED production code

Command: `cd backend && HELIO_TEST_JVM_XMX=3g nice -n 19 sbt "testOnly com.helio.services.pipelines.LateFinisherRunSpec"` (exit 1)

```
[info] - should answer success and publish succeeded when the delete also landed before the Output list was read, so no node guard runs
01:11:38.435 WARN  [scala-execution-context-global-82] c.h.s.pipelines.PipelineRunService - Run a2ffccf2-886e-44ea-9c08-cab879afcdc5: pipeline 838e70e7-3d17-4f5a-81c4-efb483d10417 was deleted while its run executed; discarding its outcome
[info] - should answer success and publish succeeded when the delete landed after the Output list was read, although a node guard then sees the run Missing (HEL-1564) *** FAILED ***
[info]   false was not equal to true (LateFinisherRunSpec.scala:314)
01:11:38.518 WARN  [scala-execution-context-global-82] c.h.s.pipelines.PipelineRunService - Run fc1f2abb-8eb4-4dbd-87b1-4439505c992d: pipeline fc6178c0-5c2d-4ee9-8684-2f3db207845b was deleted while its run executed; discarding its outcome
[info] - should answer success, keeping the node already written, when the delete landed between two node writes (HEL-1564) *** FAILED ***
[info]   Success(false) was not equal to Success(true) (LateFinisherRunSpec.scala:325)
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 2026-10-14 01:11:38.603 PDT [1230030] ERROR:  insert or update on table "binary_refs" violates foreign key constraint "binary_refs_pipeline_id_fkey"
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 2026-10-14 01:11:38.603 PDT [1230030] DETAIL:  Key (pipeline_id)=(97454a14-ad6b-4fc3-b9a9-4ee3181909f2) is not present in table "pipelines".
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 2026-10-14 01:11:38.603 PDT [1230030] STATEMENT:  INSERT INTO binary_refs
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 	                     (id, pipeline_id, node_step_id, row_index, field_name, storage_key, mime_type, filename, size_bytes, created_at)
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 	                   VALUES
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 	                     ($1, $2, $3, $4, $5, $6,
01:11:38.603 INFO  [postgres:pid(1229680)] i.z.t.d.p.embedded.EmbeddedPostgres - 	                      $7, $8, $9, $10)
[info] - should answer success when a post-fold binary-reference write fails because the pipeline was deleted after the run's own write won (HEL-1564) *** FAILED ***
[info]   Failure(org.postgresql.util.PSQLException: ERROR: insert or update on table "binary_refs" violates foreign key constraint "binary_refs_pipeline_id_fkey"
[info]     Detail: Key (pipeline_id)=(97454a14-ad6b-4fc3-b9a9-4ee3181909f2) is not present in table "pipelines".) was not equal to Success(true) (LateFinisherRunSpec.scala:344)
[info] a binary-reference write that fails while the pipeline still exists (HEL-1564 narrowness control)
[info] - should still fail the submit and still publish succeeded, exactly as before
[info] a run whose terminal write lost to a delete that landed after the fold (HEL-1564 D1b)
01:11:39.075 WARN  [scala-execution-context-global-83] c.h.s.pipelines.PipelineRunService - Run 5080d5d7-cc8d-4ac9-9b3e-583d96c95d81: terminal write skipped (run already terminal or not found) for its 'succeeded' outcome; dropping the late outcome
01:11:39.075 WARN  [scala-execution-context-global-66] c.h.s.pipelines.PipelineRunService - Run 5080d5d7-cc8d-4ac9-9b3e-583d96c95d81: terminal write skipped (run already terminal or not found) for its 'succeeded' outcome; dropping the late outcome
[info] - should answer 404, publish no succeeded and leave no run row when a post-fold binary-reference write then fails on the deleted pipeline *** FAILED ***
[info]   Failure(org.postgresql.util.PSQLException: ERROR: insert or update on table "binary_refs" violates foreign key constraint "binary_refs_pipeline_id_fkey"
[info]     Detail: Key (pipeline_id)=(5925b1ef-7baa-4b9a-8bc6-ae920706de20) is not present in table "pipelines".) was not equal to Success(Left(NotFound("Pipeline not found: 5925b1ef-7baa-4b9a-8bc6-ae920706de20"))) (LateFinisherRunSpec.scala:378)
[info] a healthy run whose own succeeded terminal write commits before its node writes (positive control, C1)
[info] - should write every node's snapshots, history and payload, publish succeeded and finish succeeded
[info] Tests: succeeded 12, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
[error] Failed tests:
```

Reading: flipped HEL-1544 test (delete after list), delete-between-nodes, post-fold binary-ref FK after won, and D1b (test 7)
are RED for the expected reasons (404 / `false` / the raw FK violation instead of success / 404). The narrowness control
(binary-ref FK while the pipeline exists) passes on unmodified code: it pins today's answer (the Future fails and `succeeded`
is still published, asserted in the test). The item-2 delete test was sequenced (terminalGate) and the HEL-1544
delete-before-list test now asserts exactly one `succeeded`; both pass on unmodified code (green before the fix).

## 1.3a Test-file size budget
`node scripts/check-scala-quality.mjs`: "Scala code-quality check: clean (250 soft warning(s))". The 250-line budget is SOFT and
LateFinisherRunSpec was already over it (387 lines before, ~480 now); no hard error. Deviation from the task: the tests were NOT
moved to a sibling spec, because the fixture (HookBackend/HookOutputRepo/GatedRunRepo seams, seed, counters) is private to the
spec and a shared-trait extraction would be a refactor of unrelated tests. Flagged for the evaluator.
SUPERSEDED in cycle 2 (evaluation-1 CR1): the split WAS done. `LateFinisherSpecBase` (abstract fixture class holding every seam and
helper), `LateFinisherRunSpec` (HEL-1518 item 1/2, D7, C1 control, lock tests; 236 lines) and `LateFinisherDeleteAfterWonSpec`
(HEL-1544 + HEL-1564 delete-after-won, narrowness control, D1b; 128 lines). The 499-line spec no longer exists.

## 1.3 Audit of mid-run pipeline-delete tests
- LateFinisherRunSpec: item-1 test (afterEngine delete) -- delete precedes the chain, run's own write necessarily after: deterministic (lost write, 404).
  Item-2 delete test -- was order-sensitive; now sequenced via terminalGate (delete finishes first). HEL-1544 tests -- already forced via terminalWritten.
  D7 delete-before-list -- already gated. Lock tests -- no run chain.
- Hel1503EditorRunGapsSpec / Hel1516GranteeDriftPreviewSpec (delete inside findByIdShared / step listing before execution): do not reach the success chain; green in the related run.
- WorkspaceContextServiceSpec / PipelineRepositorySpec / ResourceTagMigrationSpec: plain deletes, no run.

## 2.2 Mutations (each applied to PipelineRunDeletedRecovery.scala, spec run, then restored; logs summarised)
1. Drop pipeline-gone check (`case Success(_) if isWon`): RED -- "still fail the submit and still publish succeeded, exactly as before" (false was not equal to true, spec:361); 15/16.
2. Drop the `won` check (`case Success(None) =>`): RED -- 3 failures: item-2 delete-in-window 404 test (got Right), D7 "deleted before the Output list was read" (got Right), D1b test 7 (got Right); 13/16.
3. Narrow recovery to RunNoLongerOpen only: RED -- binary-reference-after-won test ("Success(false) was not equal to Success(true)"); 15/16.
4. Drop D1b (re-fail as original): RED -- test 7 (Failure(PSQLException binary_refs_pipeline_id_fkey) was not equal to Success(Left(NotFound(...)))); 15/16.
Restored file is byte-identical to the fixed version (diff clean) and the spec is green.

## 2.1/2.3 Green and determinism
After the fix: LateFinisherRunSpec 16/16, exit 0. Ten consecutive runs (nice -n 19, one at a time), each "Tests: succeeded 16, failed 0", exit 0: 10/10 green.

## 3.1 Related specs
testOnly Hel1503EditorRunGapsSpec, Hel1516GranteeDriftPreviewSpec, LiveRunReaperSpec, OrphanedRunReaperSpec, NodePayloadHistory*, OutputHistory*, PipelineRun*, AutoRun*, DatasetWriteAutoRun*, Hel914Ac1EndToEndSpec: "Tests: succeeded 282, failed 0", exit 0.
check-scala-quality: clean; check-openspec-hygiene: "openspec/ is clean".

## 3.2 Full backend suite (HELIO_TEST_SHARD_INDEX=i HELIO_TEST_SHARD_COUNT=4 HEL924_TEST_GROUP_CONCURRENCY=1 HELIO_TEST_JVM_XMX=3g nice -n 19 sbt testFull)
- shard 0: exit 0, Suites 152, Tests succeeded 2175, failed 0, canceled 4
- shard 1: exit 0, Suites 153, Tests succeeded 1859, failed 0
- shard 2: exit 0, Suites 153, Tests succeeded 1802, failed 0
- shard 3: exit 0, Suites 154, Tests succeeded 2232, failed 0
No fixture-only test (no run repo, deleted pipeline, failing chain) turned into a recovered success (skeptic note): all green.

## 3.3 Comments
Updated the scaladoc of failIfLostTerminalWrite and the publish comment in onUnblockedRunSuccess; the recovery class documents the rule. `grep -n wherever` in touched main files: no hits.

## Cycle 2 (evaluation-1)
- Split as above; `import scala.util.{Success, Try}` replaces the inline qualifier; section-divider comment and the HEL-1366 "Edge:"
  comment in PipelineRunSucceededWrites corrected; scaladoc rewrapped; recover call uses named arguments (production change = comments + named args only, so no new full-suite run).
- Both specs after the split: `testOnly LateFinisherRunSpec LateFinisherDeleteAfterWonSpec` -> Tests: succeeded 16, failed 0, exit 0.
- Mutations re-run against the split specs (all RED, restored after each): (1) drop gone-check -> narrowness control (DeleteAfterWonSpec) 15/16;
  (2) drop won check -> item-2 delete + D7 delete-before-list (RunSpec) and D1b (DeleteAfterWonSpec) 13/16;
  (3) narrow to RunNoLongerOpen -> binary-ref-after-won and D1b (DeleteAfterWonSpec) 14/16; (4) drop D1b -> D1b test 15/16.
- D2 (settle-before-answer) remains UNTESTED: a red-able test needs a slow sibling write (e.g. a wrapped dataSourceRepo for the baseline upsert); the evaluator's extra mutation (drop settle) survives. Recorded as a known gap; the code comment documents the intent.

## Cycle 2 verification (after the spec split)

- Both specs (`LateFinisherRunSpec` 10 tests + `LateFinisherDeleteAfterWonSpec` 6 tests) run together: 3 consecutive fresh runs, each `Tests: succeeded 16, failed 0`.
- Mutations re-run against the moved tests (restored after each): drop pipeline-gone check -> narrowness control red (15/16); drop `won` check -> 3 red (13/16); narrow recovery to `RunNoLongerOpen` -> binary-ref-after-won and D1b red (14/16); D1b -> `Future.failed(original)` -> D1b red (15/16).
- Note: several early cycle-2 runs flaked while a second writer was mutating/committing in the same worktree; with the tree quiescent all runs are green.
- No production logic changed since the cycle-1 full `testFull` (comments, wrapping, named arguments only); `check-scala-quality.mjs` and `check-openspec-hygiene.mjs` clean.
