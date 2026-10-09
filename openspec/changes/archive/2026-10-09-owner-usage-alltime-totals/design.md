## Context

See proposal.md - Why. Current shape: `AdminUsageRoutes` (owner check via `AdminAccessService.guardOwner` before `days`
is parsed) -> `AdminUsageService.usage` -> `ProductUsageRepository` reading the V113 rollup tables on
`DbContext.withSystemContext` (role `helio_privileged`). Rollup tables carry no RLS; `product_events` is FORCE-RLS.
The rollup (`ProductEventRepository.rollupDayAction` / `activeUsersUpsert`) recomputes one UTC day from raw rows; the
tick (`ProductEventRollupService.tickAt`) rolls `(rolled_through, today]` and advances the mark to `today - 2`.
`product_active_users_daily` holds `daily_active_users` and nullable `weekly_active_users` (null when `day - 6` is not
after the retention cutoff). Owner rulings 2026-10-09 (escalation HEL-1420, all three option A) fix the product calls.

## Goals / Non-Goals

**Goals:** all-time identifier-free totals independent of `days`; 30-day active via the rollup; `days` 1..365.
**Non-Goals:** per-user data; a non-telemetry activity signal; cleaning the system user (HEL-1421); MAU backfill.

## Decisions

1. **Response shape: a new required `totals` object** `{totalUsers: integer, activeLast7Days: integer|null,
   activeLast30Days: integer|null, asOf: date|null}` on `AdminUsageResponse`. Explicit JSON `null`s via the existing
   `nullingNones` wrapper (spray omits `None` otherwise - the seam bug class). Alternative (top-level flat fields)
   rejected: a nested object reads as one card and keeps the window-scoped fields visibly separate.
2. **`totalUsers` = `SELECT COUNT(*) FROM users WHERE id <> <system id>`** on `withSystemContext` (owner ruling Q2-A).
   `users` has no RLS; `helio_privileged` holds SELECT via V38's `GRANT ... ON ALL TABLES` (users predates V38).
   The system id is one named constant (`SystemUserId`, value `00000000-0000-0000-0000-000000000001`, seeded by V10)
   in the repository's companion, so HEL-1421 changes or drops one line. Rejected: summing rollup `signup_completed`
   (cannot exclude the system user - V114 backfilled it and rollups carry no user id).
3. **Active counts read the `rolled_through` row of `product_active_users_daily`**: 7d = `weekly_active_users`
   (existing), 30d = new `monthly_active_users`. A missing row or null value -> `null` (never 0). `asOf` =
   `rolled_through`. When `rolled_through` is null: active fields and `asOf` null, `totalUsers` still computed.
4. **V121 `ALTER TABLE product_active_users_daily ADD COLUMN monthly_active_users BIGINT`** (nullable, no default:
   metadata-only, no rewrite, no data read). Runs as the table owner (`helio` in prod owns the V113 rollup tables), so
   no BYPASSRLS needed; it never touches `product_events`, so FORCE RLS is irrelevant. Table-level grants (V113 explicit
   GRANT to `helio_privileged`) cover new columns. Effect on existing prod rows: every existing row gets
   `monthly_active_users = NULL`; no other column changes. Rejected: backfilling in SQL - it would need to read
   `product_events` as non-BYPASSRLS `helio`, which the owner policy's bare `current_setting` makes fail (V114 lesson).
5. **Rollup writes MAU in `activeUsersUpsert`** alongside DAU/WAU: computable iff `day.minusDays(29).isAfter(cutoff)`
   (same rule shape as WAU); otherwise null. A computable roll writes the value and overwrites any prior one on conflict. A non-computable roll inserts NULL, but on conflict keeps a previously computed value (`COALESCE(EXCLUDED.x, old.x)`), exactly as WAU already did: an overwrite would null a value that was correctly computed while the window was still inside retention.
   Consequence: after deploy the headline 30d count is `null` until the tick rolls the next day past `rolled_through`
   (at most ~1 UTC day); the page shows "not yet available". Accepted (no backfill path; see 4).
6. **`days` range 1..365** (Q3-A): `MaxDays = 365`, same parse/400 path, never clamped. Cost: 365 zero-filled points
   x 4 series from indexed day-keyed rollup scans - trivial. Schema `days.maximum` 365.
7. **Frontend**: types gain `AdminUsageTotals`; page renders a totals card above the window content (also when
   `rolledThrough` is null, showing total users with active as unavailable); WINDOWS adds 180/365; the data-through
   line becomes a prominent notice: "Data through <date> (UTC). The most recent ~2 days are still being rolled up."
   Active labels: "Active, last 7 days" with hint "users with a tracked product event", not "active users".
   DESIGN.md tokens + existing `UsageCard`/`Stat` components only.
8. **Seam**: a frontend contract test validates a response fixture against `admin-usage-response.schema.json`
   (follow whatever schema-validation pattern exists; add one if none), and a backend test validates the real
   serialised response against the same schema; plus a real response captured from the running backend as evidence.

## Risks / Trade-offs

- [Telemetry "active" undercounts real use: most events are once-per-user first-run events] -> honest labelling; real
  activity signal is a filed follow-up.
- [`totalUsers` counts current users, not historical signups; deleted users drop out] -> matches "total users"; stated.
- [Test DBs are per-suite embedded Postgres but users persist across tests within a suite] -> assert exact counts in
  a suite/state that controls all `users` rows (or clean `users` beyond the system user in the test), never a delta
  that a residue row could satisfy vacuously.
- [V121 number collision with a concurrent lane] -> verified free against origin/main and all local branches at
  planning time; executor re-checks before commit.

## Migration Plan

Deploy applies V121 (instant). Owner pre-release read-only prod check:
`SELECT has_table_privilege('helio_privileged','users','SELECT') AS users_ok,
(SELECT relowner::regrole FROM pg_class WHERE relname='product_active_users_daily') AS rollup_owner,
(SELECT rolled_through FROM product_rollup_state WHERE id=1) AS rolled_through;`
expects `users_ok = t` and `rollup_owner = helio` (the Flyway role). Rollback: the column is additive and unread by the
old binary.

## Planner Notes

Self-approved: `totals` as a nested object; `asOf` field; constant placement; MAU computability rule mirroring WAU;
no MAU backfill (forced by RLS, owner informed via final report).
