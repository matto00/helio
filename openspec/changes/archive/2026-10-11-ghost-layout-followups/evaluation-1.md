## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 58945eda07f35af55276781673bc2fcdc51d944d. Diff base resolved live by `resolve-review-base.sh`: bcb0e891923094c1a1e85ecc053f30a73ee6d70f.
Fresh gate run (mine, not the executor's): `nice -n 19 sbt -J-Xmx3g testFull` in WORKTREE_PATH, exit 0.
Result: 6814 succeeded, 0 failed, 4 canceled, 507 suites, 0 aborted. The log contains `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
Log: `.concertino/runs/HEL-1485/evidence/eval1-testFull.log`.
The new specs ran in that suite: `PatchSetPreviewGhostLayoutSpec`, `AutoLayoutGhostSpec` and `DashboardDeleteRacesPanelDeleteSpec`. The existing `PatchSetUndo*Spec` suites, including `PatchSetUndoGhostLayoutSpec` (the D7 guards), also ran.
Other gates: `npm run check:scala-quality` is clean (soft warnings only), `check:openspec` is clean and `check:schemas` is in sync. No frontend files changed, so the frontend gates do not apply.

### Phase 1: Spec Review — PASS
- AC1 (preview drops ghosts like apply, red-first): met. `LayoutPolicy.resolveOnLive` is the one function both `DashboardWrites.applyUpdate` and `PatchSetPreviewProjection.dashboardUpdateAfter` call.
  - Red log `red-preview-autolayout.log` shows 3 failures, each for the intended reason: ghost present (line 52), ghost item kept in the supplied lg (line 60), and 400 instead of 200 on a ghost-only overlap (line 34).
  - The parity assertion compares the preview with a real apply's `resultingState`, not with hand-built JSON.
- AC2 (deadlock reproduced on embedded Postgres as a non-superuser, non-BYPASSRLS role, then fixed with the repro as the red test): met.
  - `LayoutStripDbSupport.startPostgres` uses `VerifiedEmbeddedPostgres.start` and `require`s that the app role is `(rolsuper, rolbypassrls) == (false, false)`. The app role is the schema owner under FORCE RLS, matching prod's `helio`. The privileged side reaches `helio_privileged` by SET ROLE.
  - The 40P01 comes from the real V122 trigger and the real FK cascade. The interleave waits on observed `pg_stat_activity.wait_event_type = 'Lock'`. The 20 ms poll is a bounded wait loop, not sleep-as-proof.
  - The modelling (the panel side holds P with `FOR UPDATE`, then issues the real DELETE) is stated in the spec comment, as D2 requires.
  - Red: `red-deadlock.log`, both cases show `dashboard/teardown side=Some(40P01)`. Green: `green-deadlock.log`, and my own testFull.
- AC3 (auto-layout routed through the same filter, red-first): met. `AutoLayoutService` packs against `LayoutPolicy.onlyPanels(existing.layout, panelIdsInternal)`. Red log shows both auto-layout cases failing for the right reason (lines 26 and 36). The HEL-1457 window is documented in a code comment.
- AC4 (`checkDashboard` filters the domain layout directly, behaviour unchanged): met. `DashboardResponse.fromDomain` maps fields losslessly (DashboardProtocol.scala:115-180), so the old round-trip and the new direct comparison are equivalent. The existing PatchSetUndo specs pass.
- AC5 (V122/V123 not edited): met. `git diff --name-only` shows no `db/migration` path and no new migration.
- Tasks: all tasks are checked off and match the diff. The `dashboard-delete` delta is correctly kept, because the deadlock reproduced.
- Scope creep: none.
- Planning artifacts: these match the implementation (`probe-deadlock.md` records red, green and both residuals).
- Constraints: C1 holds (the spec doc comment says it proves the cycle can form, not its frequency; the interleave is lock-wait driven). C2 holds (V122/V123 untouched, VerifiedEmbeddedPostgres, non-superuser roles, guard line present, no inline FQNs, red-first).

### Phase 2: Code Review — PASS
- No inline FQNs. A grep of the added non-import lines finds only `package` declarations, and `check:scala-quality` is clean.
- DRY: the live-panel resolution, which was previously duplicated (and had drifted), is now a single shared function. That is the point of D1.
- Rename-only parity was verified against `DashboardWrites.writeUpdate`. Preview's `renameOnly` (`nameOpt.isDefined && appearanceOpt.isEmpty && layoutPatchOpt.isEmpty`) equals apply's `appearanceOpt.isEmpty && layoutOpt.isEmpty` under `Some(name)`. The `PatchSetPreviewGhostLayoutSpec` rename-only case guards it: removing the branch would make `ghostIn` false.
- `applyUpdate` refactor: behaviour is preserved, with the same two `onlyPanels` calls in the same order.
- Teardown pre-lock: it is the first write-phase statement, before `deletePipelines`. `SELECT ... FOR UPDATE` under RLS needs the panels UPDATE policy (`helio_can_access_dashboard`, V36), which the owner passes. An empty `dashboardIds` set yields `inSet(empty)`, which is a harmless no-op.
- The 4 canceled tests are pre-existing, opt-in measurement tests cancelled by `assume` when `HELIO_MEASURE` is unset, and the diff does not touch them:
  - `DatasetWriteSubmitLatencySpec.scala:215`, 3 cases "reports p50/p95 before vs. after (report-only; HELIO_MEASURE=1)"
  - `OutputFilteredMetricMeasurementSpec.scala:50`, 1 case "add no more than 500 ms (median of 20)"

  The same 4 appear in the executor's run and in mine.
- Issues: none blocking.

### Phase 3: UI Review — N/A
None of the Phase 3 triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`) are in the diff. The spec deltas are under `openspec/changes/`, and there is no API shape change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `DashboardDeleteRacesPanelDeleteSpec`:
  - `sqlState` (line ~60) maps any non-`PSQLException` failure, including an `Await` timeout, to `None`.
  - Both cases assert only "does not contain 40P01" (lines ~126 and ~138).
  - Fix: assert `(panelState, dashboardState) shouldBe ((None, None))` and rethrow non-PSQL failures, so an unrelated error on either side cannot read as success. The `exists(...) shouldBe false` post-checks already catch most such cases.
- `PatchSetPreviewGhostLayoutSpec`: the "still reject a layout that overlaps two live panels" and "rename-only" cases pass on unfixed code by design, so they are guards, not red proofs. A one-word `(guard)` in their names or a short comment would make that explicit for later readers.
- `PatchSetPreviewProjection.scala` has gone from 396 to 402 lines, crossing the CONTRIBUTING.md ~400-line threshold. Per that rule, propose a split in the PR description; do not split in this change.
- `backend/relative/path/` is an empty, untracked, non-ignored directory left in the worktree by the pre-existing `LocalFileSystemSpec` during testFull. It is not part of the diff, so this is only for awareness; there is a candidate follow-up for the test's temp-dir hygiene.
- Re-sync with HEL-1475 (patch-set undo overlap) before the PR, as the ticket's driver constraints require.
