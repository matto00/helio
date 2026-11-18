-- HEL-1742 (HEL-921 L2): rendered narrative-insight store. One row per render ATTEMPT (ok, failed
-- or skipped), because node_snapshots and output_snapshot_history.summary cannot hold markdown,
-- citations or per-render cost. A reader needs the newest ok row AND the newest attempt of any
-- status (a failed or skipped attempt must not hide the last good render), so both are indexed.
--
-- Shaped like V115 (output_snapshot_history): UUID pk (a TRUNCATE ... CASCADE through the outputs
-- FK would otherwise orphan a sequence); output_id FK ON DELETE CASCADE (FK actions are not
-- RLS-gated, so deleting an Output removes its renders); pipeline_id and run_id are TEXT with NO
-- foreign key (pipeline_runs keeps only the 10 newest runs and grantee-triggered runs have no
-- row; the output_id cascade already removes the rows, a second FK would only add a second
-- cascade path). run_id is NULL for a render not tied to a run (daily, manual, pin).
--
-- status/trigger are closed sets enforced by CHECK. An ok row must carry markdown (a CHECK); other
-- statuses may leave it NULL. citations is the JSONB array of stored citations (only the ones the
-- render actually used; [] for a non-ok row). Token counts and cost_micros are NULL when no model
-- call happened (skipped_*), never 0, so "free" and "unknown" stay distinguishable.
--
-- RLS is sharing-aware exactly as V115: ENABLE + FORCE, four policies on
-- helio_can_access_pipeline(pipeline_id); safe at create time because nothing is backfilled.
-- Writes run on the privileged pool (BYPASSRLS), so the explicit GRANT to helio_privileged (V113
-- pattern, not default privileges) is load-bearing.
--
-- Additive only -- never edit this file once applied (shared dev DB; Flyway checksums the whole
-- file, comments included).

CREATE TABLE output_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id             TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  pipeline_id           TEXT NOT NULL,
  run_id                TEXT NULL,
  trigger               TEXT NOT NULL CHECK (trigger IN ('on_run', 'daily', 'manual', 'pin')),
  status                TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped_quota', 'skipped_unchanged', 'skipped_budget')),
  markdown              TEXT NULL,
  citations             JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_digest          TEXT NULL,
  model                 TEXT NULL,
  input_tokens          INT NULL CHECK (input_tokens >= 0),
  output_tokens         INT NULL CHECK (output_tokens >= 0),
  cache_creation_tokens INT NULL CHECK (cache_creation_tokens >= 0),
  cache_read_tokens     INT NULL CHECK (cache_read_tokens >= 0),
  cost_micros           BIGINT NULL CHECK (cost_micros >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT output_insights_ok_has_markdown CHECK (status <> 'ok' OR markdown IS NOT NULL)
);

CREATE INDEX idx_output_insights_output_created
  ON output_insights (output_id, created_at DESC);

CREATE INDEX idx_output_insights_output_created_ok
  ON output_insights (output_id, created_at DESC) WHERE status = 'ok';

ALTER TABLE output_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE output_insights FORCE ROW LEVEL SECURITY;

CREATE POLICY output_insights_select ON output_insights
  FOR SELECT
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY output_insights_insert ON output_insights
  FOR INSERT
  WITH CHECK (helio_can_access_pipeline(pipeline_id));

CREATE POLICY output_insights_update ON output_insights
  FOR UPDATE
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY output_insights_delete ON output_insights
  FOR DELETE
  USING (helio_can_access_pipeline(pipeline_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON output_insights TO helio_privileged;
