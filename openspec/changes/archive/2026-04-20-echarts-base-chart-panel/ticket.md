# HEL-65: ECharts integration + base chart panel

## Context

The chart panel type currently renders a placeholder. This ticket wires up a real ECharts instance as the foundation for all subsequent chart configuration work.

## What changes

* Install `echarts` and `echarts-for-react` (or equivalent React wrapper)
* Create a `ChartPanel` component that mounts an ECharts instance sized to the panel
* Wire `ChartPanel` into the panel type router in `PanelGrid` for panels with `type === "chart"`
* Render a sensible default chart (e.g. empty line chart with placeholder axes) when no config is set
* Chart resizes correctly when the panel is resized on the grid

## Acceptance criteria

- [ ] `echarts` package is installed and importable
- [ ] A panel with type `chart` renders an ECharts instance instead of a placeholder
- [ ] The chart fills the panel card area and reflows when the panel is resized
- [ ] No console errors when the chart panel mounts or unmounts
- [ ] Existing non-chart panel types are unaffected
