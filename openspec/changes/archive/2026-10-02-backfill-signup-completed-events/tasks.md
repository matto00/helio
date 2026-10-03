## 1. Red-first RLS proof
- [x] 1.1 In `FlywayNonSuperuserMigrationSpec` (or a sibling spec reusing its non-superuser setup), seed users with no events and show a plain `INSERT INTO product_events SELECT ... FROM users` FAILS under the NOSUPERUSER NOBYPASSRLS role (record the error)

## 2. Migration
- [x] 2.1 Add `backend/src/main/resources/db/migration/V114__backfill_signup_completed_events.sql` per design Decision 1 (per-user set_config in a DO block, ON CONFLICT DO NOTHING, no first_dashboard_rendered)
- [x] 2.2 Assert under the non-superuser role: expected row count inserted with `occurred_at = users.created_at`, `properties = '{}'`, none for first_dashboard_rendered, a pre-existing event untouched
- [x] 2.3 Assert idempotency: re-running the backfill body inserts 0 rows
- [x] 2.4 Assert on a fresh connection/statement after the migration (run under the non-superuser role, inside Flyway's transaction) that `current_setting('app.current_user_id', true)` is NULL/empty

## 3. Rollup consequence
- [x] 3.1 V114 lowers a non-NULL `rolled_through` to (earliest backfilled day - 1) when it inserted rows (design Decision 4); NULL stays NULL
- [x] 3.2 Test (a): rolled_through NULL, ~400-day history, one `tickAt` rolls all days through today-2, sets `rolled_through`; report elapsed time; assert WAU non-NULL inside the retention window; purge exempts `signup_completed`
- [x] 3.3 Test (b): rolled_through NON-NULL with rolled days present: after V114 the next tick re-rolls the historical days and the admin usage query shows them
- [x] 3.4 Test the partly-purged guard behaviour and document the accepted limitation
- [x] 3.5 Empty `users` table: V114 succeeds and changes nothing (including no rolled_through change)

## 4. Gates
- [x] 4.1 `cd backend && nice -n 19 sbt testFull` green (report known flakes HEL-1228/1225/1215 by name)

## Standing Constraints
