# Per-chart-type config — line / bar / pie / scatter (HEL-248)

## Why

A Chart panel exposes one uniform config surface no matter which chart type it renders, so type-specific ECharts
capabilities (smoothing, stacking, donut holes, bubble sizing…) are unreachable. Each chart type has meaningfully
different config needs; the editor should surface type-appropriate options that swap with the selected chart type.

## What Changes

- `ChartPanelConfig` gains an optional `chartOptions` object, keyed **per chart type** (`line`/`bar`/`pie`/`scatter`),
  persisted end-to-end following the HEL-253/HEL-255 typed-config-column precedent (TS type → `panel.schema.json` →
  domain Scala decode/patch with allow-list validation → `PanelRowMapper` → repository config-column write path →
  Flyway migration, single nullable `chart_options` JSONB column). Absent = current behavior; existing rows need zero
  migration.
- Per-type options (each maps to a real ECharts option — see design.md for the exact mapping):
  - **Line**: smoothing, point markers, area fill.
  - **Bar**: orientation (vertical/horizontal), stacking (none/stacked/normalized), group spacing.
  - **Pie**: donut hole size, show percentage labels.
  - **Scatter**: point size field, color-group field (data-column bindings refining the existing xAxis/yAxis mapping).
- The panel edit pane gains a chart-type-specific "Display" section that swaps live with the chart type selected in
  the Appearance section, in the Epic A config language, riding the existing dirty/save/cancel contract
  (mirrors `TableDisplayFields`/`useTableDisplayState`).
- `ChartPanel` rendering applies the persisted options for the active chart type; options stored for other types are
  preserved (switching type never destroys another type's options, nor binding/appearance/refresh interval).
- Creation-modal chart type choice gains `scatter` (currently line/bar/pie only) for four-type parity.
- `BindingEditor.tsx` is split rather than grown past the 400-line CONTRIBUTING.md threshold.

## Capabilities

### New Capabilities

- `chart-type-display-config`: persisted per-chart-type display options on `ChartPanelConfig` (wire shape,
  validation, persistence, back-compat).
- `chart-type-config-editor`: the type-specific Display section in the panel edit pane (swap behavior, controls,
  mobile touch targets).

### Modified Capabilities

- `echarts-chart-panel`: rendering SHALL apply the persisted per-type options to the built ECharts option.
- `panel-creation-type-config`: creation-modal chart type selector offers four options (adds Scatter).

## Impact

- Frontend: `panel.ts` types, `ChartPanel.tsx`, `chartAppearance.ts` (unchanged or minor), editors
  (`BindingEditor.tsx` split + new `ChartDisplayFields`/`useChartDisplayState`), `panelPayloads`/`panelThunks`
  PATCH path, `PanelDetailModal.css` (+ mobile media block + CSS-lock test), creation modal chart types.
- Backend: `ChartPanel.scala`, `RequestValidation`, `PanelRowMapper`, `PanelRepository`, Flyway `V56`.
- Contract: `schemas/panel.schema.json` `$defs.ChartConfig`.

## Non-goals

- Moving `chartType` out of `appearance.chart` (it stays the selector's home; no breaking wire change).
- Multi-series binding redesign (existing `xAxis`/`yAxis`/`series` fieldMapping slots are untouched).
- New chart types beyond the existing four; per-type theming beyond the listed options.
