## Why

Telemetry began with v0.8.7; every earlier user has no `signup_completed` row, so prod `/admin/usage` has no signup history. The owner chose to backfill (reversing HEL-1208's no-backfill ruling).

## What Changes

- New Flyway migration `V114__backfill_signup_completed_events.sql` inserting one `signup_completed` per user lacking one, `occurred_at = users.created_at`, empty properties, idempotent via the partial unique index, working under the non-superuser non-BYPASSRLS prod role.
- `first_dashboard_rendered` is explicitly NOT backfilled.
- Tests: red-first non-superuser proof, row-count proof, idempotency proof, rollup-after-backfill proof over a multi-month history.

## Capabilities

### Modified Capabilities
- `product-telemetry`: adds a requirement for the historical signup backfill.

## Impact

Backend migration + tests only. No API, schema, or frontend change.
