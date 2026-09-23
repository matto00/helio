-- HEL-1093 (design.md Decision 1): DB-backed, globally-consistent debounce state for the
-- dataset-write auto-run trigger -- one row per pipeline with a pending debounce window. A
-- dataset write UPSERTs a forward-only `fire_at`; the existing PipelineSchedulerService tick
-- atomically claims and fires due rows (Decision 3). No dedicated new timer/sweeper.
--
-- RLS follows V62's `pipeline_schedules` indirect-owner pattern, NOT V109's direct-owner
-- pattern: this table has no `owner_id` column of its own, and its writer (the dataset write's
-- author) is not always the pipeline's owner (a pipeline root's data source can be owned by
-- whoever added that root as an editor grantee, not necessarily the pipeline owner -- see
-- design.md Context). All access is via DbContext.withSystemContext (the privileged pool) --
-- RLS is still ENABLEd/FORCEd so a future caller reaching this table over the app pool degrades
-- safely to "no rows visible" rather than an open table, mirroring V62's own rationale.

CREATE TABLE pipeline_auto_run_debounce (
    pipeline_id  TEXT PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
    fire_at      TIMESTAMPTZ NOT NULL,
    claimed_at   TIMESTAMPTZ
);

ALTER TABLE pipeline_auto_run_debounce ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_auto_run_debounce FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_auto_run_debounce_owner ON pipeline_auto_run_debounce
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_auto_run_debounce.pipeline_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );

-- New trigger_source value for auto-runs (design.md Decision 1/3) -- widens the V63 CHECK
-- constraint rather than adding only a Scala-side enum value.
ALTER TABLE pipeline_runs DROP CONSTRAINT pipeline_runs_trigger_source_check;
ALTER TABLE pipeline_runs ADD CONSTRAINT pipeline_runs_trigger_source_check
  CHECK (trigger_source IN ('manual', 'scheduled', 'external', 'auto-run'));
