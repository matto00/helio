## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `e48be17bdc1a2c535e94ff54e199c74fa87d5b80`. Base resolved live with `resolve-review-base.sh` (main, origin): `c939f378146d5614be8e8c4cc12b9466dae08b15`.
Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1882/evidence/.concertino/scratch/HEL-1882/skeptic/`

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/editor-grant-write-recheck/HEL-1882`.
- **Full diff read** (`git diff c939f378...HEAD`). It touches 6 production files.
  - **D1 Output create.** In `OutputRepository.insertInternal`, the new `actor` is required (it has no default). `requireAction(pipelineId, actor)` runs right after `lockPipelines(OutputCreate)` and before `insertInternalAction`, all in one `withSystemContext` transaction. `OutputService.create` composes `.recover(PipelineWriteRefusal.refused(NotFound("Pipeline not found")))`: Viewer maps to `Forbidden("Forbidden")` and anything else to the pre-check's NotFound. No new `ServiceError.Forbidden(` producer; ExistenceNotLeakedRoutesSpec is green. `restoreBoundOutputs` passes `actor = user`.
  - **D2 Backfill.** `findByIdShared` is kept. `currentWriteAccessInternal(...).mayWrite` is checked before `evaluateAndPersist`. `overwriteRows(..., guard = Some(requireAction(...)))`: the guard is the transaction's first action (`NodeSnapshotRepository.scala:209`, `guard.fold(action)(g => g.andThen(action)).transactionally`). The schema update is sequenced after a successful overwrite. With `git diff -w`, the extracted body shows as whitespace-only.
  - **D3 PATCH.** `updateOwned` reads `pipeline_id` and then runs `requireAction` and the updates in one `transactionally` block on the user context. The empty body goes through the same guarded block. `OutputService.update` recovers `PipelineWriteAccessRevoked` as `None`, which gives the existing 404 "Output not found".
  - **D4 Insight.** `requester = Some(user)` is passed only from `refresh` (`InsightRenderService.scala:113`). The run trigger (:99) and the tick (:164) pass none. The check is the first step of `renderGuarded`, before `findByIdInternal`, any `noSend` row, the quota charge and the send. `Refused` returns no row, and `inFlight` is released by the existing `andThen`.
- **Production call sites (grep of `backend/src/main`):**
  - `insertInternal` has 2 callers: `OutputService:159` and `PatchSetUndoRestorers:176`.
  - `updateOwned` has 1 caller: `OutputService:257`.
  - `startRender` has 3 callers, matching files-modified.md.
- **Test churn is mechanical.** I read the diffs of the files with the most churn (OutputRoutesSpec, PipelineRunServiceSpec, InsightRenderServiceSpec/Fixture). The only change is `actor = AuthenticatedUser(<the ownerId argument>)`. The RaceLocks extraction matches the removed private class; the one difference is an explicit `ExecutionContext.parasitic` in `choose`. No assertion was changed.
- **Green on HEAD (my run).** I ran the 4 new specs, OutputWriteGrantPatchSetRlsSpec, ExistenceNotLeakedRoutesSpec and PipelineGrantRecheckRaceSpec on the lane DB with `-J-Xmx3g` and nice 19. Result: `Suites: completed 7, aborted 0` and `Tests: succeeded 124, failed 0`. Evidence: `green-head.txt`.
- **Red reproduced on the stated base (my run).** I checked out `353dd3f78` for `backend/src`; its production code is base plus the 5-line render-observer seam (`git diff --stat` confirmed). Result: `Tests: succeeded 18, failed 15`. Each red fails for its stated reason:
  - create: "the Output was created: Right(...)"
  - backfill (a) and (b): "snapshot rows written: Vector(...-t2|0)"
  - PATCH: 200 body with `"name":"renamed"`, and `Right(...renamed...)`
  - insight: `Wrote(Ok,true); sends=1`
  - Every GUARD was green. Afterwards I ran `git checkout HEAD -- backend/src` and the tree was clean again. This matches the committed `red-run.txt`. Evidence: `red-base.txt`.
