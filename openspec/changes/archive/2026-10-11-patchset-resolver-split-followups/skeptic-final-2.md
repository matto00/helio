## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `1c02ef6076ac2ff313e99937d3020ef7855df8a4`. Base resolved live with `resolve-review-base.sh` (main/origin): `dae4bc4516791452ad5b3e27e871d39771bbd5a6`. The branch has two commits, 53a291a16 and 1c02ef607. No UI change, so step 4 does not apply.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/patchset-resolver-split-followups/HEL-1482`.
- **Round-1 CR1 (comment attribution): fixed and accurate.** `PatchSetPipelineResolvers.resolvePipelineCreate` now credits:
  - the blank-id 400 to `PipelineRootWrites.resolveOneRootSourceId`. Its `(Some(_), None)` arm returns `BadRequest("roots: sourceId is required and must not be blank")` without an ownership lookup.
  - the unresolvable/unowned-id 404 to `PipelineCreateWrites.lookupOwnedRoots`. That method calls `findByIdOwned`, which returns `NotFound("Data source not found: …")`.

  I read both members, and the comment matches the code.
- **Round-1 CR2:** `citation-sweep.md` row C now records the split credit and no longer claims "ownership 404" for `resolveOneRootSourceId`.
- **Main code is comment-only (CR3 / C1).** I filtered `git diff dae4bc451...HEAD -U0 -- backend/src/main` for changed lines whose first token is not `//`, `*`, `/**` or `*/`. Zero hits (grep exit 1). I also read the full 7-file diff by eye: every hunk is doc or comment text.
- **Item 7 (priority): I re-proved it with my own mutations.** Runner: `/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/skeptic2/run.sh`. Logs and `summary.log` are in the same directory. Each run applies one mutation by line number, runs `nice -n 19 sbt -batch -J-Xmx3g testOnly`, and restores the file with `git checkout` under a trap. Every log shows `[hel1468-guard]`. After the run `git status --short` was empty, and no sbt JVM had this worktree as its cwd. All mutations are in `PatchSetApplyResolvers.scala`.

  | Run | Mutation | Spec | Result |
  |---|---|---|---|
  | Unmutated, HEAD 1c02ef607 | none | PipelineStepGrant, DashboardGrant, ResolverMessages, ExistenceNotLeakedRoutes | 85/85 green, exit 0 |
  | MA | L211 `case Some("editor") => Right(())` changed to `Left(ServiceError.Forbidden())`. This breaks the editor-grant branch in the opposite direction to round 1's M7a/M7d. | PipelineStepGrant | RED, exit 1. All 4 editor tests fail: update, delete, create, preview. The 5 others pass. |
  | MB | L194 `authorizeEditorOnDashboard` `Viewer => Left(Forbidden())` changed to `Right(())` | DashboardGrant | RED, exit 1. The 3 viewer panel tests fail: update, delete, create. |
  | MC | L117 `resolveDashboardUpdate` `Viewer => Left(Forbidden())` changed to `buildDashboardUpdateResolved(...)` | DashboardGrant | RED, exit 1. The 2 viewer dashboard-update tests fail: apply and preview. |
  | MD | L232 `decodeCreatePatch` missing-patch message truncated | ResolverMessages | RED, exit 1. Exactly the missing-patch test fails. |

  Combined with round 1's M7a (any grant allowed) and M7d (fall-through allowed), both RED on the 4 viewer tests, the pipeline grant gate is now pinned in both directions. I read the code: every viewer case asserts exactly `shouldBe Left(ServiceError.Forbidden())` for apply (update/delete/create) and for preview. Every editor case asserts a real mutation (limit 5 -> 10, step removed, new step id present), and the preview case asserts that nothing was written.
- **Item 4:** the diff changes only the 4 output rows' `sites`, from `PatchSetApplyResolvers.scala` to `PatchSetOutputResolvers.scala` (C3). Round 1 ran its own M4 (`ownerId != user.id` changed to `if false`), which turned exactly those 4 rows RED. The test file has not changed since then. My unmutated run includes `ExistenceNotLeakedRoutesSpec` and it is green.
- **Items 5-6:** the literals in `PatchSetResolverMessagesSpec` match the source: L184 `requireTargetId`, and L232/L236 `decodeCreatePatch`. MD shows those assertions can fail.
- **Items 1-3:**
  - The four listed sites are corrected: `PatchSetPreviewProjection`, `PatchSetUndoService`, `RefinementEditShapeSpec`, and the annotated `PatchSetPreviewServiceSpec`.
  - The `PipelineProtocol` citation now points at `resolveOneRootSourceId`. Its `(Some, Some)` arm is the mutual-exclusivity 400.
  - `grep resolveInlineOrExistingRoot backend/src` returns 0 hits. `grep` for the moved members still prefixed `PatchSetApplyResolvers.` returns 0 hits outside the annotated provenance block.
- **Items 8-9:** the explicit decisions are in design.md D6 and in verification.md.

### Verdict: CONFIRM

### Non-blocking notes
- The orchestrator still owes the follow-up ticket for the 8 editor-grant survivors outside `services/patchsets/`, listed in `mutation-evidence.md`. It should also cover the two out-of-scope `resolveRootDataSources` mentions (`PipelineCreateTransaction.scala`, and `PipelineRootWrites.scala`'s doc on `resolveOneRootSourceId`). The `PipelineRunService.submit` viewer-triggers-run survivor deserves a careful look there.
- `PatchSetDashboardGrantSpec` has no editor-grantee *panel update* case. Editor panel delete and create cover the shared `authorizeEditorOnDashboard` Right branch, so this is not a gap in the guarded branch.
