## Standing Constraints

- [C1] Deadlock specs are labelled as proving the lock cycle exists (not its frequency); interleaves are driven by observed lock waits, never sleeps.
- [C2] Never edit V122/V123 (SQL only in a new V124, re-checked before commit); new DB specs use VerifiedEmbeddedPostgres.start and non-superuser/non-BYPASSRLS roles; `[hel1468-guard]` must appear in sbt runs; no inline FQNs; red-first tests.

## 1. Backend — deadlock (reproduce first)

- [x] 1.1 Write the two-connection deadlock repro spec (VerifiedEmbeddedPostgres.start, non-superuser roles); record result in probe-deadlock.md
- [x] 1.2 If reproduced: pre-lock panel rows (ORDER BY id FOR UPDATE) in DashboardRepository.delete
- [x] 1.2b If reproduced: pre-lock as the FIRST write statement of WorkspaceTeardownRepository.planAndExecute (before deletePipelines), with its own interleave test
- [x] 1.2c Document the panel<->panel ordering residual (scoped out) in code comment and probe-deadlock.md
- [x] 1.3 N/A: the deadlock reproduced, so the dashboard-delete delta stays (see probe-deadlock.md)

## 2. Backend — preview, auto-layout, undo check

- [x] 2.1 Extract/share apply's live-panel layout resolution and use it in PatchSetPreviewProjection.dashboardUpdateAfter
- [x] 2.2 AutoLayoutService packs against LayoutPolicy.onlyPanels(existing.layout, panelIdsInternal)
- [x] 2.3 PatchSetUndoConflictCheck.checkDashboard filters liveDashboard.layout directly (no response round-trip)
- [x] 2.4 Comment the remaining HEL-1457 stale-read window in AutoLayoutService

## 3. Tests

- [x] 3.1 Preview red-first: stored ghost (appearance-only), supplied ghost, overlapping ghost no-400; parity with apply
- [x] 3.2 Auto-layout red-first: ghost in targeted breakpoint not kept / no offset; ghost in untargeted breakpoint not written
- [x] 3.3 Deadlock spec green after 1.2 (or documented not-reproduced)
- [x] 3.4 Existing D7 undo specs pass unchanged after 2.3
- [x] 3.5 sbt testFull (with [hel1468-guard] in output), lint/typecheck untouched frontend; record logs in run evidence dir
