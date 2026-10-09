## Standing Constraints

- [C1] Exact user-count assertions must control every users row in the DB they run against (fresh DB or fixture accounts for harness users); never adjust the expected number to fit residue rows.
- [C2] Active-count tests must use events giving distinct NON-ZERO 7-day and 30-day counts; a 0 expectation alone proves nothing.
- [C3] Frontend schema validation: add ajv as an explicit devDependency (disclosed in PR) or do not import it.

## Backend

- [x] 1.1 Re-verify V121 is free (origin/main + local branches), then add `V121__monthly_active_users.sql` (nullable `monthly_active_users BIGINT`, header comment per design Decision 4); verify migrations apply in `ProductTelemetryDbHarness` (non-BYPASSRLS Flyway role)
- [x] 1.2 Extend `activeUsersUpsert` to write the trailing-30-day distinct count (null when `day-29` is not after cutoff) in both branches and both ON CONFLICT updates; verify via the rollup test in 3.2
- [x] 1.3 Add `ProductUsageRepository.totalUsers()` (excludes a single named `SystemUserId` constant) and `activeTotals(day)` (WAU/MAU for one day); verify via 3.1
- [x] 1.4 Add `AdminUsageTotals` + `totals` field to the protocol with explicit nulls (`nullingNones`); verify JSON shape test in 3.3
- [x] 1.5 `AdminUsageService`: build `totals` (also on the empty/null-rolled path), `MaxDays = 365`; verify via 3.1/3.3
- [x] 1.6 Update `schemas/admin/admin-usage-response.schema.json` (`totals`, `days` max 365, description), CLAUDE.md endpoint line (1..365, totals), `ProductUsageRepository` doc comment; verify `grep -rn "1\.\.90" CLAUDE.md schemas backend/src/main` returns no admin-usage hit

## Frontend

- [x] 2.1 Add `AdminUsageTotals` to `types/adminUsage.ts`; verify `npm run typecheck`
- [x] 2.2 Page: totals card (null -> unavailable, never 0; tracked-event labelling), windows 7/30/90/180/365, prominent data-through notice with lag note; verify `AdminUsagePage.test.tsx`

## Tests

- [x] 3.1 RED-FIRST service/route test with prod-like fixture: 8 users created 53-166 days before `rolled_through` (+ system user), real write path + real rollup; assert `totalUsers = 8` and hand-counted 7d/30d active; capture the failing run before implementing
- [x] 3.2 Rollup test: MAU equals hand-counted distinct users over 30 days (user active on several days counted once); null outside retention; idempotent rerun
- [x] 3.3 Route tests: `days=365` 200 with 365 points, `days=366`/`0`/`abc` 400, non-owner 403 before parsing; existing no-identifier guard extended to cover `totals` and stays green
- [x] 3.4 Seam: backend test validates the serialised response against the JSON schema; frontend test validates its fixture against the same schema
- [x] 3.5 Frontend tests: totals render, null active shows unavailable, 180/365 options, data-through notice
- [x] 3.6 Running app, both themes, throwaway OWNER user (HELIO_OWNER_EMAILS in worktree env; never matt@helio.dev); capture a real `/api/admin/usage?days=365` response; screenshots outside the worktree root; delete throwaway rows by exact id
