-- HEL-1784: remember who made the last dataset write that armed a pipeline's auto-run, so the fired run can record
-- that user as its trigger (pipeline_runs.triggered_by_user_id) while it is still submitted as, and counted against,
-- the pipeline owner. Last writer wins, like the coalesced debounce itself.
--
-- Additive and nullable, no default and NO backfill / data UPDATE: a row written before this migration stays NULL and
-- its run falls back to the owner as the trigger, which is what every auto-run recorded until now. An UPDATE on this
-- FORCE-RLS table under Flyway's non-BYPASSRLS role is the v0.7.x incident class.
-- ON DELETE SET NULL: deleting the writer must not delete the owner's pending auto-run (FK actions bypass RLS).
ALTER TABLE pipeline_auto_run_debounce
  ADD COLUMN triggered_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;
