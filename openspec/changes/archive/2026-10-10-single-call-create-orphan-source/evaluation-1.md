## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `9402b22431a88307b2b3ac4fb3673a13d0335a62` (commits f75658e4e, 9402b2243) against live-resolved base `625e1deff20f2ba73e98b2cfa0a1d0d1e298e25a`. Backend-only diff; no `frontend/**`, `schemas/**`, `ApiRoutes.scala` or `openspec/specs/**` (canonical) files touched.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (red-first, 422 AND zero new `data_sources` rows): I re-measured this myself. I made a throwaway detached worktree at 625e1deff (the whole pre-fix tree) and added only the three new spec files from HEAD. `sbt -J-Xmx3g testOnly <3 specs>` gave `[hel1468-guard] ScalaTest summary: failed=14 aborted=0 unreadable=0` and `Tests: succeeded 3, failed 14`. That matches red-evidence.md. The 3 tests that passed are the two valid-create controls and the labelled cleanup-failure GUARD. Every orphan case failed on the exact-owner-id row count (`N was not equal to N-1`). The patch-set apply and preview cases failed on status (200 with a `failure` / a 200 projection). The throwaway worktree has been removed.
- AC2 (validate before write, plus patch-set `resolvePipelineCreate`): done. Decision 1 is the pre-flight and Decision 3 is the resolver.
- AC3 (no orphan on any 4xx/5xx, tests per failure class for step config, Output config and step type): covered by `PipelineCreateOrphanSourceRoutesSpec`, plus the post-creation classes (fieldMapping, multi-root simple and transactional) and the failed-Future service cases.
- The "Exact sequence" in design.md matches the code. `checkedCreate` runs: `checkRootsReadOnly` (pass a: shape and existing-id ownership, read-only) → `PipelineCreatePreflight.run` (transactional path only) → `validateStepCrossOwnerRefs` ownership half → `createWithInlineRoots` (pass b, inside `compensatingInlineSources`) → `lookupOwnedRoots` / `createTransactional` or `pipelineRepo.create`.
- Compensation covers both a `Left` and a failed Future. `Future.unit.flatMap(_ => body)` also catches synchronous throws. The `Failure(ex)` branch deletes and then returns `Future.failed(ex)`, which is the original exception. A cleanup failure is `.recover`-logged and never replaces the original error. The guard covers this, and red-evidence.md records the mutation showing the guard can fail.
- Patch-set rollback: the pipeline delete `Left` returns `unrecoverable` before any source delete is attempted. Sources are deleted only for request roots with `type` defined, matched by position against the forward summary's `roots`. A failed Future is still caught by the existing `NonFatal` recover at `PatchSetApplyRollback.scala:57`.
- The tasks are all ticked and match the code. The spec delta for `pipeline-create-api` reflects the implemented behavior, and behavior-changes.md states the patch-set behavior change and the multi-error precedence shifts.
- CONSTRAINTS C1–C4 are honored:
  - C1: every orphan test counts `data_sources WHERE owner_id = <exact uuid>` before and after.
  - C2: verified above on the whole pre-fix tree.
  - C3: compensation goes through `dataSourceService.delete(id, user)`, and the transaction still uses `runTransactionally(user.id)`.
  - C4: on the direct route, single-error statuses and messages are unchanged. The pre-flight and in-transaction checks call the same `PipelineCreatePreflight.checkStep` / `checkOutput` / `validateOutputConfig`. `rootShapeProblem` reproduces `resolveOneRootSourceId`'s messages verbatim. The new early 404 text `Data source not found: <id>` is identical to `PipelineRepository.create:327`'s message, so the simple path's unknown-id 404 is unchanged.

### Phase 2: Code Review — PASS
Issues: none blocking

Gates I ran myself:
- `cd backend && sbt -J-Xmx3g testFull` on HEAD 9402b224 passed. It printed `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` and `Tests: succeeded 6554, failed 0, canceled 4`. All three new specs and `PipelineCreateStepConfigRoutesSpec` appear in the run log. This run is on the final HEAD, so it includes the temp-dir-hygiene edit the executor made after its own testFull.
- `npm run check:scala-quality` is clean (no inline FQNs; soft-size warnings only, all pre-existing).
- `check:test-temp-dir-hygiene` is clean.
- `check:openspec` is clean.
- `check:spec-structure` passed.
- `prettier --check` on the change dir passed.

Review notes:
- CONTRIBUTING mechanical rules: no inline FQNs, and imports are at the top of each file. `PipelineService.scala` shrank from 2652 to 2571 lines. The new `PipelineCreatePreflight.scala` (209 lines) is within the 250 budget.
- DRY: the request-scoped checks moved into one object used by three callers (create pre-flight, `buildStepsAction` / `buildOutputsAction`, and the patch-set resolver). The old duplicated `rawConfigProblem` loop in the resolver was removed.
- Error handling: cleanup failures are logged with only the id and message, and the original error is preserved.
- Tests are meaningful: each is red on the pre-fix tree, the guard has a demonstrated mutation, and the valid-create controls show the fix does not over-delete.
- No dead code. The doc comments the change falsified (the `create` HEL-906 narrative and `resolveOneRootSourceId`'s "no undo step") were updated.

### Phase 3: UI Review — N/A
No UI-trigger paths are in the diff.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `PatchSetApplyRollback.deleteInlineRootSources`: if `resultingState` has no `roots` array (for example, a future change to the forward outcome shape), `zip` produces nothing and the edit is reported `rolledBack` without deleting anything. A `log.warn` when `summaryRoots.size != request.roots.size` would make that loud.
- No test pins the "pipeline delete fails → no source delete attempted, `unrecoverable`" branch of Decision 3a. The code is clearly correct by reading, but a stub-repo case would guard it.
- design.md's Risks section says "a spec asserts identical status/message for a class via both entry points". Drift is now structurally impossible because both paths call the same helper, but no such spec exists. Either add one cheap case or reword the risk line.
- `rootShapeProblem` now runs before the null-`sourceService`/`dataSourceService` check, so test wiring without those services gets a 400 shape error before the `InternalError`. This affects test-only wiring; production always wires both.
