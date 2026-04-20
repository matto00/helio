## Why

The ECharts integration (HEL-65) renders a default line chart for all chart panels. Users currently have no way to choose which chart type a panel displays, making chart panels functionally uniform. This ticket adds the UI and persistence layer so users can pick from line, bar, pie, and scatter chart types within the panel detail modal.

## What Changes

- Add a chart type selector control to the panel detail modal (Appearance tab) for chart-type panels
- Extend the panel appearance schema to include a `chartType` field (`line | bar | pie | scatter`)
- Backend persists `chartType` as part of the panel appearance JSON
- The ECharts panel reads `chartType` from appearance and passes the correct option set to ECharts
- Selecting a type updates the live chart preview immediately (no Save required for preview)
- Default chart type is `line` when unset

## Capabilities

### New Capabilities

- `chart-type-selector`: UI control in panel detail modal for selecting chart type; live preview update; chartType stored in appearance

### Modified Capabilities

- `echarts-chart-panel`: chart rendering must switch ECharts option set based on `appearance.chartType` (requirement change — currently always renders line chart)
- `panel-appearance-settings`: appearance schema gains `chartType` field (requirement change — new field in validated schema)

## Non-goals

- Area chart and stacked bar are stretch goals and are excluded from this ticket
- Data binding / real data series are out of scope; chart preview uses placeholder data
- Custom ECharts theming or per-series color controls

## Impact

- Frontend: `ChartPanel` component, panel detail modal (Appearance tab), appearance Redux state
- Backend: panel appearance JSON schema validation, Flyway migration not needed (appearance stored as JSONB)
- Schema: `schemas/panel.json` gains optional `chartType` enum field
