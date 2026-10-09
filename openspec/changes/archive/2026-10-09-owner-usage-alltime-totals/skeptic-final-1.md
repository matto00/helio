## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `63706d76574f6cc45f7cb641a0c935579f4d104b` against the live-resolved base `03588796bbef47de0b48bedd201ae3e49739a191` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/owner-usage-alltime-totals/HEL-1420`.

Owner rulings Q1-A, Q2-A and Q3-A were treated as settled and not reopened.

### What I verified (with evidence)

**Backend specs, fresh run.** I ran these in a `git clone --shared` of HEAD under the session scratchpad, so the worktree was not touched:
- `AdminUsageTotalsSpec`
- `ProductEventMonthlyActiveSpec`
- `ProductUsageRepositoryRoleSpec`
- `AdminUsageRoutesSpec`
- `AdminUsageServiceSpec`

Command: `nice -n 19 sbt -batch testOnly ...`. Result: exit 0, `Tests: succeeded 30, failed 0`. The harness is EmbeddedPostgres. Flyway runs as `helio_migration_test NOSUPERUSER NOBYPASSRLS` (`ProductTelemetryDbHarness.scala`), so V121 applies under a non-BYPASSRLS migration role on every run of these specs.

**Mutation testing.** I reproduced each failure myself, then reverted every mutation (`git checkout -- backend`, clone status clean). Every guard goes red for the right reason:

| # | Mutation | Result |
| --- | --- | --- |
| M1 | `totalUsers` system-user exclusion replaced with `WHERE id IS NOT NULL` | `days=1: 9 was not equal to 8` (AdminUsageTotalsSpec:76) and `(3,None,None,None) was not equal to (2,None,None,None)` (:96). The exact-count fixture is not vacuous: it counts all 9 rows and the exclusion is what yields 8 (C1). |
| M2 | MAU window `minusDays(29)` changed to `30` | `Some(3) was not equal to Some(2)` (ProductEventMonthlyActiveSpec:31) and `Some(5) was not equal to Some(4)` (AdminUsageTotalsSpec:85) |
| M5 | MAU window `29` changed to `28` | `Some(1) was not equal to Some(2)` (ProductEventMonthlyActiveSpec:31). Both window boundaries are pinned. |
| M3 | COALESCE keep-prior removed for `monthly_active_users` | `None was not equal to Some(2)` (ProductEventMonthlyActiveSpec:48). The keep-prior rule is guarded. |
| M4 | `activeLast30Days` dropped from `nullingNones` (null omitted instead of explicit) | the schema-validation test goes red. The backend half of the seam catches a shape drift. |
| FE | `totalUsers` renamed to `userCount` across the frontend type, fixture, component and tests (client-side drift) | `adminUsage.contract.test.ts` 2 failed. Unmutated: 21/21 passed. The frontend half of the seam catches it. |

**Red-first.** The executor's red log (`.concertino/runs/HEL-1420/evidence/.concertino-evidence-tmp/red-first-AdminUsageTotalsSpec.txt`) shows `0 was not equal to 8` at :76 and a missing `monthly_active_users` column. Those line numbers match where my M1 and M2 mutations fail today, so the log is consistent with the shipped spec. I did not treat the log as proof. M1, M2, M3 and M5 independently show the spec fails on the behaviours it claims to guard.

**AC1, total users = 8 with active counts.**
- Fixture `AdminUsageTotalsSpec.scala` `seedProdLike`: 8 users created 53..166 days before `rolled_through`, plus the system user. It goes through the real `ProductEventService.ingest`/`recordSignup` and the real `ProductEventRollupService.tickAt`.
- It asserts `COUNT(*) FROM users = 9` and `totalUsers = 8` for days 1/7/90/365. That is 7 excluding the system user out of 8 including it, per Q2-A, with the fixture's 8 non-system users.
- 7d = 2 and 30d = 4: distinct and non-zero (C2). The fixture includes a two-day user, a user one day before the window, and a user after `rolled_through`.

**AC2, identifier-free.**
- Service spec: a serialised-body grep for user ids, the system id and `userId`.
- Route spec: grep for the free/beta/owner ids, `userId` and the email domain, plus schema validation of the real route body.
- Schema `totals.additionalProperties: false`.
- Live: my `days=365` response contains 0 occurrences of my throwaway id.

**AC3, owner-only.**
- Route spec: 403 before parse for `days=abc` (beta) and `days=366` (free).
- Live: my throwaway user got `403` before promotion and `200` after an exact-id tier update.

