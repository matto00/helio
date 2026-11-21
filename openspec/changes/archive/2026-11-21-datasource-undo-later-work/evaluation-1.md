## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: c50523a280a0c94c2c31649a6bd3180a58016e27 (impl) on 4ade5d2ad (red). Diff base resolved live:
ebfeb6af76fdb594e072e46458d660c423a1db63 (merge-base with origin/main; main has since gained 626cf9852 HEL-1799,
which touches none of this lane's files).

### Phase 1: Spec Review — PASS

- AC premise check: recorded in premise-validation.md and probe-notes.md. The red run shows the real loss:
  appends, form submits, row edits, schema edits and replaces all returned 200 and cascaded the rows. A later
  pipeline or form panel produced a partial undo (`[failed, restored]`) whose ERROR log printed pipeline, panel and
  dashboard ids.
- Owner rulings are honored: appended rows, apply-era row edits and schema edits each refuse with a 409. Nothing is
  restored and the messages carry counts only. Row deletes do not block a journaled apply. References are named via
  `PatchSetUndoBoundPanels.nameList`, the rest are counted, and no ids appear.
- Tasks 1.1 to 4.3 are marked done and match the code. Task 5.1 (the D9 follow-up triage) is the orchestrator's
  Delivery step and is correctly left open.
- Scope is clean. The changed files are limited to `services/patchsets/*`, `PatchSetApplicationRepository`, two new
  read-only methods on `DataSourceRepository`, the README and the new spec. There are no edits to
  `DataSourceService` (no row-write methods, no form submit path) and none to `helio-mcp`/MCP analyze files, which
  belong to HEL-1800 and HEL-1799.
- There is no wire change. The REST 409 body, MCP `undo_patch_set` ("the whole undo is refused", helio-mcp
  refinement.ts:131, unchanged) and the web undo toast are unaffected (tests below).
- The `JournaledEdit` change is additive. `createdDataset` defaults to `None`, its format is declared before
  `journaledEditFormat`, and an old-shape row parses to `None` (tested).
- CONSTRAINTS C1/C2/C3/C4/C5/C14 were honored by this review. On C12 (red first), see the note in Non-blocking.

### Phase 2: Code Review — FAIL

Gates I ran myself, in WORKTREE_PATH at c50523a28:
- `sbt testFull` in 7 shards (HELIO_TEST_SHARD_COUNT=7, `-J-Xmx3g`, `nice -n 19`): every shard exited 0 with
  `hel1468-guard failed=0 aborted=0`. Counts were 581 + 1736 + 1323 + 1556 + 2108 + 1422 + 1504 = 10,230 succeeded,
  0 failed (5 canceled, all pre-existing assumption-cancels).
- `testOnly com.helio.services.patchsets.* com.helio.services.sources.* com.helio.infrastructure.persistence.patchsets.* com.helio.infrastructure.persistence.sources.*`:
  934 succeeded, 0 failed.
- `npm run check:scala-quality`: clean (soft size warnings only). `check:openspec`, `format:check` and
  `check:repo-integrity`: clean.
- Web toast and patch-set slice (`frontend/src/features/patchSets`, jest 3 workers): 8 suites, 80 passed. MCP
  refinement tests (`helio-mcp/src/tools/refinement*`): 3 suites, 17 passed.

Red-first, re-verified independently in a throwaway detached worktree at 4ade5d2ad (since removed):
- The red commit is test-only (one file, the spec).
- Against the old code: 4 passed (RLS assert, probe, clean undo, lone delete) and 9 failed, each for the defect
  reason ("expected a Conflict, got Right(...)", or `[restored, restored]` for the Phase-2 test).

The spec runs on `helio_app_test` (`SET ROLE helio_app_test`, NOBYPASSRLS) and asserts `rolbypassrls = false`. It
drives the real `PatchSetUndoService.undo`.

Mutations I re-ran myself (throwaway worktree at c50523a28):
- describe-swap (`used <- refs.map(_.map(_.describe))`): RED, 3 failures.
- An id-leaking name variant (append `(${p.id})` / `(${p.dashboardId})` to the named parts): RED on
  `should not include <id>` in both reference tests. So the no-id assertions really discriminate.
- appended `createdAt > threshold` changed to `>=`: RED, 6 failures (clean-undo precision, form submit, append,
  delete-then-append, lone delete, Phase 2).
- edited `createdAt <= threshold` changed to `<`: RED, 1 failure (edited-row test).
- fallback `changedSinceApply = w.sourceUpdatedAt.isAfter(appliedAt)` changed to `false`: RED (legacy lone-delete
  test).
- The Phase-2 reference-conflict mapping in PatchSetUndoService.scala:126 reverted to `_.left.map(_.err)`:
  **SURVIVED**. All 407 `com.helio.services.patchsets.*` tests passed. See Change Request 1.

Code checks:
- Phase-1 wiring sits correctly in `checkOne`'s `("dataSource","create")` arm (PatchSetUndoConflictCheck.scala:85-93),
  not behind `guarded`'s `PatchSetUndoBoundPanels.guards`.
- The Phase-2 re-check (`ifNoLaterDatasetWork`, PatchSetUndoService.scala:169-177) uses the same `blocking`
  predicate. Its failure phrase is count-only and was asserted at ERROR in the spec. The change to
  `PatchSetUndoService` is minimal: one arm and one 8-line helper.
- Counts read on the privileged pool (`withSystemContext`) through aggregate `length` queries, with no row data read.
  The read-back of `created_at` happens on the applier's context, and a failure degrades to `None` with a WARN that
  carries no id.
- Issues:
  1. **Untested new code path (Tests meaningful).** PatchSetUndoService.scala:126 maps any `DataSourceDeleteError`
     that carries a conflict to `PatchSetUndoDatasetLaterWork.gainedUseDuringUndo`. Design D7 commits to this so
     that "the `failed` outcome and its log line hold no id". No test exercises it: reverting it passes the whole
     patch-set suite. The red log shows what a revert would bring back: `ERROR ... undo restore failed ...
     referenced by pipeline(s) 'Later pipeline 1796' (42186e52-...; as root)`. That is ids at ERROR, which the owner
     ruling forbids at INFO and above.
  2. **Dead code.** `PatchSetUndoDatasetLaterWork.guards` (PatchSetUndoDatasetLaterWork.scala:26) has no caller
     anywhere in `backend/src`. The Phase-1 arm and Phase-2 arm both dispatch on `(targetKind, op)` directly. In the
     spec: the import of `JournaledCreatedDataset` (PatchSetUndoDatasetLaterWorkSpec.scala:34) is unused, and
     `appOutputs` (:52, assigned :118) and `appDsRepo` (:56, assigned :113) are assigned and never read.

### Phase 3: UI Review — N/A

This is a backend-only change. No file under `frontend/**`, `schemas/**`, `openspec/specs/**` or `ApiRoutes.scala`
changed (the spec delta lives under `openspec/changes/`). As briefed, I limited the review to confirming that the web
undo toast and patch-set slice tests still pass (80/80). No servers were started.

### Overall: FAIL

### Change Requests

1. Add a deterministic test (no sleeps) for the reference-landed-during-undo backstop in
   `PatchSetUndoDatasetLaterWorkSpec`. Suggested shape: a `DataSourceRepository` subclass whose
   `datasetLaterWork`, on its second call (the Phase-2 re-check), inserts a `pipeline_roots` row on the created
   source through `privDb` before it returns the super result. `DataSourceService.delete`'s `findReferences` then
   refuses. Assert all of the following:
   - the edit's status is `failed`;
   - the ERROR log line contains `the data source gained a use during the undo; nothing further was undone`;
   - the ERROR log line contains neither the pipeline id nor the source id;
   - the source and its rows remain.

   Confirm that the test goes RED when PatchSetUndoService.scala:126 is reverted to `_.left.map(_.err)`, and record
   that mutation in the mutations evidence.
2. Remove the unused `def guards` at PatchSetUndoDatasetLaterWork.scala:26. In the spec, remove the unused
   `JournaledCreatedDataset` import (:34) and the never-read `appOutputs`/`appDsRepo` fields (:52/:56, :113/:118).

### Non-blocking Suggestions

- PatchSetUndoService.scala:126 is now 290 characters. Consider extracting the delete-and-map lambda into a small
  private helper, for example `deleteCreatedSource(id, user)`. Fixing CR1 is a natural moment for it.
- PatchSetApplyService.scala:135 uses a mutable `ConcurrentHashMap` side channel for `createdDatasets`, while the
  same loop threads `children` and `rawConfigs` as immutable maps. Threading a `Map[Int, JournaledCreatedDataset]`
  the same way would match the surrounding style. The loop is sequential, so concurrency is not needed.
- C12 note: 5 of the 18 tests were added only in the impl commit and never shown red: both legacy-journal tests,
  the journal round-trip, the zero-row create, and the hidden-pipeline count. Design D8 listed "an old-journal
  fallback case" among the red tests. These tests do discriminate (the fallback mutation above goes red on them),
  so I am not blocking on this. A future lane should land such cases in the red commit, with any line that needs
  the new field split out.
- The form-submit scenario calls `appendFormRow` directly as `otherUser` with a synthetic `PanelId("p")` rather
  than through a real editor grant and form panel. This is acceptable, because the guard does not depend on the
  write path, but it is narrower than the spec scenario's wording.
- The branch's merge-base is ebfeb6af7, and main now also has 626cf9852 (HEL-1799). It touches none of this lane's
  files, but CI will run on the merged tree.
