# Tasks — per-chart-type-config (HEL-248)

## 1. Backend — schema, domain, persistence

- [x] 1.1 Flyway `V56__panel_chart_options.sql`: `ALTER TABLE panels ADD COLUMN chart_options JSONB` (nullable, doc comment per V55 style)
- [x] 1.2 `ChartPanel.scala`: typed `ChartOptions` (+ `LineOptions`/`BarOptions`/`PieOptions`/`ScatterOptions`) with Option fields; `ChartPanelConfig.chartOptions: Option[ChartOptions]`; `decode`/`decodeCreate` tolerant of absent/invalid; `Patch.chartOptions: Option[Option[ChartOptions]]` (absent/null/replace); `applyPatch`
- [x] 1.3 Allow-list validation: `orientation`, `stacking` enums; `barGapPct` 0–100, `donutHolePct` 0–90 → 400 with field-naming message (HEL-255 density precedent; wire via domain decode/`RequestValidation` as the existing pattern dictates)
- [x] 1.4 `PanelRowMapper`: chart read arm (`chartConfig`) parses `chart_options`; **write arm** (`domainToRow` ChartPanel case) serializes it — both directions (duplicate/snapshot path)
- [x] 1.5 `PanelRepository`: add `chartOptions` to `PanelRow` + config-column write path (HList past 22-col ceiling per HEL-255)
- [x] 1.6 `schemas/panel.schema.json`: `$defs.ChartConfig.chartOptions` + per-type `$defs` with enums/ranges

## 2. Frontend — types, wire, editor, rendering

- [x] 2.1 `panel.ts`: `LineChartOptions`/`BarChartOptions`/`PieChartOptions`/`ScatterChartOptions`/`ChartTypeOptionsMap`; `ChartPanelConfig.chartOptions?`; add `"scatter"` to `ChartTypeConfig`
- [x] 2.2 PATCH path: thread `chartOptions` through `panelPayloads`/`panelThunks`/`panelService` (`updatePanelBinding`), undefined = omit key, null = clear (mirror `tableDisplay`)
- [x] 2.3 `useChartDisplayState.ts`: per-type option state keyed off live chartType; dirty tracking vs initial; `reset()`; `patch` merging edited type into stored map (other types pass through)
- [x] 2.4 `ChartDisplayFields.tsx`: "Display" section, one type's controls at a time (line toggles; bar orientation/stacking/gap; pie donut/percent labels; scatter size/color field selects with "— None —", bound-only); shared components + DESIGN.md tokens; inline hints for non-obvious controls
- [x] 2.5 `PanelDetailModal` → `BindingEditor`: pass live `chartType` prop; mount `ChartDisplayFields` for chart panels; ride save/reset/dirty contract
- [x] 2.6 Split `BindingEditor.tsx` (extract `MetricBindingFields.tsx`, behavior-preserving) to stay under 400 lines
- [x] 2.7 `ChartPanel.tsx`: apply active-type options in `buildDataOption` + `buildAggregateDataOption` per design D4 (incl. horizontal axis swap, normalized percent transform, donut radius, scatter size/color); `compact` merge unchanged
- [x] 2.8 `ChartCreatorFields`: add Scatter option (four types)
- [x] 2.9 `PanelDetailModal.css`: Display-section styles; extend `@media (max-width: 768px)` 44px touch-target block; no horizontal overflow at 390px; clean trivial style debt in touched files

## 3. Tests

- [x] 3.1 Backend `PanelSpec`: ChartOptions decode with fields ABSENT (spray-json None-omission), null-clear vs absent-keep patch semantics, invalid enum/range → error
- [x] 3.2 Backend `PanelRowMapperSpec`: chart arm round-trip with/without chart_options; NULL column → absent
- [x] 3.3 Backend `ApiRoutesSpec`: PATCH persists chartOptions; PATCH without key leaves stored value; null clears; invalid stacking → 400; GET round-trip
- [x] 3.4 FE `useChartDisplayState` tests: dirty/reset/patch-merge preserves other types' entries; untouched → undefined patch
- [x] 3.5 FE `ChartDisplayFields` test: section swaps per chartType; scatter selects hidden when unbound
- [x] 3.6 FE `ChartPanel` tests: per-type option → ECharts option mapping (all four types incl. normalized sums to 100, axis swap, donut radius, scatter grouping)
- [x] 3.7 FE acceptance test: switching chart type + save preserves binding, appearance, refresh interval, and other types' options
- [x] 3.8 `PanelDetailModal.css.test.ts`: pin new mobile touch-target rules
- [x] 3.9 Creation modal test: four chart type options offered and submitted
