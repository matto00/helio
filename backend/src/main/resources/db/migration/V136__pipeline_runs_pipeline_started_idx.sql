-- HEL-1578: the Home timeline's 24h window query and the keep-24h retention prune both filter
-- pipeline_runs by pipeline and a started_at range, newest first. Only pipeline_id was indexed.
CREATE INDEX IF NOT EXISTS pipeline_runs_pipeline_started_idx
    ON pipeline_runs (pipeline_id, started_at DESC);
