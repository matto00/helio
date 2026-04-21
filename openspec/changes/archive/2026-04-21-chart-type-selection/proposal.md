## Why

Chart panels hard-code `type: "bar"` for all ECharts series, ignoring any stored `chartType` in the
panel's appearance. The specs for `chart-type-selector` and `echarts-chart-panel` already define the
required behavior — this change closes the gap between those specs and the running code.

## What Changes

- Extend `ChartAppearance` schema and backend model to include an optional `chartType` field
  (`"bar"` | `"line"` | `"pie"` | `"scatter"`), defaulting to `"bar"` when absent
- Update `appearanceToEChartsOption` in `chartAppearance.ts` to propagate `chartType` into the
  ECharts series config; add special-case rendering for pie (no axes, `{name, value}` data) and
  scatter (x/y as coordinate pairs)
- Add a chart type selector (segmented control / radio group) to the Appearance tab of the panel
  detail modal, visible only for `type: "chart"` panels
- Live preview in the modal updates immediately as the user changes chart type
- `chartType` is included in the PATCH appearance payload so the selection persists on reload

## Capabilities

### New Capabilities

None — all required behavior is already specified in existing specs.

### Modified Capabilities

- `chart-type-selector`: no requirement changes; previously unimplemented selector control is now
  being built
- `echarts-chart-panel`: no requirement changes; `chartType` rendering path (including pie and
  scatter special cases) is now being implemented
- `panel-appearance-settings`: the `chartType` validation requirement already exists in the spec;
  the schema artifact is being updated to include the field

## Impact

- `schemas/panel.json` — add `chartType` to the `ChartAppearance` object definition
- `backend/` — `ChartAppearance` case class and JSON protocol updated to include `chartType`
- `frontend/src/` — `chartAppearance.ts`, `ChartPanel.tsx`, panel detail modal Appearance tab

## Non-goals

- Adding chart types beyond bar / line / pie / scatter
- Per-series chart type overrides
- Axis label customisation for pie/scatter (covered by existing `axisLabels` field, already tracked separately)
