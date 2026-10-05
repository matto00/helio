## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 2f0a08a61e9cf7016702383739090679a10923e2 (base 5ae66fc110fc7b6351ed512694c7bf0319f86f85, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — PASS
Issues: none.

I checked each acceptance criterion against the diff and against tests I ran myself:
- Two real runs give 2 points per Output, carrying run ids and trigger sources (manual and scheduled). The test also checks the metric value (30, summed from string cells) and the column sum. Dry, blocked, failed, write-back failure and HEL-947 backfill runs each give 0 (PipelineRunServiceOutputHistorySpec).
- When the history insert fails, the snapshot replace is rolled back. This is tested at repo level (NodeSnapshotOverwriteRowsWithSpec) and at service level, with a sentinel on both nodes.
- Deleting an Output cascades to its history (OutputHistoryRepositorySpec).
- A shared fixture checks the reducer against aggregate.ts. Jest uses the real TS `computeAggregate`/`groupAndAggregate` as the oracle (57 cases, all green when I ran them). The Scala seam spec reads the same file.
- RLS is proven under `SET ROLE helio_app_test`: owner sees rows, grantee sees rows, non-grantee sees 0, and an INSERT with no user context is rejected.
- RlsPolicyGuardSpec (allowlist and FORCE check), RlsPrivilegedDmlSpec (helio_privileged SELECT/INSERT/UPDATE/DELETE) and FlywayNonSuperuserMigrationSpec (FORCE list) are all updated.
- listRecent, nearestAtOrBefore, earliest and thinAndPurge each have unit tests. They cover the tiebreak, the exactly-at instant, empty results, all three age classes, per-tier purge and idempotence.
- Cost is measured and reported (my numbers are in Phase 2).
- Owner rulings D1–D10: all honoured within the L1 scope. D2, D3's headline switch, D4's scheduling, L6 and L8 are correctly left out as non-goals.
- All tasks are marked done and match the code. The planning artifacts match the implementation.
- Constraints C1–C5 are honoured. RLS was proven non-BYPASSRLS. Red runs are recorded, and I re-applied a sample myself (below). No shared base trait was edited.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs in WORKTREE_PATH, all at `nice -n 19`):
- `sbt testFull`: **5809 succeeded, 0 failed**, first try with no flake rerun needed. EXIT=0.
- `npm run lint`: clean.
- `npm run format:check`: clean.
- `npm test`: 422 suites / 4437 tests green. The new `aggregate.fixture.test.ts` runs 57 tests, all green.
- `npm --prefix frontend run build`: OK.
- `npm run check:scala-quality`: "clean". Its pattern list does not cover `java.lang.*` / `java.sql.*` / `slick.*`, so the inline FQNs below get past it.

Cost, re-measured from the testFull run's own output (OutputHistoryCostMeasurementSpec, 1000-row node, metric + chart Output, median of 7):
- Without history: 1026 statements, 0 batches, 70 ms.
- With history: 1027 statements, 1 batch, 74 ms.
- Delta: +1 statement (the config query) and +1 JDBC batch, about +4 ms wall time. Reducer CPU for both Outputs is about 1.8 ms.
- This matches the executor's claim.

Mutations I re-applied myself. Each was restored exactly with `git checkout --`, the targeted specs were re-run green (106/106), and the worktree is clean.

| Mutation | Result (red as expected) |
|---|---|
| `coerceNumber` treats blank as `Some(0.0)` | seam: empty, blank, mixed avg, mixed min |
| group key = exact integer (`new JBigDecimal(d).toBigInteger`) for integral doubles | seam: "numeric keys use ES Number toString" (2^63 / 1e21) |
| `t.toDoubleOption` replaces the JS grammar | seam: hex, upper hex, binary, octal, 1d, 1f, 0x1p3, "hex and exponent strings" |
| V115 SELECT policy `USING (true)` | RLS: "non-grantee zero rows" |
| V115 INSERT policy `WITH CHECK (true)` | RLS: "reject INSERT with no user context" and "reject INSERT by a non-grantee". This proves the rejection comes from the policy, not a missing GRANT (the spec grants ALL on all tables to helio_app_test). |
| dry runs routed to `onRunSuccess` (`if (false) onDryRunSuccess`) | "write none for a dry run" |
| write-back `Left` routed to `onUnblockedRunSuccess` | "write none for a write-back failure" |
| `overwriteRowsWith` as two separate `withSystemContext` calls | NodeSnapshotOverwriteRowsWithSpec rollback and the service-level rollback test |
| V115 FK without `ON DELETE CASCADE` | cascade test |

Precondition probe on the failed-run test, to check it is not vacuous: I temporarily added an assertion, since reverted. The run row is `status=failed` with `error_log` "Pipeline execution failed at step … (compute) … invalid expression". So the `Left` comes from a real engine failure, not from rejection before the run.

The other preconditions are also non-vacuous:
- The blocked test asserts `blocked == true`.
- The backfill test asserts the backfill actually materialized 2 snapshot rows before it checks for 0 history rows.
- The RLS spec asserts `rolbypassrls = false` for the pool's `current_user`.

