## Standing Constraints

- [C1] RLS claims are proven only under a non-BYPASSRLS role (`SET ROLE helio_app_test`); a superuser-run assertion is not evidence.
- [C2] Every exclusion/rollback/cascade test is shown red first (a mutation or pre-implementation run that makes it fail) and green after; record the red output.
- [C3] Backend gate is `nice -n 19 sbt testFull` (never bare `sbt test`), Bash timeout 600000, at most 2 parallel workers, everything at `nice -n 19`; `sbt --client shutdown` as a separate call.
- [C4] Shared dev DB: record every id created; delete only by exact id, never by pattern/name/time window. No writes under `~`; scratch files removed by exact path.
- [C5] Do not edit shared test base traits (HEL-1228 lane runs concurrently on RouteTest timeouts) without escalating first. Known flakes (1s RouteTest timeouts HEL-1228/1225, PanelCard.test.tsx:625 HEL-1215, ProductEventRollupServiceSpec HEL-1247) are rerun, not fixed.

## 1. Migration and RLS

- [x] 1.1 Write `backend/src/main/resources/db/migration/V115__output_snapshot_history.sql` per design D-1 (TEXT ids, UUID PK, cascade FK, index, ENABLE+FORCE, four `helio_can_access_pipeline` policies, explicit GRANT to `helio_privileged`).
- [x] 1.2 Register `output_snapshot_history` in `RlsPolicyGuardSpec.rlsTables`; extend `RlsPrivilegedDmlSpec` to prove `helio_privileged` can SELECT/INSERT/UPDATE/DELETE it (seed a parent `outputs` row — the spec has no outputs coverage today, see its :208-212 comment — and add the new table to `cleanDb()`); extend `FlywayNonSuperuserMigrationSpec` to assert the table exists after the non-superuser migration.
- [x] 1.3 RLS proof spec under `SET ROLE helio_app_test` (a non-owner, non-BYPASSRLS role; `RlsSharingAwareTablesSpec` has only dashboard-sharing fixtures — the grantee case needs a `resource_permissions` row with `resource_type = 'pipeline'`, precedent `PipelineSharingAclSpec`): owner SELECT sees rows, grantee (shared pipeline) SELECT sees rows, non-grantee sees 0, INSERT with no `app.current_user_id` is rejected with a message containing `row-level security policy` (not merely any exception / SQLSTATE 42501, which a missing GRANT also raises). One recorded red mutation per assertion (round 2 CR1): SELECT policy `USING (true)` → non-grantee-sees-0 red; INSERT policy `WITH CHECK (true)` → insert-rejection red; a policy keyed on direct ownership instead of `helio_can_access_pipeline` → grantee-visible red. Dropping FORCE is NOT a valid mutation here (RLS applies to non-owners regardless of FORCE); FORCE is instead proven by asserting `relforcerowsecurity = true` for the table (RlsPolicyGuardSpec / FlywayNonSuperuserMigrationSpec).
- [x] 1.4 Cascade test: delete an Output → its history rows are gone (red: FK without cascade fails the delete / leaves rows).

## 2. Summary reducer

- [x] 2.1 `shared-test-fixtures/output-summary-reducer.json` with coerce/aggregate/group cases listed in design D-2.
- [x] 2.2 Jest `frontend/src/utils/aggregate.fixture.test.ts` asserting the real `computeAggregate`/`groupAndAggregate` against every fixture case (the oracle).
- [x] 2.3 `OutputSummaryReducer` (pure) in `backend/src/main/scala/com/helio/domain/...`: coerceNumber (JS grammar), computeAggregate, groupAndAggregate (JS `String()` keys), column stats (cap 20), metric, chart series (cap 200, even-stride downsample), version-1 JSON.
- [x] 2.4 `OutputSummaryReducerSeamSpec` reads the same fixture; plus unit tests for column numeric detection across sparse rows, metric field resolution, series modes and downsampling. Mutations, each recorded red: (a) Scala `coerceNumber` treats a blank/whitespace string as 0 → seam spec red; (b) group key uses the exact integer value for an integral double (e.g. `BigDecimal(d).toBigInteger`) → seam spec red on the `2**63` case; (c) `toDoubleOption` instead of the JS grammar → red.

## 3. Repository

- [x] 3.1 `OutputHistoryRepository` per design D-3: `insertAction` (lifted `++=` / fully parameterized, never `#$`, composable), `listRecent`, `nearestAtOrBefore`, `earliest`, `thinAndPurge` + `HistoryThinningPolicy` defaults.
- [x] 3.2 Repository spec: one test per primitive including ordering/tiebreak, boundary instants (exactly-at), empty cases, thinning across the three age classes (do not assert ≤1 per bucket across an age-class boundary), per-tier max-age purge, idempotent second pass.

## 4. Transactional write path

- [x] 4.1 `NodeSnapshotRepository`: extract `overwriteRowsAction`, keep `overwriteRows` behaviour, add `overwriteRowsWith(..., andThen)`.
- [x] 4.2 Rollback spec: existing snapshot rows, then `overwriteRowsWith` whose `andThen` fails (e.g. history insert with a non-existent `output_id`) → node_snapshots unchanged. Red mutation: run `overwriteRowsAction` and `andThen` in TWO separate `ctx.withSystemContext` calls (removing `.transactionally` is a no-op — `withSystemContext` already applies it, DbContext.scala:64).
- [x] 4.3 `PipelineRunService`: nullable `outputHistoryRepo`, thread `triggerSource` to `onUnblockedRunSuccess`, one config batch read per run, per-node entries, `overwriteRowsWith`.
- [x] 4.4 Run-path spec (real DB): two real runs → 2 points per Output with run ids and trigger source; dry run → 0; blocked run (error-severity assertion fails) → 0; failed run → 0; write-back failure → 0; HEL-947 backfill (`backfillOutputNode`) → 0. Each exclusion shown red by a mutation that writes history on that path (record which mutation exercised which test). Service-level rollback: a history repo whose `insertAction` fails → run's node snapshot unchanged (same two-transactions red mutation).

## 5. Wiring and measurement

- [x] 5.1 `Main.scala` constructs `OutputHistoryRepository`, passes it to `ApiRoutes`; `ApiRoutes` exposes `outputHistoryRepoOpt` and threads it to `PipelineRunService` (design D-5). No routes.
- [x] 5.2 Cost measurement per design D-6 over a ~1000-row node; record query count delta and timing (median of ≥5) in the executor report.
- [x] 5.3 Record the `AlertEvaluationService.extractMetric` no-coercion divergence (file:line) and the dashboard metric/chart divergences for L3/L5/L8 in the report.

## 6. Gates

- [x] 6.1 `nice -n 19 sbt testFull` green (flakes rerun per C5), frontend `npm test` for the new fixture test, lint/typecheck/format via pre-commit.
