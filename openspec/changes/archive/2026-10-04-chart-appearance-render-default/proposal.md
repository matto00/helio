## Why

A chart panel whose stored appearance has no `chart` sub-object renders with none of the app's chart theming:
there is no tooltip at all on a single-series chart (the option carries no `tooltip` key) and only an
unstyled ECharts default box on a multi-series bar/line (stark white in dark theme), gridlines/axis lines are ECharts'
default colour, and canvas text/axis labels use the browser default font. Every create path in the product
(Add-panel dialog, first-run, persona templates, apply-proposal/MCP without chart fields, import/duplicate of
such a panel, and a `chart: null` appearance PATCH) yields exactly this state, so a freshly built dashboard
looks unthemed until the user opens and saves the appearance editor.

## What Changes

- Chart rendering treats an absent `appearance.chart` as the default chart appearance (the same default the
  appearance editor already pre-fills), so tooltip, axes, gridlines, fonts and legend placement are themed.
- Stored data is unchanged: no backend change, no migration, no write-time default. Existing stored chart-less
  panels are fixed on next render.
- Panels that do store `appearance.chart` render exactly as before (including `tooltip.enabled: false`).

## Capabilities

### New Capabilities

### Modified Capabilities
- `echarts-chart-panel`: adds a requirement that a chart panel with no stored chart appearance renders with
  the default chart appearance's theming, identical to one storing the default explicitly.

## Impact

- Frontend only: the chart option assembly (`frontend/src/features/panels/ui/buildChartOption.ts`) and its
  tests. Every chart mount that goes through it (grid panel, fullscreen overlay, mobile stack, output preview)
  benefits.
- No API, schema, or migration change. No PanelGrid/layout code touched.

## Non-goals

- HEL-1181 (pie needle slices) and HEL-1182 (metric fieldMapping order) — v0.9, untouched.
- Changing what any create path stores (the apply-proposal spec explicitly keeps `appearance.chart` unset when
  no chart fields are given).
- Changing the appearance editor or the PATCH merge semantics.
