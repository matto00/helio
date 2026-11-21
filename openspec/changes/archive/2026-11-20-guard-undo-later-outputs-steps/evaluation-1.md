## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `df49a870ad9bab274d17168df96d5ec6769a97e9` against live base `763c69f6f77be04a57e6e5d208262f86c3fb86e0` (resolve-review-base.sh). Backend-only diff (6 main files, 3 test files, openspec change dir).

### Independent verification (fresh runs by the evaluator)

All sbt runs were done in a throwaway detached worktree under `.concertino/scratch/HEL-1795/eval-red` (no .env copied; ScalaTest uses embedded Postgres), using `nice -n 19 sbt -J-Xmx3g`. The worktree was removed afterwards (`git worktree list` shows no straggler).

- **Red on main code:** at `57a150c25` (the red commit: main source unchanged, spec plus openspec only), `testOnly PatchSetUndoLaterOutputsSpec` gave 1 passed and 1 failed. "should refuse, changing nothing, when an editor added an Output to it" FAILED with `expected a Conflict, got Right(PatchSetUndoResponse(Vector(EditUndoOutcome(0,restored,...))))`. The red is real and goes through the real `PatchSetUndoService.undo` entry point on `helio_app_test` (the `rolbypassrls = false` test passed). There is no PATCH_SET_STALE pre-emption: the undo simply succeeded.
- **Green at HEAD:** `PatchSetUndoLaterOutputsSpec`, `PatchSetUndoRoutesSpec` and `PatchSetUndoLaneSpec` ran 3 suites, 21 tests, 0 failed.
- **Patch-set packages:** `com.helio.services.patchsets.*`, `com.helio.api.routes.patchsets.*`, `com.helio.infrastructure.persistence.patchsets.*` and `*PatchSet*` ran 59 suites, 591 tests, 0 failed (hel1468 guard: failed=0 aborted=0).
- **Other specs that use apply/undo:** `OutputRepositoryRequiredSpec`, `Hel914Ac1EndToEndSpec`, `ConditionalFormatsWriteSpec`, `PipelineCreateTransactionalSpec`, `ProposalDryRunParitySpec`, `*DraftUndo*` and `*DraftSave*` ran 18 suites, 360 tests, 0 failed.
- **My own mutations** (each reverted, then the scratch tree was confirmed clean):
  - Phase-2 re-check disabled (`if (later.isEmpty) restore` changed to `if (true) restore` in `PatchSetUndoService.ifStillUnbound`): 10 passed, 1 failed. The failing test was "report the edit failed, deleting nothing, when an Output lands after the Phase-1 check".
  - createdChildren Output excusal dropped (`case Some(c) => false` in `PatchSetUndoLaterChildren.blocking`): 10 passed, 1 failed. The failing test was "undo cleanly when the pipeline holds only the steps and Outputs the create itself made". This reproduces the executor's M2.
- **Repo checks** (pre-commit, the ones relevant to the backend): `check:scala-quality` (clean, soft warnings only), `check:openspec`, `check:spec-structure`, `check:test-temp-dir-hygiene`, `check:no-credential-leak` and `check:repo-integrity` all exited 0. No frontend files changed, so the frontend gates do not apply.

### Phase 1: Spec Review — FAIL
- AC1 (failing test first on helio_app_test, two-user case): PASS. The red commit `57a150c25` comes before the implementation, and I reproduced the red myself.
- AC2 (409, nothing changed, HEL-1720 naming rules): PASS. There are row-level assertions on the pipeline and Output. The helper uses `outputRepo.findById(id, user)`, which is sharing-aware, so only Outputs the undoing user can read are named; the rest are counted ("Output(s) you cannot see"). Steps are described by op and position only. There is no id in the message, asserted at `PatchSetUndoLaterOutputsSpec.scala:206-207,221`.
- AC3 (same-user later additions block; only set-created rows are excused): PASS. Covered by the same-user Output test, the step test and the legacy-fallback test. The excusal comes exactly from the journal (`createdChildren`).
- Steps were checked as the ticket asked: an editor can add a step, and a later step blocks. PASS.
- No scope creep. dataSource and HEL-1797 work were not touched. The `PatchSetUndoService` change is minimal: it threads `appliedAt` and adds one `ifStillUnbound` arm (402 to 409 lines).
- No API/schema change: `EditOutcome`, the `applyOne` return type and `PatchSetApplyResponse` are unchanged. The new field lives only in `JournaledEdit`, is optional and defaults to `None`, and an old-shape row parsing is tested.
- `PatchSetUndoLaneSpec`'s reversal is deliberate, matches the ticket's intent and is documented in files-modified.md.
- Constraints C1-C9 are honoured in the diff and evidence (no .env reads, quoted heredocs, red committed first, mutations recorded).
- **Issue:** `tasks.md` has every task unchecked at HEAD. `git show HEAD:openspec/changes/guard-undo-later-outputs-steps/tasks.md` gives 10 `- [ ]` and 0 `- [x]`, yet the work for 1.1-3.4 is done. This fails the checklist item "All task items marked done and matching what was implemented", and the planning artifacts do not reflect the final state.

### Phase 2: Code Review — PASS
- CONTRIBUTING.md mechanical rules: `check:scala-quality` is clean, with no inline FQNs (`java.time.Instant` and `NonFatal` are imported at the top). The soft size warnings are informational: `PatchSetUndoService.scala` was already over 400 lines before this diff (HEL-1797 is the queued split), and the new spec is 368 lines.
- DRY: `doomedRows` is now the single removal-set computation, shared by the panel check (`doomed`) and the new check, so the two cannot drift (design D1). `nameList` generalises `describeBlocking`'s naming half instead of copying it (design D3).
- Security and disclosure: there is no Output or step id in the 409 message. The Phase-2 reason is a fixed phrase plus a count (asserted against the ERROR log at `PatchSetUndoLaterOutputsSpec.scala:286-289`). The `captureCreatedChildren` WARN logs only the edit index and the exception class. `PatchSetUndoConflictCheck` and the route add no new INFO+ logging.
- Error handling: a failed read in `captureCreatedChildren` falls back to `None` with a WARN, so the apply never fails because of it, and the legacy rule then applies (documented).
- Tests are meaningful: four independent mutations, two of them mine, each turn a named test red. There is a route-level 409 test, and helper-level tests for the case that cannot be reached through apply are labelled as such.
- No dead code and no TODO/FIXME.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. The web toast shows the server's 409 message, and the MCP `undo_patch_set` wording ("the whole undo is refused") still holds (probes.md, task 3.3).

### Overall: FAIL

### Change Requests
1. `openspec/changes/guard-undo-later-outputs-steps/tasks.md`: mark tasks 1.1, 1.2, 2.1-2.4 and 3.1-3.4 as `- [x]`. The evidence shows each is implemented: red-run.txt, probes.md, mutations.md, the 11-test spec, the route test and the 3.3 wording check. Leave a task unchecked only if it is genuinely not done, and give the reason. No code change is needed.

### Non-blocking Suggestions
- In the re-check test, `PatchSetUndoLaterOutputsSpec.scala:279-280` (`Thread.sleep(1500)` then `isCompleted shouldBe false`) is timing-based. It asserts that the undo is blocked rather than racing, so it is acceptable, but a latch or a poll of `pg_locks` would be sturdier.
- The mutations.md M3 note says the pipelineStep-arm case goes red "which shares the rule's guard". That case has no legacy fallback, so consider rewording it to say exactly what M3 changed.
- At delivery, remember the follow-up for alert rules that cascade with an excused Output (design Non-Goals), and state it in the PR body.
