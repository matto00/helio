## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `db0caabbb7800b07952d4e29971f202d3b8ae9c5`, branch `bug/single-panel-row-lock-order/HEL-1498`.
Diff base was resolved live after `git fetch origin`: `resolve-review-base.sh` returned `000c1dfa5` (exit 0).
origin/main is one commit ahead at `317284497` (HEL-1444), which changes only frontend, e2e and openspec files, so it does not overlap this diff.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/single-panel-row-lock-order/HEL-1498`.
- **Migration number (C4) and AC8:**
  - `git ls-tree origin/main backend/src/main/resources/db/migration/` puts the max version at 128 (`V128__stored_object_deletions.sql`, HEL-1434, now merged).
  - The branch adds only `V129__lock_panels_for_deletion.sql`, which is max + 1 with no gap.
  - The diff touches no other migration (`git diff --stat -- db/migration/`), so V1..V128 are unedited.
- **AC1 — one id-ordered lock, taken first, in each multi-panel writer.** I read every writer's transaction in full:
  - **W1 `replaceContents`:** `lockForDeletion(dashboards)`, then the dashboard `FOR UPDATE`, then delete, insert, layout update and re-read.
  - **W2 `batchUpdate`:** an app-level `sortBy(id).forUpdate` runs before the item loop. These are existing rows only and nothing is deleted, so the app-level lock is enough.
  - **W3 `OutputService.delete`:** now one transaction (`deleteWithPanelsInternal`): lock, then `DELETE panels RETURNING id`, then delete the output. It is called after the owner check.
  - **W4 `PipelineRepository.delete`:** an unlocked owner-scoped SELECT, then the lock, then the delete. A pipeline the caller does not own locks nothing.
  - **W5 `PipelineStepRepository.deleteInternal`:** reads first, then the lock on `tailDescendantIds + deleted` (`descendantIdsOf` includes each tail root), before the promotion UPDATE.
  - **W6 root removal:** `removeRootCascadeAction` is the first DBIO in `PipelineRootWrites.removeRoot`'s transaction (lines 211-215), and it locks first.
  - **W7 `DataSourceRepository.delete`:** owner-scoped SELECT, then the lock, then the delete.
  - **W8 teardown:** the earlier statements are plain SELECTs (I grepped for `forUpdate`/`FOR SHARE`: none). Then there is one `lockForDeletion(dashboards, pipelines, dataSources)` before the first delete. `DashboardRepository.delete` locks dashboards the same way.
  - I grepped every `.delete` and `DELETE FROM` in `backend/src/main`. I found no other writer that reaches `panels`. `ConnectorRepository.delete` refuses when dependents exist, and there is no user-delete path.
- **The SECURITY DEFINER function's security posture (V129):**
  - Settings: `SET search_path = pg_catalog, public` and `SET row_security = off`. It returns void, so it discloses nothing.
  - EXECUTE is revoked from PUBLIC and granted dynamically to `current_user` before the re-own. The re-own uses the same bracket as V122:84-89 (transient `CREATE` on the schema, `OWNER TO helio_privileged`, then revoke).
  - Production: Flyway and both pools use the same `helio.db.user` (`Database.scala:23-30`, `application.conf:94-97`). So the runtime app role is the role the grant goes to, and the privileged pool runs as the owner.
  - Abuse: anyone who can call the function can already `SET ROLE helio_privileged`, so it grants no new capability. Every production call site passes ids only after its owner or ACL check. The worst case is over-locking (a superset) for one transaction.
- **AC2, AC3 and AC7 — race and HEL-1526 specs (green, run by me).**
  - I used `testOnly` with a per-run ScalaTest `-Dskeptic_nonce=...` because sbt 2 replayed a cached `testOnly` in 13 s. The nonce runs show real execution ("Run completed in 19 seconds"):
    - 38/38 passed across `PanelWriterLockOrderRaceSpec`, `ReplaceContentsLayoutRaceSpec`, `PipelineCascadeLockOrderRaceSpec`, `DashboardDeleteRacesPanelDeleteSpec`, `PatchSetPreviewCumulativeSpec`, `PatchSetPreviewOutputContextSpec`, `PatchSetPreviewGhostLayoutSpec` and `ResourceTagMigrationSpec`.
    - The four race specs alone ran twice more: 12/12 both times ("Run completed in 8 seconds, 313 ms" and "8 seconds, 126 ms"). They are stable.
  - **Red:** I relied on the evaluator's pasted rerun at a5f33e75b (`.concertino/runs/HEL-1498/evidence/evaluator-red-rerun-a5f33e75b.txt`). It shows 40P01 on the writer side for W1-W8, the HEL-1526 race failing with an lg layout of `Set()` vs the created panel, the version case failing with `Some(0)` vs `Some(1)`, and 7 cumulative PROOF cases red. The 3 GUARDs and the 2 HEL-1485 cases are green. This is unambiguous pasted output.
  - **Interleave soundness:**
    - The W1-W8 gate holds the lowest panel (A), and the writer must be observed waiting on a lock before the gate's real `DELETE FROM dashboards`. Pre-fix, the writer holds B (inserted first), which forms the cycle.
    - W4-W8 put the panels on a grantee's dashboard that the pipeline owner cannot see under RLS (NOBYPASSRLS app role), so only V129 can order them. W8's dashboard is untagged (AC3).
    - The HEL-1526 SHARE-mode gate: SHARE conflicts with ROW EXCLUSIVE but not with ROW SHARE. So post-fix, replace holds the dashboard row while it waits on its DELETE, and the create serializes behind it. Pre-fix, replace's unlocked read and its later UPDATE overwrite the create's item. The spec waits per racer by `application_name`.
- **AC4 — cumulative preview.**
  - I read `PatchSetPreviewOverlay`, `PatchSetPreviewRemovals`, `PatchSetPreviewProjection` and `PatchSetPreviewService`.
  - The overlay replays V122 strips and placement appends with a +1 version bump only on a real change. `withDashboard` folds in and clears the pending ops. `before` and the fingerprint stay at resolve time (`PatchSetTargetFingerprint.forEdit(edit, ...)` takes no overlay), which is what the GUARD case shows.
  - Each PROOF case compares preview `after` with apply `resultingState` from the same set on the same fixture, so the expected values come from apply rather than hand-written JSON.
- **AC5 — split.**
  - `13f0485fe` touches only main sources and the README, with no test files.
  - All `PatchSetPreview*.scala` files are at most 197 lines, against CONTRIBUTING's soft budget of about 250.
- **AC6.**
  - `DashboardDeleteRacesPanelDeleteSpec` asserts `(None, None)` on both cases.
  - `LockRaceSupport.sqlStateAllowing` rethrows any non-PSQL failure unless it is explicitly allowed. The only allowance is W2's exact `Panel '<id>' not found`, matching design D6.
  - Both ghost-layout guards are prefixed `GUARD:`, and the legend line is present.
- **Fixture changes — legitimate:**
  - The 6 fixtures that grant `EXECUTE ... TO helio_app_test` use an app role that is not the migrating role, unlike production. Without the grant, the test app role could not call the function that production's app role can.
  - `ResourceTagMigrationSpec` is pinned to V93, which has no `outputs`. A no-op stand-in with the same signature is correct there.
  - The `PatchSetPreviewOutputContextSpec` change follows from AC4: the whole matrix deletes a source that a later pipeline create roots on, and apply would fail that too. The write-nothing snapshot assertion it guards is unchanged.
- **UI:** no `frontend/**` files in the diff, so step 4 does not apply.
- **Full suite:** I did not rerun `testFull`. `green-evidence.md` and `evaluation-1.md` paste a chunked run: 7630 passed, 0 failed, 4 canceled, matching the executor's count.

### Verdict: CONFIRM

### Non-blocking notes

1. **Undisclosed divergence from design D4: the promoted head child.**
   - design.md D4 says the preview's step delete "mirrors `deleteInternal`'s splice: tail subtrees removed, head child promoted". The code does not model the promotion (`PatchSetPreviewRemovals` records removals only).
   - The overlay's scaladoc lists it as a residual (`PatchSetPreviewOverlay.scala:28`), but proposal.md's non-goals and `evaluation-1.md`'s residual list name only step-create re-parenting and the data-source cascade.
   - Effect: in a set that deletes step S and then updates S's lowest-positioned child, preview `after.parentStepId`/`position` show the pre-promotion values, while apply returns the promoted ones.
   - I am not refuting on this:
     - Step-update preview already differs from apply on `rootId` (it passes `Map.empty`) and has a known `MatchError` follow-up.
     - The symmetric step-create re-parenting case was accepted as a residual at the design gate.
     - The fix needs a 22-arm `withParent` helper.
   - At delivery, file this as a follow-up together with the two disclosed residuals, and say in the PR body that the patch-set-preview spec delta's unconditional SHALL does not yet cover these three step and source cascade cases.
2. `PatchSetPreviewOutputContextSpec` accepts `Right(_)` or the one `NotFound`, but the matrix is deterministic and always produces the `NotFound`. Pinning the `Left` would be tighter. Harmless either way, because the write-nothing assertion is what the case guards.
3. The 6 fixture grants use `EXECUTE ON ALL FUNCTIONS`. Granting only `hel1498_lock_panels(text[] x6)` would be narrower and would not quietly widen the test role's access to other SECURITY DEFINER functions. These are test fixtures only.
4. The function's EXECUTE grant assumes the migrating role and the runtime app role are the same, as `evaluation-1.md` notes. That holds today, because Flyway and both pools read `helio.db.user`. A future role split would need an explicit grant.
5. C4 still requires re-checking the migration number at push and by the auditor. It is correct as of this review (origin/main max is V128).
