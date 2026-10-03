# HEL-1244: Backfill signup_completed product events for pre-telemetry users so /admin/usage shows signup history

## Description
Owner ruling (2026-10-03): backfill past signups, reversing HEL-1208's no-backfill ruling. Insert one `signup_completed` product event per existing user lacking one, `occurred_at = users.created_at`, empty properties, idempotent via `uq_product_events_once_per_user` (`ON CONFLICT (user_id, event) WHERE event IN ('signup_completed','first_dashboard_rendered') DO NOTHING`). Prefer Flyway V114. Do NOT backfill `first_dashboard_rendered`. Verify rollup (`ProductEventRollupService.tickAt`, `rollupRange`) rolls history on first tick, retention purge exempts signup_completed, WAU computable, cost of many days in one tick.

Hazard: `product_events` is ENABLE+FORCE RLS; prod Flyway runs as non-BYPASSRLS `helio`. Must be proven by `FlywayNonSuperuserMigrationSpec` with rows actually inserted, red-first (plain INSERT fails under that role).

## Acceptance Criteria
- After deploy prod /admin/usage shows signups per day back to earliest real user.
- Re-running is a no-op.
- No user's own row is duplicated; new signups unaffected.
- Migration proven as non-superuser non-BYPASSRLS role with rows inserted, red-first.
