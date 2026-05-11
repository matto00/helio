-- Extend pipeline_runs.status check constraint to include 'dry_run'.
-- Dry-run executions are recorded immediately in a completed state without
-- a queued → terminal transition.
ALTER TABLE pipeline_runs DROP CONSTRAINT pipeline_runs_status_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dry_run'));
