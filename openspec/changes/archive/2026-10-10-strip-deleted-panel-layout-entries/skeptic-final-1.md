## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c830b1edf94922bb4b0525bb36744624117afe85`. Base resolved live with `resolve-review-base.sh`: `a29a7e5ce23108a682fd87aea7d79edd6b922dc9`. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/delete-panel-layout-ghosts/hel-1456`.

### What I verified (with evidence)

**Merge content.** `git diff --name-only af47ebb4a c830b1edf` lists only `frontend/**` files and HEL-1478's archived openspec files. No backend file changed after the evaluator's gated commit.

**AC1: a delete strips every breakpoint, in the same transaction, under the dashboard row lock.**
- The mechanism is V122. It is a statement-level `AFTER DELETE ... REFERENCING OLD TABLE` trigger on `panels`, so it runs inside the deleting statement's transaction.
- It runs `SELECT ... FOR UPDATE` on the affected dashboards in id order. That is the same row lock `PanelLayoutPlacement.scala:47` takes.
- It then rewrites each array breakpoint with `WITH ORDINALITY` ordering and `COALESCE(..., '[]')`.
- It writes only when `IS DISTINCT FROM` is true. It does not touch `last_updated`.
- Covered by `V122StripDeletedPanelLayoutItemsSpec`: single delete, `[]` not null, no row write when there is nothing to strip (xmin check), `last_updated` unchanged, odd-shaped breakpoints kept. These run as a NOSUPERUSER/NOBYPASSRLS role with the RLS GUC set.

**AC2: bulk `deleteByOutputIdInternal`.**
- The same trigger fires for it.
- `V122Spec` "a bulk delete statement" covers 5 panels across 2 dashboards.
- `PanelDeleteLayoutStripSpec` covers the route paths: Output, pipeline and pipeline-step deletes.

**AC3: one-off repair.**
- V123 does all reads and writes inside a `helio_privileged`-owned SECURITY DEFINER helper with `row_security = off`, and drops the helper after use. That satisfies C1.
- It is idempotent, keeps `[]` rather than null, and does not touch `last_updated`.
- The header says prod counts were not measured and carries the read-only count query. It also explains why that query must run as BYPASSRLS.
- `V123StripExistingGhostLayoutItemsSpec` runs the chain as a NOBYPASSRLS owner. Under FORCE RLS that role would see zero panels, so its "live items byte-identical" assertion is the real proof the repair reads past RLS.

**AC4: tests.** Two route-level tests exist: "next create starts at the remaining panel's bottom on every breakpoint" and "auto-layout packs with no offset". Both are RED in `evidence/red-run-1.log`.

**RED-first and mutations (C2).** I read the logs myself.
- `red-run-1.log`: 30 failed and 1 aborted. The abort is V123Spec with "No migration with a target version 123", which is RED by absence.
- Guards are the tests that already passed on unfixed code. They are labelled as guards in design.md: replaceContents, dashboard delete, overlap-still-400s, write-over-ghost-cells, and refuse-when-moved.
- `red-run-2`/`red-run-3`: the D5 and D7 tests are RED with the migrations present.
- Mutations, each red on its intended tests:
  - `mutation-1` (no re-own and no `row_security=off`): the RLS cases and the V123 wipe cases.
  - `mutation-2` (supplied-only filter): unsent-breakpoint, editor-panel and appearance.
  - `cycle2-mutation-3` (user-scoped lookup): "panel created by another user", failed=2.
- One anomaly: in `red-run-2`, V123 "not touch last_updated" failed on a timestamp-text timezone comparison. The current spec compares with `= '...'::timestamptz`, so that was a test bug that has since been fixed, not a product defect.

