## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b07f487642894e1e3ac011713c0ac576e9d971cc`. The base was resolved live with `resolve-review-base.sh` to `eb0521f00c97618ef206f7928d59058da5f3b54f`. There are 3 commits: 0167f9d0e (red), bec60a608 (implementation) and b07f48764 (cycle-2 fixes). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/undo-bound-output-panels/HEL-1720`.

### What I verified (with evidence)

**Diff read in full.** The diff touches `OutputRepository.deleteIfUnboundInternal`, the new `PatchSetUndoBoundPanels`, `PatchSetUndoConflictCheck.guarded`, `PatchSetUndoService` (`deleteCreatedOutput` and `ifStillUnbound` on the pipelineStep, pipeline and dashboard arms), the new `PatchSetUndoBoundOutputPanelsSpec` (8 cases) and an updated `PatchSetUndoLaneSpec` case. No frontend or helio-mcp files changed, and there is no migration.

**AC1: undo never silently deletes a later panel, or a panel another user owns.**
- Phase 1. `PatchSetUndoConflictCheck.checkAll` now calls `guarded`. For the create arms `output`, `pipelineStep`, `pipeline` and `dashboard`, it adds `PatchSetUndoBoundPanels.blocker`. The blocker computes the doomed panels through internal reads and subtracts the `newId`s of the set's `panel` create edits. Any remainder becomes a blocker, which goes down the existing 409 Conflict path with nothing restored.
- The doomed sets are correct:
  - `output` uses `findIdsByOutputIdsInternal`.
  - `pipeline` uses `listByPipelineInternal` to collect all of its Outputs.
  - `dashboard` uses `panelIdsInternal`.
  - `pipelineStep` uses `removedByDeleteInternal`. That is the same pure `removalOf(...).removed` = `tailDescendants + deletedId` that the real delete uses, so it includes the step itself and the non-promoted subtrees.
- Phase 2, Output arm. `deleteIfUnboundInternal` keeps the existing lock order: panels, then pipeline, then `SELECT ... FOR UPDATE` on the Output. It then re-counts the bound panels and returns `Left(n)` without writing anything if any exist.
- Phase 2, other arms. `ifStillUnbound` re-runs the computation just before each delete. The window that remains is the documented V130-class residual (design D4).

**AC2: a test covers the two-user case, on helio_app_test, through the real `PanelService.duplicate`.**
- In the spec, `beforeAll` builds `DbContext(appDb, privDb)`. `appDb` runs `SET ROLE helio_app_test`, a role created `NOSUPERUSER` and therefore NOBYPASSRLS by default. No migration or test alters it to BYPASSRLS (grep found none). `privDb` runs `SET ROLE helio_privileged`, mirroring prod.
- The test calls `appPanels.duplicate(aPanel, otherUser)`, which is the real `PanelService` on the app pool. It asserts `copy.ownerId shouldBe otherUser.id` and that the copy's `output_id` is A's Output. It then asserts that A's undo is a `Conflict` naming `"A later panel (copy)"`, and that B's panel, A's panel and the Output all survive.

**Mutation spot-check (my own run, reproduced).**
- I replaced `if (!PatchSetUndoBoundPanels.guards(edit)) own` with `if (true) own` in `PatchSetUndoConflictCheck.scala` and ran the full spec file. Result: `Tests: succeeded 3, failed 5`. The 5 failures were two-user, same-user, dashboard, pipeline+unreadable and pipelineStep-descendant. This matches the executor's mutation (a) record exactly.
- I reverted with `git checkout --`. The sha256 is identical before and after (`fbb65717…`), and `git status` is clean apart from the evaluator's untracked `evaluation-2.md`.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1720/evidence/.concertino/scratch/HEL-1720/skeptic-mutation-a.txt`.
- The failure output shows defence in depth. With Phase 1 disabled, the Phase-2 guards still stopped every deletion (each outcome was `failed`, with the log line "N panel(s) were bound during the undo"). The tests fail on the missing Conflict, not on a lost panel.
- The other mutations (b to f) are recorded in `evidence/mutations.txt` with plausible targeted reds. I did not re-run them.

