## Standing Constraints

- [C1] Test-only unless a test exposes a real order dependence; never edit usePanelData.ts, outputConfigTypes.ts, Output schemas or PanelCard.tsx.
- [C2] Every new test must be red under a recorded mutation that reinstates a positional pick (D6); GUARDs labelled as such.
- [C3] `sbt testFull`/`testOnly` only, never bare `sbt test`; no root `jest --coverage`; cap parallelism at 3–4, nice -n 19.

### Backend

## 1. Backend tests

- [x] 1.1 `OutputSummaryReducerSpec`: label-first, unit-first and unit+label-first `fieldMapping` (with/without `aggregation.agg`) resolve `value`, with D1 discriminating fixtures and D4 precondition; verify with `sbt "testOnly *OutputSummaryReducerSpec"`
- [x] 1.2 `OutputFilteredMetricRoutesSpec` (authenticated rows route): value-first-written and label-first-written metric configs both return `metric.field` = value column and the exact full-filtered value; D3 stored-order precondition; verify with `sbt "testOnly *OutputFilteredMetricRoutesSpec"`
- [x] 1.3 Same as 1.2 for the public panel rows route (`PublicPanelRowsResolver`); verify with testOnly of the spec it lands in
- [x] 1.4 Record server mutation (first `fieldMapping` entry) → 1.1–1.3 red; revert; record evidence

### Frontend

## 2. Frontend tests

- [x] 2.1 `metricHistoryView.test.ts`: `resolveServerMetricField` label-first/unit-first returns the value field (and aggregation identity); verify with `npm test -- --testPathPatterns=metricHistoryView`
- [x] 2.2 New `MetricOutputPanel` key-order test: loaded first-row value, loaded aggregate value, accepted `filteredMetric`, history headline — each label-first equals value-first; injected filteredMetric/headline values MUST differ from the loaded-rows value so acceptance vs fallback is distinguishable; verify with `npm test -- --testPathPatterns=MetricOutputPanel`
- [x] 2.3 `CollectionRenderer.test.tsx`: label-first mapping renders values from the value column (labelled GUARD), asserting on the value element specifically (label number renders too), mutation placed after the slot loop; verify with `npm test -- --testPathPatterns=CollectionRenderer`
- [x] 2.3a Optional: add a label-first case to `shared-test-fixtures/output-summary-reducer.json` so client and server pin the same answer
- [x] 2.4 Record client mutations (positional pick in `resolveServerMetricField`; positional `item.value` in CollectionRenderer) → 2.1–2.3 red; revert; record evidence

## 3. Verification

- [x] 3.1 Full gates: `npm run lint`, `npm run typecheck`, `npm test` (frontend), `sbt testFull`; `git diff` shows test/spec files only (C1)
