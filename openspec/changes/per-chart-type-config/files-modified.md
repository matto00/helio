# Files modified — per-chart-type-config (HEL-248)

## Backend — schema, domain, persistence

- `backend/src/main/resources/db/migration/V56__panel_chart_options.sql` — new nullable `chart_options` JSONB column (zero data migration; NULL = prior rendering).
- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` — typed `ChartOptions` + per-type `LineChartOptions`/`BarChartOptions`/`PieChartOptions`/`ScatterChartOptions`; `ChartPanelConfig.chartOptions`; tolerant `decode` / strict `decodeCreate`; `Patch.chartOptions` (absent/null/replace) with allow-list enum + range validation (→ 400 via `PanelConfigCodec.safe`); `applyPatch`.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — chart READ arm (`chartConfig`) parses `chart_options`; chart WRITE arm (`domainToRow`) serializes it; `chartOptionsColumn`/`parseChartOptions` helpers (both directions — guards the HEL-245/255 duplicate/snapshot drop class).
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — `chartOptions` added to `PanelRow`, table column, the 24-column HList projection, and `configColumnsOf`/`configColumnValuesOf` (so both `replace` and `batchUpdate` write it).
- `schemas/panel.schema.json` — `$defs.ChartConfig.chartOptions` + new `ChartOptions`/`LineChartOptions`/`BarChartOptions`/`PieChartOptions`/`ScatterChartOptions` `$defs` with enums/ranges.

## Frontend — types, wire, editor, rendering

- `frontend/src/features/panels/types/panel.ts` — per-type option interfaces + `ChartTypeOptionsMap`; `ChartPanelConfig.chartOptions?`; `"scatter"` added to `ChartTypeConfig`.
- `frontend/src/features/panels/state/panelPayloads.ts` — `chartOptions` threaded through `buildBindingPatch` (undefined = omit, null = clear, object = replace).
- `frontend/src/features/panels/services/panelService.ts` — `chartOptions` param on `updatePanelBinding`.
- `frontend/src/features/panels/state/panelThunks.ts` — `chartOptions` on the `updatePanelBinding` thunk arg + forwarded to the service.
- `frontend/src/features/panels/ui/editors/useChartDisplayState.ts` — new hook: per-type working map keyed off the live chart type, dirty tracking, `reset()`, `patch` (merges the edited type, preserves others); `normalizeChartOptions` drops default-equivalents.
- `frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx` — new "Display" section; one type's controls at a time (line toggles / bar orientation+stacking+gap / pie donut+labels / scatter size+color selects); inline hints; DESIGN.md tokens.
- `frontend/src/features/panels/ui/editors/MetricBindingFields.tsx` — new; metric Value/Label/Unit block extracted from `BindingEditor` (behavior-preserving) for the D5 split.
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — mounts `ChartDisplayFields`, threads the live `chartType` prop, wires chart display into dirty/reset/save; swapped metric JSX to `MetricBindingFields`; now 398 lines (< 400 threshold).
- `frontend/src/features/panels/ui/editors/fieldOptions.ts` — `aggFieldOptions` moved here (shared; part of the BindingEditor slimming).
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — passes `chartType={chartAppearance.chartType}` to `BindingEditor` (live swap before save).
- `frontend/src/features/panels/ui/ChartPanel.tsx` — `chartOptions` prop; scatter size (3rd data dim + `symbolSize`) / color (series-per-value grouping) in `buildDataOption`; `applyChartTypeOptions` after appearance merge, before `compact`.
- `frontend/src/utils/chartTypeOptions.ts` — new; `applyChartTypeOptions` (line/bar/pie decoration incl. horizontal axis swap + normalized percent transform) and `makeScatterSymbolSize`.
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` / `PanelContent.tsx` — thread `config.chartOptions` to `ChartPanel`.
- `frontend/src/features/panels/ui/creators/ChartCreatorFields.tsx` — Scatter option added (four-type parity).
- `frontend/src/features/panels/ui/PanelDetailModal.css` — Display-section toggle-row + field-hint styles; `@media (max-width: 768px)` 44px targets for toggle rows and sliders.

## Tests

- `backend/.../PanelSpec.scala` — ChartOptions decode with fields ABSENT, empty→None, lenient-drop, strict create/patch rejection, absent/null/replace patch semantics, keyed-map preservation on partial edit; existing 3-arg `Patch` calls updated to 4-arg.
- `backend/.../PanelRowMapperSpec.scala` — chart-arm round-trip with/without `chart_options` (NULL → absent).
- `backend/.../ApiRoutesSpec.scala` — PATCH persists chartOptions across a real repo re-read; absent-key leaves stored; null clears; invalid stacking → 400.
- `frontend/.../useChartDisplayState.test.ts`, `ChartDisplayFields.test.tsx`, `ChartPanel.test.tsx` (chartOptions mapping incl. normalized sums-to-100, axis swap, donut radius, scatter grouping), `PanelDetailModal.chartDisplay.test.tsx` (acceptance: type switch + save preserves binding/refresh/other types), `PanelDetailModal.css.test.ts` (mobile locks), `PanelCreationModal.test.tsx` (four chart types).
- `frontend/src/test/panelFixtures.ts` — `makeChartPanel` accepts `chartOptions`.
- `frontend/.../PanelDetailModal.test.tsx` + `PanelDetailModal.aggregation.test.tsx` — trailing `chartOptions` arg added to `updatePanelBinding` positional assertions.
