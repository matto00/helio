## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD bcb0e891923094c1a1e85ecc053f30a73ee6d70f (= origin/main; the change dir is untracked planning only).

### What I verified (with evidence)

- **Premise, items 1/3/4.** These are confirmed against the live code:
  - `PatchSetPreviewProjection.scala:212-235` resolves `LayoutPolicy(prior.layout, patch)` with no filter.
  - `AutoLayoutService.scala:102` builds `kept` from the unfiltered `existing.layout`, and line 109 feeds the unfiltered base to `LayoutPolicy(...)`.
  - `PatchSetUndoConflictCheck.scala:126-133` round-trips the layout through `DashboardResponse`.
- **D1 parity, branch by branch,** checked against `DashboardWrites.scala:36-104`. Patch-set apply uses the default `Validate` policy (`PatchSetApplyForward.scala:43-46`). `RestorePriorStored` is reachable only from undo and rollback (`PatchSetUndoService.scala:190`, `PatchSetApplyRollback.scala:104`), never from preview.
  - Rename only: `updateName` re-reads the row, so the layout comes back UNFILTERED (lines 79-80). The design names this branch correctly.
  - Rename + appearance: `onlyPanels(renamed.layout)` (line 84), filtered.
  - Rename + layout, and layout only: `LayoutPolicy(live.layout, onlyPanels(patch))` (lines 51-55), filtered.
  - Appearance only: `live.layout` (lines 48, 96), filtered.
  - All of name, appearance and layout empty: already a 400 in `validateDashboardUpdateRequest` (`DashboardServiceValidation.scala:114`), for both preview and apply.
  - `ctx.dashboardRepo` is available in `PatchSetApplyContext`. The planned red tests (a), (b) and (c) are all genuinely red on the current code, because `LayoutPolicy` has no notion of panel existence.
  - D1 matches apply in every reachable branch, provided the rename-only special case is mirrored (the design says it will be).
- **D2: the deadlock and the lock-order fix.** V122 (`V122__...sql`) takes panel rows first, then `PERFORM ... FROM dashboards ... ORDER BY id FOR UPDATE`. `DashboardRepository.delete` (line 221-222) is a single `DELETE` on the privileged pool, and the V2 cascade then needs the panel row locks. So the inversion is real by construction.
  - `PanelLayoutPlacement.insertAndAppend` (lines 42-57; also used by `insertPlaced`, `duplicate`, `insertBatchPlaced`) locks D and then inserts a NEW panel. It never waits on an existing panel row, so the pre-lock adds no inversion against it. A create that commits between the pre-lock and the delete still has its panel cascaded away.
  - `replaceContents` (`DashboardContentsOps.scala:46-72`) runs `DELETE panels` (panel rows, then D via V122), then insert, then update D. That order matches the planned pre-lock.
  - Patch-set apply runs every edit as its own service call and transaction (`PatchSetApplyForward`). There is no wrapping transaction that would hold D across edits.
  - `batchUpdate` (`PanelMutationRepository.scala:89-150`) locks panels only, never D.
  - **No path locks D and then an existing panel row in one transaction, with one exception: workspace teardown (Change Request 1).**
- **D2: the test model.** Under `SELECT ... FROM panels WHERE id = P FOR UPDATE`, T1 holds a FOR UPDATE tuple lock on P. That is the same tuple-lock strength a real `DELETE` of P takes. T1 then issues the real `DELETE` and the real V122 waits on D, while T2's real cascade waits on P. So the 40P01 comes from the real trigger plus the real cascade.
  - This is honest evidence that the lock-order cycle exists. It says nothing about how often the real intra-statement window is hit, and it must be labelled that way (the design already requires this).
  - After the fix, the same interleave goes green for the right reason. T2's pre-lock blocks on P before it touches D. T1's V122 then gets D and T1 commits. The READ COMMITTED recheck then skips P and T2 deletes D.
  - The reverse model ("T2 holds D first") is only reachable in production through teardown (below). After the fix, plain `DashboardRepository.delete` never holds D before its panels.
