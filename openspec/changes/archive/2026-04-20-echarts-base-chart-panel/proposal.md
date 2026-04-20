## Why

The chart panel type renders a static bar-chart skeleton placeholder with no real charting capability.
Wiring up ECharts gives users a live, resizable chart instance and establishes the rendering foundation
all future chart configuration work will build on.

## What Changes

- Add `echarts` and `echarts-for-react` npm dependencies to the frontend
- Create a `ChartPanel` React component that mounts an ECharts instance filling the panel card body
- Route panels with `type === "chart"` through `ChartPanel` in `PanelGrid`
- Render a default empty line chart (with placeholder axes) when no data config is set
- Use ECharts' built-in `resize()` / `autoResize` to reflow when the panel is resized on the grid
- Remove the static bar-chart skeleton placeholder for chart panels

## Non-goals

- Chart configuration UI (axis labels, series type picker, color settings) — future ticket
- Data binding to real data sources — future ticket
- Exporting charts as images

## Capabilities

### New Capabilities

- `echarts-chart-panel`: React component that mounts and manages an ECharts instance inside a panel card,
  handling initial render, resize events, and clean unmount

### Modified Capabilities

- `panel-type-rendering`: The chart panel scenario changes from "renders a bar-chart skeleton" to
  "renders a live ECharts instance"; the unbound and bound scenarios need updating to reflect ECharts output

## Impact

- Frontend only — no backend or API changes
- New npm deps: `echarts`, `echarts-for-react`
- `PanelGrid` or its panel-type router updated to use `ChartPanel`
- Existing metric, text, and table panel paths are untouched
