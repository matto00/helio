## Why

Chart panels already have a field mapping UI and a data-fetch pipeline (`usePanelData`), but `ChartPanel` renders a static empty ECharts chart and ignores all fetched data and mappings. This ticket closes that gap by wiring the fetched data and `fieldMapping` through to the ECharts render.

## What Changes

- `ChartPanel` accepts `rawRows`, `headers`, and `fieldMapping` props and builds an ECharts option from them
- `PanelContent` passes the mapped chart data through to `ChartPanel` (currently passes nothing)
- Chart renders a line or bar series using the xAxis field as categories and the yAxis field as values; the optional series field groups multiple series
- Unmapped fields (no xAxis or yAxis selected) show an informative empty state in place of an empty chart
- No backend changes required: `fieldMapping`, `rawRows`, and `headers` are already produced by `usePanelData`

## Capabilities

### New Capabilities
- `chart-field-data-rendering`: ChartPanel reads `fieldMapping` and `rawRows`/`headers` to build a live ECharts series; includes empty state for unmapped fields

### Modified Capabilities
- `echarts-chart-panel`: ChartPanel gains data props; the unbound empty-chart scenario is refined to also cover "mapped but no data" and "unmapped fields" cases

## Impact

- `frontend/src/components/ChartPanel.tsx` — primary change; add props and ECharts data transform
- `frontend/src/components/PanelContent.tsx` — pass `rawRows`, `headers`, `fieldMapping` to `ChartPanel`
- `frontend/src/components/PanelGrid.tsx` — pass `panel.fieldMapping` through `PanelCardBody` to `PanelContent`
- Test: `ChartPanel` unit tests for data rendering and empty state
- No schema, API, or backend changes

## Non-goals

- Advanced chart configuration (colors, legend customization, tooltips beyond defaults)
- Series grouping beyond using a third column as a series label
- Chart type switching in this ticket (line/bar both use the same slot structure)
