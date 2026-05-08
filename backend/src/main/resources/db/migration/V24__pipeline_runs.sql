CREATE TABLE pipeline_runs (
  id           TEXT        PRIMARY KEY,
  pipeline_id  TEXT        NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  row_count    INT,
  error_log    TEXT
);
CREATE INDEX pipeline_runs_pipeline_id_idx ON pipeline_runs(pipeline_id);