**Live API (`localhost:9759`, owner throwaway).**
- `days=365`: 200, 365 `activeUsers` points.
- `days=366/0/abc`: 400/400/400.
- `totals = {totalUsers: 12913, activeLast7Days: 5251, activeLast30Days: null, asOf: 2026-10-07}`.
- `totalUsers` matches an independent `SELECT count(*) FROM users WHERE id <> '...0001'` = 12913.

**V121 effect on existing rows (prod).** I checked the dev DB directly:
- `product_active_users_daily` has `monthly_active_users` NULL for 10-04..10-07, which were rolled pre-V121.
- It is populated for 10-08 (6646) and 10-09 (6728), which were recomputed after V121.
- `flyway_schema_history` has V121 with `success = t`.

`ProductEventRollupService.tickAt` recomputes from `min(rolled_through+1, today-1)`. The day that next becomes `rolled_through` will therefore already have been recomputed post-migration, and the 30-day headline self-heals within one UTC day of deploy. Until then the page honestly shows "—, not yet available", never 0. The migration is a nullable ADD COLUMN with no backfill. Its header explains why no backfill: FORCE-RLS `product_events` cannot be read as the Flyway role.

**COALESCE keep-prior rule.** On conflict, a NULL (non-computable) roll never clobbers an earlier value computed inside retention. This mirrors the existing WAU behaviour, is documented in design.md Decision 5 and the spec delta, and is guarded (M3).

**Frontend gates.**
- In the worktree: `npm run lint` exit 0, `npm run format:check` exit 0.
- In the clone: `tsc --noEmit` exit 0.
- An earlier eslint/prettier anomaly in the clone was environmental. `npx` resolved a different tool version through the symlinked `node_modules`. The re-run in the worktree with the project scripts is clean.
- ajv is an explicit devDependency (C3).

**UI, running app** (`start-servers.sh` reused healthy servers; `assert-phase.sh servers` PASS). Throwaway owner `3bf7d71e-81f9-4e41-a299-fa163800df46`, not matt@helio.dev. It was deleted by exact id afterwards (`DELETE 1`, re-count 0).

Screenshots, taken outside the worktree root and persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.playwright-mcp/hel1420-skeptic-a-1440.png` (dark, 1440, 30d)
- `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.playwright-mcp/hel1420-skeptic-b-light-1440.png` (light, 1440)
- `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.playwright-mcp/hel1420-skeptic-c-light-365.png` (light, 365d window)
- `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.playwright-mcp/hel1420-skeptic-d-dark-390.png` (dark, 390 mobile)

Judgment:
- **Layout.** The totals row uses the page's own `Stat`/`dl` card pattern, now extracted rather than reinvented. It renders 3 full-width tracks at desktop and stacks to 1 column on mobile with no overflow.
- **Data-through notice.** It is prominent, uses tokens only (`--app-surface`, `--app-border-subtle`, `--app-radius-lg`, `--space-*`, `--text-*`, all present in `theme/theme.css`), and is at parity in light and dark.
- **Honest labelling.** Each active count says "users with a tracked product event, as of 2026-10-07". Total users says "registered, excluding the system user".
- **Window independence.** Switching to the 365-day window leaves the totals unchanged.
- **Console.** No console errors.

### Verdict: CONFIRM

### Non-blocking notes
- **The evaluator's open question: "WAU (latest)" always equals "Active, last 7 days".** Both read `weekly_active_users` at `rolled_through`, and the series window always ends there. I judge this acceptable for this ticket, not a REFUTE: the values are consistent, not contradictory. The window-stats row is HEL-1211's existing surface, and removing or relabelling it is a scope change the ticket did not ask for. A follow-up could drop "WAU (latest)" or replace it with a window-scoped figure.
- **The "All-time totals" heading sits over two trailing-window counts.** This is the ticket's own wording ("All-time headline totals ... active in the last 7/30 days"), and each card's label and hint state the window. A heading like "Headline totals" would be more exact.
- **`Total users` uses `String(totals.totalUsers)` rather than `formatCount`.** Neither groups thousands on this page today ("12913", "9178"), so it is visually consistent.
- **Playwright artefacts.** The Playwright MCP's allowed roots force screenshots and snapshot YAMLs into `/home/matt/Development/helio/.playwright-mcp/` (the main checkout's `.playwright-mcp` directory, pre-existing). The screenshots are persisted copies; this is the known parallel-Playwright location hazard, not a defect of this change.
- **No mtime-ordering evidence was relied on.** The red-first claim is corroborated by line-number agreement and by independent mutation reds, not by file timestamps.
