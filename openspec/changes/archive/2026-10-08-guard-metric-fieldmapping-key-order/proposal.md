## Why

HEL-1182 reported a metric panel picking its value column by `fieldMapping` key position, which breaks after a
Postgres jsonb round-trip reorders keys. HEL-1275 and HEL-1326 already replaced that with a by-key rule on every path,
so the bug is gone on main — but nothing pins it: no test asserts that a `label`- or `unit`-first mapping still
resolves `value`. A future refactor could reintroduce a positional pick and every gate would stay green.

## What Changes

- Add regression tests, red-proven by mutation, that shuffle `fieldMapping` key order on every metric-value path:
  - client: the metric-field resolver and the metric panel's loaded-rows, filtered-metric and headline values;
  - client: the collection renderer's per-slot mapping;
  - server: the history summary's metric field/value selection;
  - server: the full-filtered-set metric on the authenticated Output rows route and the public panel rows route,
    through a real database round-trip.
- Add a key-order scenario to the existing "Metric field selection never picks a label or unit mapping" requirement.
- No production-code change expected (test-only premise-refuted closure).

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-snapshot-history`: the metric-field-selection requirement gains an explicit key-order-independence scenario
  (behavior already true on main; the scenario makes the contract testable and stated).

## Non-goals

- Changing the backend to preserve JSON key order (jsonb normalises key order; any order-reliant fix is not a fix).
- Touching `usePanelData.ts`, `outputConfigTypes.ts`, Output config schemas or `PanelCard.tsx` (concurrent lanes).
- Chart/table key-order behavior (charts read named slots `xAxis`/`yAxis`; out of this ticket's scope).

## Impact

- Test files only: frontend Jest (`metricHistoryView`, `MetricOutputPanel`/`PanelContent` metric tests,
  `CollectionRenderer`), backend ScalaTest (`OutputSummaryReducerSpec`, `OutputFilteredMetricRoutesSpec`, public
  panel rows spec).
- One delta spec scenario. Credit for the actual fix: HEL-1275 (#779) and HEL-1326 (#805).
