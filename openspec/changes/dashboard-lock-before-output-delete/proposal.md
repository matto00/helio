## Why
HEL-1498 put every multi-panel writer on "panel rows by id, then dashboard rows by id", but the `outputs` rows sit
outside that order. A panel create locks its dashboard `FOR UPDATE` and then takes KEY SHARE on the bound Output
through the `panels.output_id` foreign key (dashboard, then Output). A cascading delete that removes that Output
(pipeline, pipeline step, pipeline root, data source, workspace teardown) deletes the Output row first, then the FK
cascade deletes its panels and V122's trigger locks their dashboards (Output, then dashboard). The two can deadlock
(SQLSTATE 40P01) when a panel is created on dashboard D bound to Output O while O, already bound on D, is being
deleted. HEL-1498 flagged it and did not reproduce or fix it; the owner triaged it as standalone (HEL-1534).

## What Changes
- New red-first race spec on `VerifiedEmbeddedPostgres` (NOBYPASSRLS app role, the `LockRaceSupport` harness) that
  drives a real panel create against a real cascading delete and observes the 40P01 before any fix.
- New migration V130 (re-checked as max-on-origin/main + 1 before claiming and before push) that redefines
  `hel1498_lock_panels` (same signature, same SECURITY DEFINER owner and ACL) so that, after it locks the panel rows by
  id, it also locks, in one id-ordered statement, every dashboard those panels sit on plus the dashboards passed in
  `p_dashboard_ids`. Every caller of `PanelRowLocks.lockForDeletion` (already wired as the first write of every
  output-removing delete by HEL-1498) thereby locks dashboards BEFORE it deletes any Output. The system-wide order
  becomes "panel rows by id, then dashboard rows by id, then Output rows", which panel create (dashboard, then Output)
  already follows. No Scala call site changes are needed beyond documentation.
- Documentation of the order on `PanelRowLocks` and in the migration header, including the residual window that stays
  open (a dashboard that gains its first panel bound to the deleted Output after the lock runs).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `panel-row-lock-order`: adds a requirement that output-removing deletes lock the affected dashboards, by id, after
  the panel rows and before deleting any Output, so they never deadlock with a concurrent panel create.

## Impact
- `backend/src/main/resources/db/migration/V130__lock_dashboards_for_output_deletion.sql` (new).
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowLocks.scala` (doc only).
- New test spec under `backend/src/test/scala/com/helio/infrastructure/persistence/` plus, if needed, a helper in
  `LockRaceSupport`.
- No API, schema-JSON, frontend or dependency change. Slightly wider lock footprint on dashboard rows for cascading
  deletes (they already lock those rows later via V122; this moves the lock earlier).
