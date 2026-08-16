-- HEL-509 (419-B): per-run assertion results.
--
-- Persists one row per rule evaluated by an `assert` step (HEL-454 / 419-A)
-- during a pipeline run — succeeded, failed (partial results), or a
-- successful dry run. See design.md Decisions 4/4a/5 for the exact
-- persistence sequencing (PipelineRunService.executeRun).
--
-- run_id FKs pipeline_runs(id) ON DELETE CASCADE -- assertion results are
-- meaningless once their parent run is gone (mirrors alert_events'
-- cascade-from-parent precedent, V61).
--
-- RLS mirrors pipeline_runs' own indirect-owner policy (V35) one level
-- deeper: pipeline_run_assertions -> pipeline_runs -> pipelines.owner_id.
-- insertAssertions always runs via withSystemContext (privileged pool);
-- listAssertionsByRun/listAssertionsByRunInternal mirror
-- listByPipeline/listByPipelineInternal's existing owner-scoped/
-- system-context split.

CREATE TABLE pipeline_run_assertions (
    id         TEXT PRIMARY KEY,
    run_id     TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    step_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    field      TEXT,
    severity   TEXT NOT NULL,
    passed     BOOLEAN NOT NULL,
    observed   TEXT,
    message    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_run_assertions_run_id ON pipeline_run_assertions(run_id);

-- ── RLS: indirect owner via run_id -> pipeline_runs -> pipelines.owner_id ────

ALTER TABLE pipeline_run_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_run_assertions FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_run_assertions_owner ON pipeline_run_assertions
  USING (
    EXISTS (
      SELECT 1 FROM pipeline_runs r
      JOIN pipelines p ON p.id = r.pipeline_id
      WHERE r.id = pipeline_run_assertions.run_id
        AND p.owner_id = current_setting('app.current_user_id')::uuid
    )
  );
