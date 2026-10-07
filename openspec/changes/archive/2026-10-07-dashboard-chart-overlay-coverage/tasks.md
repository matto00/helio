## Standing Constraints

- [C1] Dashboard chart overlay is drawn only when the panel holds the Output's complete rows (rowsTruncated===false) and no viewer/cross filter narrows them; truncated (>200-row) panels get no overlay, aggregated or not (item 2 deferred to HEL-1358).
- [C2] Dashboard aggregated chart panels group loaded rows client-side with the SAME function the editor preview uses — no second grouping implementation.

### Frontend

## 1. Frontend — aggregation (item 1)

- [x] 1.1 Add `chartAggregationSpec` (design D1); switch `OutputPreviewPane`'s gating to it
- [x] 1.2 `ChartOutputPanel` takes record rows and computes `chartAggregate` via `groupAndAggregate` (D2)
- [x] 1.3 Thread cross-filter-narrowed record rows from `OutputPanelContent`; supply them from `PanelFullscreenOverlay` and `PanelDetailModal`
- [x] 1.4 Remove the dead always-null `chartAggregate` prop chain where it becomes unused
- [x] 1.5 Aggregated click-select keys on `aggregation.groupBy` (D3)
- [x] 1.5a `ChartInspectConfig` carries the aggregation spec; Inspect filters aggregated selections on groupBy over record rows (D3)
- [x] 1.5c Pass the aggregation spec from `ChartOutputPanel` through `ChartRenderer`/`ChartPanel` to `useChartClickHandler`
- [x] 1.5b Name the aggregated primary series `<agg>(<yField>)` in `buildAggregateDataOption` (D4a)
- [x] 1.6 `selectChartOverlay` accepts a matching `grouped` series (D4); C1 unchanged
- [x] 1.7 `chartCompareBlocker`/`ChartCompareField` copy per D5; drop `compareBlockerInput`'s scatter workaround

## 2. Frontend — compact legend (item 3)

- [x] 2.1 `buildChartOption` keeps a compact legend when an overlay was applied in compact mode (D6)

## 3. Frontend — chart-type default (item 4)

- [x] 3.1 Add `resolvePanelChartType`; use it in `ChartOutputPanel` and `PanelCard`'s `chartInspectConfig` (D7)

### Tests

## 4. Tests

- [x] 4.1 Unit: `chartAggregationSpec`, grouped `selectChartOverlay` match/mismatch/truncated/filtered, blocker cases
- [x] 4.2 Unit: dashboard aggregate equals preview aggregate on the same records (incl. null groupBy cell)
- [x] 4.3 Component: aggregated chart renders grouped on card, fullscreen, detail modal; click dimension; Inspect rows incl. null group; scatter-panel-on-aggregated-Output keeps xAxis keying
- [x] 4.4 Unit: compact legend with/without overlay and explicit-hidden; resolver default/override; Inspect type
- [x] 4.4a Test: detail modal save payload carries no `appearance.chart` key
- [x] 4.5 e2e: aggregated chart Output with compare 7d shows grouped bars + "vs 7d" on a dashboard (seeded history), both themes
- [x] 4.6 Running-app check of items 1/3/4 in light and dark themes, screenshots saved inside the worktree
