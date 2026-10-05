## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `34c3d393005508bb5042c7ad438f948ff1720756`. Base resolved live with `resolve-review-base.sh` (exit 0): `1f955abd`. Diff is `git diff 1f955abd...HEAD`: 4 backend files and the change dir. The only uncommitted file is `evaluation-2.md`.

### What I verified (with evidence)

- **AC1: no `= null` default, and omitting the repo does not compile.**
  - `PatchSetUndoService.scala:60` and `PatchSetUndoTypes.scala:28` both declare `outputRepo: OutputRepository` with no default.
  - The new `PatchSetUndoContext.build` (`PatchSetUndoTypes.scala:35-43`) takes every parameter as required.
  - `grep "new PatchSetUndoService|PatchSetUndoContext("` finds 4 construction sites. Each one passes the repo explicitly:
    - `ApiRoutes.scala:560` passes `outputRepoOpt.orNull`.
    - `PatchSetUndoRoutesSpec.scala:110` was fixed to pass `new OutputRepository(ctx)`.
    - `PatchSetUndoServiceSpec` has the other two.
  - The full suite compiled.
- **AC2: every `outputRepo` dereference is audited.**
  - Grep shows only 3 reads: the guard (`:91`), `restoreBoundOutputs` (`:321`, `context.outputRepo.insertInternal`) and `countPlacementsForStep` (`:365`). There are no bare `outputRepo.` reads. ConflictCheck and Inverse never read it.
  - **The guard matches both dereference paths:**
    - `restorePipelineStepCreate` always reaches `countPlacementsForStep`. The guard treats every `pipelineStep` create as needing the repo.
    - `restoreBoundOutputs` only dereferences when `boundOutputs` is a non-empty JsArray. The guard tests exactly that.
  - **C1 holds:** `needsOutputRepo` uses pattern matching only, with no `asJsObject` or `fields(...)`.
  - **No silent degrade remains:** the silent-`0` branch in `countPlacementsForStep` is removed. The rejection is the typed `PatchSetApplyContext.outputRepoUnavailable` (`InternalError("Output repository is not configured")`), returned before Phase 1.
  - **C3 holds:** `evidence.md` names `PanelService.scala:635`. I confirmed that line is the `outputRepo == null` silent skip.
- **AC3: the parity test can fail.** I mutated a scratch copy of `backend/` (the worktree was not touched) so that `build(..., null)` is passed for outputRepo. The parity test then FAILED with `undo context field 'outputRepo' true was not equal to false (PatchSetUndoServiceSpec.scala:707)`.
  - The `keySet` equality check makes the test fail if a new context field is added without being added to the test.
  - The `theSameInstanceAs` check catches a wrong instance being wired in.
- **Red-first (C2), reproduced myself.** In the scratch copy I disabled the guard (`if false && ...`) and ran `testOnly PatchSetUndoServiceSpec`: 16 passed, 2 failed.
  - **Delete with a bound Output:** `got Right(PatchSetUndoResponse(Vector(EditUndoOutcome(0,failed,None,None))))`.
  - **Create:** `NullPointerException ... PatchSetUndoContext.outputRepo() is null`.
  - These match `evidence.md`'s recorded modes. With the guard in place, all 4 HEL-1256 tests pass.
- **Gates, run fresh at 34c3d393 in the worktree:**
  - `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: exit 0. 5917 tests, 411 suites, 0 failed, 0 aborted. The 4 HEL-1256 tests are in the log.
  - FirstRunRoutesSpec ran and passed with no timeout.
  - `sbt --client shutdown` was run separately afterward.
  - `npm run check:openspec`: clean.
  - `npm run check:scala-quality`: clean (soft warnings only).
- **UI:** none. The change is backend-only, so step 4 was skipped.

### Verdict: CONFIRM

### Non-blocking notes
- The null-repo guard runs before the conflict check. A misconfigured fixture with a conflicting application therefore gets a 500 instead of a 409. This is acceptable for a server-configuration fault, and prod always wires a DbContext.
- `PatchSetUndoServiceSpec.scala` is about 773 lines. Propose a split in the PR, as the evaluator already noted.
- The out-of-scope `= null` defaults on the other services (including PanelService's silent outputId skip) should get their own follow-up ticket, as the proposal states.
