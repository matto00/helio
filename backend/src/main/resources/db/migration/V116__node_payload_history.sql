-- HEL-1276 (HEL-918 L6): opt-in full row payloads per materialized node per run. One JSONB array
-- of rows per (node, run), written in the same transaction as the node's snapshot replace and its
-- output_snapshot_history summary points (V115), only when an Output on the node opted in via
-- outputs.config.historyPayloads and the pipeline owner's tier allows payloads. Capped (rows and
-- serialized bytes) and tier-retained by the application, never truncated.
--
-- UUID primary key, not BIGSERIAL (TRUNCATE ... CASCADE sequence landmine, D8). run_id is TEXT with
-- NO foreign key (D7: pipeline_runs keeps only the newest runs). pipeline_id references pipelines
-- with ON DELETE CASCADE so deleting a pipeline removes its payloads. node_step_id / root_id mirror
-- V98's exactly-one-of CHECK, so a root-bound payload always carries its root.
--
-- RLS mirrors V115 / node_snapshots: ENABLE + FORCE, four policies on
-- helio_can_access_pipeline(pipeline_id), plus an explicit GRANT to helio_privileged (writes and
-- the retention pass run on the privileged pool). Safe to FORCE at create time: nothing is
-- backfilled.
--
-- output_snapshot_history.payload_id links a summary point to its payload. ON DELETE SET NULL: a
-- deleted payload un-links its points and never deletes them. FK checks and referential actions
-- are not RLS-filtered.
--
-- Additive only -- never edit this file once applied (Flyway checksums the whole file).

CREATE TABLE node_payload_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id    TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  node_step_id   TEXT NULL,
  root_id        TEXT NULL,
  run_id         TEXT NULL,
  trigger_source TEXT NOT NULL,
  captured_at    TIMESTAMPTZ NOT NULL,
  row_count      INT NOT NULL,
  byte_size      INT NOT NULL,
  rows           JSONB NOT NULL,
  CONSTRAINT node_payload_history_node_xor CHECK ((node_step_id IS NULL) <> (root_id IS NULL))
);

CREATE INDEX idx_node_payload_history_node_captured
  ON node_payload_history (pipeline_id, node_step_id, root_id, captured_at DESC);

ALTER TABLE node_payload_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_payload_history FORCE ROW LEVEL SECURITY;

CREATE POLICY node_payload_history_select ON node_payload_history
  FOR SELECT
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY node_payload_history_insert ON node_payload_history
  FOR INSERT
  WITH CHECK (helio_can_access_pipeline(pipeline_id));

CREATE POLICY node_payload_history_update ON node_payload_history
  FOR UPDATE
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY node_payload_history_delete ON node_payload_history
  FOR DELETE
  USING (helio_can_access_pipeline(pipeline_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON node_payload_history TO helio_privileged;

ALTER TABLE output_snapshot_history
  ADD COLUMN payload_id UUID NULL REFERENCES node_payload_history(id) ON DELETE SET NULL;

CREATE INDEX idx_output_snapshot_history_payload
  ON output_snapshot_history (payload_id) WHERE payload_id IS NOT NULL;
