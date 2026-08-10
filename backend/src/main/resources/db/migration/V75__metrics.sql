-- HEL-446: Metric definition persistence (Semantic/Metric Layer epic, HEL-418).
--
-- metrics is a direct-owner table (owner_id lives on the row), structurally
-- closer to alert_rules (V60) than the older image_uploads (V54): both are
-- owner-only tables with a FK-with-CASCADE to data_types. Follows V60's
-- newer conventions -- an explicit owner_id ... REFERENCES users(id) FK
-- (V35/V54 predate this and don't have it) -- and indexes both owner_id and
-- data_type_id (the latter mirrors idx_alert_rules_target_data_type_id:
-- data_type_id carries ON DELETE CASCADE, so an unindexed column here would
-- force a full scan on every DataType delete).
--
-- allowed_dimensions/format are stored as JSONB -- no new serialization
-- mechanism, same pattern as DataTypeRepository's dataFieldsColumnType.
--
-- No CRUD service/REST routes yet (data-layer only ticket); this is the
-- foundation the rest of HEL-418 builds on.

CREATE TABLE metrics (
    id                  TEXT PRIMARY KEY,
    owner_id            UUID NOT NULL REFERENCES users(id),
    data_type_id        TEXT NOT NULL REFERENCES data_types(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    measure_field       TEXT NOT NULL,
    aggregation         TEXT NOT NULL,
    allowed_dimensions  JSONB NOT NULL,
    format              JSONB NOT NULL,
    deprecated          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_metrics_owner_id ON metrics(owner_id);
CREATE INDEX idx_metrics_data_type_id ON metrics(data_type_id);

-- ── RLS: mirror the V35/V60 direct-owner pattern exactly ─────────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table --
-- without FORCE, the table owner would bypass RLS even on the app pool. The
-- privileged pool (helio_privileged, BYPASSRLS -- see V34) is the only
-- sanctioned bypass, reserved for findByIdInternal.

ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics FORCE ROW LEVEL SECURITY;

CREATE POLICY metrics_owner ON metrics
  USING (owner_id = current_setting('app.current_user_id')::uuid);
