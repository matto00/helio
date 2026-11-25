-- HEL-1175: an optional idempotency key on a form/counter submit. The key, the submitter and the panel are recorded on
-- the appended row, so a same-key re-send (same submitter, same panel) is answered from that row instead of appending a
-- second one. The key lives exactly as long as its row: no purge job, no new table, no new policy (the columns inherit
-- dataset_rows' grants and its dataset_rows_owner policy).
--
-- Additive only: nullable columns, no default and NO backfill / data UPDATE. dataset_rows is FORCE RLS and Flyway's role
-- is not BYPASSRLS, so an UPDATE here is the v0.7.x incident class; rows written before this stay NULL (unkeyed).
-- ON DELETE SET NULL: deleting the submitter or the panel must never delete the dataset's rows (FK actions bypass RLS).
-- A key whose submitter or panel is gone can then only ever answer a conflict, never a replay.
ALTER TABLE dataset_rows
  ADD COLUMN submit_key      UUID NULL,
  ADD COLUMN submit_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN submit_panel_id TEXT NULL REFERENCES panels(id) ON DELETE SET NULL;

-- Uniqueness per dataset; the lookup under the source lock is the primary guard, this index is defence in depth.
CREATE UNIQUE INDEX ux_dataset_rows_submit_key ON dataset_rows (data_source_id, submit_key) WHERE submit_key IS NOT NULL;

-- So a user or panel delete's SET NULL is an index lookup, not a scan of the multi-tenant table.
CREATE INDEX idx_dataset_rows_submit_user_id  ON dataset_rows (submit_user_id)  WHERE submit_user_id  IS NOT NULL;
CREATE INDEX idx_dataset_rows_submit_panel_id ON dataset_rows (submit_panel_id) WHERE submit_panel_id IS NOT NULL;
