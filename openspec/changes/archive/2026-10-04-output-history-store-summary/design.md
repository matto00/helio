## Context

Verified against main 5ae66fc1 (orchestrator premise check, persisted as `premise-validation.md` evidence):

- `NodeSnapshotRepository.overwriteRows` (NodeSnapshotRepository.scala:106-137) builds `DELETE` + one `INSERT` per row via `DBIO.seq` and runs it as `ctx.withSystemContext(action.transactionally)` on the privileged (BYPASSRLS) pool. `DbContext.withSystemContext` itself already wraps in `.transactionally`.
- Two production callers: `PipelineRunService.onUnblockedRunSuccess` (:1366, write at :1418, sequenced node by node, one transaction per node) and the HEL-947 backfill `persistBackfilledRows` (:775 → :779), reached from `backfillOutputNode` (:683).
- Run outcome routing (PipelineRunService.scala ~1100-1300): dry runs → `onDryRunSuccess` (never writes snapshots); real runs → `onRunSuccess`, which routes blocked runs to `onBlockedRun`, failed write-backs to `onWriteBackFailure`, and only the remaining case to `onUnblockedRunSuccess`; engine failures → `executeRunFailure`. So `onUnblockedRunSuccess` is exactly D5's "real, unblocked, successful" set, and the backfill is the only other snapshot writer.
- `triggerSource` reaches `executeRun` (:988) but is not threaded to `onRunSuccess`/`onUnblockedRunSuccess` today.
- The domain `Output` has no `config`; `OutputRepository.findConfigsByIdsInternal(ids)` (privileged, one query) returns it.
- Frontend: metric headline = `computeAggregate(rows, Object.values(cfg.fieldMapping)[0], cfg.aggregation.agg)` or the first row's cell when no agg (PanelContent.tsx:293-310). Charts on dashboards render per-row x→y from `fieldMapping.xAxis/yAxis/series` (chartDataOptions.ts / chartClickSelection.ts `resolveDataColumns`); `groupAndAggregate` is used only by `OutputPreviewPane` when `aggregation {groupBy, agg, yField}` is set (dashboard `usePanelData.chartAggregate` is always `null`).
- Ticket citation correction: V113 supplies the ENABLE + FORCE + explicit `GRANT ... TO helio_privileged` pattern but its policy is direct-owner (`user_id`). The sharing-aware policy shape is V94's `node_snapshots_{select,insert,update,delete}` (V94:306-320) on `helio_can_access_pipeline(pipeline_id)`.
- No test subclasses `NodeSnapshotRepository` or overrides `overwriteRows`. Only `e2e/hel1189-output-panel-controls-live.spec.ts` mentions node snapshots in e2e (reads, not write-shape). Tests truncating `outputs` use `CASCADE`, which covers the new FK child.

## Goals / Non-Goals

**Goals:**
- Storage + RLS for per-Output history (D7, D8), migration safe under a non-BYPASSRLS Flyway role.
- A pure summary reducer that matches the frontend aggregation exactly on shared fixtures (D1, D3).
- History written in the same per-node transaction as the snapshot replace, for real unblocked successful runs only (D5, D9).
- All repository primitives L2/L3/L8 need, unit-tested, and the repo pre-wired in Main/ApiRoutes.

**Non-Goals:**
- No read API, no `config.compare` validation (L3), no retention scheduling or tier lookup wiring on the scheduler tick (L2), no payload history (L6), no alert baselines (L8), no frontend/MCP change. The metric headline does NOT switch to the server value here (L3/L5).
- `AlertEvaluationService.extractMetric` does not coerce strings; it is NOT changed here. The divergence is recorded for L8 (see Risks).

## Decisions

### D-1 Migration V115 (`V115__output_snapshot_history.sql`)

```
CREATE TABLE output_snapshot_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  output_id      TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,  -- outputs.id is TEXT (V94:207)
  pipeline_id    TEXT NOT NULL,        -- matches outputs/node_snapshots.pipeline_id (TEXT)
  node_step_id   TEXT NULL,
  root_id        TEXT NULL,
  run_id         TEXT NULL,            -- D7: no FK
  trigger_source TEXT NOT NULL,
  captured_at    TIMESTAMPTZ NOT NULL,
  row_count      INT NOT NULL,
  summary        JSONB NOT NULL
);
CREATE INDEX idx_output_snapshot_history_output_captured ON output_snapshot_history (output_id, captured_at DESC);
ENABLE + FORCE ROW LEVEL SECURITY;
four policies (select/insert/update/delete) on helio_can_access_pipeline(pipeline_id), the V94 node_snapshots shape;
GRANT SELECT, INSERT, UPDATE, DELETE ON output_snapshot_history TO helio_privileged;  -- V113 pattern
```

