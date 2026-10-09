## Why

The panel detail modal seeds its chart-appearance edit state with `chartType: "line"` when the panel stores none. The
chart section is hidden and the save path does not send `appearance.chart` today, so this is latent — but the moment
either is wired up, the modal would freeze an implicit "line" onto the panel and override the bound Output's
`config.chartType`, re-creating on the frontend the bug HEL-1304 fixed on the backend merge path.

## What Changes

- `buildInitialChart` (PanelDetailModal.tsx) leaves `chartType` unset when the panel stores none. Note the shared
  `defaultChartAppearance` itself carries `chartType: "line"` and is spread first, so the fix must omit that key, not
  just drop the `?? "line"` fallback.
- A stored panel `chartType` is still carried through unchanged.
- New unit test: panel with no stored chartType bound to a `bar` Output → initial chart state has no `chartType`, and a
  save sends no `appearance.chart`/`chartType`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chart-type-selector`: adds a requirement that the detail modal never seeds an implicit chart type into its edit state.

## Impact

- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` (one function) and one new test file.
- No backend, schema, API, or migration change. Stored rows untouched (HEL-1379 ruling).

## Non-goals

- Changing `defaultChartAppearance` (shared by buildChartOption, HistoryChart, OutputPreviewPane, UsageChart,
  ChartOutputPanel).
- Enabling the chart section or wiring `appearance.chart` into the modal's save.
- Migrating stored implicit "line" values (owner ruled no, HEL-1379).
- Splitting PanelDetailModal.tsx (HEL-1399).