- **Mutations (my run, each restored).**
  - Batch 1 removed the create re-check, the PATCH re-check and the insight check, and set the backfill guard to `None`. 13 tests went red: both create reds, all 5 PATCH reds, all 4 insight reds, and both backfill (b) tests. Backfill (a) stayed green as expected, because the start check was still there. Evidence: `mut-batch1.txt`.
  - Batch 2 removed the backfill start check and mapped Viewer to NotFound in create. Backfill (a) went red twice with `overwriteRows calls 1 was not equal to 0`: the zero-calls assertion discriminates even though the in-tx guard still refuses. Create (downgraded) went red with `Left(NotFound) was not equal to Left(Forbidden("Forbidden"))`. Evidence: `mut-batch2.txt`.
- **Refusals write nothing and answer the existing status and body.**
  - Create: the GUARDs pin the route bodies `{"message":"Pipeline not found"}` (404) and `{"message":"Forbidden"}` (403), and the race reds assert the same `ServiceError` values plus zero Output rows.
  - PATCH: 404 `{"message":"Output not found"}` and the stored name/config are unchanged.
  - Backfill: no `node_snapshots` rows and the schema stays `[]`.
  - Insight: zero sends, no `output_insights` row and the owner's counter is 0, on a beta-tier owner.
  - Patch-set apply: 200 with set failure "Output not found". Undo: edit status "failed". Neither is a 5xx (OutputWriteGrantPatchSetRlsSpec, green).
- **NOBYPASSRLS.**
  - The PATCH and patch-set specs use `DraftSaveApiFixture` (non-BYPASSRLS app pool, line 7 doc).
  - InsightRefreshGrantRecheckSpec calls `assertAppPoolEnforcesRls()`.
  - The X2 user-context `requireAction` read of `pipelines` and `resource_permissions` works under RLS for a downgraded viewer. The probe and red tests show the downgrade is detected and refused on that pool.
- **Broader regression shard (my run):** OutputRoutesSpec, PipelineRunServiceSpec, InsightRenderServiceSpec, every `services.patchsets.*` and `api.routes.patchsets.*` spec, DraftSaveRlsSpec and PatchSetOutputCreateSpec. Result: `Suites: completed 63, aborted 0` and `Tests: succeeded 840, failed 0`. Evidence: `shard-broad.txt`. I did not re-run the full 801-suite run the evaluator reports. Its cycle-2 delta is whitespace and an import only, and every directly affected suite was re-run here.
- **Quality gate:** `node scripts/check-scala-quality.mjs` exited 0.
- **Spec deltas:** the MODIFIED requirement "DELETE /api/outputs/:id requires current pipeline edit access" exists in `openspec/specs/output-routes-api/spec.md:594`.

### Acceptance criteria trace
1. **Red-first race test per path; revoke/downgrade between admission and write; nothing written; existing refusal; failable by mutation; red run committed before the fix.**
   - Create: OutputCreateGrantRecheckSpec (2 reds).
   - Backfill: OutputBackfillGrantRecheckSpec (4 reds).
   - PATCH: OutputPatchGrantRecheckSpec (5 reds).
   - Insight refresh: InsightRefreshGrantRecheckSpec (4 reds).
   - All were reproduced red by me and mutation-failable. The red-run commit `353dd3f78` precedes the implementation commit `a734ec796`.
   - Scope is the pipeline side only, per owner ruling Q1=A. Dashboard-editor writes are HEL-1889, so this AC is met as re-scoped.
2. **Non-race behaviour unchanged:** GUARD tests for owner and current editor on every path, a non-creator editor PATCH, a revoke-before-read on backfill, the automatic render and the viewer admission. The one intentional exception is X2 (owner ruling Q2), and it is pinned red-first.
3. **NOBYPASSRLS run for repo changes on RLS tables:** the `updateOwned` change runs on the user context and is tested on the non-BYPASSRLS fixture. The other repository changes run on the system context.
4. **Full spec files for touched specs, plus ExistenceNotLeakedRoutesSpec:** yes, my runs above and the evaluator's full shards.

### Verdict: CONFIRM

### Non-blocking notes
- The insight refusal is silent to the requester: the response is `202 started=true` and `lastAttempt` is unchanged. This is consistent with Q3 ("writes nothing"), but the PR body should say so.
- The patch-set rollback refusal outcome ("unrecoverable") is recorded from reading the code, not from a test. The design accepts this as a race-only partial state.
