## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 03588796bbef47de0b48bedd201ae3e49739a191 (change dir untracked). Owner rulings Q1-A/Q2-A/Q3-A taken as settled.

### What I verified (with evidence)

- **V121 is free.** The worktree's latest migration is V120. A scan of every local branch and `origin/*` ref for `V12[1-9]__*` found nothing.
- **V121 is safe as the non-BYPASSRLS Flyway role.** V113 creates `product_active_users_daily` as the migration role. Its header says "the app-pool role owns them". The table has no RLS. `ADD COLUMN ... BIGINT` (nullable, no default) is metadata-only. V113 grants `helio_privileged` at table level (`GRANT SELECT, INSERT, UPDATE, DELETE ON ... product_active_users_daily`), so the new column is covered. Every writer and reader of the table uses an explicit column list: ProductEventRepository.scala:138/145, ProductUsageRepository.scala:39, ProductUsageRepositoryRoleSpec.scala:74 and the ProductEventRepositorySpec selects. So adding the column breaks no existing statement. The design says existing rows get NULL and nothing else changes. That is correct.
- **Rejecting a SQL backfill is correct.** `product_events` is FORCE RLS, and its policy uses a bare `current_setting('app.current_user_id')` (V113). Run as non-BYPASSRLS `helio`, that would fail or read nothing.
- **The tick claim holds ("MAU null until the next day rolls, at most about 1 UTC day").** In ProductEventRollupService.tickAt, start = min(rt+1, today-1), it rolls [start, today], and it advances to today-2. On day D (rt = D-2), only D-1 and D are rerolled, so the existing rt row keeps a null MAU. On day D+1, the first tick advances rt to D-1. That row was already rolled by the new binary on day D, so it has MAU. The purge path (`rollupRangeAction` from rt+1) behaves the same way.
- **`helio_privileged` can SELECT `users`.** `users` has no RLS: I grepped every migration for an RLS or POLICY statement on users and found none. `users` comes from V6, which predates V38's `GRANT SELECT ... ON ALL TABLES IN SCHEMA public`. Prod already reads `users` through `withSystemContext` in NodePayloadHistoryRepository.scala:41/54 (`JOIN users u`). The design's pre-release `has_table_privilege` check backs this up.
- **The system user is unique and seeded once.** Only V10 inserts into `users` (id `...0001`). V114 backfilled `signup_completed` for it, so a rollup signup sum cannot exclude it. That supports Q2-A's direct count.
- **The WAU mirror is sound.** `wauComputable = day.minusDays(6).isAfter(cutoff)`. MAU uses the same rule with `minusDays(29)`. `activeUsersUpsert` always inserts a row per rolled day (INSERT ... SELECT of scalar subqueries), so "missing row" only means "never rolled".
- **`nullingNones` exists** (AdminUsageProtocol.scala:43) and is the right tool for the `totals` nulls.
- **The spec delta is consistent with the base.** The MODIFIED "Aggregates from rollups only" requirement matches the base header in openspec/specs/owner-usage-admin/spec.md:23 and narrows the exception to `totals.totalUsers` only. I found no contradictions between the proposal, design, tasks and specs.
- **AC coverage.** totalUsers on the prod-like fixture plus red-first is covered by 3.1. Identifier-free is covered by 3.3, which extends the existing guard. Owner-only and 403-before-parse is covered by 3.3. Longer windows and data-through are covered by 1.5/2.2/3.5. The system-user exclusion is covered by 1.3. Contract updates (schema `days.maximum` 90 to 365 plus `totals`, CLAUDE.md, spec) are planned in 1.6. That 1.6 grep verification is a concrete acceptance signal.

### Verdict: CONFIRM

### Non-blocking notes

1. **Make test isolation for the exact user count concrete.** The design names the risk but leaves the mechanism as "or". Ground truth:
   - `ProductTelemetryDbHarness` inserts `userA`/`userB` once in `beforeAll`, and `beforeEach` never deletes users.
   - `AdminUsageRoutesSpec` inserts free/beta/owner users, and the owner must exist to call the route.
   - A naive 8-user fixture therefore reads 10 (service) or 11 (route).

   Fix this either way:
   - Use a dedicated fresh-DB suite (or count only in a suite with no other inserts), or
   - Make the pre-existing users part of the 8.

   Never adjust the expected number to match residue.
2. **Avoid vacuous zeros in 3.1.** A fixture with only 53-166-day-old signups gives 7d = 30d = 0. Assert 0 there, but separately, per the spec scenario "fixture users emit events on known days", the fixture should produce non-zero, distinct 7d and 30d counts. For example, one user inside 7 days and three inside 30, with one of them active on several days. Then a wrong-column or wrong-window bug turns the test red.
3. **The AC's literal is "8 users, total = 8 (or 7 excluding the system user)",** which suggests prod's 8 includes the system user. The design's fixture (8 plus system, expects 8) tests the same rule. Either is fine, but say which one in the test name so the AC trace is unambiguous at the final gate.
4. **The frontend seam test has no pattern to follow yet.** No frontend test validates against a JSON schema. `ajv` is only a transitive package in `node_modules`, not a declared dependency. Either add it as an explicit devDependency (a dependency change, so call it out in the PR) or rely on the backend `JsonSchemaValidation` plus a real captured response. Do not import an undeclared transitive package.
5. **Add a role check for `users`.** Consider extending `ProductUsageRepositoryRoleSpec` (NOBYPASSRLS `helio_privileged`): its service call will now hit `users`. Add a revoke-SELECT-on-users red check mirroring the existing `product_event_daily` one, so the grant is proven as the access path.
6. **Spec wording.** The product-telemetry delta says "Days rolled up before this value existed SHALL keep it null". Any later re-roll of such a day inside retention (the public `rollupDay`, or a tick recompute) would fill it. "are not backfilled" states the actual guarantee and won't produce a false-red test.
