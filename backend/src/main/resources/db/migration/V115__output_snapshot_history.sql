-- HEL-1271 (HEL-918 L1): per-Output summary history. One row per Output per real, unblocked,
-- successful pipeline run (the summary itself -- row count, column stats, headline metric, chart
-- series -- is computed by OutputSummaryReducer and stored as JSONB). node_snapshots keeps only
-- the latest materialization, so this table is what makes deltas/sparklines/alert baselines
-- possible.
--
-- Keyed by output_id with ON DELETE CASCADE (FK actions are not RLS-gated, so deleting an Output
-- removes its history). UUID primary key, not BIGSERIAL: a TRUNCATE ... CASCADE through the
-- outputs FK would otherwise leave an orphaned sequence. run_id is TEXT with NO foreign key on
-- purpose -- pipeline_runs keeps only the 10 newest runs and grantee-triggered runs have no row.
-- pipeline_id carries no FK of its own: the output_id cascade already removes the rows, and a
-- second FK would only add a second cascade path.
--
-- RLS is sharing-aware, mirroring node_snapshots (V94): the four policies gate on
-- helio_can_access_pipeline(pipeline_id). ENABLE + FORCE is safe at create time because this
-- migration backfills no rows (unlike V94). Writes run on the privileged pool (BYPASSRLS), so the
-- explicit GRANT to helio_privileged (V113 pattern, not default privileges) is load-bearing.
--
-- Additive only -- never edit this file once applied (shared dev DB; Flyway checksums the whole
-- file, comments included).

CREATE TABLE output_snapshot_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id      TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  pipeline_id    TEXT NOT NULL,
  node_step_id   TEXT NULL,
  root_id        TEXT NULL,
  run_id         TEXT NULL,
  trigger_source TEXT NOT NULL,
  captured_at    TIMESTAMPTZ NOT NULL,
  row_count      INT NOT NULL,
  summary        JSONB NOT NULL
);

CREATE INDEX idx_output_snapshot_history_output_captured
  ON output_snapshot_history (output_id, captured_at DESC);

ALTER TABLE output_snapshot_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE output_snapshot_history FORCE ROW LEVEL SECURITY;

CREATE POLICY output_snapshot_history_select ON output_snapshot_history
  FOR SELECT
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY output_snapshot_history_insert ON output_snapshot_history
  FOR INSERT
  WITH CHECK (helio_can_access_pipeline(pipeline_id));

CREATE POLICY output_snapshot_history_update ON output_snapshot_history
  FOR UPDATE
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY output_snapshot_history_delete ON output_snapshot_history
  FOR DELETE
  USING (helio_can_access_pipeline(pipeline_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON output_snapshot_history TO helio_privileged;
