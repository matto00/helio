## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `fb3c2a6df500d78f3ab9459924e75b1ac5f20eaa` against live base `737adb3525afa48d2f75576f948221910b732f8d` (resolve-review-base.sh).
Evidence directory (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1707/evidence/.concertino/scratch/HEL-1707/eval1/`

### Phase 1: Spec Review — FAIL

Issues:
- The production behaviour matches the plan. Every editor-reachable writer in D2 re-checks access right after lock (3): root add, root remove (`removeRootCascadeAction`), draft save (after `abortIf(!locked)`), attachTail, spliceInsertReporting (so duplicate is covered too), update (`lockPipelineOfStepRechecked`), delete (inside each attempt), reorderTrunk, plus Output delete and undo (D5). The C3 handling is in place: `.headOption` returns `PipelineGone`, and so does a `false` lock result. The three uncalled `insert*/reorderInternal` writers are untouched (C1). The D2 refusal bodies match the existing pre-checks: `Forbidden("Forbidden")` equals `Forbidden()`, and the not-found strings match `PipelineRootWrites.scala:87/142`, `PipelineStepWriteChecks.scala:94/153` and `PipelineStepWrites.scala:101`. The typed refusal is recovered before `classifyDbError` at every site. `deleteStep` and `OutputService.delete` gain a narrow recover only.
- D3 holds. No re-check reads `actingUserId`. Each re-check takes the new required `actor`/`user` parameter (no default), and in `DraftSaveTransaction` the `actor` is the caller, the same one that is journalled and audited.
- **D6 / tasks 1.2 not met for one route (red for the wrong reason):** the `PUT /steps/order` race cases send `ReorderPipelineStepsRequest(Seq(s.t4, s.t1))`. The seeded trunk union is {t1, t2, t4}, so this is not a valid permutation. On main the request answers `422 ... missing trunk step ids: t2` and writes nothing whether or not the grant is revoked (red-run.txt, the two reorder lines). D6 requires each red to be red "for the stated reason (500 / write landed)". For reorder, the "write nothing" assertion is vacuous, and mutation m8 is red only because 422 is not 404. I verified this in a throwaway worktree, with the reorder re-check removed and the request changed to the valid permutation `Seq(t4, t2, t1)`. In both cases (revoked, downgraded) the revoked editor's reorder lands (`Right(Vector(LimitStepResponse(... t4 ..., t2 ..., t1 ...)))`, mut-run2.txt). With the real implementation restored, the same valid-permutation cases are green (mut-run3.txt). So the code is right, but the committed test cannot catch a reorder write landing after a revoke.
- AC (1) through (4) are otherwise addressed. The red run was committed (252d1b525, the .txt alone) before the implementation (fb3c2a6df). No migration was added, and the grants are confirmed real (V129, V137).
- Constraints C1, C2 and C3 are honoured in the diff.

### Phase 2: Code Review — PASS (gates); test-quality issue counted under Phase 1

Gates I ran myself (fresh evidence, all in the worktree; each log's project-path lines name this worktree):
- `sbt Test/compile`: exit 0.
- Shard 1, the new and extended specs (PipelineGrantRecheckRaceSpec, OutputDeleteCurrentAccessRlsSpec, PipelineRootEditorGuardsRlsSpec, PipelineRootWriteGrantsSpec): 4 suites, 34 tests, 0 failed (shard1.txt).
- Shard 2, all 18 specs touched mechanically: 538 succeeded, 0 failed (shard2.txt).
- Shard 3, `*DraftSave* *PatchSetUndo* *PatchSetPipelineStepGrantSpec`: 31 suites, 439 succeeded, 0 failed (shard3.txt).
- Shard 4, `*PipelineStep* *PipelineRoot* *PipelineService* *PipelineSharing* *PipelineEditor* *Output*Routes*Spec *OutputService* *OutputRepository*`: 43 suites, 1308 succeeded, 0 failed (shard4.txt).
- The hel1468 guard reported `failed=0 aborted=0` on every shard.
- `check:scala-quality` (clean, soft size warnings only, none new as a hard failure), `check:openspec`, `check:spec-structure`, `check:repo-integrity`, `format:check`: all exit 0.
- Full `sbt testFull` was not run as a single command because of the 600 s per-command cap. The shards above cover every touched spec and the related root, draft, step, Output and undo families.

Mutation spot-checks, run independently in a throwaway detached worktree at HEAD (removed afterwards):
- D4 1(b) combined: removing the lock-Boolean check and mapping the predicate's `PipelineGone` to `Owner` turns 1(b) red with the FK `PSQLException`. This matches evidence m1b.
- m8 (reorder re-check removed): red only as 422 vs 404, as described above.
- The other evidence files fit their stated branches. m6 (splice) also fails the duplicate cases, as it should because duplicate delegates to splice. m1b-lock-boolean-only stays green, as the design states. m12 vs m13 behaves as the design states. The evidence files record only test output, not the mutation diff itself (see suggestions). The working tree is clean, and HEAD contains every re-check, so the mutations were reverted.

Code-quality checklist: imports are at the top of the file with no inline FQNs, the shared predicate is a single unit (DRY), types are explicit, and errors are handled at the service boundary with narrow `.recover`s. There is no dead code. The comments carry the reasoning inline with each HEL ref.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/services/pipelines/PipelineGrantRecheckRaceSpec.scala:142`: change the reorder request to a valid trunk permutation that actually reorders, for example `ReorderPipelineStepsRequest(Seq(s.t4, s.t2, s.t1))`, so the "write nothing" assertion can fail. Then re-record the evidence:
   - Re-run this case on unmodified main code (737adb352). It must be red because the write landed (`Right(Vector(...))`), not because of a 422.
   - Re-run mutation m8 against it. It must be red with `Right(...)`.
   - Replace `evidence/mutation-m8-reorder-recheck.txt` and append the corrected reorder red lines to the red-run evidence, or add an addendum file. Note in the addendum that the original reorder red was a 422 from an invalid permutation.

### Non-blocking Suggestions
- `OutputDeleteCurrentAccessRlsSpec` undo case: also assert the edit's reported outcome (`"failed"` for that edit index, per `PatchSetUndoService.scala:102`), not only that the Output still exists. The spec delta says the undo "reports" the refusal.
- The spec delta covers a creator with "no grant" (revoked) on `DELETE /api/outputs/:id`, but only the downgrade-to-viewer case is tested. Add a revoked-creator case, or state why it is already 404 on main.
- Mutation evidence files would be stronger if each recorded the one-line diff it applied, not only the test output.
- `DraftSaveTransaction.scala:12-13`: the new `com.helio.services.pipelines.PipelineWriteRefusal` import sits between infrastructure imports, and the selector list starts with `PipelineWriteAccess` out of order. This is cosmetic.
