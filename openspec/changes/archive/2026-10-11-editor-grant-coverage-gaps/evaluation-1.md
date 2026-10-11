## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `04edd571ec91c80f96fb72fbd6b9247a7ba587d5` against live-resolved base `bcb0e891923094c1a1e85ecc053f30a73ee6d70f`
(`resolve-review-base.sh`, exit 0). Evaluator logs: `/home/matt/Development/helio/.concertino/runs/HEL-1488/evidence/EVAL-*.log`
(driver `eval-run.sh`).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 is met. All 8 sites have a test that goes RED under the recorded one-line mutation. Site 6 is tested on a
  private cluster: the spec drops the V16 CHECK, inserts role `'owner'`, and reads it back as `Role.Viewer`. A comment
  in main code records why the arm is unreachable.
- AC2 is met. Viewer, editor and owner are covered at sites 1, 2, 3 and 8 (`EditorGrantCoverageSpec`, 12 tests).
  - Site 7: the new tests cover viewer real/dry and editor real/dry. The owner arm is pinned by the existing owner
    tests: the S7-O mutation fails 51 of them.
  - Sites 4 and 5 cover the anonymous arm both ways: grant/token gives exact Viewer, refused gives exact NotFound/404.
  - Sites 2 and 3: the owner short-circuit mutants are equivalent, and are honestly recorded as equivalent. The owner
    tests are killed by owner-rejecting mutants instead.
- AC3 is met. Refusals assert exact values: `Left(ServiceError.Forbidden())`, `Left(ServiceError.Forbidden("Forbidden"))`,
  `Left(NotFound(msg))`, `Right(ResourceAccess.Viewer)`, and the 404 asserts `ErrorResponse("Dashboard not found")`
  plus status. Accept tests observe the effect:
  - the panel title is re-read from the repo;
  - after a contents replace, the old panel is gone;
  - the exported payload is checked by name and panel count;
  - the Output is re-listed by pipeline;
  - the run response carries rowCount/sourceRowCount 2 and `blocked=false`.
- AC4 is met. Both citations now point at symbols that exist and are used:
  - `PipelineRootWrites.resolveOneRootSourceId` (`PipelineRootWrites.scala:36`, used at `PipelineCreateWrites.scala:188`);
  - `PipelineCreateWrites.lookupOwnedRoots` (`PipelineCreateWrites.scala:195`, used at :168).
  `grep -rn resolveRootDataSources backend/src` returns no hits.
- AC5 is met. This filter prints nothing (exit 1), so the main-code diff is comment-only:
  `git diff -U0 $BASE...HEAD -- backend/src/main | grep '^[+-]' | grep -v '^+++\|^---' | grep -vE '^[+-]\s*(//|\*|/\*)'`
- AC6: no test failed on unmutated code. No authorization defect was found.
- All tasks are marked done and match the diff. There is no scope creep, and there are no API/schema changes.
- CONSTRAINTS C1-C6 are honored:
  - Main code changes are comment-only.
  - Mutation scripts live only in the run evidence dir, not in the diff.
  - Assertions are exact.
  - Every sbt run shows `[hel1468-guard]`.
  - Both new specs use `VerifiedEmbeddedPostgres.start`.
  - No inline FQNs: a grep of added test lines for `com.helio.`/`scala.`/`java.`/`org.` qualified references outside imports finds none.

### Phase 2: Code Review — PASS
Issues: none blocking.

