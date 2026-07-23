-- Add pipeline_runs.trigger_source to record how a run was triggered
-- (manual, scheduled, or external -- HEL-417). NOT NULL DEFAULT backfills
-- existing rows to 'manual' in the same statement (Postgres 11+ fast
-- default path); mirrors V28's drop/re-add CHECK-constraint pattern, but
-- as a single new-column ADD since there is no existing constraint to touch.
ALTER TABLE pipeline_runs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_trigger_source_check
  CHECK (trigger_source IN ('manual', 'scheduled', 'external'));
