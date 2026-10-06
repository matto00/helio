# HEL-1326 red/green evidence (task 3.6)

Red = the new test run against main's production code (production files stashed, tests kept);
green = the same tests on this branch. Full logs are in `evidence/`. `GUARD` = already passes on main
(constraint C1); never a red claim.

## Reds (fail on main, pass on branch)

| # | What | Command | Failing assertion on main | Logs |
|---|------|---------|---------------------------|------|
| 1 | Shared fixture `metricField` (TS port) | `cd frontend && npx jest src/utils/aggregate.fixture.test.ts` | 6 fail: `metricField: lone label mapping`, `lone unit mapping`, `lone label mapping with aggregation value`, `lone label mapping with aggregation but no value`, `lone unvalidated legacy key`, `empty value mapping string` (`expect(resolveServerMetricField(c.config)).toEqual(c.expected)`) | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-1-ts-metricField.log` |
| 2 | Reducer + shared fixture (Scala port) | `cd backend && sbt "testOnly *OutputSummaryReducerSpec *OutputSummaryReducerSeamSpec"` | 9 fail: reducer "null for a lone label mapping", "null for a lone unit mapping", "aggregate aggregation.value for {label} + aggregation.value" (`m.fields("field") shouldBe "amount"` got the label field), plus the 6 fixture cases | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-2-scala-reducer.log`, green `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/green-2-scala-reducer.log` (88 pass) |
| 3 | TS `resolveServerMetricField` | `npx jest src/features/panels/history/metricHistoryView.test.ts` | `never picks a lone label or unit mapping` (expected null), `aggregates aggregation.value for the {label} + aggregation shape` | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-3-ts-metricHistoryView.log` |
| 4 | Route specs (rows metric + history identity) | `sbt "testOnly *OutputFilteredMetricRoutesSpec *OutputHistoryMetricIdentityRoutesSpec"` | 8 fail: `key not found: metric` (full-set sum, avg, history current/baseline identity, HEL-1327 item 1 older-than-30 baseline); `None was not equal to Some(null)` (field-less metric auth and public, null identity); public key set `{items,limit,offset,total}` != `{..., metric}` | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-4-scala-routes.log`, green `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/green-4-scala-routes.log` (14 pass) |
| 5 | Client stale-baseline guard | `npx jest src/features/panels/history/metricHistoryView.test.ts` | `hides the delta when the baseline's own stored identity is another field`, `... had no metric (null identity)` (delta rendered on main) | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-5-ts-baseline-identity.log`, green `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/green-5-ts-history.log` |
| 6 | Authenticated RTL, real chain getOutputRows -> fetchPanelPage -> panelsSlice -> PanelCardBody -> PanelContent -> MetricOutputPanel | `npx jest src/features/panels/ui/PanelCard.filteredMetric.test.tsx` | 3 fail: `Unable to find an element with the text: 4,200` (filtered headline, and the clear-filter test's first step), `Unable to find ... "--"` (lone label shows no value) | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-6-rtl-filtered-headline.log` |
| 7 | Public RTL, fetchPublicPanelRows -> usePublicPanelData -> PanelContent | `npx jest src/features/dashboards/ui/PublicDashboardViewerPage.filteredMetric.test.tsx` | `Unable to find an element with the text: 4,200` | `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/red-7-rtl-public-filtered-headline.log` |

## Guards (pass on main, not reds)

- Rows: no `metric` key when unfiltered / offset > 0 / non-metric Output (auth), unfiltered public key set is exactly `{items,total,offset,limit}`.
- History: baseline selection unchanged for a mismatched identity (`baseline` still the nearest at or before, `delta` computed).
- Client: matching baseline identity still shows the delta; a baseline without identity (older server) keeps today's behaviour; no `metric` in rows response keeps the loaded-rows value; mismatched `metric` field/agg is ignored.
- D5 `existing-disclosure`: client-side cross-filter over truncated rows keeps the loaded-rows headline and renders "N of M loaded rows match." (`PanelContent.metricHistory.test.tsx`). Fixture uses `fieldMapping {value: amount, label: region}` so the unrelated lone-label bug cannot affect it; run on main's production files with ts-jest diagnostics off it passes 15/15 (`/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/guard-d5-on-main.log`).
- Stale filtered metric cleared when the filter is removed (slice sets `metric` undefined on a page-0 response without it): labelled guard (main never stored `metric`).

## D3 measurement (opt-in, `HELIO_MEASURE=1`, never in testFull/CI)

Command: `cd backend && HELIO_MEASURE=1 nice -n 19 sbt "testOnly com.helio.services.pipelines.OutputFilteredMetricMeasurementSpec"`
(log `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/measurement-d3.log`). EmbeddedPostgres, app pool without BYPASSRLS, `OutputService.rows` path,
filter `region eq east`, page 200, median of 20 calls after 3 warm-ups.

- Measurement numbers (fixture, not a cap): 120,000-row node, 60,000 matching the filter (>= 100k / >= 50k required).
- There is no per-node row cap: `node_snapshots` has none and `NodeSnapshotRepository.overwriteRowsAction` inserts every row it is given. Rows are bounded only upstream, per source: `CsvLimits.maxRows` (env `CSV_MAX_ROWS`, default 50,000; also `CSV_MAX_CELLS` 300,000), `InProcessPipelineEngine.MaxRunRows` = 1,000 (REST/SQL runs), `DataSourceService.DatasetMaxRows` = 500 (static/dataset). Join/union fan-out is unbounded. The 120k fixture is 2.4x the largest single-source default, and the filtered read cannot exceed what the run that wrote the node already held in memory.
- Rows call without metric (same node, table Output): median 76 ms.
- Rows call with metric (metric Output): median 121 ms.
- Added by the filtered full-set metric: 45 ms (bar <= 500 ms). Value check: sum over the 60,000 east rows = 3,600,000,000, asserted exact.
- Without the env var the spec is cancelled via `assume` (testFull shows 1 canceled).

## Gates

- `nice -n 19 sbt testFull`: Tests: succeeded 6069, failed 0, canceled 1 (the measurement spec) (`evidence/gate-sbt-testFull.summary.txt` (the 7.7 MB full log was not committed)), `sbt --client shutdown` run separately.
- `npm run lint`, `npm run format:check`, `npm run typecheck`: exit 0. Root jest 375 pass, frontend jest 4610 pass (`/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/openspec/changes/fix-metric-headline-and-field/evidence/gate-npm-test-frontend.log`), `npm --prefix frontend run build`: exit 0. `node scripts/check-schema-drift.mjs`: in sync (122 schemas, pairs `PublicPanelRowsResponse` and `OutputRowsResponse`).
