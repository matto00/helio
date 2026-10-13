## Standing Constraints

- [C1] Evidence for the queue counts must come from a NOSUPERUSER login with `helio_privileged` BYPASSRLS and only migration grants (prod shape); a superuser or NOBYPASSRLS-role pass is not evidence.
- [C2] Every new behaviour test is shown red against a named mutation (recorded in evidence) before it counts as proof.
- [C3] Backend tests run as foreground `sbt testOnly` shards under 600 s each, never a whole-suite or backgrounded run; report exactly what ran.
- [C4] Time-boundary tests pin fixtures at the boundary +/- 1 minute and are shown red by a mutation moving the boundary in each direction.

### Backend

## 1. Re-arm

- [x] 1.1 Add `StoredObjectDeletionRepository.rearm(cutoff, maxAttempts): Future[Int]` per design.md D1 (`last_attempt_at <= cutoff`, `IS NOT NULL` documentation only; CASE keeps `claimed_at = 'infinity'`); verify by 5.1
- [x] 1.2 Call `rearm` at the start of `StoredObjectDeletionService.pass()` (`rearmAfterSeconds`, default 86400), recovered on its own with a WARN, INFO count log without keys; verify by 5.1-5.3

## 2. Admin usage counts

- [x] 2.1 Add `QueueCounts` + `StoredObjectDeletionRepository.queueCounts(maxAttempts)` (one statement, `withSystemContext`); verify by 5.4-5.5
- [x] 2.2 Add `storedObjectDeletionsQueued` / `storedObjectDeletionsStuck` to `AdminUsageTotals` (jsonFormat6, non-null), fill both `AdminUsageService` paths with `StoredObjectDeletionService.DefaultMaxAttempts`, wire the repository in `ApiRoutes`; verify by 5.4
- [x] 2.3 Update `schemas/admin/admin-usage-response.schema.json` (both fields required, integer >= 0, top-level and totals descriptions); verify by 5.6 and 6.1
- [x] 2.4 Update `CLAUDE.md`'s `GET /api/admin/usage` line to mention the live deletion-queue counts; verify by grep

### Frontend

## 3. Types

- [x] 3.1 Add both fields to `AdminUsageTotals` (`frontend/src/features/adminUsage/types/adminUsage.ts`), the fixture and every literal `AdminUsageTotals` in tests; verify `npm run typecheck`

## 4. Storage cleanup section

- [x] 4.1 Add `ui/StorageCleanup.tsx` per design.md D4 (reused `admin-usage__totals` / `__section-title` / `__muted` classes, live note, two `Stat`s) and render it below `UsageTotals` in `AdminUsagePage`; verify by 6.2
- [x] 4.2 Add the `admin-usage__stats--pair` modifier (2 columns, tokens only, same responsive overrides as `--totals`); verify by 6.3

### Tests

## 5. Backend tests

- [x] 5.1 Drain spec: capped row at 24 h - 1 min not re-armed, at 24 h + 1 min re-armed, for legacy and new-style rows; new-style keeps `claimed_at = 'infinity'`; re-armed row deleted on success; kept when referenced; capped row with NULL `last_attempt_at` not re-armed; persistent failure reaches the cap again
- [x] 5.2 Mutation proofs for 5.1 (C2/C4): re-arm call removed; cutoff +1 h; cutoff -1 h; CASE replaced by `claimed_at = NULL`; WHERE widened to `(last_attempt_at IS NULL OR last_attempt_at <= cutoff)` (the NULL-row test goes red); each recorded red in evidence
- [x] 5.3 Move the existing cap fixtures inside the cool-down so they still guard the cap: `StoredObjectDeletionServiceSpec.scala:187-191` and `FormAndConversationObjectDrainSpec.scala:368-375`; show each still fails with the claim's cap clause removed
- [x] 5.4 Admin usage service spec: queued/stuck counts (attempts cap-1 vs cap), independent of `days`, also on the not-rolled-up path; body has no seeded key, source table or queue id; mutation `>=` -> `>` red. Update constructor call sites (AdminUsageServiceSpec, AdminUsageTotalsSpec, ProductUsageRepositoryRoleSpec)
- [x] 5.5 Prod-role proof (C1), added to `backend/src/test/scala/com/helio/infrastructure/persistence/StoredObjectDeletionsMigrationSpec.scala` (its role recipe, plus the two-pool `DbContext` construction from `ProductUsageRepositoryRoleSpec:59-71` WITHOUT its NOBYPASSRLS flip; evidence shows `helio_privileged` rolbypassrls at read time): non-zero `queueCounts`; mutation: counts read on the app pool (or `helio_privileged` NOBYPASSRLS) returns 0 -> red; `ProductUsageRepositoryRoleSpec` still passes
- [x] 5.6 `AdminUsageRoutesSpec`: update the `totals` key-set assertions (`AdminUsageRoutesSpec:198`, `AdminUsageTotalsSpec:112`); real body validates against the updated schema and fails against the pre-change schema

## 6. Frontend tests

- [x] 6.1 `adminUsage.contract.test.ts`: fixture accepted; omitted queue field rejected
- [x] 6.2 `StorageCleanup` / `AdminUsagePage` test: both counts and labels rendered in the storage-cleanup section, not in the totals card
- [x] 6.3 Visual check of the page in light and dark themes against the running app (2-column section, no empty cell, vertical spacing between the two stacked sections); `npm run lint`, `npm run typecheck`, `npm run format:check`, adminUsage jest (`--maxWorkers=3`) green; backend shards for every touched spec green (C3)
