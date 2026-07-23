-- HEL-447: Alert rule persistence foundation.
--
-- alert_rules is a direct-owner table (owner_id lives on the row), following
-- the same shape as pipelines/data_types (see V35's direct-owner RLS
-- pattern). This is the first ticket of a sequential 3-ticket alerts chain
-- (HEL-447 -> HEL-455 -> HEL-466); later tickets FK this table.
--
-- `condition` is stored as JSONB (comparator + threshold + optional window
-- params) so richer condition kinds can be added without a migration -- the
-- service layer only validates the `comparator`/`threshold` keys on write
-- and passes the rest of the blob through opaquely (design.md).
--
-- `target_data_type_id` cascades: a rule with no target is meaningless,
-- mirroring how `pipeline_steps` cascades from `pipelines`.

CREATE TABLE alert_rules (
    id                   TEXT PRIMARY KEY,
    owner_id             UUID NOT NULL REFERENCES users(id),
    target_data_type_id  TEXT NOT NULL REFERENCES data_types(id) ON DELETE CASCADE,
    metric               TEXT NOT NULL,
    condition            JSONB NOT NULL,
    name                 TEXT NOT NULL,
    enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    severity             TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_rules_owner_id ON alert_rules(owner_id);
CREATE INDEX idx_alert_rules_target_data_type_id ON alert_rules(target_data_type_id);

-- ── RLS: mirror the V35 direct-owner pattern exactly ─────────────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table --
-- without FORCE, the table owner would bypass RLS even on the app pool. The
-- privileged pool (helio_privileged, BYPASSRLS -- see V34) is the only
-- sanctioned bypass, reserved for `listEnabledByDataTypeInternal`.

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY alert_rules_owner ON alert_rules
  USING (owner_id = current_setting('app.current_user_id')::uuid);
