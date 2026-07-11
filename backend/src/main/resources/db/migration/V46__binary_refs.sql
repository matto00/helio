-- HEL-217: binary_refs — a row-correlated secondary index over `binary-ref`
-- field values already stored inline in `data_type_rows.data` (JSONB). This
-- table exists for lookups that don't require deserializing every row
-- (lifecycle management, future GC, asset browsing); it is never an
-- alternate read path for row data. See BinaryRefRepository and design.md
-- Decision 4 for the write contract (overwriteForDataType is the only
-- writer — no singular insert/delete).
--
-- No FK from data_type_id -> data_types.id, matching the existing
-- data_type_rows precedent (V29): orphan cleanup is explicitly deferred.

CREATE TABLE binary_refs (
    id           TEXT PRIMARY KEY,
    data_type_id TEXT NOT NULL,
    row_index    INT NOT NULL,
    field_name   TEXT NOT NULL,
    storage_key  TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    filename     TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (data_type_id, row_index, field_name)
);

CREATE INDEX idx_binary_refs_data_type_id ON binary_refs (data_type_id);

-- RLS: binary_refs is indirectly owned via data_type_id -> data_types.owner_id,
-- the same pattern used for data_type_rows (V35). Always written/read via
-- withSystemContext (background connector/pipeline path); the privileged
-- pool bypasses this policy. Enabled so any future non-privileged path is
-- fail-closed by default rather than silently open.

ALTER TABLE binary_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE binary_refs FORCE ROW LEVEL SECURITY;

CREATE POLICY binary_refs_owner ON binary_refs
  USING (
    EXISTS (
      SELECT 1 FROM data_types dt
      WHERE dt.id = binary_refs.data_type_id
        AND dt.owner_id = current_setting('app.current_user_id')::uuid
    )
  );