Issues:
1. **CONTRIBUTING.md "Imports & Qualifiers" ("never inline a fully-qualified name when an import would do") — [mechanical], greppable.** Violations in this diff:
   - `backend/src/main/scala/com/helio/domain/history/JsSemantics.scala:36`: `java.lang.Double.parseDouble`
   - `JsSemantics.scala:86`: `java.lang.Double.toString`
   - `backend/src/main/scala/com/helio/domain/history/OutputSummaryReducer.scala:30-31`: `java.lang.Math.min` / `java.lang.Math.max`
   - `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputHistoryRepository.scala:95,101`: `java.sql.Timestamp.from`
   - `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/OutputHistoryRepositorySpec.scala:153-154`: `java.time.temporal.ChronoUnit`
   - `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryCostMeasurementSpec.scala:54`: `java.lang.reflect.InvocationTargetException`
   - `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceOutputHistorySpec.scala:203-204`: `slick.dbio.DBIO`. The file already imports `PostgresProfile`; use `PostgresProfile.api.DBIO` via a top-level import.
   - `backend/src/test/scala/com/helio/infrastructure/persistence/OutputHistoryRlsSpec.scala:40`: function-scoped `import com.zaxxer.hikari.{HikariConfig, HikariDataSource}` with no coupling reason. CONTRIBUTING:72 allows a scoped import only when widening would cause real coupling.
   - `java.sql.Timestamp.from` has precedent elsewhere in the repo. That does not exempt new code from the rule.
2. **Dead code: unused imports.**
   - `PipelineRunServiceOutputHistorySpec.scala:21`: `scala.concurrent.duration.DurationInt` is unused.
   - `PipelineRunServiceOutputHistorySpec.scala:22`: `Await` is unused (only `ExecutionContext` is used).
   - `OutputHistoryRlsSpec.scala:12`: `java.util.UUID` is unused.

Everything else on the Phase 2 checklist passes:
- **Security:** `insertAction` is a lifted `++=` and `summary` is a bound JSONB parameter. The hostile-key test checks this. All `thinAndPurge` values are `$`-bound with no `#$`.
- **Transaction composition:** `withSystemContext` already applies `.transactionally` (DbContext.scala:64). The inner `.transactionally` in `overwriteRowsAction` nests harmlessly.
- **Error handling:** the history write is not best-effort, per D9.
- **Refactor:** `overwriteRows` is unchanged in behaviour. The backfill still uses it, so the backfill stays history-free.
- **Wiring:** `triggerSource` is threaded through private methods only. Main/ApiRoutes are pre-wired, and the scheduler reuses `apiRoutes.pipelineRunService`, so scheduled runs record history.

### Phase 3: UI Review — N/A
The only `frontend/**` change is a new Jest test file, `frontend/src/utils/aggregate.fixture.test.ts`, which has no runtime or UI effect. No ApiRoutes route, schema or openspec/specs change affects UI (the ApiRoutes change is constructor wiring only, with no route). Per the orchestrator brief, the UI phase is skipped.

### Overall: FAIL

### Change Requests
1. Replace each inline FQN with a top-of-file import:
   - `JsSemantics.scala:36,86`: `import java.lang.{Double => JDouble}` (same idiom as the existing `JBigDecimal`), then `JDouble.parseDouble` / `JDouble.toString`.
   - `OutputSummaryReducer.scala:30-31`: use `math.min` / `math.max`, or `_ min _` / `_ max _`. Behaviour is identical for finite doubles.
   - `OutputHistoryRepository.scala:95,101`: `import java.sql.Timestamp`, then `Timestamp.from(...)`.
   - `OutputHistoryRepositorySpec.scala:153-154`: `import java.time.temporal.ChronoUnit`.
   - `OutputHistoryCostMeasurementSpec.scala:54`: add `InvocationTargetException` to the existing `java.lang.reflect.{...}` import.
   - `PipelineRunServiceOutputHistorySpec.scala:203-204`: import `DBIO` at the top, e.g. `import slick.dbio.DBIO`, and use the bare `DBIO`.
   - `OutputHistoryRlsSpec.scala:40`: move the hikari import to the file's import block.
2. Remove the unused imports:
   - `PipelineRunServiceOutputHistorySpec.scala:21` (`DurationInt`)
   - `PipelineRunServiceOutputHistorySpec.scala:22` (`Await`, which leaves `import scala.concurrent.ExecutionContext`)
   - `OutputHistoryRlsSpec.scala:12` (`java.util.UUID`)

These are the only blocking items. No behaviour change is requested, and every functional and evidence requirement is met. After the fix, re-run `sbt testFull` (compile plus the new specs).

### Non-blocking Suggestions
- `OutputSummaryReducer.summarize` recomputes `columnStats` once per Output on the same node. That is negligible at the measured ~1.8 ms, but L3 could hoist it if many Outputs share a node.
- `metric` does not filter `aggregation.agg` through `Aggs`, while `series` does. An unknown agg yields `metric.value = null` with the unknown agg string recorded. This is harmless, but the two paths are inconsistent.
- `truncate` cuts x strings at 256 UTF-16 units, which can split a surrogate pair. I did not verify how pgjdbc encodes a lone surrogate. It is worth a note for L3 so that point labels are never assumed to be well-formed.
- Consider asking upstream to extend `check:scala-quality`'s pattern list to `java.lang.`, `java.sql.`, `java.time.` and `slick.`, so this class of finding is caught at commit time.