Fresh gate evidence (my own runs, not the executor's report):
- An unmutated targeted run of the 5 touched specs (`EVAL-unmutated.log`) exited 0 and reports
  `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` and `Tests: succeeded 128, failed 0`.
  128 = 91 + 12 + 7 + 17 + 1, which matches the counts in `test-count-evidence.md`.
- Mutation spot re-runs using the executor's `mutl.py` (which always reverts):

| Id | Mutation | Result | Killer excerpt |
|---|---|---|---|
| EVAL-S7-V | `PipelineRunService.scala:197` `case Some("editor")` -> `case Some(_)` | RED 89/2 | `Right(RunResultResponse(...)) was not equal to Left(Forbidden("Forbidden")) (PipelineRunServiceSpec.scala:559 / :573)` |
| EVAL-S7-E | same line -> `case Some("editor") if false` | RED 87/4 | `Left(Forbidden("Forbidden")) was not an instance of scala.util.Right` (:528/:542); `None.get` (new editor tests) |
| EVAL-S1-V | `PanelService.scala:221` `Right(ResourceAccess.Viewer)` -> `... if false` | RED 11/1 | `Right(Vector(DividerPanel(... "Edited by viewer" ...))) was not equal to Left(Forbidden("Forbidden")) (EditorGrantCoverageSpec.scala:149)` |
| EVAL-S1-E | same -> `Right(ResourceAccess.Viewer) \| Right(ResourceAccess.Editor)` | RED 11/1 | `expected an editor grantee's batch update to be accepted (EditorGrantCoverageSpec.scala:155)` |
| EVAL-S1-O | `PanelService.scala:223` `case Right(_)` -> `case Right(ResourceAccess.Editor)` | RED 11/1 | `scala.MatchError: Right(Owner)` at `PanelService.scala:218` |
| EVAL-S5-token | `AclDirective.scala:141` `provide(ResourceAccess.Viewer)` -> `provide(ResourceAccess.Editor)` | RED 16/1 | `"[Edito]r" was not equal to "[Viewe]r" (AclDirectiveSpec.scala:270)` |

- After all of these runs, `git -C $W status --short` was empty (`EVAL-status-after.log` is empty) and HEAD was unchanged.
  No HEL-1488 sbt process is left running.
- The executor's remaining mutation logs agree with `mutation-evidence.md`:
  - S2/S3/S8 V/E/O are each 11/1;
  - the S2/S3 equivalent mutants are 12/0;
  - S4 is 6/1, S6 is 0/1, S7-O is 40/51;
  - each log carries the guard line.
- The executor's `final-testfull.log`: 506 suites, 6826 succeeded, 0 failed, guard line present. I did not re-run
  testFull: another lane's testFull was in progress, and the targeted runs cover every touched suite.
- `npm run check:scala-quality` exited 0 (`EVAL-scala-quality.log`, "clean (232 soft warning(s))").

Checklist: the canonical code-quality rules (imports, no inline FQNs) are met. Duplication is acceptable. Test names
are readable. There are no untyped escape hatches. There is no main-code behaviour change, no dead code, and no
over-engineering. The tests are meaningful: each one is shown to fail under its mutation.

#### Requested judgment: "a non-owner editor's run persists no run row"
This is **real product behaviour, not a harness artifact.** The test harness wires a real `PipelineRunRepository(ctx)`
(`PipelineRunServiceSpec.scala:138`) into the service (:148-149). The no-op comes from production code:

- `PipelineRunRepository.insertRun` (`PipelineRunRepository.scala:45-56`) does nothing silently when
  `pipelineOwnedAction` (owner_id = caller) is false.
- `updateRunTerminal` (:172-192) and `PipelineRepository.updateLastRun` (:492-) are scoped to the owner in the same way.
- `PipelineRunExecutor.scala:144-156` maps `ConcurrencyCapResult.NotOwned` to proceed, with a comment that this was
  deliberately kept during HEL-505 ("an editor-grantee-triggered run has always resolved normally despite no persisted
  run row, and must keep doing so").

Product consequences for an editor grantee's real run in production:
1. No `pipeline_runs` row is written, so there is no run history entry and no assertion results.
2. The pipeline's `last_run_*` badge is not updated.
3. The run is never counted against HEL-505's per-user `PIPELINE_RUN_MAX_CONCURRENT` cap. `NotOwned` skips the
   capped insert, so an editor's in-flight real runs never count against the cap. The HEL-505 rate limit still applies.

Output materialization still happens, because the succeeded writes use `*Internal` repos. This is long-standing,
documented and intentionally preserved. It is not an authorization escalation, and it is outside this ticket's scope
(C1: no behaviour change). **I recommend a follow-up ticket, not a fix here.** Its question: should editor-triggered
runs be recorded and counted, for example by inserting the run via `insertRunInternal` / the cap path keyed on the
pipeline owner, now that the grant check in `submit` has already authorized the caller? Item 3 (the concurrency-cap
bypass) is the part most likely to be a real defect against HEL-505's intent.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The diff is backend tests, main-code
comments, and change-dir artifacts.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineRunServiceSpec.scala:547-550`: the new block comment says an editor grantee's "persisted assertion result"
  is observed. The tests below it, and the comment at :578-579, say the opposite: no row is persisted, and the
  response is the observed effect. Reword it to match.
- `PipelineRunServiceSpec.scala:585` and `:596`: `.toOption.get` fails as a bare `None.get`. For a clearer red, use
  `.getOrElse(fail("expected an editor grantee's run to be accepted"))`, the idiom `EditorGrantCoverageSpec` already uses.
- `EditorGrantCoverageSpec.scala` is 255 lines, a new soft-budget (250) warning. It also lives in `services.dashboards`
  while covering `PanelService` and `OutputService`. Either is acceptable. Splitting the Output section out would fix both.
- Open a follow-up for the editor-run persistence and concurrency-cap gap described above.