Column types above were read from V94:206-284 (`outputs.id`, `pipeline_id`, `node_step_id` are TEXT) and V98 (`root_id`); re-verify `root_id`'s type against V98 before writing. The PK alone is UUID (D8: no BIGSERIAL). `pipeline_id` gets no FK of its own (the `output_id` cascade already removes rows when a pipeline's outputs are deleted, and an extra FK only adds a second cascade path). No CHECK on `trigger_source` (it is a copied label; `pipeline_runs` owns the enum). Migration creates no rows, so FORCE at create time is safe under the non-BYPASSRLS Flyway role (no backfill DO block, unlike V94). Header comment states additive-only / never edit once applied.

### D-2 `OutputSummaryReducer` — pure, `com.helio.domain` (no I/O)

Input: the node's rows as `Vector[JsObject]` (exactly what `node_snapshots.data` stores and the frontend receives), the Output's `kind`, and its `config: JsObject`. Output: a summary `JsObject`.

**Coercion (`coerceNumber`)** is a faithful port of aggregate.ts, including the JS `Number(string)` grammar — NOT Scala `toDoubleOption` (Java grammar accepts `"1d"`, `"1f"`, `"0x1p3"`, rejects `"0x10"`, `"0b11"`, `"0o7"`; JS is the opposite):
- `JsNumber` → its double if finite, else null.
- `JsString s` → null if `s.trim()` (JS whitespace set: `\t \n \u000B \f \r space      -          　 ﻿`) is empty; else the JS StringToNumber result if finite, else null. Grammar after trimming: `0x/0X` + one or more hex digits, `0b/0B` + one or more binary digits, `0o/0O` + one or more octal digits (`"0x"` alone → null) (no sign allowed, value via BigInteger→double); otherwise `[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)` parsed with `java.lang.Double.parseDouble` (correctly rounded, same as JS); anything else (incl. `_` separators, `1d`, `NaN`) → null. `Infinity`/overflow → non-finite → null.
- everything else (JsBoolean, JsNull, absent, arrays, objects) → null.

**`computeAggregate(rows, field, agg)`**: `count` = cells present and not `JsNull`; `sum` = left-fold sum of coercible values (0 when none); `avg`/`min`/`max` over coercible values, null when none.

**`groupAndAggregate(rows, groupBy, agg, yField)`**: group key = a port of JS `String(cell)` — JsString as-is, JsNull → `"null"`, absent → `"undefined"`, booleans `"true"/"false"`, objects/arrays → `"[object Object]"` / comma-join (document; fixtures need not cover). JsNumber → a port of ECMAScript `Number::toString` (round 1 CR2 — never the exact integer value): for `-0` and `0` → `"0"`; negative → `"-"` + toString(−d); otherwise take the shortest round-trip decimal digits `s` (k digits, no leading/trailing zeros) and exponent `n` such that d = 0.s × 10^n, derived from JDK 21 `Double.toString`, then minimized (round 2 CR2: JDK 21 is NOT always shortest for subnormals — `Double.MinPositiveValue` prints `4.9E-324` where JS prints `5e-324`, and `9.9E-324` vs `1e-323`): when k = 2, test the two neighbouring 1-significant-digit decimals and use the candidate CLOSEST to the value among those that parse back to the same double (ES requires minimal k, then closest — testing the lower neighbour first would wrongly emit `4e-324`; design round 3 note); then: k ≤ n ≤ 21 → `s` followed by n−k zeros (`2**63` → `"9223372036854776000"`, `1e20` → `"100000000000000000000"`); 0 < n ≤ 21 → first n digits, `.`, remaining k−n digits (`123.456`); −6 < n ≤ 0 → `"0."` + (−n zeros) + `s` (`0.000001`); otherwise exponent form: one digit, `.` + remaining digits if k > 1, `e`, sign `+`/`-`, |n−1| (`1e+21`, `1e-7`, `1.5e-7`). Categories sorted by UTF-16 code unit order (`String.compareTo`, same as JS default sort); value = `computeAggregate(...)` `?? 0`.

