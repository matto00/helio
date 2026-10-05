## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `3fcb55f0ddb2532dbe0cf6dbad90718133fe267d`. Diff base (resolved live): `1f955abd7a75e54c2be677ea373517e842a677e2` (origin/main).

### Phase 1: Spec Review — FAIL

Acceptance criteria:
- AC1 (no `= null` default; omission is a compile error): met. `PatchSetUndoService.scala:60` and `PatchSetUndoTypes.scala:28` have no default. `PatchSetUndoContext.build` (`PatchSetUndoTypes.scala:33-43`) is the only construction path. All three construction sites pass the repo: `ApiRoutes.scala:563` (named arg, unchanged), `PatchSetUndoServiceSpec.scala:118`, `PatchSetUndoRoutesSpec.scala:113` (fixed).
- AC2 (every dereference audited; no NPE or silent degrade; typed `ServiceError` before any mutation): met in code. The only `outputRepo` reads left are `context.outputRepo` at `PatchSetUndoService.scala:91` (guard), `:321` (`restoreBoundOutputs`), and `:365` (`countPlacementsForStep`). The silent `0` branch is gone. The guard runs before `PatchSetUndoConflictCheck.checkAll`, so nothing is restored. The predicate `needsOutputRepo` (`:73-87`) matches exactly when `restorePipelineStepDelete`/`restoreBoundOutputs` would dereference the repo: a non-empty `boundOutputs` JsArray. A legacy entry, a non-array value, or an empty array does not dereference it, and every `pipelineStep` create does.
- AC3 (structural parity test): met. `PatchSetUndoServiceSpec.scala:684-713` checks that the field-name set equals the supplied keys, that each field is non-null and the same instance, and that undo's fields are a subset of apply's. If a new case-class field is added, either `build` stops compiling or the key-set assertion fails.

Standing constraints:
- C1 (total predicate): honored. `needsOutputRepo` uses only `case o: JsObject` / `case arr: JsArray`, with no `asJsObject`/`fields(...)`.
- C2 (red-first evidence records the observed failure mode): **cannot be verified.** No red-first transcript is persisted anywhere reviewable: not in the change dir, `files-modified.md`, the commit message, or `.concertino/runs/HEL-1256/evidence/`. Task 2.5 is ticked "record the transcript", but nothing is recorded.
- C3 (audit names `PanelService.create`'s null-guarded outputId check as out-of-scope): **cannot be verified**, for the same reason. No audit artifact exists. The guard is real: `backend/src/main/scala/com/helio/services/panels/PanelService.scala:635` (`case Some(_) if outputRepo == null => Future.successful(Right(()))`).
- Task 2.6 (coverage grep "record result") is ticked, but no result is recorded either.

Scope: clean. Only the undo service/types and two specs changed. Task 1.6 holds: there are no leftover "nullable-optional" comments in the undo files, and `services/patchsets/README.md` does not mention `outputRepo`. The spec delta matches the implemented behaviour.

### Phase 2: Code Review — PASS

Gates (my own fresh runs, in WORKTREE_PATH):
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: exit 0. 5917 tests, 411 suites, 0 failed, 0 aborted, 6m43s. All 4 new HEL-1256 tests ran and passed. **FirstRunRoutesSpec ran and passed with no timeout.** `sbt --client shutdown` was run afterward.
- `npm run check:scala-quality`: clean (soft warnings only).
- `npm run check:openspec`: clean. `prettier --check` on the change dir: clean.
- There is no frontend diff, so the frontend gates were not triggered.

Independent red-first mutation (the evaluator's own run, in a throwaway detached worktree at 3fcb55f0, removed afterward). I removed the D3 guard (`PatchSetUndoService.scala:91-93`) and ran `testOnly PatchSetUndoServiceSpec`: 16 passed, 2 failed. Observed failure modes:
- (a) pipelineStep delete with a bound Output: `Right(PatchSetUndoResponse(Vector(EditUndoOutcome(0,failed,None,None))))`. That is a 200 with a `failed` outcome, and the log shows the NPE on `context.outputRepo().insertInternal` that `safeRestoreOne` recovered.
- (b) pipelineStep create: an **unrecovered `NullPointerException` thrown synchronously** from `countPlacementsForStep` (`:362`), up through `restorePipelineStepCreate` and `safeRestoreOne`. It escapes as a failed Future, i.e. a 500 at the route, not a `failed` outcome.
- The panel-only and parity tests still passed under the mutation.

So the new tests are genuinely red without the guard and green with it. The two observed modes differ: delete gives 200 with `failed`, create gives an unrecovered NPE. The executor's own C2 record should state both.

Code quality: no inline FQNs. Naming is clear, and the comments explain why. `PatchSetApplyContext.outputRepoUnavailable` is reused instead of adding a duplicate message (DRY). There is no dead code. `asInstanceOf` appears only in the parity test, to recover typed values from the heterogeneous `supplied` map, which is acceptable in a test.

### Phase 3: UI Review — N/A

There are no `frontend/**`, `ApiRoutes.scala`-route, `schemas/**`, or `openspec/specs/**` changes. The `ApiRoutes.scala` construction site is unchanged, and the change dir's spec delta is not under `openspec/specs/`.

### Overall: FAIL

### Change Requests
1. Persist the executor's verification evidence in a reviewable file in the change dir, for example `openspec/changes/undo-output-repo-required/evidence.md`, or a section in `files-modified.md`. Tasks 2.5, 2.6 and 2.7 say "record", and binding constraints C2/C3 can only be checked against a recorded artifact. It must contain:
   a. (C2, task 2.5) The red-first transcript with the guard removed, stating the **observed** modes: delete-with-bound-Output gives a 200 `PatchSetUndoResponse` with outcome `failed` (NPE recovered by `safeRestoreOne`, step left recreated without its Output). Create gives an unrecovered `NullPointerException` from `countPlacementsForStep` (a failed Future, i.e. 500). Do not paste ticket/design wording. The evaluator reproduced exactly these modes; see Phase 2.
   b. (C3) The audit naming `backend/src/main/scala/com/helio/services/panels/PanelService.scala:635` (`case Some(_) if outputRepo == null => Future.successful(Right(()))`) as an out-of-scope, collaborator-owned silent skip that the undo restore path reaches via `panelService.create`.
   c. (task 2.6) The coverage grep result over unit tests and repo-root `e2e/`.
   d. (task 2.7) The `testFull` totals and the FirstRunRoutesSpec timeout status.
   This needs no code change.

### Non-blocking Suggestions
- `PatchSetUndoServiceSpec.scala` grew from 677 to 775 lines and was already well past CONTRIBUTING's ~400-line threshold. Mention a split proposal in the PR description, as CONTRIBUTING.md:24 asks.
- In the delete-rejection test, `stepsBefore` is already `empty`, so the two `listByPipelineInternal` assertions overlap. This is harmless.
