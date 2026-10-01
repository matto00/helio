-- HEL-1208: first-party product telemetry. `product_events` holds one row per allow-listed
-- product event per user; five aggregate tables hold the daily rollups that outlive the per-user
-- rows once the retention purge removes them (see the product-telemetry capability spec).
--
-- RLS: `product_events` is direct-owner (user_id), the V109 pattern -- ENABLE + FORCE + one owner
-- policy. User-context inserts run on the app pool (`DbContext.withUserContext`); rollup and
-- purge touch every user's rows, so they run on the privileged pool (helio_privileged,
-- BYPASSRLS). The rollup tables hold aggregates only (no user id) and carry no RLS; the app-pool
-- role owns them, which is accepted because they contain nothing per-user.
--
-- Explicit GRANTs to helio_privileged, not V38's ALTER DEFAULT PRIVILEGES -- same reasoning as
-- V102/V105: production has hit grant-only incidents that superuser-run tests cannot observe.
--
-- ON DELETE CASCADE on user_id: no account-deletion path exists in the backend, so the FK action
-- is the mechanism that removes a deleted user's events (FK actions are not RLS-gated).
--
-- Additive only -- never edit this file once applied (shared dev DB; Flyway checksums the whole
-- file, comments included).

CREATE TABLE product_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK (event IN (
                'signup_completed',
                'first_dashboard_rendered',
                'provenance_opened',
                'firstrun_file_dropped',
                'firstrun_dashboard_created',
                'firstrun_template_chosen'
              )),
  properties  JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_events_occurred_at ON product_events (occurred_at);
CREATE INDEX idx_product_events_user_event ON product_events (user_id, event);

-- Server-side once-per-user dedupe: first row wins, a repeat insert is a no-op
-- (`ON CONFLICT (user_id, event) WHERE <this predicate> DO NOTHING`).
CREATE UNIQUE INDEX uq_product_events_once_per_user
  ON product_events (user_id, event)
  WHERE event IN ('signup_completed', 'first_dashboard_rendered');

ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events FORCE ROW LEVEL SECURITY;

CREATE POLICY product_events_owner ON product_events
  USING (user_id = current_setting('app.current_user_id')::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id')::uuid);

CREATE TABLE product_event_daily (
  day          DATE NOT NULL,
  event        TEXT NOT NULL,
  event_count  BIGINT NOT NULL,
  active_users BIGINT NOT NULL,
  PRIMARY KEY (day, event)
);

-- weekly_active_users is NULL for a day whose trailing 7-day window had already partly left
-- the retention window before its first rollup: it cannot be computed from partial raw rows.
CREATE TABLE product_active_users_daily (
  day                DATE PRIMARY KEY,
  daily_active_users BIGINT NOT NULL,
  weekly_active_users BIGINT
);

CREATE TABLE product_ttfd_daily (
  day            DATE PRIMARY KEY,
  sample_count   INT NOT NULL,
  median_seconds DOUBLE PRECISION NOT NULL,
  p90_seconds    DOUBLE PRECISION NOT NULL,
  histogram      JSONB NOT NULL
);

CREATE TABLE product_event_property_daily (
  day            DATE NOT NULL,
  event          TEXT NOT NULL,
  property_key   TEXT NOT NULL,
  property_value TEXT NOT NULL,
  event_count    BIGINT NOT NULL,
  PRIMARY KEY (day, event, property_key, property_value)
);

CREATE TABLE product_rollup_state (
  id            SMALLINT PRIMARY KEY CHECK (id = 1),
  rolled_through DATE,
  last_purge_at TIMESTAMPTZ
);

INSERT INTO product_rollup_state (id) VALUES (1);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  product_events,
  product_event_daily,
  product_active_users_daily,
  product_ttfd_daily,
  product_event_property_daily,
  product_rollup_state
TO helio_privileged;
