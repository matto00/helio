-- HEL-1244: backfill one `signup_completed` product event per pre-telemetry user, so the
-- admin usage view shows signup history back to the earliest real user (owner ruling
-- 2026-10-03, reversing HEL-1208's no-backfill ruling). `first_dashboard_rendered` is
-- deliberately NOT backfilled.
--
-- RLS: `product_events` is ENABLE + FORCE ROW LEVEL SECURITY, so even the table-owning,
-- non-BYPASSRLS migration role (prod `helio`) is subject to the `product_events_owner` policy,
-- whose bare `current_setting('app.current_user_id')` raises 42704 when unset. A plain
-- `INSERT ... SELECT FROM users` therefore passes under a superuser and fails in production.
-- Each insert here is made under its own user's context via a transaction-local set_config
-- (is_local = true), which exercises the real WITH CHECK policy, takes no DDL lock on the live
-- table, and cannot leak past the migration transaction. `users` has no RLS, so the loop can
-- read every user.
--
-- Idempotent: `ON CONFLICT ... DO NOTHING` against `uq_product_events_once_per_user`, so a user
-- who already has a signup_completed row (including one landing concurrently with the deploy)
-- is skipped untouched.
--
-- Rollup consequence: when `product_rollup_state.rolled_through` is already set, the next
-- rollup tick would resume after it and never reach the backfilled history. If any row was
-- inserted, lower the mark to (earliest backfilled UTC day - 1) so the tick recomputes forward
-- (rollupDayAction is an idempotent recompute from raw rows). NULL stays NULL (the tick then
-- starts at the earliest event day, which is now the earliest signup). Accepted limitation:
-- this must not be re-applied to a database whose old rows were already purged (Flyway runs it
-- once). `product_rollup_state` has no RLS.
--
-- Additive only -- never edit this file once applied (Flyway checksums the whole file).

DO $$
DECLARE
  u            RECORD;
  inserted     BIGINT;
  total        BIGINT := 0;
  earliest_day DATE;
BEGIN
  FOR u IN SELECT id, created_at FROM users ORDER BY created_at LOOP
    PERFORM set_config('app.current_user_id', u.id::text, true);
    INSERT INTO product_events (user_id, event, properties, occurred_at)
    VALUES (u.id, 'signup_completed', '{}'::jsonb, u.created_at)
    ON CONFLICT (user_id, event) WHERE event IN ('signup_completed', 'first_dashboard_rendered') DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted > 0 THEN
      total := total + inserted;
      IF earliest_day IS NULL THEN
        earliest_day := (u.created_at AT TIME ZONE 'UTC')::date;
      END IF;
    END IF;
  END LOOP;

  -- Rows are visited in created_at order, so earliest_day is the earliest backfilled day.
  IF total > 0 THEN
    UPDATE product_rollup_state
       SET rolled_through = earliest_day - 1
     WHERE id = 1 AND rolled_through IS NOT NULL AND rolled_through >= earliest_day;
  END IF;
END
$$;
