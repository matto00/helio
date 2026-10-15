-- HEL-1579: persist each run's per-step row counts so a reloaded pipeline page can show a
-- row count after every step without re-running (JSON object: step id -> count).
--
-- Follows the V104 (HEL-873) precedent: no DEFAULT and no backfill on either column -- NULL is
-- the deliberate "not recorded" state for every row written before this migration, and for every
-- run that records no per-step counts (failed, blocked, reaped, Spark, dry run). A backfilled
-- value would assert a fact that was never observed. RLS: no new policy -- the existing
-- `pipelines` and `pipeline_runs` policies cover the new columns.
ALTER TABLE pipeline_runs
  ADD COLUMN step_row_counts JSONB NULL;

ALTER TABLE pipelines
  ADD COLUMN last_run_step_row_counts JSONB NULL;
