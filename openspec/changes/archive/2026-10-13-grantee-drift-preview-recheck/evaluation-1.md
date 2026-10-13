## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `3cb2641fa45406d2820eaa1d1024564aebf42a38`. Diff base, resolved live: `d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc`.
I re-ran everything below myself. None of it is taken from the executor's report.

### Phase 1: Spec Review — PASS
- AC1: analyze reads the baseline with `findLastSourceSchemaInternal(pipelineId)`, keyed by the id `findByIdShared` has already
  authorized. The diff's current schema comes from `findByIdOwnedByInternal(primaryDsId, pipeline.ownerId)`
  (PipelineAnalyzeReads.scala:99-104, :158-161). That mirrors the capture side. The rest of the response stays in the caller's view.
  The test runs as a NOSUPERUSER NOBYPASSRLS role and is red on main for BOTH editor and viewer (see below).
- AC2: `guardedExecution` wraps both `backend.execute` sites (source arm :196, step arm :267). The empty-roots branch
  now answers 404 when the pipeline is gone and 422 otherwise (:155-161). Live owner, editor and viewer previews are pinned green.
- The assumed product calls A1 (grantee sees the owner's drift), A2 (viewers keep non-AI previews) and A3 (a deleted
  pipeline answers 404, not 422) are recorded in design.md. They are not silent reinterpretations. Per the driver rules
  the PR is parked for OWNER REVIEW.
- All tasks are ticked, and they match the code. There is no scope creep and no migration or API-shape change. The spec deltas match the
  behavior. `check:openspec` and `check:spec-structure` are clean.
- C2 is honored. Seam R revokes at `listRootDataSourceIdsInternal` inside `previewAtNode`, after its own
  `findByIdShared`, which is the last ACL read. S1 deletes after `previewAtNode`'s `findByIdShared`. S2 deletes at the step-list read.
  Defect cases (a), (d), (e) and (f) are red on main. Guards (b) and (g) fail under M2 and M5. (c) is labelled as a pin.

### Phase 2: Code Review — PASS
Gates run fresh, in this worktree, foreground, with `nice -n 19` and `-J-Xmx3g`:
- `Hel1516GranteeDriftPreviewSpec` on HEAD: 10 succeeded, 0 failed.
- Run 1 (ExistenceNotLeakedRoutesSpec, Hel1503EditorRunGapsSpec, PipelineRunServiceSpec,
  PipelineRunEditorPersistenceSpec): 4 suites, 188 tests, 0 failed. ExistenceNotLeakedRoutesSpec passing confirms
  that `PipelineRunPreview.scala` still has exactly 1 `Forbidden` producer.
- Run 2 (OutputRoutesSpec, PipelineRunRoutesSpec, PipelineAnalyzeRoutesSpec, PipelineAclSpec,
  PipelineAnalyzeServiceSpec): 5 suites, 338 tests, 0 failed.
- `check:scala-quality`: clean (soft size warnings only). `check:test-temp-dir-hygiene`: clean.
- I did not run the full `sbt testFull` (it would exceed the 600 s cap). That is left to CI.

**Red-proof masking (the orchestrator's specific concern): resolved by an independent unmasked run.** The executor's loop tests
stop at the first failing iteration, so red-run.md shows only `editor` and `stepBound=true single=true` red. I made a
throwaway detached worktree at the base SHA, copied the spec into it and wrapped every loop iteration and multi-assert in a
ScalaTest `Checkpoint`, so all failures are reported. I ran it on unchanged main. All 6 defect tests are red,
and **every iteration is red**:
- (a) `EDITOR: None was not equal to Some(...extra...)` and `VIEWER: None was not equal to Some(...extra...)`
- (d) `editor got Right(RunResultResponse(...))` and `viewer got Right(RunResultResponse(...))`
- (e) all 8 combinations, {editor, viewer} x {stepBound true, false} x {single true, false}, `got Right(PipelinePreviewResponse(...))`
- (f) S1 step: `Left(UnprocessableEntity(DataSource not found ...))`. S1 single-Output: both `stepBound=true` and `stepBound=false`
  give `Left(UnprocessableEntity(...))`. S2: the step gives `Right(...)`, the output gives `Right(...)`, and `S2 executions: 2 was not equal to 0`.
- `Tests: succeeded 4, failed 6`. The guards and pins pass on main, as their labels say.

Mutations I ran myself on the fixed code (in the same throwaway worktree, with the unmasked spec):
- **Source-arm-only** (my own, not one of the executor's): drop `guardedExecution` on the source-level arm. This makes (e) red for exactly the 4
  `stepBound=false` iterations and nothing else. The source-arm re-check is load-bearing and covered by the tests.
- **M1 + M5 together** (they touch disjoint tests): (a) is red for EDITOR and VIEWER (`None`). (g) is red with `viewer got
  Left(UnprocessableEntity(Pipeline execution failed at step ... (analyzewithai) ...))`. Result: 2 failed.
- **M2**: (a) is red for both roles (every baseline column reported "removed"). Guard (b) is red with `Some(...removedColumns name, score...) was not
  equal to None`. Result: 2 failed.
These confirm the executor's M1, M2 and M5 claims. I did not repeat M3, M4a or M4b. The source-arm mutation plus the unmasked red
cover the same seams. The throwaway worktree has been removed (`git worktree list` shows no straggler).

Code-quality findings (none blocking):
- The predicate in `checkPreviewAccessInternal` (PipelineRepository.scala:205-220) matches `findByIdShared`'s grant predicate
  (resource_type `pipeline`, resource_id, grantee_id) plus the editor filter. So no live grantee who passes the ACL read can be
  refused by the re-check. It uses `withSystemContext` and carries a justification comment, as CONTRIBUTING requires.
- `ServiceError.Forbidden` is reached only after `findByIdShared` returned the pipeline. That is consistent with the
  existence-not-leaked rules, and the classification comment was updated.
- There are no inline FQNs, no `any`/`asInstanceOf` escape hatches in production code, and no dead code. `findGrantRole` is still used elsewhere.
- Tests are meaningful: a spy backend counts executions and a spy AI client counts model calls.

### Phase 3: UI Review — N/A
Backend only. The diff touches no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- PipelineRunPreview.scala:197-216: the source-level arm's body was not re-indented inside `guardedExecution(...) {`.
  The step arm (:267+) was. A one-level indent would make the wrapped scope visible.
- Hel1516GranteeDriftPreviewSpec.scala:250-259, :281-289, :294-304, :320-330, :332-343: the multi-role and multi-arm loops
  stop at the first failure, so a red run reports only one iteration. Wrapping each iteration in a ScalaTest `Checkpoint`
  (or registering one test per iteration) would make the red record self-evident. I verified it independently, above.
- red-run.md section 3 says the raw mutation outputs were "captured by a scratch script" but does not persist them. Persisting them
  would make the mutation table self-authenticating.
- CONTRIBUTING's ~400-line rule: PipelineRepository.scala grows from 728 to 765 lines and PipelineRunPreview.scala from 298 to 315. Both were
  already over budget before this change. The PR description should propose a split, as CONTRIBUTING asks.