- **D3.** `panelIdsInternal` (`DashboardRepository.scala:181-184`, privileged, unpaged) runs after the ACL check in `authorizeEditor`. The two planned red tests are red today (line 102 keeps the ghost and offsets by it; line 109 writes back untargeted breakpoints from the unfiltered base).
- **D4.** A pure refactor. Domain to response to domain is lossless for `{panelId,x,y,w,h}`, and the existing D7 specs are a fair guard.
- **Spec deltas.** The `openspec/specs/{patch-set-preview,dashboard-auto-layout,dashboard-delete}` capabilities exist. V122 and V123 are untouched by the plan, and the highest migration is V123.

### Verdict: REFUTE

### Change Requests

1. **D2 fix does not cover `WorkspaceTeardownRepository`; the design's placement leaves the same deadlock there.**
   - The problem is in `planAndExecute` (`WorkspaceTeardownRepository.scala:155-160`). It runs `deletePipelines andThen deleteSources andThen deleteDashboards` in ONE transaction, on the user-context pool.
   - `deletePipelines` cascades pipelines to outputs (V94:208) to panels (V94:344, `panels.output_id ... ON DELETE CASCADE`). V122 fires on that cascade and takes `FOR UPDATE` on every tagged dashboard D that holds a panel bound to a tagged pipeline. So by the time it reaches `deleteDashboards`, teardown already holds D.
   - If the pre-lock is placed "then deletes the dashboards", as D2 words it, the teardown's order becomes D, then the remaining panel rows of D. A concurrent single-panel delete of P2 on D (P2 locked, V122 waiting on D) still deadlocks.
   - Required revision: D2 and task 1.2 must state that in teardown, the panel-row pre-lock for `dashboardIds` runs as the FIRST write-phase statement, before `deletePipelines`. More precisely, it must come before any statement in that transaction that can fire V122 on a tagged dashboard.
   - Task 1.1/3.3 must add (or explicitly justify omitting) a teardown interleave. Teardown holds a tagged dashboard via a pipeline-cascade strip, while a concurrent transaction deletes another panel on that dashboard.
   - Also state that the pre-lock runs under the caller's RLS context there, unlike the privileged `DashboardRepository.delete`. The owner passes `panels_select`/`panels_update` (V36:146-152) through `helio_can_access_dashboard`, so every panel is visible, but say so.
2. **Qualify the "single lock order / no new inversion" claim for panel-to-panel ordering.**
   - The pre-lock takes panel rows `ORDER BY id`. The other multi-panel lockers take them in a different order:
     - `replaceContents` takes them in `DELETE ... WHERE dashboard_id = D` scan (heap/TID) order.
     - `batchUpdate` takes them in request-item order.
     - Output and pipeline cascades take them in scan order.
   - So a dashboard delete racing `replaceContents`, or an output delete touching 2 or more panels of the same dashboard, can still deadlock on two panel rows. That pair already deadlocked before the fix through the D/panel inversion, so this is not a regression, but it is a residual.
   - The design asserts V122's "single lock order" as if it settled this. It only orders dashboards against panels, and dashboards against each other.
   - Required revision: D2 and Risks must name this residual explicitly, and the code comment, `probe-deadlock.md` and the PR must carry it as well. Then do one of the following:
     - (a) Scope it out, with the reasoning that the spec delta covers a single-panel delete only.
     - (b) Also give `replaceContents` the same `ORDER BY id FOR UPDATE` pre-lock, so dashboard-scoped multi-panel deleters agree.
   - Either way, decide it in the design. The executor must not discover it mid-implementation.

### Non-blocking notes
- D1 parity is per-edit against the stored state. In a patch set where an earlier edit deletes (or creates) a panel and a later edit updates the dashboard's layout, preview and apply can still differ on that panel. The design's non-goal ("sequential preview") covers this. The PR should say so, because the AC wording is "exactly as apply does".
- D3: "pack against `onlyPanels(...)`" should explicitly name BOTH uses of the base: `kept` at line 102 and the `LayoutPolicy(existing.layout, patch)` base at line 109. The parenthetical implies this, but making it literal removes one reading where only `kept` is filtered.
- The rename-only branch storing and returning the unfiltered layout is a HEL-1456 asymmetry, which preview will now faithfully copy. It is fine to leave, but worth a one-line comment at the shared helper so a future reader doesn't "fix" only one side.
- tasks.md has an empty "Standing Constraints" heading. Either fill it with the overnight constraints (VerifiedEmbeddedPostgres.start, `[hel1468-guard]`, non-superuser roles, V124 only, no inline FQNs) or drop it.
