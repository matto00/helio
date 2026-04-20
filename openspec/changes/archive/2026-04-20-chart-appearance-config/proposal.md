## Why

Chart panels render ECharts instances but currently expose no controls for visual customization beyond generic panel appearance (background/color/transparency). Users need to configure chart-specific presentation — series colors, legend, tooltip, and axis labels — directly from the panel detail modal with live preview.

## What Changes

- Extend the panel appearance schema with a `chart` sub-object holding: `seriesColors` (array of hex strings), `legend` (enabled + position), `tooltip` (enabled), and `axisLabels` (showX, showY, optional labelX, labelY)
- Backend persists the new `chart` appearance fields alongside existing appearance fields; no breaking change to the existing appearance contract
- Frontend Appearance tab gains a "Chart" section with a color picker/palette selector, legend toggle + position selector, tooltip toggle, and X/Y axis label toggles with optional text inputs
- Chart panel reads appearance settings and passes them as ECharts options so changes preview in real time inside the panel detail modal

## Capabilities

### New Capabilities
- `chart-appearance-config`: Chart-specific appearance settings (series colors, legend, tooltip, axis labels) stored in panel appearance and applied to ECharts rendering

### Modified Capabilities
- `panel-appearance-settings`: Extend the appearance schema and backend persistence to include the new `chart` sub-object
- `echarts-chart-panel`: ECharts instance must consume appearance settings from the panel and apply them as ECharts options
- `frontend-resource-appearance-editing`: Appearance tab gains a chart-specific controls section with live preview

## Impact

- `schemas/panel.json` — add `chart` object to appearance
- Backend panel PATCH handler and Slick column (JSONB) — no schema migration needed; appearance is stored as a JSON blob
- `frontend/src/components/panels/ChartPanel.tsx` (or equivalent) — pass appearance options to ECharts
- `frontend/src/components/modals/PanelDetailModal` — extend Appearance tab with chart controls

## Non-goals

- Per-series (multi-series) individual color assignment — palette applies uniformly
- Tooltip template formatting (format string) — deferred to a follow-up
- Y2 / dual-axis configuration