**Fresh re-run at HEAD (mine).**
- Backend command: `nice -n 19 sbt -batch -J-Xmx3g "testOnly ...V122* ...V123* ...PanelDeleteLayoutStrip* ...DashboardLayout* ...PatchSetUndoGhostLayoutSpec ...DashboardServiceLayoutPolicySpec"`. Result: Suites 11, Tests succeeded 103, failed 0, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0`.
- Log: `/home/matt/Development/helio/.concertino/runs/HEL-1456/evidence/skeptic-final-1/targeted-specs.log`. I ran it with one other sbt JVM running and 52 GB available.
- Jest seam test at HEAD (post-merge): 3/3 passed.

**D5 (server filter).**
- `DashboardWrites.applyUpdate` filters both `existing.layout` and the patch with `LayoutPolicy.onlyPanels` against `panelIdsInternal`. That lookup is unpaged and privileged, so other users' panels are kept, and the mutation-3 proof shows that matters.
- The filter applies under both Validate and RestorePriorStored.
- The rename-with-appearance branch filters `renamed.layout`. The rename-only branch writes no layout, which is documented.
- Removing items from a valid breakpoint cannot make it invalid, so no new 400 is possible.
- Patch-set rollback of a panel delete recreates the panel under a NEW id (`PatchSetApplyRollback.scala:84-90`). The filter therefore drops only the old id, which was already a ghost before this change. No regression there.

**D7.**
- `PatchSetUndoConflictCheck.scala:120-136` compares both layouts restricted to the current panel ids. Name and appearance are still compared exactly.
- It calls `panelIdsInternal` only after `findById` returns Some.
- Covered by `PatchSetUndoGhostLayoutSpec`, including the guard "still refuses when a live item moved".

**Seam.**
- The client test and `DashboardLayoutGhostSeamSpec` read the same `shared-test-fixtures/layout-ghost-write-seam.json`.
- The client test asserts the exact PATCH body `buildLayoutPatch` produces and that the client adopts the ghost-free response.
- The backend spec sends that body to the real route.
- `probe.md` 3.11 records the live dev-DB row check: V123 took dev from 84 ghost items on 9 dashboards to 0/0, and the PATCH filter worked on a live row.

**HEL-1457.**
- PATCH still takes no lock, so PATCH-vs-PATCH last-write-wins is unchanged.
- D5 now prevents a stale PATCH from restoring a ghost.
- Strictly, D5 adds one DB round trip (`panelIdsInternal`) between the PATCH's unlocked read of `existing` and its write. The stale-read window is longer by that one query, a few milliseconds. The race is no different in kind, and design D6's "not widened" is accurate in substance.

**UI (step 4).** Skipped: there are no UI changes. The only `frontend/**` file in the diff is `layoutGhostWriteSeam.test.ts`. Rendering is unchanged because the client already ignored ghosts via `liveEntries`.

### Verdict: CONFIRM

### Non-blocking notes
- **New deadlock pair, not mentioned in design D3/Risks.** A dashboard delete takes the locks in the reverse order: it deletes the dashboard row (row lock on D), then its FK cascade deletes the panels (needs each panel row lock). A concurrent single-panel delete on the same dashboard holds P's row lock, and its V122 trigger then waits for `FOR UPDATE` on D.
  - Result: Postgres detects the deadlock and aborts one of the two requests (40P01, after `deadlock_timeout`).
  - Before V122, the dashboard delete simply waited for the panel delete to commit.
  - No data is corrupted or lost, the window is milliseconds wide, and the two user actions conflict anyway. That is why this does not block.
  - But D3's statement "every delete path therefore uses ONE order" is false for dashboard deletes. Record this in the PR body, and either file a follow-up (for example, have the trigger skip dashboards that are being deleted via `SKIP LOCKED`/`NOWAIT`) or accept it explicitly.
  - I derived this from Postgres locking semantics. I did not reproduce it.
- Follow-up already known: patch-set preview vs apply divergence for ghost items (`PatchSetPreviewProjection.scala:214`). Link the ticket from the PR.
- The throwaway eval/probe users remain in the dev DB because there is no user-delete endpoint (known).
- Cosmetic: `PatchSetUndoConflictCheck` converts the live layout from domain to response and back to domain. It could filter `liveDashboard.layout` directly.
