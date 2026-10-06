## Standing Constraints

- [C2] No V117 migration or history backfill (owner ruling D4 `no-backfill`).
- [C3] D5 ruled `existing-disclosure`: no new metric loaded-rows copy.
- [C1] Every red-first test claim names the assertion that fails on main; assertions that already pass on main are labelled guards, never reds.

## 1. Backend

- [x] 1.1 `OutputSummaryReducer.metric`: drop the lone-mapping branch (D1); expose `metricOf(rows, config)` used by `summarize`; verify `OutputSummaryReducerSpec`
- [x] 1.2 `NodeSnapshotRepository`: projected filtered read of one field over all matching rows, always `row_index ASC` (D3); verify repository spec on EmbeddedPostgres
- [x] 1.3 Shared service helper (config read only when kind metric + resolved filter + offset 0) computing the filtered metric; `OutputRowsResponse.metric` (last, `= None`) + JSON format (D2); verify rows route spec
- [x] 1.4 Public route: `PublicPanelRowsResponse` under `api/protocols/**` (existing keys unchanged + optional `metric` last) wired through the helper (D2); verify public route spec
- [x] 1.5 Schemas: optional `metric` (object `{field, agg|null, value|null}` OR `null`) in `schemas/outputs/output-rows-response.schema.json`; new public panel rows schema titled `PublicPanelRowsResponse`; verify `node scripts/check-schema-drift.mjs` passes and pairs both
- [x] 1.6 History: additive `metric: {field, agg} | null` on resolved `current`/`baseline` (case classes + both history schemas, explicit null); selection unchanged (D4); verify history route specs + schema drift
- [x] 1.7 Non-gating, env-opt-in (`HELIO_MEASURE=1`, skipped in testFull/CI) measurement spec on EmbeddedPostgres (pattern: `OutputHistoryCostMeasurementSpec`): ≥100k-row node, ≥50k matching, median of 20, ≤500 ms added; record command, numbers, node row cap in the PR body

## 2. Frontend

- [x] 2.1 `resolveServerMetricField`: same rule as 1.1 (D1); verify metricHistoryView unit tests
- [x] 2.2 `getOutputRows`/`fetchPanelPage`/`panelsSlice`: carry `metric` on the page-0 pagination entry; a page-0 response without it clears it (D6); verify slice tests
- [x] 2.3 `fetchPublicPanelRows`/`usePublicPanelData`: parse and expose `metric` per request (D6); verify hook test
- [x] 2.4 `PanelContent` → `MetricOutputPanel` `filteredMetric` prop; headline rule per D6 (present `metric: null` + no-field config → no value) ; every client-fallback narrowing keeps the loaded-rows value (D5); verify RTL
- [x] 2.5 History types + `selectMetricHistoryView`: stale-baseline check uses `baseline.metric` when present, else today's `points` lookup (D4); verify unit + RTL
- [x] 2.6 D5 ruled `existing-disclosure`: no new UI; RTL guard that a metric panel under a client-side cross-filter with truncated rows renders the HEL-588 disclosure and the loaded-rows headline

## 3. Tests

- [x] 3.1 Shared fixture category `metricField` in `shared-test-fixtures/output-summary-reducer.json`, asserted by `OutputSummaryReducerSeamSpec` AND `aggregate.fixture.test.ts`; reducer unit: lone label/unit → `metric: null`, `{label}`+`aggregation.value` → aggregation field (reds)
- [x] 3.2 Route specs extending `com.helio.testkit.HelioRouteTest`: filtered metric over >200 matching rows = full-set aggregate, exact JSON keys, schema-valid (red); field-less metric → `"metric": null` present (red); public parity (red); absent when unfiltered/offset>0/non-metric (GUARDS); unfiltered public key set exactly `{items,total,offset,limit}` (GUARD)
- [x] 3.3 History route spec: `current.metric`/`baseline.metric` present with stored identity (red); HEL-1327 item 1: a window baseline OLDER than the 30 returned points carries a mismatched `baseline.metric` the client can check (red); baseline selection unchanged for mismatched identity (GUARD)
- [x] 3.4 Client unit: `resolveServerMetricField` → `null` for lone label/unit (red); out-of-window mismatched `baseline.metric` → no delta (red)
- [x] 3.5 RTL driving a mocked HTTP rows response → `fetchPanelPage` → slice → `PanelContent` → `MetricOutputPanel`: filtered headline shows `metric.value`, not the loaded sum (red); lone-label metric shows no value (red); stale `metric` cleared when the filter is removed (labelled red or guard)
- [x] 3.6 Record red/green evidence (command + failing assertion on main, passing on branch) for every red in the PR body
- [x] 3.7 Full gates: `nice -n 19 sbt testFull` (≤2 workers, Bash timeout 600000, then `sbt --client shutdown` as its own call), `npm test`, lint, typecheck, format