**Summary JSON (version 1)**:
```
{
  "v": 1,
  "rowCount": <int>,
  "columns": { "<col>": {"count": n, "sum": s, "min": m, "max": M}, ... },
  "columnsTruncated": <bool>,
  "metric": {"field": "<col>", "agg": "<agg>"|null, "value": <num>|null} | null,
  "series": {"mode": "rows"|"grouped", "x": "<col>", "y": "<col>", "agg": "<agg>"|null,
             "points": [[<x>, <y|null>], ...], "totalPoints": n, "downsampled": <bool>} | null
}
```
- **columns**: candidate columns = union of keys across ALL rows (never row 0 only — MISTAKES.md "Schema inference from row 0"). A column is numeric iff ≥ 1 cell coerces AND every cell that is neither absent, `JsNull`, nor a whitespace-only string coerces (so CSV-backed string-typed numbers count; a mixed text column does not). Ordered by name (deterministic; JsObject field order is not preserved), capped at 20 with `columnsTruncated`. Stats use `coerceNumber`: a column's `count` is the number of COERCIBLE cells — deliberately not `computeAggregate`'s `count` (non-null cells); L3 must not conflate the two.
- **metric** (kind `metric` only, else null): value column = the single `fieldMapping` value when it has one entry; else `fieldMapping("value")` when present; else `aggregation.value` when present; else null (metric null). With `aggregation.agg` set → `computeAggregate` over ALL rows (D3); otherwise `coerceNumber(row 0's cell)` (the frontend's no-agg first-row behaviour), `agg: null`.
- **series** (kind `chart` only, else null): if `aggregation` has non-empty `groupBy`, `agg`, `yField` AND `chartType != "scatter"` → `mode: "grouped"` from `groupAndAggregate` (x = category string). Otherwise if `fieldMapping.xAxis` and `fieldMapping.yAxis` are both set → `mode: "rows"`, one point per row: x = the raw cell JSON value (JsNull when absent), y = `coerceNumber(cell)` (null when not coercible). Otherwise null (never guess column 0 — the frontend's header-order fallback is not reproducible from an unordered JsObject). If more than 200 points: even-stride downsample keeping first and last (`idx_i = round(i*(n-1)/199)`, i = 0..199), `downsampled: true`; `totalPoints` always the pre-reduction count.
- Non-finite numbers never reach the JSON (coercion guarantees finiteness; sums of finite values can overflow to ±Infinity — the reducer maps any non-finite result to null).

**Shared fixture (seam test)**: `shared-test-fixtures/output-summary-reducer.json` with `coerce` cases (`value` → `expected`), `aggregate` cases (`rows`, `field`, `agg`, `expected`) and `group` cases (`rows`, `groupBy`, `agg`, `yField`, `expected: {categories, values}`). Read by a Jest test (`frontend/src/utils/aggregate.fixture.test.ts`, exercising the real exported `computeAggregate`/`groupAndAggregate`; `coerceNumber` is not exported, so each coerce case is driven through `computeAggregate([{f: value}], "f", "max")` — which returns `null` when nothing coerces, so `expected` is exactly the coerced value or `null`. Never through `sum`: `sum` returns 0 for both "not coercible" and "coerced to 0", which would blind the seam to a blank-string-as-0 port bug (round 1 CR1)) and by `OutputSummaryReducerSeamSpec` in Scala. Fixture MUST include: `"12"`, `" 12 "`, `""`, `"   "`, `"abc"`, `"12abc"`, `"0x1A"`, `"0b101"`, `"0o17"`, `"-0x1"`, `"1e3"`, `"+5"`, `".5"`, `"5."`, `"1d"`, `"1_000"`, `"Infinity"`, `"NaN"`, `"1e400"`, `true`, `null`, absent field, numbers incl. integral doubles (`1.0` as a group key → `"1"`), fractional (`2.5`), `1e21`, `1e-7`; plus group-key cases (round 1 CR2) for `2**63`, `1e20`, a 19-digit integer above 2^53, `-0`, `1.5e-7`, `123.456`, `5e-324`, `1e-323`; and coerce case `"0x"`. The fixture's expected values are produced by running the real TS function (Jest asserts them), so the TS side is the oracle and the Scala side must match.

### D-3 `OutputHistoryRepository` (`infrastructure/persistence/pipelines/`)

All on `ctx.withSystemContext` (privileged pool, D8: callers authorize via `outputRepo.findById` first). Domain row: `OutputHistoryPoint(id, outputId, pipelineId, nodeStepId, rootId, runId, triggerSource, capturedAt, rowCount, summary: JsObject)`.
- `insertAction(entries: Seq[OutputHistoryInsert]): DBIO[Unit]` — a lifted Slick table `++=` (JDBC batch, one round trip; repo precedent `PipelineRunRepository.scala:410`, `DataSourceRepository.scala:350`), or an equivalent FULLY parameterized statement. **No `#$` interpolation of any entry field** (round 1 CR4): `summary` carries user-controlled column names and string x-values and this runs on the BYPASSRLS pool. `summary` is bound as JSONB via the column mapping (as `outputs.config` already is). `DBIO.successful(())` when empty. Composable — never runs itself.
- `listRecent(outputId, limit): Future[Vector[OutputHistoryPoint]]` — newest first (`captured_at DESC, id DESC` tiebreak).
- `nearestAtOrBefore(outputId, at: Instant): Future[Option[OutputHistoryPoint]]` — latest point with `captured_at <= at` (D6 baseline).
- `earliest(outputId): Future[Option[Instant]]` — oldest `captured_at` (D6 `availableFrom`).
- `thinAndPurge(now: Instant, policy: HistoryThinningPolicy, maxAgeByTier: Map[UserTier, Duration]): Future[Int]` — returns rows deleted. One transaction: (1) delete rows older than the owning user's tier max age (join `outputs.owner_id → users.tier`; tier missing from the map → no age purge for it); (2) keep ONLY the newest point per `(output_id, bucket)` where the bucket is epoch-aligned (`floor(epoch(captured_at)/bucket_seconds)`) and bucket size depends on age `now - captured_at`: `< recentWindow (24h)` → `recentBucket (5 min)`, `< midWindow (7d)` → `midBucket (1h)`, else `oldBucket (1d)`. Implemented as `DELETE ... WHERE id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY output_id, age_class, bucket ORDER BY captured_at DESC, id DESC) rn ...) WHERE rn > 1)`. Idempotent (a second call deletes 0). `HistoryThinningPolicy` is a case class with D4's defaults; L2 owns its env loading and scheduling.
No `fromEnv` config object is added here (L2).

### D-4 Transactional write path (D9)

`NodeSnapshotRepository`:
- extract today's body into `def overwriteRowsAction(pipelineId, nodeStepId, rows, explicitRootId): DBIO[Unit]` (unchanged SQL);
- `overwriteRows(...)` keeps its signature and behaviour: `ctx.withSystemContext(overwriteRowsAction(...))` — the backfill keeps calling this (history-free by construction);
- new `overwriteRowsWith(pipelineId, nodeStepId, rows, explicitRootId, andThen: DBIO[Unit]): Future[Unit]` = `ctx.withSystemContext((overwriteRowsAction(...) >> andThen).transactionally)` — one transaction, so a failing `andThen` rolls back the replace.

`PipelineRunService`:
- new nullable constructor param `outputHistoryRepo: OutputHistoryRepository = null` (same nullable-default convention as `nodeSnapshotRepo`).
- thread `triggerSource: String` from `executeRun` → `executeRunSuccess` → `onRunSuccess` → `onUnblockedRunSuccess` (private methods; no public signature change).
- in `materializedWrites`, after `listByPipelineInternal`, call `outputRepo.findConfigsByIdsInternal(outputs.map(_.id.value))` ONCE per run (only when `outputHistoryRepo != null`). Per materialized node: build one `OutputHistoryInsert` per Output on that node (`summary = OutputSummaryReducer.summarize(nodeJsRows, o.kind, config)`, `captured_at = now` — the run's single `now` val, so all nodes of one run share a timestamp — `run_id = runId.value`, `trigger_source = triggerSource`, `row_count = nodeJsRows.size`, `pipeline_id`, `node_step_id`/`root_id` from the node key exactly as `overwriteRows` resolves them — for a root-bound node use the explicit root id), then `nodeSnapshotRepo.overwriteRowsWith(..., outputHistoryRepo.insertAction(entries))`. When `outputHistoryRepo == null` the existing `overwriteRows` call is used unchanged.
- Not best-effort (D9): a history failure fails that node's transaction exactly like a snapshot-insert failure does today (same propagation; no `recoverWith`). Cross-node atomicity stays out of scope (unchanged HEL-905 Decision 3).
- Previews (`/preview`, dry-run previews, output previews) never reach `executeRun`, so they are structurally excluded alongside the listed paths.
- Exclusions are structural: dry/blocked/failed/write-back-failure never reach `onUnblockedRunSuccess`; the backfill calls `overwriteRows`. Each gets a test that would go red if history leaked into it.

### D-5 Wiring (pre-wire only)

`Main.scala` constructs `val outputHistoryRepo = new OutputHistoryRepository(ctx)` alongside the other repos and passes it to `ApiRoutes` via a new defaulted (`= null`) constructor param — Main owns the instance because L2 schedules retention from Main's scheduler wiring (it needs the repo there, not inside ApiRoutes), and the ticket asks for both files pre-wired. `ApiRoutes` exposes `val outputHistoryRepoOpt: Option[OutputHistoryRepository] = Option(outputHistoryRepo).orElse(Option(dbContext).map(new OutputHistoryRepository(_)))` (so DB-backed test fixtures exercise the real path with no constructor churn across the 19 `new ApiRoutes(` sites) and threads `outputHistoryRepoOpt.orNull` into `PipelineRunService`. No route, no scheduler change. If an unused-value lint fires on `Main`, the val is used by the ApiRoutes call so it does not.

### D-6 Cost measurement

A measurement spec/script (not a gate) that runs one real pipeline run over a ~1000-row node with ≥ 1 metric and 1 chart Output, with and without `outputHistoryRepo`, reporting: extra SQL round trips and statements per run (expected: +1 config query per run, +1 JDBC batch round trip per materialized node carrying one INSERT statement per Output on that node unless the driver rewrites batches), reducer CPU time, and wall time delta of the node transaction (median of ≥ 5 runs). Numbers go into the executor's report and the PR body; no hard threshold assertion (timing asserts are flaky — MISTAKES.md "gates all run on one machine").

## Risks / Trade-offs

- **Divergence recorded for L8**: `AlertEvaluationService.extractMetric` does not coerce strings, unlike this reducer. A rolling-average baseline from history vs a live alert value could disagree on CSV string numbers. Not changed here (out of scope); the executor records file:line in its report and the PR body for L8.
- **Divergence recorded for L3/L5**: the dashboard metric today aggregates over `filteredRawRows` (stringified, first page only, with `null` collapsed to a sentinel that `count` counts), and the per-row chart parses y with `parseFloat` (`"12abc"` → 12). The stored summary follows `computeAggregate` over typed rows (D3's canonical value). The headline switch is L3/L5's job; they must use these values, not re-derive.
- Series `x` is the raw cell JSON; the 200-point cap bounds count, not per-point size. Strings longer than 256 chars are truncated to 256 in stored points (recorded for L3).
- Write amplification: every real run now inserts N small rows (one per Output). Bounded by the 10 runs/min/user guard; thinning (L2) bounds storage.
- History insert failure now fails a run that previously succeeded (D9's explicit choice). Concretely: an Output deleted between `listByPipelineInternal` and its node transaction makes the history insert violate the FK, failing that node's transaction (snapshot not replaced, run future errors), where before `updateSchemaInternal` silently updated 0 rows. Accepted as a narrow race; not papered over with best-effort.
- Pre-existing (HEL-905 Decision 3), unchanged: `updateMeta`/`updateRun` are eager Futures that mark the run `succeeded` regardless of `materializedWrites`, so a later-node failure can leave earlier-node history from a run the API reports as an error.
- Thinning partitions by age class, so a coarse bucket straddling the 24h/7d boundary may briefly keep two points (self-heals on a later pass). For L2/L3: after thinning, D6's `previous_run` (second-newest point) is the previous RETAINED point, not necessarily the literal previous run.
- Metric field resolution with a multi-key `fieldMapping` deliberately differs from the dashboard's `Object.values(fieldMapping)[0]` (insertion order a spray `JsObject` cannot reproduce), and the `aggregation.value` fallback (reached only when `fieldMapping` is empty, where the dashboard renders nothing) has no dashboard counterpart; recorded for L3/L5.
- RLS is invisible to superuser dev/CI (MISTAKES.md): the proof must run under `SET ROLE helio_app_test`.
