-- HEL-455: Alert event persistence (firing/resolved/acknowledged/snoozed).
--
-- Second ticket of the sequential 3-ticket alerts chain (HEL-447 -> HEL-455
-- -> HEL-466). alert_events FKs alert_rules (V60).
--
-- owner_id/target_data_type_id are denormalized onto the row (copied from
-- the parent alert_rules row at creation) rather than joined through
-- alert_rule_id -- this keeps the RLS policy a direct-owner check
-- (consistent with alert_rules/pipelines/data_types) instead of a
-- subquery-based indirect policy, and avoids an extra join on every
-- list/ack/snooze call (design.md "Table shape" decision).
--
-- alert_rule_id cascades: an event for a deleted rule is meaningless,
-- mirroring how alert_rules itself cascades from data_types.
--
-- pipeline_run_id is a plain unenforced TEXT column (no FK) -- pipeline runs
-- are ephemeral execution records, not a durable referenceable table in this
-- schema; the ticket only requires the id be captured for traceability.
--
-- state is a TEXT enum + CHECK constraint, mirroring severity's pattern on
-- alert_rules rather than a native Postgres enum type (no native enum
-- precedent exists in this schema).

CREATE TABLE alert_events (
    id                  TEXT PRIMARY KEY,
    alert_rule_id       TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    owner_id            UUID NOT NULL REFERENCES users(id),
    target_data_type_id TEXT NOT NULL,
    value               JSONB NOT NULL,
    pipeline_run_id     TEXT,
    severity            TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    state               TEXT NOT NULL CHECK (state IN ('firing', 'resolved', 'acknowledged', 'snoozed')),
    first_fired_at      TIMESTAMPTZ NOT NULL,
    last_evaluated_at   TIMESTAMPTZ NOT NULL,
    resolved_at         TIMESTAMPTZ,
    acknowledged_at     TIMESTAMPTZ,
    snoozed_until       TIMESTAMPTZ
);

CREATE INDEX idx_alert_events_rule_state ON alert_events(alert_rule_id, state);
CREATE INDEX idx_alert_events_owner_id ON alert_events(owner_id);

-- ── RLS: mirror the V60 direct-owner pattern exactly ─────────────────────────
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the table --
-- without FORCE, the table owner would bypass RLS even on the app pool. The
-- privileged pool (helio_privileged, BYPASSRLS -- see V34) is the only
-- sanctioned bypass, reserved for the background evaluation engine's
-- findActiveByRule/upsertFiringInternal (no real caller yet -- HEL-466 wires
-- it).

ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events FORCE ROW LEVEL SECURITY;

CREATE POLICY alert_events_owner ON alert_events
  USING (owner_id = current_setting('app.current_user_id')::uuid);