**No disclosure of other tenants.**
- `describe` names a panel only when both `panelRepo.findById(_, Some(user))` and `dashboardRepo.findById(_, Some(user))` succeed. Otherwise the panel is only counted.
- Lookups are capped at 10, and the rest appear only as "and N more".
- The pipeline-arm test asserts that B's private panel title, board name and panel id are absent from the 409 message, and that "1 panel(s) on dashboards you cannot see" is present. It passed in my run.
- Logs: the only new log path is the ERROR line in `restoreAll`. Its reason is `boundDuringUndo(n)`, a fixed phrase plus a count, and two tests capture that log and assert no id or title appears in it.
- `ServiceResponse` does not log Conflict messages: grep shows the Conflict branch only maps the status code.

**helio-mcp and web accuracy.**
- The `undo_patch_set` description at `helio-mcp/src/tools/refinement.ts:125-133` says "if any touched resource changed since the apply … the whole undo is refused and nothing is touched". A created resource that gained panels has changed, so the description remains accurate.
- Web: `undoPatchSet.rejected` uses `err.response.data.message`, and `PatchSetReviewPage.tsx:131-136` pushes it as an error toast. The 409 message naming the panels therefore reaches the user.

**Regression suites (my own runs, full spec files, `nice -n 19 sbt -J-Xmx3g`).**
- Shard 1, exit 0, `Tests: succeeded 104, failed 0`. It covered all 13 `PatchSetUndo*Spec` files (including BoundOutputPanels, Lane, LaneDescendants, Refusal, Routes, PanelDashboard, Inverse and GhostLayout), plus `PatchSetOutputCreateSpec`, `PatchSetRollbackLaneStepSpec`, `DraftSaveUndoSpec` and `DraftSaveRootsUndoSpec`. All 8 HEL-1720 cases and the updated Lane case are listed as passing. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1720/evidence/.concertino/scratch/HEL-1720/skeptic-shard1.txt`.
- Shard 2, exit 0, `Tests: succeeded 107, failed 0`. It covered every remaining spec that calls undo (`Hel914Ac1EndToEndSpec`, `LayoutPolicySpec`, `DashboardServiceLayoutPolicySpec`, `OutputRepositoryRequiredSpec`, `PatchSetApplyServiceSpec`) plus `PatchSetRoutesSpec`, `PatchSetInsightOutputSpec`, `PatchSetDashboardGrantSpec`, `PatchSetPipelineStepGrantSpec`, `PatchSetInlineRootRollbackSpec` and `PatchSetApplyFormCreateSpec`. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1720/evidence/.concertino/scratch/HEL-1720/skeptic-shard2.txt`.

**Debugging law.** The root cause was probe-confirmed: red commit 0167f9d0e, `evidence/red-run.txt` showing 2 failures, and the design's finding that FK cascades bypass the explicit-DELETE mutation. The regression tests exercise the fixed path, and my mutation proves it.

**Owner-ruling conformance.** The undo is all-or-nothing with a 409. Readable panels are named and the rest counted. The guard covers exactly the four ruled arms. Draft-save undo is untouched (HEL-1792).

**UI step skipped.** There are no UI changes.

**mtime evidence.** No conclusion here depends on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- In the rare Phase-2 race, where a bind lands after Phase 1, the response is 200 with an edit `failed`. The web `undoSuccessToast` still says "Undone." because it does not inspect `failed` statuses. The panel is not deleted, so AC1 holds. This toast behaviour predates the change (HEL-413's partial tier) and could become a small follow-up.
- `removedPlacementCount` on a pipelineStep-create undo is now effectively always 0. The executor already lists it as a follow-up candidate.
- `PatchSetUndoLaneSpec` has the `case other =>` arrow over-indented. This is cosmetic; the evaluator's format check covered it.
- The `dataSource` create arm is outside the owner-ruled set. Its delete depends on HEL-987's user-scoped `findReferences`, and I did not check its cross-user story. If anyone wants certainty that no other arm cascades another user's panels, that should be its own ticket.
